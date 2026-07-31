import { and, asc, eq } from "drizzle-orm";

import type { Actor } from "@clockwork/contracts";
import {
  assertExternalGateTransition,
  evaluateExternalGate,
  externalGateActivationTestIsCurrent,
  ExternalGateActivationTestStatusSchema,
  ExternalGateConfiguredStatusSchema,
  ExternalGateKeySchema,
  ExternalGateSimulatorStateSchema,
  sanitizeActivationEvidenceReference,
  type ExternalGateActivationTestResult,
  type ExternalGateConfiguredStatus,
  type ExternalGateKey,
  type ExternalGateRecord,
} from "@clockwork/domain/system";

import type { RuntimeDatabase } from "../../client";
import { externalGates } from "../../schema/system";
import { withInternalTransaction } from "../../transaction";
import { appendAuditAndOutbox } from "../audit-outbox";

export interface UpdateExternalGateInput {
  gateKey: ExternalGateKey;
  expectedRowVersion: number;
  owner: string;
  inputRequired: string;
  configuredStatus: ExternalGateConfiguredStatus;
  reviewOn: string | null;
  statusReason: string;
  actor: Actor;
  requestId: string;
  now: Date;
}

export interface RecordExternalGateActivationTestInput {
  gateKey: ExternalGateKey;
  expectedRowVersion: number;
  result: ExternalGateActivationTestResult;
  actor: Actor;
  requestId: string;
  now: Date;
}

function mapGate(row: typeof externalGates.$inferSelect): ExternalGateRecord {
  return {
    ...row,
    gateKey: ExternalGateKeySchema.parse(row.gateKey),
    configuredStatus: ExternalGateConfiguredStatusSchema.parse(
      row.configuredStatus,
    ),
    simulatorState: ExternalGateSimulatorStateSchema.parse(row.simulatorState),
    lastActivationTestStatus: ExternalGateActivationTestStatusSchema.parse(
      row.lastActivationTestStatus,
    ),
    lastActivationTestAt: row.lastActivationTestAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class DatabaseExternalGateService {
  public constructor(private readonly db: RuntimeDatabase) {}

  public list(input: { requestId: string; now: Date }) {
    return withInternalTransaction(this.db, input.requestId, async (tx) => {
      const rows = await tx
        .select()
        .from(externalGates)
        .orderBy(asc(externalGates.gateKey));
      return rows.map((row) => evaluateExternalGate(mapGate(row), input.now));
    });
  }

  public get(input: {
    gateKey: ExternalGateKey;
    requestId: string;
    now: Date;
  }) {
    return withInternalTransaction(this.db, input.requestId, async (tx) => {
      const row = await tx.query.externalGates.findFirst({
        where: eq(externalGates.gateKey, input.gateKey),
      });
      if (!row) throw new Error("EXTERNAL_GATE_NOT_FOUND");
      return evaluateExternalGate(mapGate(row), input.now);
    });
  }

  public update(input: UpdateExternalGateInput) {
    return withInternalTransaction(this.db, input.requestId, async (tx) => {
      const existing = await tx.query.externalGates.findFirst({
        where: eq(externalGates.gateKey, input.gateKey),
      });
      if (!existing) throw new Error("EXTERNAL_GATE_NOT_FOUND");
      const before = mapGate(existing);
      const candidate: ExternalGateRecord = {
        ...before,
        owner: input.owner,
        inputRequired: input.inputRequired,
        configuredStatus: input.configuredStatus,
        reviewOn: input.reviewOn,
        statusReason: input.statusReason,
      };
      assertExternalGateTransition(candidate, input.now);
      const [updated] = await tx
        .update(externalGates)
        .set({
          owner: input.owner,
          inputRequired: input.inputRequired,
          configuredStatus: input.configuredStatus,
          reviewOn: input.reviewOn,
          statusReason: input.statusReason,
        })
        .where(
          and(
            eq(externalGates.gateKey, input.gateKey),
            eq(externalGates.rowVersion, input.expectedRowVersion),
          ),
        )
        .returning();
      if (!updated) throw new Error("EXTERNAL_GATE_VERSION_CONFLICT");
      const after = mapGate(updated);
      await appendAuditAndOutbox(tx, {
        aggregateType: "external_gate",
        aggregateId: updated.id,
        aggregateVersion: updated.rowVersion,
        eventType: "system.external_gate.updated",
        actor: input.actor,
        requestId: input.requestId,
        before: { ...before },
        after: { ...after },
      });
      return evaluateExternalGate(after, input.now);
    });
  }

  public recordActivationTest(input: RecordExternalGateActivationTestInput) {
    return withInternalTransaction(this.db, input.requestId, async (tx) => {
      const existing = await tx.query.externalGates.findFirst({
        where: eq(externalGates.gateKey, input.gateKey),
      });
      if (!existing) throw new Error("EXTERNAL_GATE_NOT_FOUND");
      const before = mapGate(existing);
      const evidenceReference = sanitizeActivationEvidenceReference(
        input.result.evidenceReference,
      );
      const testAllowsActivation =
        input.result.status === "passed" &&
        input.result.simulatorState === "ready" &&
        externalGateActivationTestIsCurrent(input.result.testedAt, input.now);
      const configuredStatus =
        before.configuredStatus === "active" && !testAllowsActivation
          ? "blocked"
          : before.configuredStatus;
      const [updated] = await tx
        .update(externalGates)
        .set({
          configuredStatus,
          simulatorState: input.result.simulatorState,
          simulatorDetails: input.result.simulatorDetails,
          lastActivationTestStatus: input.result.status,
          lastActivationTestAt: new Date(input.result.testedAt),
          lastActivationTestedBy: input.result.testedBy,
          activationEvidenceReference: evidenceReference,
        })
        .where(
          and(
            eq(externalGates.gateKey, input.gateKey),
            eq(externalGates.rowVersion, input.expectedRowVersion),
          ),
        )
        .returning();
      if (!updated) throw new Error("EXTERNAL_GATE_VERSION_CONFLICT");
      const after = mapGate(updated);
      await appendAuditAndOutbox(tx, {
        aggregateType: "external_gate",
        aggregateId: updated.id,
        aggregateVersion: updated.rowVersion,
        eventType: "system.external_gate.activation_test_completed",
        actor: input.actor,
        requestId: input.requestId,
        occurredAt: input.now,
        before: { ...before },
        after: { ...after },
      });
      return evaluateExternalGate(after, input.now);
    });
  }
}
