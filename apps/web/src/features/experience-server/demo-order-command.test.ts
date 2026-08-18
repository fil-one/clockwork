import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  getCommerceSession: vi.fn(),
}));

vi.mock("@/src/auth/session", () => ({
  getCommerceSession: mocks.getCommerceSession,
}));

vi.mock("./demo-order-acceptance", () => ({
  demoOrderAcceptance: () => ({ execute: mocks.execute }),
}));

import { handleDemoOrderCommand } from "./demo-order-command";

const accountId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";

function request(idempotencyKey = "demo-order-command-0001"): Request {
  return new Request(
    "https://demo.clockwork.test/api/v1/core/commands/orders",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
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
  mocks.getCommerceSession.mockResolvedValue({
    userId,
    organizationId: "66666666-6666-4666-8666-666666666666",
    accountIds: [accountId],
    roles: ["owner"],
    isInternalStaff: false,
    mfaVerified: true,
    recentAuthenticationVerified: true,
  });
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

describe("the demo order command boundary", () => {
  it("requires order:write even when the account is in session scope", async () => {
    mocks.getCommerceSession.mockResolvedValue({
      ...(await mocks.getCommerceSession()),
      roles: ["member"],
    });

    const response = await handleDemoOrderCommand(request());

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

    const response = await handleDemoOrderCommand(input);

    expect(response.status).toBe(200);
    expect(clone).not.toHaveBeenCalled();
    expect(arrayBuffer).toHaveBeenCalledTimes(1);
    expect(response.headers.get("idempotency-replayed")).toBe("true");
    const execution = mocks.execute.mock.calls[0]?.[0] as unknown;
    expect(execution).toMatchObject({
      action: "prepare_artifact",
      idempotencyKey: "demo-order-command-0001",
    });
    expect(
      (execution as { readonly requestHash?: unknown }).requestHash,
    ).toEqual(expect.stringMatching(/^[0-9a-f]{64}$/u));
    await expect(response.json()).resolves.toMatchObject({
      auditEventId: "88888888-8888-4888-8888-888888888888",
      outboxEventId: "99999999-9999-4999-8999-999999999999",
    });
  });

  it("rejects an invalid idempotency key before changing demo state", async () => {
    const response = await handleDemoOrderCommand(request("short"));

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "IDEMPOTENCY_KEY_REQUIRED",
    });
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
