import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { demoMutationOriginAllowed, handle } from "./demo-app";

const csrfToken = "12345678901234567890123456789012";
const orderProofHeaders = {
  origin: "https://demo.clockwork.test",
  cookie: `clockwork-csrf=${csrfToken}`,
  "x-csrf-token": csrfToken,
};

beforeEach(() => {
  vi.stubEnv("APP_ORIGIN", "https://demo.clockwork.test");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function commandRequest(headers: Record<string, string>): Request {
  return new Request(
    "https://demo.clockwork.test/api/v1/core/commands/quotes",
    {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({
        id: "88888888-8888-4888-8888-888888888888",
        accountId: "11111111-1111-4111-8111-111111111111",
        action: "create",
        payload: { route: "direct" },
      }),
    },
  );
}

describe("demo commerce api", () => {
  it("answers a mutation that carries replay and CSRF evidence", async () => {
    const response = await handle(
      commandRequest({
        "idempotency-key": "demo-quote-command-1",
        "x-csrf-token": csrfToken,
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      record: { resource: "quotes", rowVersion: 1, data: { route: "direct" } },
    });
  });

  it("refuses a mutation with no idempotency key", async () => {
    const response = await handle(
      commandRequest({ "x-csrf-token": csrfToken }),
    );

    expect(response.status).toBe(403);
  });

  it("refuses a mutation with no CSRF token", async () => {
    const response = await handle(
      commandRequest({ "idempotency-key": "demo-quote-command-2" }),
    );

    expect(response.status).toBe(403);
  });

  it("serves the active agreement template the click-through surface verifies", async () => {
    const response = await handle(
      new Request(
        "https://demo.clockwork.test/api/v1/lifecycle/agreement-templates/active?type=csa&jurisdiction=US",
      ),
    );
    const template = (await response.json()) as {
      exactText: string;
      exactTextHash: string;
      executionMode: string;
    };
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(template.exactText),
    );

    expect(response.status).toBe(200);
    expect(template.executionMode).toBe("click_through");
    expect(
      Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join(""),
    ).toBe(template.exactTextHash);
  });

  it("declines checkout instead of simulating a payment provider", async () => {
    const response = await handle(
      new Request("https://demo.clockwork.test/api/v1/core/payment-sessions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "demo-payment-session-1",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({
          accountId: "11111111-1111-4111-8111-111111111111",
          invoiceId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        }),
      }),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("content-type")).toContain(
      "application/problem+json",
    );
    await expect(response.json()).resolves.toMatchObject({
      code: "DEMO_PAYMENT_UNAVAILABLE",
    });
  });

  /**
   * The order lane is run, not simulated, so it is the one command the echo
   * handler must not answer. Reaching an authentication failure rather than a
   * `{record: {data: <the payload>}}` echo is the evidence that the request was
   * routed to the lane -- the lane reads a session, and this request carries
   * none.
   */
  it("routes an order command to the lane rather than echoing it", async () => {
    const response = await handle(
      new Request("https://demo.clockwork.test/api/v1/core/commands/orders", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "demo-order-command-1",
          ...orderProofHeaders,
        },
        body: JSON.stringify({
          id: "88888888-8888-4888-8888-888888888888",
          accountId: "11111111-1111-4111-8111-111111111111",
          action: "accept",
          payload: {},
        }),
      }),
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "ACTION_NOT_ALLOWED",
    });
  });

  it("refuses an order command with no replay evidence", async () => {
    const response = await handle(
      new Request("https://demo.clockwork.test/api/v1/core/commands/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "x", action: "create", payload: {} }),
      }),
    );

    expect(response.status).toBe(403);
  });

  it("requires the order command origin to match the configured app", async () => {
    const response = await handle(
      new Request("https://demo.clockwork.test/api/v1/core/commands/orders", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "demo-order-command-2",
          ...orderProofHeaders,
          origin: "https://attacker.example",
        },
        body: JSON.stringify({ id: "x", action: "create", payload: {} }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "ORIGIN_REJECTED",
    });
  });

  it("accepts the actual same-origin host for local and deploy-preview requests", async () => {
    const response = await handle(
      new Request("http://127.0.0.1:3317/api/v1/core/commands/orders", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "demo-order-command-local-1",
          ...orderProofHeaders,
          host: "127.0.0.1:3317",
          origin: "http://127.0.0.1:3317",
        },
        body: JSON.stringify({
          id: "88888888-8888-4888-8888-888888888888",
          accountId: "11111111-1111-4111-8111-111111111111",
          action: "accept",
          payload: {},
        }),
      }),
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "ACTION_NOT_ALLOWED",
    });
  });

  it("requires the order command CSRF header to match its cookie", async () => {
    const response = await handle(
      new Request("https://demo.clockwork.test/api/v1/core/commands/orders", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "demo-order-command-3",
          ...orderProofHeaders,
          "x-csrf-token": "abcdefabcdefabcdefabcdefabcdefab",
        },
        body: JSON.stringify({ id: "x", action: "create", payload: {} }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "CSRF_REJECTED",
    });
  });

  it("validates order idempotency evidence before entering the lane", async () => {
    const response = await handle(
      new Request("https://demo.clockwork.test/api/v1/core/commands/orders", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...orderProofHeaders,
        },
        body: JSON.stringify({ id: "x", action: "create", payload: {} }),
      }),
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "IDEMPOTENCY_KEY_REQUIRED",
    });
  });

  it("reports an operation the demo does not simulate as problem details", async () => {
    const response = await handle(
      new Request("https://demo.clockwork.test/api/v1/system/nothing-here"),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain(
      "application/problem+json",
    );
    await expect(response.json()).resolves.toMatchObject({
      code: "DEMO_OPERATION_UNAVAILABLE",
      retryable: false,
    });
  });
});

describe("demo order mutation origin resolution", () => {
  const base = {
    configuredOrigin: "https://clockwork.example",
    host: "internal-next:3000",
    forwardedHost: null,
    forwardedProtocol: null,
    requestProtocol: "http",
  } as const;

  it("allows the configured canonical origin", () => {
    expect(
      demoMutationOriginAllowed({
        ...base,
        origin: "https://clockwork.example",
      }),
    ).toBe(true);
  });

  it("uses the served Host when Next rewrites the internal request URL", () => {
    expect(
      demoMutationOriginAllowed({
        ...base,
        origin: "http://127.0.0.1:3317",
        host: "127.0.0.1:3317",
      }),
    ).toBe(true);
  });

  it("uses a strict forwarded host and protocol for deploy previews", () => {
    expect(
      demoMutationOriginAllowed({
        ...base,
        origin: "https://deploy-preview-42--clockwork.netlify.app",
        forwardedHost: "deploy-preview-42--clockwork.netlify.app",
        forwardedProtocol: "https",
      }),
    ).toBe(true);
  });

  it("rejects malformed forwarded hosts and attacker origins", () => {
    expect(
      demoMutationOriginAllowed({
        ...base,
        origin: "https://deploy-preview-42--clockwork.netlify.app",
        forwardedHost:
          "deploy-preview-42--clockwork.netlify.app, attacker.example",
        forwardedProtocol: "https",
      }),
    ).toBe(false);
    expect(
      demoMutationOriginAllowed({
        ...base,
        origin: "https://clockwork.example",
        forwardedHost: "clockwork.example/attacker",
        forwardedProtocol: "https",
      }),
    ).toBe(false);
    expect(
      demoMutationOriginAllowed({
        ...base,
        origin: "https://attacker.example",
        forwardedHost: "deploy-preview-42--clockwork.netlify.app",
        forwardedProtocol: "https",
      }),
    ).toBe(false);
  });
});
