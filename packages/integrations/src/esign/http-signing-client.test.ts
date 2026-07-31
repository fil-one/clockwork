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
});
