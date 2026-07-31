import type { WebhookVerifier } from "@clockwork/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApiApp } from "../../app";
import type { WebhookDeduplicator } from "../../webhooks";
import {
  configureCoreRouteDependencies,
  MemoryCoreFinanceService,
  resetCoreRouteDependenciesForTest,
} from ".";

const csrf = "core-finance-csrf-token-00000000000001";
const accountOne = "10000000-0000-4000-8000-000000000001";
const accountTwo = "10000000-0000-4000-8000-000000000002";

function mutationHeaders(input: {
  key: string;
  persona?: string;
  accountId?: string;
}) {
  return {
    "content-type": "application/json",
    origin: "http://localhost:3000",
    cookie: `clockwork-csrf=${csrf}`,
    "x-csrf-token": csrf,
    "idempotency-key": input.key,
    "x-clockwork-persona": input.persona ?? "owner",
    "x-clockwork-account": input.accountId ?? accountOne,
  };
}

describe("core-finance API", () => {
  afterEach(() => {
    resetCoreRouteDependenciesForTest();
    vi.restoreAllMocks();
  });

  it("writes versioned records with audit/outbox evidence and replays idempotently", async () => {
    const service = new MemoryCoreFinanceService();
    configureCoreRouteDependencies({ service });
    const app = createApiApp();
    const request = {
      method: "POST",
      headers: mutationHeaders({ key: "core-account-create-0001" }),
      body: JSON.stringify({
        id: "11000000-0000-4000-8000-000000000001",
        accountId: accountOne,
        action: "create",
        payload: {
          legalName: "Example LLC",
          roles: ["direct_client", "partner"],
        },
      }),
    };
    const first = await app.request("/v1/core/commands/accounts", request);
    const replay = await app.request("/v1/core/commands/accounts", request);
    expect(first.status).toBe(200);
    const responseBody: unknown = await first.json();
    expect(responseBody).toMatchObject({ record: { rowVersion: 1 } });
    if (!responseBody || typeof responseBody !== "object")
      throw new Error("Expected a command response object");
    expect(typeof Reflect.get(responseBody, "auditEventId")).toBe("string");
    expect(typeof Reflect.get(responseBody, "outboxMessageId")).toBe("string");
    expect(replay.headers.get("idempotency-replayed")).toBe("true");
    expect(service.auditEvents).toHaveLength(1);
    expect(service.outboxMessages).toHaveLength(1);
  });

  it("returns an operator-safe optimistic concurrency conflict", async () => {
    const service = new MemoryCoreFinanceService();
    configureCoreRouteDependencies({ service });
    const app = createApiApp();
    const id = "12000000-0000-4000-8000-000000000001";
    const call = (
      action: string,
      expectedVersion: number | undefined,
      key: string,
    ) =>
      app.request("/v1/core/commands/orders", {
        method: "POST",
        headers: mutationHeaders({ key }),
        body: JSON.stringify({
          id,
          accountId: accountOne,
          action,
          ...(expectedVersion ? { expectedVersion } : {}),
          payload: { status: action },
        }),
      });
    expect(
      (await call("create", undefined, "core-order-create-0001")).status,
    ).toBe(200);
    expect((await call("accept", 1, "core-order-accept-0001")).status).toBe(
      200,
    );
    const stale = await call("activate", 1, "core-order-stale-0001");
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({
      code: "VERSION_CONFLICT",
      status: 409,
      retryable: false,
    });
  });

  it("denies unauthorized cross-account and cross-partner writes", async () => {
    configureCoreRouteDependencies({ service: new MemoryCoreFinanceService() });
    const app = createApiApp();
    const crossAccount = await app.request("/v1/core/commands/orders", {
      method: "POST",
      headers: mutationHeaders({ key: "cross-account-order-0001" }),
      body: JSON.stringify({
        id: "13000000-0000-4000-8000-000000000001",
        accountId: accountTwo,
        action: "create",
        payload: {},
      }),
    });
    expect(crossAccount.status).toBe(403);
    await expect(crossAccount.json()).resolves.toMatchObject({
      code: "FORBIDDEN",
    });

    const crossPartner = await app.request(
      "/v1/core/commands/deal_registrations",
      {
        method: "POST",
        headers: mutationHeaders({
          key: "cross-partner-registration-0001",
          persona: "partner_admin",
          accountId: accountOne,
        }),
        body: JSON.stringify({
          id: "13000000-0000-4000-8000-000000000002",
          accountId: accountTwo,
          action: "create",
          payload: { endClientAccountId: accountTwo },
        }),
      },
    );
    expect(crossPartner.status).toBe(403);
    await expect(crossPartner.json()).resolves.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("requires explicit tenant scope for non-internal cursor reads", async () => {
    configureCoreRouteDependencies({ service: new MemoryCoreFinanceService() });
    const response = await createApiApp().request("/v1/core/records/invoices", {
      headers: {
        "x-clockwork-persona": "billing",
        "x-clockwork-account": accountOne,
      },
    });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "ACCOUNT_SCOPE_REQUIRED",
    });
  });

  it("verifies untouched Stripe bytes before claim and deduplicates delivery", async () => {
    const order: string[] = [];
    const verify: WebhookVerifier<unknown>["verify"] = ({
      rawBody,
      signature,
    }) => {
      order.push("verify");
      expect(signature).toBe("test-signature");
      expect(new TextDecoder().decode(rawBody)).toBe(
        '{"id":"evt_1","type":"invoice.paid"}',
      );
      return Promise.resolve({
        eventId: "evt_1",
        occurredAt: "2026-07-31T16:00:00Z",
        payload: { id: "evt_1", type: "invoice.paid" },
      });
    };
    const verifier: WebhookVerifier<unknown> = { verify: vi.fn(verify) };
    const claim: WebhookDeduplicator["claim"] = () => {
      order.push("claim");
      return Promise.resolve("duplicate");
    };
    const deduplicator: WebhookDeduplicator = {
      claim: vi.fn(claim),
      markProcessed: vi.fn(),
      markFailed: vi.fn(),
    };
    configureCoreRouteDependencies({
      service: new MemoryCoreFinanceService(),
      stripeWebhook: { verifier, deduplicator, apply: vi.fn() },
    });
    const response = await createApiApp().request("/v1/webhooks/stripe", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "stripe-signature": "test-signature",
      },
      body: '{"id":"evt_1","type":"invoice.paid"}',
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "duplicate" });
    expect(order).toEqual(["verify", "claim"]);
  });

  it("claims operator replay once and requires recent authentication", async () => {
    configureCoreRouteDependencies({ service: new MemoryCoreFinanceService() });
    const app = createApiApp();
    const denied = await app.request("/v1/core/replays/stripe/evt_2", {
      method: "POST",
      headers: {
        ...mutationHeaders({
          key: "core-replay-denied-0001",
          persona: "internal_operator",
        }),
        "x-clockwork-recent-auth": "false",
      },
    });
    expect(denied.status).toBe(403);
    await expect(denied.json()).resolves.toMatchObject({
      code: "RECENT_AUTHENTICATION_REQUIRED",
    });
  });
});
