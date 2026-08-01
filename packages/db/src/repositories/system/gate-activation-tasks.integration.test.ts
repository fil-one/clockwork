import { eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createRuntimeDatabase } from "../../client";
import { auditEvents, outboxMessages } from "../../schema";
import {
  externalGates,
  systemExternalGateActivationTasks,
} from "../../schema/system";
import { withInternalTransaction } from "../../transaction";
import { DatabaseExternalGateActivationTaskStore } from "./gate-activation-tasks";

const databaseUrl =
  process.env.DIRECT_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable";
const gateKey = "EXT-ACC-01" as const;
const requestPrefix = "integration:durable-gate-activation";
const now = new Date("2026-07-31T16:00:00.000Z");
const actor = { kind: "system" as const, id: "activation-integration-test" };

const { client, db } = createRuntimeDatabase({
  url: databaseUrl,
  maxConnections: 2,
  role: "clockwork_service",
  ssl: false,
});
const store = new DatabaseExternalGateActivationTaskStore(db);
let original: typeof externalGates.$inferSelect | undefined;

async function cleanup() {
  await withInternalTransaction(db, `${requestPrefix}:cleanup`, async (tx) => {
    const events = await tx
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(like(auditEvents.requestId, `${requestPrefix}%`));
    if (events.length > 0) {
      await tx.delete(outboxMessages).where(
        inArray(
          outboxMessages.eventId,
          events.map(({ id }) => id),
        ),
      );
      await tx
        .delete(auditEvents)
        .where(like(auditEvents.requestId, `${requestPrefix}%`));
    }
    await tx
      .delete(systemExternalGateActivationTasks)
      .where(
        like(systemExternalGateActivationTasks.taskKey, `${requestPrefix}%`),
      );
  });
}

beforeAll(async () => {
  await cleanup();
  await withInternalTransaction(db, `${requestPrefix}:setup`, async (tx) => {
    original = await tx.query.externalGates.findFirst({
      where: eq(externalGates.gateKey, gateKey),
    });
    if (!original) throw new Error("Seeded external gate is unavailable");
    await tx
      .update(externalGates)
      .set({
        configuredStatus: "active",
        simulatorState: "ready",
        simulatorDetails: "Stale activation state awaiting bounded refresh",
        lastActivationTestStatus: "passed",
        lastActivationTestAt: new Date("2026-07-29T16:00:00.000Z"),
        lastActivationTestedBy: "previous-runner",
        activationEvidenceReference: "evidence://activation/previous",
        reviewOn: "2099-12-31",
        emergencyDisabledAt: null,
        emergencyDisabledBy: null,
        emergencyDisableReason: null,
        emergencyDisableEvidenceReference: null,
      })
      .where(eq(externalGates.gateKey, gateKey));
  });
});

afterAll(async () => {
  await cleanup();
  if (original)
    await withInternalTransaction(
      db,
      `${requestPrefix}:restore`,
      async (tx) => {
        await tx
          .update(externalGates)
          .set({
            owner: original?.owner,
            inputRequired: original?.inputRequired,
            configuredStatus: original?.configuredStatus,
            simulatorState: original?.simulatorState,
            simulatorDetails: original?.simulatorDetails,
            lastActivationTestStatus: original?.lastActivationTestStatus,
            lastActivationTestAt: original?.lastActivationTestAt,
            lastActivationTestedBy: original?.lastActivationTestedBy,
            activationEvidenceReference: original?.activationEvidenceReference,
            reviewOn: original?.reviewOn,
            statusReason: original?.statusReason,
            emergencyDisabledAt: original?.emergencyDisabledAt,
            emergencyDisabledBy: original?.emergencyDisabledBy,
            emergencyDisableReason: original?.emergencyDisableReason,
            emergencyDisableEvidenceReference:
              original?.emergencyDisableEvidenceReference,
          })
          .where(eq(externalGates.gateKey, gateKey));
      },
    );
  await client.end();
});

describe.sequential("durable database gate activation", () => {
  it("recovers provider success after lease expiry and finalizes against the fresh gate version", async () => {
    const taskKey = `${requestPrefix}:billing:2026-07-31`;
    const claimed = await store.claim({
      taskKey,
      gateKey,
      provider: "billing",
      mode: "live",
      runtimeEnvironment: "production",
      requestId: `${requestPrefix}:claim`,
      now,
      leaseMs: 1_000,
    });
    if (!claimed.leaseToken) throw new Error("Lease token was not returned");
    const succeeded = await store.recordProviderSuccess({
      taskKey,
      expectedRowVersion: claimed.rowVersion,
      leaseToken: claimed.leaseToken,
      result: {
        status: "passed",
        testedAt: now.toISOString(),
        testedBy: "bounded-http-probe",
        evidenceReference: "evidence://activation/current",
        simulatorState: "ready",
        simulatorDetails: "Bounded live provider probe passed",
      },
      requestId: `${requestPrefix}:provider-succeeded`,
      now,
    });
    expect(succeeded.status).toBe("provider_succeeded");
    await expect(
      store.claim({
        taskKey,
        gateKey,
        provider: "billing",
        mode: "live",
        runtimeEnvironment: "production",
        requestId: `${requestPrefix}:early-recovery`,
        now: new Date(now.getTime() + 999),
        leaseMs: 1_000,
      }),
    ).rejects.toThrow("EXTERNAL_GATE_ACTIVATION_TASK_BUSY");

    await withInternalTransaction(
      db,
      `${requestPrefix}:concurrent-admin-change`,
      async (tx) => {
        await tx
          .update(externalGates)
          .set({ statusReason: "Concurrent audited admin review completed" })
          .where(eq(externalGates.gateKey, gateKey));
      },
    );
    const recoveredAt = new Date(now.getTime() + 1_001);
    const recovered = await store.claim({
      taskKey,
      gateKey,
      provider: "billing",
      mode: "live",
      runtimeEnvironment: "production",
      requestId: `${requestPrefix}:recover`,
      now: recoveredAt,
      leaseMs: 1_000,
    });
    expect(recovered.status).toBe("provider_succeeded");
    if (!recovered.leaseToken)
      throw new Error("Recovery lease token was not returned");
    const finalized = await store.finalize({
      taskKey,
      leaseToken: recovered.leaseToken,
      actor,
      requestId: `${requestPrefix}:finalize`,
      now: recoveredAt,
    });
    expect(finalized).toMatchObject({
      task: { status: "succeeded", completedAt: recoveredAt.toISOString() },
      gate: {
        lastActivationTestAt: now.toISOString(),
        activationAllowed: true,
      },
    });
  });
});
