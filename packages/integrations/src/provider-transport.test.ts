import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { FetchJsonProviderTransport } from "./provider-transport";
import type { ProviderTransportError } from "./provider-transport";
import {
  ClockworkTelemetry,
  InMemoryTelemetrySink,
} from "./telemetry/telemetry";
import { RuntimeBoundaryInstrumentation } from "./telemetry/instrumentation";

describe("FetchJsonProviderTransport", () => {
  it("rejects insecure remote endpoints and embedded credentials", () => {
    expect(
      () =>
        new FetchJsonProviderTransport({
          baseUrl: "http://provider.example/v1/",
          bearerToken: "secret-token",
          provider: "example",
        }),
    ).toThrow("PROVIDER_HTTPS_ENDPOINT_REQUIRED");
    expect(
      () =>
        new FetchJsonProviderTransport({
          baseUrl: "https://user:password@provider.example/",
          bearerToken: "secret-token",
          provider: "example",
        }),
    ).toThrow("PROVIDER_ENDPOINT_INVALID");
  });

  it("allows opted-in local HTTP and rejects every other local insecure scheme", () => {
    expect(
      () =>
        new FetchJsonProviderTransport({
          baseUrl: "http://localhost:8787/",
          bearerToken: "secret-token",
          provider: "example",
          allowInsecureLocalhost: true,
        }),
    ).not.toThrow();

    for (const baseUrl of ["ftp://localhost/", "file://localhost/tmp/"])
      expect(
        () =>
          new FetchJsonProviderTransport({
            baseUrl,
            bearerToken: "secret-token",
            provider: "example",
            allowInsecureLocalhost: true,
          }),
      ).toThrow("PROVIDER_HTTPS_ENDPOINT_REQUIRED");
  });

  it("sends scoped credentials and idempotency without following redirects", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ id: "provider-1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const transport = new FetchJsonProviderTransport({
      baseUrl: "https://provider.example/api/",
      bearerToken: "secret-token",
      provider: "example",
      fetch: fetcher,
    });
    const response = await transport.request({
      operation: "objects.create",
      path: "/v1/objects",
      body: { name: "Example" },
      response: z.object({ id: z.string() }),
      idempotencyKey: "objects:create:123456",
    });

    expect(response).toEqual({ id: "provider-1" });
    const [, init] = fetcher.mock.calls[0] ?? [];
    expect(init).toMatchObject({ method: "POST", redirect: "error" });
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer secret-token",
    );
    expect(new Headers(init?.headers).get("idempotency-key")).toBe(
      "objects:create:123456",
    );
  });

  it("calls the injected fetch with the global receiver", async () => {
    const receivers: unknown[] = [];
    const fetcher: typeof fetch = function (this: unknown) {
      receivers.push(this);
      if (this !== undefined && this !== globalThis)
        throw new TypeError("Illegal invocation");
      return Promise.resolve(
        new Response(JSON.stringify({ id: "provider-1" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    };
    const transport = new FetchJsonProviderTransport({
      baseUrl: "https://provider.example/api/",
      bearerToken: "secret-token",
      provider: "example",
      fetch: fetcher,
    });

    await expect(
      transport.request({
        operation: "objects.create",
        path: "/v1/objects",
        body: {},
        response: z.object({ id: z.string() }),
      }),
    ).resolves.toEqual({ id: "provider-1" });
    expect(receivers).toEqual([globalThis]);
  });

  it("maps rate limits to retryable transport failures", async () => {
    const transport = new FetchJsonProviderTransport({
      baseUrl: "https://provider.example/",
      bearerToken: "secret-token",
      provider: "example",
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ code: "RATE_LIMITED", message: "Try later" }),
            { status: 429, headers: { "retry-after": "2" } },
          ),
        ),
    });
    await expect(
      transport.request({
        operation: "objects.create",
        path: "/v1/objects",
        body: {},
        response: z.object({ id: z.string() }),
        idempotencyKey: "objects:create:123456",
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<ProviderTransportError>>({
        kind: "transient",
        code: "RATE_LIMITED",
        retryAfterMs: 2_000,
      }),
    );
  });

  it("stops reading a chunked response as soon as it exceeds the byte limit", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(700_000));
        controller.enqueue(new Uint8Array(700_000));
      },
      cancel() {
        cancelled = true;
      },
    });
    const transport = new FetchJsonProviderTransport({
      baseUrl: "https://provider.example/",
      bearerToken: "secret-token",
      provider: "example",
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(body, { status: 200 })),
    });

    await expect(
      transport.request({
        operation: "objects.create",
        path: "/v1/objects",
        body: {},
        response: z.object({ id: z.string() }),
      }),
    ).rejects.toMatchObject({
      kind: "permanent",
      code: "PROVIDER_RESPONSE_TOO_LARGE",
    });
    expect(cancelled).toBe(true);
  });

  it("keeps the deadline active after headers while the response body stalls", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    const transport = new FetchJsonProviderTransport({
      baseUrl: "https://provider.example/",
      bearerToken: "secret-token",
      provider: "example",
      timeoutMs: 100,
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(body, { status: 200 })),
    });

    await expect(
      transport.request({
        operation: "objects.create",
        path: "/v1/objects",
        body: {},
        response: z.object({ id: z.string() }),
      }),
    ).rejects.toMatchObject({
      kind: "transient",
      code: "PROVIDER_TIMEOUT",
    });
    expect(cancelled).toBe(true);
  });

  it("keeps the original throw as the cause of every transport failure", async () => {
    const network = new TypeError("ECONNRESET reading provider.example");
    async function failure(fetcher: typeof fetch, response: z.ZodType) {
      const transport = new FetchJsonProviderTransport({
        baseUrl: "https://provider.example/",
        bearerToken: "secret-token",
        provider: "example",
        fetch: fetcher,
      });
      return transport
        .request({
          operation: "objects.create",
          path: "/v1/objects",
          body: {},
          response,
        })
        .then(
          () => new Error("Expected the transport to reject"),
          (thrown: unknown) => thrown as Error,
        );
    }
    const schema = z.object({ id: z.string() });

    const networkFailure = await failure(
      vi.fn<typeof fetch>().mockRejectedValue(network),
      schema,
    );
    expect(networkFailure).toMatchObject({ code: "PROVIDER_NETWORK_ERROR" });
    expect(networkFailure.cause).toBe(network);

    const malformed = await failure(
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response("<html>gateway</html>", { status: 200 }),
        ),
      schema,
    );
    expect(malformed).toMatchObject({ code: "PROVIDER_RESPONSE_INVALID" });
    expect(malformed.cause).toBeInstanceOf(SyntaxError);

    const offSchema = await failure(
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(JSON.stringify({ id: 7 }), { status: 200 }),
        ),
      schema,
    );
    expect(offSchema).toMatchObject({
      code: "PROVIDER_RESPONSE_SCHEMA_INVALID",
    });
    expect(offSchema.cause).toBeInstanceOf(z.ZodError);
  });

  /**
   * The obvious way the cause fix goes wrong: telemetry reads the error the
   * transport throws. It takes `name` and `code` and nothing else, so a cause
   * carrying a provider host, body or credential cannot reach a span.
   */
  it("does not let a cause reach the telemetry span", async () => {
    const sink = new InMemoryTelemetrySink();
    const instrumentation = new RuntimeBoundaryInstrumentation(
      new ClockworkTelemetry(sink),
    );
    const transport = new FetchJsonProviderTransport({
      baseUrl: "https://provider.example/",
      bearerToken: "secret-token",
      provider: "example",
      fetch: vi
        .fn<typeof fetch>()
        .mockRejectedValue(
          new TypeError("connect ECONNREFUSED tenant-secret@10.0.0.5:443"),
        ),
    });

    await expect(
      instrumentation.provider({
        name: "provider.request",
        correlation: { requestId: "provider-cause-1" },
        operation: () =>
          transport.request({
            operation: "objects.create",
            path: "/v1/objects",
            body: {},
            response: z.object({ id: z.string() }),
          }),
      }),
    ).rejects.toThrow("example request failed");

    const span = sink.spans.at(-1);
    expect(span?.attributes).toMatchObject({
      "error.type": "ProviderTransportError",
      "error.code": "PROVIDER_NETWORK_ERROR",
    });
    const serialized = JSON.stringify(sink.spans);
    expect(serialized).not.toContain("ECONNREFUSED");
    expect(serialized).not.toContain("tenant-secret");
    expect(serialized).not.toContain("10.0.0.5");
  });
});
