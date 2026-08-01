import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { FetchJsonProviderTransport } from "./provider-transport";
import type { ProviderTransportError } from "./provider-transport";

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
});
