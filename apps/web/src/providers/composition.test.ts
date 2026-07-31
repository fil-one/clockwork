import { describe, expect, it, vi } from "vitest";

import type { WebhookVerifier } from "@clockwork/contracts";

import {
  GateCheckedProductionMigrationSource,
  GateCheckedRegistrationBootstrap,
  GateCheckedWebhookVerifier,
  type ExternalGateGuard,
} from "./composition";

describe("persisted external-gate composition", () => {
  it("blocks a webhook before signature/provider processing when the gate is inactive", async () => {
    const requireActive = vi.fn().mockRejectedValue(new Error("inactive"));
    const verify = vi.fn();
    const verifier: WebhookVerifier<unknown> = { verify };
    const guarded = new GateCheckedWebhookVerifier(
      verifier,
      { requireActive },
      ["EXT-ACC-01"],
    );

    await expect(
      guarded.verify({
        rawBody: new TextEncoder().encode("{}"),
        signature: "signed-test-value",
      }),
    ).rejects.toThrow("inactive");
    expect(verify).not.toHaveBeenCalled();
  });

  it("requires persisted WorkOS and domain activation before code exchange", async () => {
    const required: string[][] = [];
    const guard: ExternalGateGuard = {
      requireActive: (keys) => {
        required.push([...keys]);
        return Promise.resolve();
      },
    };
    const verify = vi.fn().mockResolvedValue({
      actor: { kind: "user", id: "workos:user-1" },
      workosUserId: "user-1",
      domainVerifiedAt: "2026-07-31T16:00:00.000Z",
    });
    const bootstrap = new GateCheckedRegistrationBootstrap({ verify }, guard);

    await bootstrap.verify({
      token: "authorization-code",
      email: "buyer@northstar.example",
      businessDomain: "northstar.example",
      requestId: "request-registration-1",
    });

    expect(required).toEqual([["EXT-ACC-01", "EXT-DOMAIN-01"]]);
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it("loads a live migration snapshot only after the persisted migration gate passes", async () => {
    const events: string[] = [];
    const guard: ExternalGateGuard = {
      requireActive: (keys, requestId) => {
        events.push(`gate:${keys.join(",")}:${requestId}`);
        return Promise.resolve();
      },
    };
    const load = vi.fn().mockImplementation(() => {
      events.push("source");
      return Promise.resolve({
        sourceBytes: new TextEncoder().encode("trusted snapshot"),
        sourceRecords: [],
        snapshotAccessAuthorization: {
          actorId: "migration-operator-1",
          authorized: true,
          authorizedAt: "2026-07-31T16:00:00.000Z",
          evidenceHash: "a".repeat(64),
          recentAuthentication: {
            authenticatedAt: "2026-07-31T15:59:00.000Z",
            evidenceHash: "b".repeat(64),
          },
        },
      });
    });
    const source = new GateCheckedProductionMigrationSource({ load }, guard);

    const result = await source.load({
      sourceSnapshotHash: "c".repeat(64),
      executionMode: "rehearsal",
      requestId: "request-migration-1",
    });

    expect(events).toEqual([
      "gate:EXT-MIGRATION-01:request-migration-1",
      "source",
    ]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(result.sourceKind).toBe("real_snapshot");
  });

  it("does not read migration source data when the activation gate is closed", async () => {
    const load = vi.fn();
    const source = new GateCheckedProductionMigrationSource(
      { load },
      {
        requireActive: () => Promise.reject(new Error("inactive")),
      },
    );

    await expect(
      source.load({
        sourceSnapshotHash: "c".repeat(64),
        executionMode: "execute",
        requestId: "request-migration-closed",
      }),
    ).rejects.toThrow("inactive");
    expect(load).not.toHaveBeenCalled();
  });
});
