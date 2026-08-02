import {
  ClockworkTelemetry,
  denialSpanAttributes,
  InMemoryTelemetrySink,
  RuntimeBoundaryInstrumentation,
} from "@clockwork/integrations/telemetry";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApiApp } from "../app";
import {
  configureCoreRouteDependencies,
  MemoryCoreFinanceService,
  resetCoreRouteDependenciesForTest,
} from "../routes/core";

const csrf = "denial-telemetry-csrf-token-0000000001";
const accountOne = "10000000-0000-4000-8000-000000000001";
const accountTwo = "10000000-0000-4000-8000-000000000002";

function tracedRequest(
  app: ReturnType<typeof createApiApp>,
  sink: InMemoryTelemetrySink,
  path: string,
  init: RequestInit,
) {
  const boundaries = new RuntimeBoundaryInstrumentation(
    new ClockworkTelemetry(sink),
  );
  return boundaries.api({
    name: "api.request",
    correlation: { requestId: "request-denial-telemetry" },
    attributes: { "http.route": "/v1/{lane}/{resource}" },
    onResult: denialSpanAttributes,
    operation: () => Promise.resolve(app.request(path, init)),
  });
}

describe("api boundary denial telemetry", () => {
  afterEach(() => {
    resetCoreRouteDependenciesForTest();
    vi.restoreAllMocks();
  });

  it("records a cross-account denial on the api span", async () => {
    configureCoreRouteDependencies({ service: new MemoryCoreFinanceService() });
    const sink = new InMemoryTelemetrySink();
    const response = await tracedRequest(
      createApiApp(),
      sink,
      "/v1/core/commands/orders",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
          cookie: `clockwork-csrf=${csrf}`,
          "x-csrf-token": csrf,
          "idempotency-key": "denial-telemetry-order-0001",
          "x-clockwork-persona": "owner",
          "x-clockwork-account": accountOne,
        },
        body: JSON.stringify({
          id: "13000000-0000-4000-8000-000000000009",
          accountId: accountTwo,
          action: "create",
          payload: {},
        }),
      },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "CROSS_ACCOUNT_DENIED",
    });
    expect(sink.spans).toHaveLength(1);
    expect(sink.spans[0]).toMatchObject({
      boundary: "api",
      attributes: {
        "error.code": "CROSS_ACCOUNT_DENIED",
        "clockwork.outcome": "denied",
        "http.response.status_code": 403,
        "clockwork.request.id": "request-denial-telemetry",
      },
    });
  });

  it("records an invalid webhook signature on the api span", async () => {
    configureCoreRouteDependencies({
      service: new MemoryCoreFinanceService(),
      stripeWebhook: {
        verifier: {
          verify: vi.fn().mockRejectedValue(new Error("invalid signature")),
        },
        deduplicator: {
          claim: vi.fn(),
          markProcessed: vi.fn(),
          markFailed: vi.fn(),
        },
        apply: vi.fn(),
      },
    });
    const sink = new InMemoryTelemetrySink();
    const response = await tracedRequest(
      createApiApp(),
      sink,
      "/v1/webhooks/stripe",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": "invalid",
        },
        body: '{"id":"evt_1","type":"invoice.paid"}',
      },
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      code: "WEBHOOK_SIGNATURE_INVALID",
    });
    expect(sink.spans[0]).toMatchObject({
      boundary: "api",
      attributes: {
        "error.code": "WEBHOOK_SIGNATURE_INVALID",
        "clockwork.outcome": "denied",
        "http.response.status_code": 401,
      },
    });
  });

  it("leaves a successful response without denial attributes", async () => {
    const sink = new InMemoryTelemetrySink();
    const response = await tracedRequest(
      createApiApp(),
      sink,
      "/v1/core/status",
      { method: "GET" },
    );

    expect(response.status).toBe(200);
    expect(sink.spans[0]?.attributes["error.code"]).toBeUndefined();
    expect(sink.spans[0]?.status).toBe("ok");
  });
});
