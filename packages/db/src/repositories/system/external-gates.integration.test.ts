import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createRuntimeDatabase } from "../../client";
import { auditEvents, outboxMessages } from "../../schema";
import { externalGates } from "../../schema/system";
import { withInternalTransaction } from "../../transaction";
import {
  DatabaseExternalGateService,
  type UpdateExternalGateInput,
} from "./external-gates";

const databaseUrl =
  process.env.DIRECT_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable";
const gateKey = "EXT-ACC-01" as const;
const requestPrefix = `integration:external-gate-activation:${crypto.randomUUID()}`;
const now = new Date("2026-07-31T16:00:00.000Z");
const actor = { kind: "user" as const, id: "integration-gate-runner" };

const { client, db } = createRuntimeDatabase({
  url: databaseUrl,
  maxConnections: 2,
  role: "clockwork_service",
  ssl: false,
});
const repository = new DatabaseExternalGateService(db);
let original: typeof externalGates.$inferSelect | undefined;

beforeAll(async () => {
  await withInternalTransaction(db, `${requestPrefix}:setup`, async (tx) => {
    original = await tx.query.externalGates.findFirst({
      where: eq(externalGates.gateKey, gateKey),
    });
    if (!original) throw new Error("Seeded external gate is unavailable");
    await tx
      .update(externalGates)
      .set({
        configuredStatus: "blocked",
        simulatorState: "ready",
        simulatorDetails: "Controlled integration simulator state",
        inputProvenance: "unverified",
        lastActivationTestStatus: "never",
        lastActivationTestAt: null,
        lastActivationTestedBy: null,
        activationEvidenceReference: null,
        reviewOn: null,
        statusReason: "Controlled integration activation state",
      })
      .where(eq(externalGates.gateKey, gateKey));
  });
});

afterAll(async () => {
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
            inputProvenance: original?.inputProvenance,
            lastActivationTestStatus: original?.lastActivationTestStatus,
            lastActivationTestAt: original?.lastActivationTestAt,
            lastActivationTestedBy: original?.lastActivationTestedBy,
            activationEvidenceReference: original?.activationEvidenceReference,
            reviewOn: original?.reviewOn,
            statusReason: original?.statusReason,
          })
          .where(eq(externalGates.gateKey, gateKey));
      },
    );
  await client.end();
});

describe.sequential("database external-gate activation evidence", () => {
  it("ignores forged protected fields on the general update and denies activation", async () => {
    const before = await repository.get({
      gateKey,
      requestId: `${requestPrefix}:read-before-forgery`,
      now,
    });
    const forged = {
      gateKey,
      expectedRowVersion: before.rowVersion,
      owner: before.owner,
      inputRequired: before.inputRequired,
      configuredStatus: "active",
      reviewOn: "2099-12-31",
      statusReason: "Operator attempted to self-attest activation evidence",
      actor,
      requestId: `${requestPrefix}:forged-update`,
      now,
      simulatorState: "ready",
      simulatorDetails: "Forged simulator pass",
      lastActivationTestStatus: "passed",
      lastActivationTestAt: now.toISOString(),
      lastActivationTestedBy: "forged-operator",
      activationEvidenceReference: "evidence://forged/pass",
    } as UpdateExternalGateInput;

    await expect(repository.update(forged)).rejects.toThrow(/cannot activate/);
    await expect(
      repository.get({
        gateKey,
        requestId: `${requestPrefix}:read-after-forgery`,
        now,
      }),
    ).resolves.toMatchObject({
      configuredStatus: "blocked",
      lastActivationTestStatus: "never",
      activationEvidenceReference: null,
      rowVersion: before.rowVersion,
    });
  });

  it("atomically persists runner fields with audit/outbox and blocks on a later failure", async () => {
    const before = await repository.get({
      gateKey,
      requestId: `${requestPrefix}:read-before-runner`,
      now,
    });
    const result = await repository.recordActivationTest({
      gateKey,
      expectedRowVersion: before.rowVersion,
      result: {
        status: "passed",
        testedAt: now.toISOString(),
        testedBy: "deterministic-runner:integration-gate-runner",
        evidenceReference:
          "https://evidence.fil.one/activation/db-test?temporary-secret=removed#download",
        simulatorState: "ready",
        simulatorDetails: "All database activation scenarios passed",
        inputProvenance: "repository_fixture",
      },
      actor,
      requestId: `${requestPrefix}:runner`,
      now,
    });
    expect(result).toMatchObject({
      simulatorState: "ready",
      simulatorDetails: "All database activation scenarios passed",
      inputProvenance: "repository_fixture",
      lastActivationTestStatus: "passed",
      lastActivationTestAt: now.toISOString(),
      lastActivationTestedBy: "deterministic-runner:integration-gate-runner",
      activationEvidenceReference:
        "https://evidence.fil.one/activation/db-test",
      rowVersion: before.rowVersion + 1,
    });

    const persisted = await withInternalTransaction(
      db,
      `${requestPrefix}:assert-audit-outbox`,
      async (tx) => {
        const event = await tx.query.auditEvents.findFirst({
          where: eq(auditEvents.requestId, `${requestPrefix}:runner`),
        });
        const message = event
          ? await tx.query.outboxMessages.findFirst({
              where: eq(outboxMessages.eventId, event.id),
            })
          : undefined;
        return { event, message };
      },
    );
    expect(persisted.event).toMatchObject({
      eventType: "system.external_gate.activation_test_completed",
      aggregateVersion: result.rowVersion,
    });
    expect(persisted.message).toMatchObject({
      topic: "system.external_gate.activation_test_completed",
    });

    const active = await repository.update({
      gateKey,
      expectedRowVersion: result.rowVersion,
      owner: result.owner,
      inputRequired: result.inputRequired,
      configuredStatus: "active",
      reviewOn: "2099-12-31",
      statusReason: "Executable integration activation test passed",
      actor,
      requestId: `${requestPrefix}:activate`,
      now,
    });
    expect(active).toMatchObject({
      configuredStatus: "active",
      effectiveStatus: "active",
      activationAllowed: true,
    });

    const failed = await repository.recordActivationTest({
      gateKey,
      expectedRowVersion: active.rowVersion,
      result: {
        status: "failed",
        testedAt: new Date(now.getTime() + 1_000).toISOString(),
        testedBy: "deterministic-runner:integration-gate-runner",
        evidenceReference: "evidence://activation-tests/db-failure",
        simulatorState: "degraded",
        simulatorDetails: "Database denial scenario did not pass",
        inputProvenance: "repository_fixture",
      },
      actor,
      requestId: `${requestPrefix}:runner-failed`,
      now: new Date(now.getTime() + 1_000),
    });
    expect(failed).toMatchObject({
      configuredStatus: "blocked",
      effectiveStatus: "blocked",
      lastActivationTestStatus: "failed",
      activationAllowed: false,
    });
    expect(failed.blockedReasons).toContain("simulator_not_ready");
    expect(failed.blockedReasons).toContain("activation_test_not_passed");
  });
});
