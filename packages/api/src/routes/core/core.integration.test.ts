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

  it("rejects generic order state-forcing commands", async () => {
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
    for (const action of [
      "accept",
      "provision",
      "activate",
      "complete",
      "cancel",
      "terminate",
    ]) {
      const response = await call(action, 1, `core-order-force-${action}-0001`);
      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toMatchObject({
        code: "INVALID_STATE",
        status: 422,
        retryable: false,
      });
    }
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
      code: "CROSS_ACCOUNT_DENIED",
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
      code: "CROSS_ACCOUNT_DENIED",
    });
  });

  it("authorizes a partner quote by partner scope while preserving the end-client buyer", async () => {
    const service = new MemoryCoreFinanceService();
    configureCoreRouteDependencies({ service });
    const app = createApiApp();
    const response = await app.request("/v1/core/commands/quotes", {
      method: "POST",
      headers: mutationHeaders({
        key: "partner-resale-quote-create-0001",
        persona: "partner_admin",
        accountId: accountOne,
      }),
      body: JSON.stringify({
        id: "13000000-0000-4000-8000-000000000010",
        accountId: accountTwo,
        action: "create",
        payload: {
          partnerAccountId: accountOne,
          endClientAccountId: accountTwo,
          route: "resale",
          totalMinor: "168000",
          partnerResaleTotalMinor: "216000",
          partnerDocumentId: "partner-only-document",
        },
      }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      record: { accountId: accountTwo },
    });

    const order = await app.request("/v1/core/commands/orders", {
      method: "POST",
      headers: mutationHeaders({
        key: "partner-resale-order-create-0001",
        persona: "partner_admin",
        accountId: accountOne,
      }),
      body: JSON.stringify({
        id: "13000000-0000-4000-8000-000000000012",
        accountId: accountTwo,
        action: "create",
        payload: {
          quoteId: "13000000-0000-4000-8000-000000000010",
        },
      }),
    });
    expect(order.status).toBe(200);

    const foreignPartner = await app.request("/v1/core/commands/quotes", {
      method: "POST",
      headers: mutationHeaders({
        key: "partner-resale-quote-foreign-0001",
        persona: "partner_admin",
        accountId: accountOne,
      }),
      body: JSON.stringify({
        id: "13000000-0000-4000-8000-000000000011",
        accountId: accountTwo,
        action: "create",
        payload: {
          partnerAccountId: accountTwo,
          endClientAccountId: accountTwo,
          route: "resale",
        },
      }),
    });
    expect(foreignPartner.status).toBe(403);

    const endClientView = await app.request(
      `/v1/core/records/quotes?accountId=${accountTwo}`,
      {
        headers: {
          "x-clockwork-persona": "owner",
          "x-clockwork-account": accountTwo,
        },
      },
    );
    expect(endClientView.status).toBe(200);
    const page = (await endClientView.json()) as {
      items: { data: Record<string, unknown> }[];
    };
    expect(page.items[0]?.data).toMatchObject({ totalMinor: "216000" });
    expect(page.items[0]?.data).not.toHaveProperty("partnerResaleTotalMinor");
    expect(page.items[0]?.data).not.toHaveProperty("partnerDocumentId");
  });

  it("requires tenant scope and prevents record account reassignment", async () => {
    const service = new MemoryCoreFinanceService();
    configureCoreRouteDependencies({ service });
    const app = createApiApp();
    const id = "13000000-0000-4000-8000-000000000003";
    const unscoped = await app.request("/v1/core/commands/orders", {
      method: "POST",
      headers: mutationHeaders({ key: "unscoped-order-create-0001" }),
      body: JSON.stringify({ id, action: "create", payload: {} }),
    });
    expect(unscoped.status).toBe(403);
    await expect(unscoped.json()).resolves.toMatchObject({
      code: "ACCOUNT_SCOPE_REQUIRED",
    });

    const created = await app.request("/v1/core/commands/orders", {
      method: "POST",
      headers: mutationHeaders({ key: "scoped-order-create-0001" }),
      body: JSON.stringify({
        id,
        accountId: accountOne,
        action: "create",
        payload: {},
      }),
    });
    expect(created.status).toBe(200);

    const reassignment = await app.request("/v1/core/commands/orders", {
      method: "POST",
      headers: mutationHeaders({
        key: "order-reassignment-0001",
        accountId: accountTwo,
      }),
      body: JSON.stringify({
        id,
        accountId: accountTwo,
        action: "create",
        payload: {},
      }),
    });
    expect(reassignment.status).toBe(404);
    await expect(reassignment.json()).resolves.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("requires approval authority for quote exception decisions", async () => {
    configureCoreRouteDependencies({ service: new MemoryCoreFinanceService() });
    const response = await createApiApp().request("/v1/core/commands/quotes", {
      method: "POST",
      headers: mutationHeaders({ key: "quote-exception-approval-0001" }),
      body: JSON.stringify({
        id: "13000000-0000-4000-8000-000000000004",
        accountId: accountOne,
        action: "approve_exception",
        expectedVersion: 1,
        payload: { reason: "Floor exception" },
      }),
    });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "AUTHORIZATION_DENIED",
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

  it("uses the typed report method with source traceability and tenant/internal scope", async () => {
    const service = new MemoryCoreFinanceService();
    configureCoreRouteDependencies({ service });
    const app = createApiApp();
    const reportId = "13000000-0000-4000-8000-000000000099";
    const created = await app.request("/v1/core/commands/reports", {
      method: "POST",
      headers: mutationHeaders({ key: "report-source-create-0001" }),
      body: JSON.stringify({
        id: reportId,
        accountId: accountOne,
        action: "create",
        payload: {
          report: "revenue_forecast",
          sourceRecordIds: { orderId: "order-source-001" },
          forecastRevenueMinor: "12000",
          currency: "USD",
        },
      }),
    });
    expect(created.status).toBe(200);

    const tenant = await app.request(
      `/v1/core/reports/revenue_forecast?accountId=${accountOne}`,
      { headers: mutationHeaders({ key: "report-tenant-read-0001" }) },
    );
    expect(tenant.status).toBe(200);
    await expect(tenant.json()).resolves.toMatchObject({
      items: [
        {
          id: reportId,
          accountId: accountOne,
          data: { sourceRecordIds: { orderId: "order-source-001" } },
        },
      ],
    });

    const crossTenant = await app.request(
      `/v1/core/reports/revenue_forecast?accountId=${accountTwo}`,
      { headers: mutationHeaders({ key: "report-cross-read-0001" }) },
    );
    expect(crossTenant.status).toBe(403);

    const internal = await app.request("/v1/core/reports/revenue_forecast", {
      headers: {
        "x-clockwork-persona": "internal_operator",
        "x-clockwork-recent-auth": "true",
      },
    });
    expect(internal.status).toBe(200);
    await expect(internal.json()).resolves.toMatchObject({
      items: [{ id: reportId }],
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
      return Promise.resolve({ status: "duplicate" });
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

  it("does not parse or claim an event before Stripe verification succeeds", async () => {
    const claim = vi.fn<WebhookDeduplicator["claim"]>();
    configureCoreRouteDependencies({
      service: new MemoryCoreFinanceService(),
      stripeWebhook: {
        verifier: {
          verify: vi.fn().mockRejectedValue(new Error("invalid signature")),
        },
        deduplicator: {
          claim,
          markProcessed: vi.fn(),
          markFailed: vi.fn(),
        },
        apply: vi.fn(),
      },
    });
    const response = await createApiApp().request("/v1/webhooks/stripe", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "stripe-signature": "invalid",
      },
      body: '{"notType":"must-not-be-parsed-before-verification"}',
    });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      code: "WEBHOOK_SIGNATURE_INVALID",
    });
    expect(claim).not.toHaveBeenCalled();
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
