import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  demoAccessCookieName,
  issueDemoAccessCookie,
} from "@/src/auth/demo-access";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  ambientSession: vi.fn(() =>
    Promise.reject(new Error("ambient session access is forbidden")),
  ),
}));

vi.mock("@/src/auth/session", () => ({
  getCommerceSession: mocks.ambientSession,
}));

vi.mock("./demo-order-acceptance", () => ({
  demoOrderAcceptance: () => ({ execute: mocks.execute }),
}));

import { handleDemoOrderCommand } from "./demo-order-command";

const accountId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const session = {
  userId,
  organizationId: "66666666-6666-4666-8666-666666666666",
  accountIds: [accountId],
  roles: ["owner" as const],
  isInternalStaff: false,
  mfaVerified: true,
  recentAuthenticationVerified: true,
};

function request(
  idempotencyKey = "demo-order-command-0001",
  headers: Readonly<Record<string, string>> = {},
): Request {
  return new Request(
    "https://demo.clockwork.test/api/v1/core/commands/orders",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
        ...headers,
      },
      body: JSON.stringify({
        id: "33333333-3333-4333-8333-333333333333",
        accountId,
        action: "prepare_artifact",
        payload: {
          quoteId: "44444444-4444-4444-8444-444444444444",
          signerUserId: userId,
          authorityTitle: "Operations Director",
          authorityAttested: true,
          poNumber: "PO-DEMO-1",
          serviceStartsOn: "2027-01-01",
          serviceEndsOn: "2027-12-31",
          acceptedAt: "2026-08-18T12:00:00.000Z",
          orderLineIds: ["55555555-5555-4555-8555-555555555555"],
        },
      }),
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.execute.mockResolvedValue({
    replayed: true,
    result: {
      status: "artifact_requested",
      rowVersion: 1,
      data: {
        orderFormDocumentId: "77777777-7777-4777-8777-777777777777",
      },
      auditEventId: "88888888-8888-4888-8888-888888888888",
      outboxEventId: "99999999-9999-4999-8999-999999999999",
    },
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the demo order command boundary", () => {
  it("rechecks the configured demo access grant when the proxy is bypassed", async () => {
    const password = "demo-order-boundary-test-password";
    vi.stubEnv("CLOCKWORK_DEMO_DEPLOY", "1");
    vi.stubEnv("CLOCKWORK_EXPERIENCE_ADAPTER", "demo");
    vi.stubEnv("NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV", "demo");
    vi.stubEnv("CLOCKWORK_DEMO_ACCESS_PASSWORD", password);
    const deniedRequest = request();
    const deniedBodyRead = vi.spyOn(deniedRequest, "arrayBuffer");

    const denied = await handleDemoOrderCommand(deniedRequest, session);

    expect(denied.status).toBe(403);
    await expect(denied.json()).resolves.toMatchObject({
      code: "DEMO_ACCESS_REQUIRED",
    });
    expect(deniedBodyRead).not.toHaveBeenCalled();
    expect(mocks.ambientSession).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();

    const grant = await issueDemoAccessCookie(password);
    const allowed = await handleDemoOrderCommand(
      request("demo-order-command-0002", {
        cookie: `${demoAccessCookieName}=${grant.value}`,
      }),
      session,
    );

    expect(allowed.status).toBe(200);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });

  it("requires order:write even when the account is in session scope", async () => {
    const unauthorizedSession = {
      ...session,
      roles: ["member"],
    } as const;

    const response = await handleDemoOrderCommand(
      request(),
      unauthorizedSession,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "ORDER_AUTHORITY_FORBIDDEN",
    });
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("passes an exact request hash into the durable command execution", async () => {
    const input = request();
    const clone = vi.spyOn(input, "clone");
    const arrayBuffer = vi.spyOn(input, "arrayBuffer");

    const response = await handleDemoOrderCommand(input, session);

    expect(response.status).toBe(200);
    expect(clone).not.toHaveBeenCalled();
    expect(arrayBuffer).toHaveBeenCalledTimes(1);
    expect(response.headers.get("idempotency-replayed")).toBe("true");
    const execution = mocks.execute.mock.calls[0]?.[0] as unknown;
    expect(execution).toMatchObject({
      action: "prepare_artifact",
      idempotencyKey: "demo-order-command-0001",
      session,
    });
    expect(mocks.ambientSession).not.toHaveBeenCalled();
    expect(
      (execution as { readonly requestHash?: unknown }).requestHash,
    ).toEqual(expect.stringMatching(/^[0-9a-f]{64}$/u));
    await expect(response.json()).resolves.toMatchObject({
      auditEventId: "88888888-8888-4888-8888-888888888888",
      outboxEventId: "99999999-9999-4999-8999-999999999999",
    });
  });

  it("rejects an invalid idempotency key before changing demo state", async () => {
    const response = await handleDemoOrderCommand(request("short"), session);

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "IDEMPOTENCY_KEY_REQUIRED",
    });
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("labels only the JSON parse itself as an invalid request body", async () => {
    const malformed = new Request(
      "https://demo.clockwork.test/api/v1/core/commands/orders",
      {
        method: "POST",
        headers: { "idempotency-key": "demo-order-malformed-0001" },
        body: "{",
      },
    );
    const response = await handleDemoOrderCommand(malformed, session);
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "INVALID_BODY",
      detail: "The request body is not JSON.",
    });

    mocks.execute.mockRejectedValueOnce(new SyntaxError("downstream failure"));
    await expect(handleDemoOrderCommand(request(), session)).rejects.toThrow(
      "downstream failure",
    );
  });
});
