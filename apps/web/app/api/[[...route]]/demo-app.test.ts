import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionClaims } from "@clockwork/api";

import {
  demoAccessCookieName,
  issueDemoAccessCookie,
} from "@/src/auth/demo-access";

const sessionMocks = vi.hoisted(() => ({
  construct: vi.fn(),
  resolve: vi.fn<(request: Request) => Promise<SessionClaims | null>>(),
}));

vi.mock("@/src/auth/session", () => ({
  WorkosNextSessionResolver: class {
    public constructor(options: unknown) {
      sessionMocks.construct(options);
    }

    public resolve(request: Request): Promise<SessionClaims | null> {
      return sessionMocks.resolve(request);
    }
  },
}));

import { demoMutationOriginAllowed, handle } from "./demo-app";

const csrfToken = "12345678901234567890123456789012";
const orderProofHeaders = {
  origin: "https://demo.clockwork.test",
  cookie: `clockwork-csrf=${csrfToken}`,
  "x-csrf-token": csrfToken,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("APP_ORIGIN", "https://demo.clockwork.test");
  sessionMocks.resolve.mockResolvedValue({
    userId: "22222222-2222-4222-8222-222222222222",
    organizationId: "66666666-6666-4666-8666-666666666666",
    accountIds: ["11111111-1111-4111-8111-111111111111"],
    roles: ["owner"],
    isInternalStaff: false,
    mfaVerified: true,
    recentAuthenticationVerified: true,
  });
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

function orderRequest(body: unknown): Request {
  return new Request(
    "https://demo.clockwork.test/api/v1/core/commands/orders",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "demo-order-boundary-0001",
        ...orderProofHeaders,
      },
      body: JSON.stringify(body),
    },
  );
}

function validPrepareOrderBody(): Readonly<Record<string, unknown>> {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    accountId: "11111111-1111-4111-8111-111111111111",
    action: "prepare_artifact",
    payload: {
      quoteId: "44444444-4444-4444-8444-444444444444",
      signerUserId: "22222222-2222-4222-8222-222222222222",
      authorityTitle: "Operations Director",
      authorityAttested: true,
      serviceStartsOn: "2027-01-01",
      acceptedAt: "2026-08-18T12:00:00.000Z",
      orderLineIds: ["55555555-5555-4555-8555-555555555555"],
    },
  };
}

describe("demo commerce api", () => {
  it("answers a mutation that carries replay and CSRF evidence", async () => {
    const response = await handle(
      commandRequest({
        ...orderProofHeaders,
        "idempotency-key": "demo-quote-command-1",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      record: { resource: "quotes", rowVersion: 1, data: { route: "direct" } },
    });
  });

  it("refuses a mutation with no idempotency key", async () => {
    const response = await handle(commandRequest(orderProofHeaders));

    expect(response.status).toBe(403);
  });

  it("refuses a mutation with no CSRF token", async () => {
    const response = await handle(
      commandRequest({
        origin: orderProofHeaders.origin,
        cookie: orderProofHeaders.cookie,
        "idempotency-key": "demo-quote-command-2",
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "CSRF_REJECTED",
    });
  });

  it("requires origin validation for non-order demo mutations", async () => {
    const response = await handle(
      commandRequest({
        ...orderProofHeaders,
        origin: "https://attacker.example",
        "idempotency-key": "demo-quote-command-3",
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "ORIGIN_REJECTED",
    });
  });

  it("requires the configured signed grant for every demo API request", async () => {
    const password = "demo-app-boundary-test-password";
    vi.stubEnv("CLOCKWORK_DEMO_DEPLOY", "1");
    vi.stubEnv("CLOCKWORK_EXPERIENCE_ADAPTER", "demo");
    vi.stubEnv("NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV", "demo");
    vi.stubEnv("CLOCKWORK_DEMO_ACCESS_PASSWORD", password);
    const url = "https://demo.clockwork.test/api/v1/system/nothing-here";

    const denied = await handle(new Request(url));
    expect(denied.status).toBe(403);
    await expect(denied.json()).resolves.toMatchObject({
      code: "DEMO_ACCESS_REQUIRED",
    });

    const grant = await issueDemoAccessCookie(password);
    const allowed = await handle(
      new Request(url, {
        headers: { cookie: `${demoAccessCookieName}=${grant.value}` },
      }),
    );
    expect(allowed.status).toBe(404);
    await expect(allowed.json()).resolves.toMatchObject({
      code: "DEMO_OPERATION_UNAVAILABLE",
    });
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
          ...orderProofHeaders,
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

  it("resolves the exact request before the order lane consumes its body", async () => {
    const input = orderRequest(validPrepareOrderBody());
    const bodyRead = vi.spyOn(input, "arrayBuffer");
    sessionMocks.resolve.mockImplementationOnce((request: Request) => {
      expect(request).toBe(input);
      expect(request.bodyUsed).toBe(false);
      expect(bodyRead).not.toHaveBeenCalled();
      return Promise.resolve({
        userId: "22222222-2222-4222-8222-222222222222",
        organizationId: "66666666-6666-4666-8666-666666666666",
        accountIds: ["11111111-1111-4111-8111-111111111111"],
        roles: ["member"],
        isInternalStaff: false,
        mfaVerified: true,
        recentAuthenticationVerified: true,
      });
    });

    const response = await handle(input);

    expect(sessionMocks.construct).toHaveBeenCalledWith({
      requireBoundSession: true,
    });
    expect(sessionMocks.resolve).toHaveBeenCalledWith(input);
    expect(bodyRead).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "ORDER_AUTHORITY_FORBIDDEN",
    });
  });

  it("fails closed before reading an order when identity is absent", async () => {
    sessionMocks.resolve.mockResolvedValueOnce(null);
    const input = orderRequest(validPrepareOrderBody());
    const bodyRead = vi.spyOn(input, "arrayBuffer");

    const response = await handle(input);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      code: "DEMO_IDENTITY_REQUIRED",
      retryable: false,
    });
    expect(bodyRead).not.toHaveBeenCalled();
  });

  it("bounds identity resolution errors before reading the order", async () => {
    sessionMocks.resolve.mockRejectedValueOnce(new Error("identity backend"));
    const input = orderRequest(validPrepareOrderBody());
    const bodyRead = vi.spyOn(input, "arrayBuffer");

    const response = await handle(input);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "DEMO_IDENTITY_UNAVAILABLE",
      retryable: true,
    });
    expect(bodyRead).not.toHaveBeenCalled();
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

  it("fails demo webhooks closed without buffering unsigned provider bytes", async () => {
    const request = new Request(
      "https://demo.clockwork.test/api/v1/webhooks/stripe",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "provider-event" }),
      },
    );
    const bodyRead = vi.spyOn(request, "arrayBuffer");

    const response = await handle(request);

    expect(response.status).toBe(503);
    expect(bodyRead).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      code: "DEMO_WEBHOOK_UNAVAILABLE",
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
