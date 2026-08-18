import { describe, expect, it, vi } from "vitest";

import { HttpEsignSigningClient } from "./http-signing-client";

function input() {
  return {
    externalReference: "envelope-commerce-1",
    accountId: "10000000-0000-4000-8000-000000000001",
    documentId: "20000000-0000-4000-8000-000000000001",
    documentBytes: new TextEncoder().encode("immutable agreement"),
    documentSha256: "a".repeat(64),
    signerEmail: "buyer@northstar.example",
    mode: "redirect" as const,
    returnUrl: "https://commerce.fil.one/signing/return",
    idempotencyKey: "request-signing-1",
  };
}

describe("HTTP e-sign signing client", () => {
  it("sends immutable bytes with a stable key and returns an allow-listed URL", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            id: "provider-envelope-1",
            state: "sent",
            signingUrl: "https://sign.provider.example/session/1",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    const client = new HttpEsignSigningClient({
      baseUrl: "https://api.provider.example/",
      apiKey: "secret-test-key",
      signingOrigins: ["https://sign.provider.example"],
      fetchImplementation,
    });

    await expect(client.createEnvelope(input())).resolves.toEqual({
      id: "provider-envelope-1",
      state: "sent",
      signingUrl: "https://sign.provider.example/session/1",
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    const call = fetchImplementation.mock.calls[0];
    if (!call) throw new Error("Expected one provider request");
    const [url, request] = call;
    expect(url).toBeInstanceOf(URL);
    expect(new Headers(request?.headers).get("idempotency-key")).toBe(
      "request-signing-1",
    );
    if (typeof request?.body !== "string")
      throw new Error("Expected a JSON request body");
    expect(request.body).toContain("documentBase64");
  });

  it("rejects private endpoints and provider navigation outside the allow-list", async () => {
    expect(
      () =>
        new HttpEsignSigningClient({
          baseUrl: "https://127.0.0.1/",
          apiKey: "secret-test-key",
          signingOrigins: ["https://sign.provider.example"],
        }),
    ).toThrow("public HTTPS");

    const client = new HttpEsignSigningClient({
      baseUrl: "https://api.provider.example/",
      apiKey: "secret-test-key",
      signingOrigins: ["https://sign.provider.example"],
      fetchImplementation: vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            id: "provider-envelope-1",
            state: "sent",
            signingUrl: "https://attacker.example/session/1",
          }),
          { status: 200 },
        ),
      ),
    });
    await expect(client.createEnvelope(input())).rejects.toThrow(
      "untrusted signing URL",
    );
  });

  it("passes an abort signal and gives up on a provider that never answers", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("The operation was aborted", "AbortError")),
          );
        }),
    );
    const client = new HttpEsignSigningClient({
      baseUrl: "https://api.provider.example/",
      apiKey: "secret-test-key",
      signingOrigins: ["https://sign.provider.example"],
      timeoutMs: 100,
      fetchImplementation,
    });

    const started = Date.now();
    const error = await client
      .createEnvelope(input())
      .catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("E-sign envelope request timed out");
    // The cause the operator needs; discarded before this change.
    expect((error as Error).cause).toBeInstanceOf(DOMException);
    expect(Date.now() - started).toBeLessThan(5_000);
    const request = fetchImplementation.mock.calls[0]?.[1];
    expect(request?.signal).toBeInstanceOf(AbortSignal);
    expect(request?.signal?.aborted).toBe(true);
  });

  it("refuses a response larger than the transport bound", async () => {
    const client = new HttpEsignSigningClient({
      baseUrl: "https://api.provider.example/",
      apiKey: "secret-test-key",
      signingOrigins: ["https://sign.provider.example"],
      fetchImplementation: vi.fn<typeof fetch>(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              id: "provider-envelope-1",
              state: "sent",
              signingUrl: "https://sign.provider.example/session/1",
              padding: "x".repeat(1_048_577),
            }),
            { status: 200 },
          ),
        ),
      ),
    });

    await expect(client.createEnvelope(input())).rejects.toThrow(
      "exceeded the maximum size",
    );
  });

  it("cancels a chunked response when it crosses the transport bound", async () => {
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
    const client = new HttpEsignSigningClient({
      baseUrl: "https://api.provider.example/",
      apiKey: "secret-test-key",
      signingOrigins: ["https://sign.provider.example"],
      fetchImplementation: vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(body, { status: 200 })),
    });

    await expect(client.createEnvelope(input())).rejects.toThrow(
      "exceeded the maximum size",
    );
    expect(cancelled).toBe(true);
  });

  it("keeps the timeout active after headers while the body stalls", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    const client = new HttpEsignSigningClient({
      baseUrl: "https://api.provider.example/",
      apiKey: "secret-test-key",
      signingOrigins: ["https://sign.provider.example"],
      timeoutMs: 100,
      fetchImplementation: vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(body, { status: 200 })),
    });

    await expect(client.createEnvelope(input())).rejects.toThrow(
      "E-sign envelope request timed out",
    );
    expect(cancelled).toBe(true);
  });

  it("refuses a declared length beyond the bound before reading the body", async () => {
    const body = vi.fn();
    const client = new HttpEsignSigningClient({
      baseUrl: "https://api.provider.example/",
      apiKey: "secret-test-key",
      signingOrigins: ["https://sign.provider.example"],
      fetchImplementation: vi.fn<typeof fetch>(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ "content-length": "1048577" }),
          text: body,
        } as unknown as Response),
      ),
    });

    await expect(client.createEnvelope(input())).rejects.toThrow(
      "exceeded the maximum size",
    );
    expect(body).not.toHaveBeenCalled();
  });

  it("keeps the provider's malformed body out of the thrown message", async () => {
    const client = new HttpEsignSigningClient({
      baseUrl: "https://api.provider.example/",
      apiKey: "secret-test-key",
      signingOrigins: ["https://sign.provider.example"],
      fetchImplementation: vi.fn<typeof fetch>(() =>
        Promise.resolve(
          new Response("Bearer live-secret-not-json", { status: 200 }),
        ),
      ),
    });

    const error = await client
      .createEnvelope(input())
      .catch((thrown: unknown) => thrown);
    expect((error as Error).message).toBe(
      "E-sign provider returned invalid JSON",
    );
    expect((error as Error).cause).toBeInstanceOf(SyntaxError);
  });

  it("rejects a timeout outside the supported range at construction", () => {
    expect(
      () =>
        new HttpEsignSigningClient({
          baseUrl: "https://api.provider.example/",
          apiKey: "secret-test-key",
          signingOrigins: ["https://sign.provider.example"],
          timeoutMs: 120_000,
        }),
    ).toThrow("timeout is invalid");
  });
});
