import { createHash } from "node:crypto";

import { createClockworkClient } from "@clockwork/api/client";
import { setupServer } from "msw/node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createDemoCommerceHandlers,
  DEMO_AGREEMENT_TEXT,
  DEMO_AGREEMENT_TEXT_HASH,
  STATUS_ENDPOINTS,
} from "./handlers";
import { DEMO_ORIGIN } from "./seed";

const server = setupServer(...createDemoCommerceHandlers());

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());

describe("generated-contract status handlers", () => {
  it("serves the three generated status reads through the typed client", async () => {
    const client = createClockworkClient(DEMO_ORIGIN);

    const [core, lifecycle, system] = await Promise.all([
      client.GET(STATUS_ENDPOINTS.core),
      client.GET(STATUS_ENDPOINTS.lifecycle),
      client.GET(STATUS_ENDPOINTS.system),
    ]);

    expect(core.data).toEqual({ lane: "core", status: "ready" });
    expect(lifecycle.data).toEqual({ lane: "lifecycle", status: "ready" });
    expect(system.data).toEqual({ lane: "system", status: "ready" });
    expect(Object.values(STATUS_ENDPOINTS)).toEqual([
      "/v1/core/status",
      "/v1/lifecycle/status",
      "/v1/system/status",
    ]);
  });
});

describe("generated-contract commerce handlers", () => {
  it("requires CSRF and idempotency evidence for generated mutations", async () => {
    const client = createClockworkClient(DEMO_ORIGIN);
    const denied = await client.POST("/v1/core/commands/{resource}", {
      params: {
        path: { resource: "quotes" },
        header: { "idempotency-key": "quote-command-denied-1" },
      },
      body: {
        id: "88888888-8888-4888-8888-888888888888",
        accountId: "11111111-1111-4111-8111-111111111111",
        action: "create",
        payload: { route: "direct" },
      },
    });
    expect(denied.response.status).toBe(403);

    const accepted = await client.POST("/v1/core/commands/{resource}", {
      params: {
        path: { resource: "quotes" },
        header: { "idempotency-key": "quote-command-1" },
      },
      headers: {
        "idempotency-key": "quote-command-1",
        "x-csrf-token": "12345678901234567890123456789012",
      },
      body: {
        id: "88888888-8888-4888-8888-888888888888",
        accountId: "11111111-1111-4111-8111-111111111111",
        action: "create",
        payload: { route: "direct" },
      },
    });
    expect(accepted.data?.record).toMatchObject({
      resource: "quotes",
      rowVersion: 1,
      data: { route: "direct" },
    });
  });

  it("publishes an agreement template whose text matches its own digest", async () => {
    const client = createClockworkClient(DEMO_ORIGIN);
    const active = await client.GET(
      "/v1/lifecycle/agreement-templates/active",
      { params: { query: { type: "csa", jurisdiction: "US" } } },
    );
    const digest = createHash("sha256")
      .update(DEMO_AGREEMENT_TEXT)
      .digest("hex");

    expect(active.data).toMatchObject({
      type: "csa",
      jurisdiction: "US",
      executionMode: "click_through",
      exactText: DEMO_AGREEMENT_TEXT,
      exactTextHash: DEMO_AGREEMENT_TEXT_HASH,
    });
    // The click-through surface recomputes this digest in the browser and
    // refuses to execute when it disagrees.
    expect(digest).toBe(DEMO_AGREEMENT_TEXT_HASH);
  });

  it("accepts the onboarding and administration mutations the surfaces call", async () => {
    const client = createClockworkClient(DEMO_ORIGIN);
    const headers = { "x-csrf-token": "12345678901234567890123456789012" };

    const invite = await client.POST(
      "/v1/lifecycle/organizations/{organizationId}/invites",
      {
        params: {
          path: { organizationId: "ffffffff-ffff-4fff-8fff-ffffffffffff" },
          header: { "idempotency-key": "member-invite-1" },
        },
        headers: { ...headers, "idempotency-key": "member-invite-1" },
        body: {
          accountId: "11111111-1111-4111-8111-111111111111",
          email: "buyer@demo.test",
          role: "member",
          expiresAt: "2026-08-30T16:00:00.000Z",
        },
      },
    );
    const procurement = await client.PUT(
      "/v1/lifecycle/accounts/{accountId}/procurement-profile",
      {
        params: {
          path: { accountId: "11111111-1111-4111-8111-111111111111" },
          header: { "idempotency-key": "procurement-profile-1" },
        },
        headers: { ...headers, "idempotency-key": "procurement-profile-1" },
        body: {
          apContact: { name: "Ada Finance", email: "ap@demo.test" },
          invoiceDeliveryEmail: "invoices@demo.test",
          poRequired: true,
          exemptions: [],
          supplierDocuments: [],
          buyerPortalTasks: [],
        },
      },
    );

    expect(invite.data).toMatchObject({ status: "accepted" });
    expect(procurement.data).toMatchObject({ status: "accepted" });
  });

  it("declines a payment session instead of simulating checkout", async () => {
    const client = createClockworkClient(DEMO_ORIGIN);

    const declined = await client.POST("/v1/core/payment-sessions", {
      params: { header: { "idempotency-key": "payment-session-1" } },
      headers: {
        "idempotency-key": "payment-session-1",
        "x-csrf-token": "12345678901234567890123456789012",
      },
      body: {
        accountId: "11111111-1111-4111-8111-111111111111",
        invoiceId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      },
    });

    expect(declined.response.status).toBe(503);
    expect(declined.error).toMatchObject({ code: "DEMO_PAYMENT_UNAVAILABLE" });
  });

  it("serves all report formats from a generated report operation", async () => {
    const client = createClockworkClient(DEMO_ORIGIN);
    const json = await client.GET("/v1/core/reports/{report}", {
      params: {
        path: { report: "three_way_tie_out" },
        query: { format: "json", limit: 100 },
      },
    });
    const csv = await client.GET("/v1/core/reports/{report}", {
      params: {
        path: { report: "three_way_tie_out" },
        query: { format: "csv", limit: 100 },
      },
      parseAs: "text",
    });
    const jsonData = json.data as
      { items: Record<string, unknown>[] } | undefined;
    expect(jsonData?.items[0]).toMatchObject({
      report: "three_way_tie_out",
      sourceRecordId: "order-demo-1",
    });
    expect(csv.data).toContain("source_record_id");
  });
});
