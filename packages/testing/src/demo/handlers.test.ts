import { createClockworkClient } from "@clockwork/api/client";
import { setupServer } from "msw/node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDemoCommerceHandlers, STATUS_ENDPOINTS } from "./handlers";
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
