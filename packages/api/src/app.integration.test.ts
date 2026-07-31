import { describe, expect, it, vi } from "vitest";

import { createApiApp } from "./app";
import { MemoryCoreFinanceService } from "./routes/core";
import {
  createExternalGateActivationSimulator,
  MemoryExternalGateService,
} from "./routes/system";

describe("API composition", () => {
  it.each([
    ["core", "unavailable"],
    ["lifecycle", "unavailable"],
    ["system", "unavailable"],
  ] as const)(
    "mounts the %s lane and reports its actual readiness",
    async (lane, expectedStatus) => {
      const response = await createApiApp().request(`/v1/${lane}/status`, {
        headers: { "x-request-id": `test-${lane}-request` },
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        lane,
        status: expectedStatus,
      });
      expect(response.headers.get("x-request-id")).toBe(`test-${lane}-request`);
    },
  );

  it("reports the activation-test runner in truthful system readiness", async () => {
    const externalGates = new MemoryExternalGateService();
    const partial = await createApiApp({ system: { externalGates } }).request(
      "/v1/system/status",
    );
    await expect(partial.json()).resolves.toEqual({
      lane: "system",
      status: "degraded",
      details: {
        externalGates: "configured",
        activationTestRunner: "missing",
        workosWebhook: "missing",
      },
    });

    const activationTestRunner = createExternalGateActivationSimulator({
      enabled: true,
      runtimeEnvironment: "test",
    });
    if (!activationTestRunner)
      throw new Error("Test activation runner was not composed");
    const full = await createApiApp({
      system: {
        externalGates,
        externalGateActivationTests: activationTestRunner,
        workosWebhook: {
          verifier: { verify: vi.fn() },
          deduplicator: {
            claim: vi.fn(),
            markProcessed: vi.fn(),
            markFailed: vi.fn(),
          },
          roleSink: { apply: vi.fn() },
        },
      },
    }).request("/v1/system/status");
    await expect(full.json()).resolves.toEqual({
      lane: "system",
      status: "ready",
      details: {
        externalGates: "configured",
        activationTestRunner: "configured",
        workosWebhook: "configured",
      },
    });
  });

  it("returns a retryable failure while a webhook delivery is in progress", async () => {
    const payload = {
      id: "evt_workos_in_progress",
      event: "organization_membership.updated",
      createdAt: "2026-07-31T16:00:00.000Z",
      data: {
        id: "om_test",
        organizationId: "org_test",
        userId: "user_test",
        status: "active",
      },
    };
    const response = await createApiApp({
      system: {
        workosWebhook: {
          verifier: {
            verify: vi.fn().mockResolvedValue({
              eventId: payload.id,
              occurredAt: payload.createdAt,
              payload,
            }),
          },
          deduplicator: {
            claim: vi.fn().mockResolvedValue({ status: "in_progress" }),
            markProcessed: vi.fn(),
            markFailed: vi.fn(),
          },
          roleSink: { apply: vi.fn() },
        },
      },
    }).request("/v1/webhooks/workos", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "workos-signature": "verified-test-signature",
      },
      body: JSON.stringify(payload),
    });

    const responseBody: unknown = await response.json();
    expect(response.status, JSON.stringify(responseBody)).toBe(503);
    expect(responseBody).toMatchObject({
      status: 503,
      retryable: true,
    });
  });

  it("binds core dependencies to the app instance", async () => {
    const service = new MemoryCoreFinanceService();
    const accountId = "10000000-0000-4000-8000-000000000001";
    const csrf = "app-composition-csrf-token-000000000001";
    const response = await createApiApp({ core: { service } }).request(
      "/v1/core/commands/accounts",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
          cookie: `clockwork-csrf=${csrf}`,
          "x-csrf-token": csrf,
          "idempotency-key": "app-composition-core-dependency-0001",
          "x-clockwork-persona": "owner",
          "x-clockwork-account": accountId,
        },
        body: JSON.stringify({
          id: "11000000-0000-4000-8000-000000000099",
          accountId,
          action: "create",
          payload: { legalName: "Composition Test LLC" },
        }),
      },
    );

    expect(response.status, await response.clone().text()).toBe(200);
    expect(service.auditEvents).toHaveLength(1);
  });
});
