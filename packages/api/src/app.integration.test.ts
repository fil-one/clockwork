import { describe, expect, it, vi } from "vitest";

import { createApiApp } from "./app";

describe("API composition", () => {
  it.each(["core", "lifecycle", "system"])(
    "mounts the %s lane without a root edit",
    async (lane) => {
      const response = await createApiApp().request(`/v1/${lane}/status`, {
        headers: { "x-request-id": `test-${lane}-request` },
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ lane, status: "ready" });
      expect(response.headers.get("x-request-id")).toBe(`test-${lane}-request`);
    },
  );

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
            claim: vi.fn().mockResolvedValue("in_progress"),
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
});
