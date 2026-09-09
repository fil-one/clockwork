import { and, asc, eq } from "drizzle-orm";

import type { Actor } from "@clockwork/contracts";
import {
  assertExternalGateTransition,
  evaluateExternalCapabilityAuthorization,
  evaluateExternalGate,
  executeExternalCapabilityBoundary,
  externalGateActivationTestIsCurrent,
  externalGateRequiresLiveSignedInput,
  ExternalGateActivationTestStatusSchema,
  ExternalGateConfiguredStatusSchema,
  ExternalGateKeySchema,
  ExternalGateInputProvenanceSchema,
  ExternalGateSimulatorStateSchema,
  sanitizeActivationEvidenceReference,
  type ExternalGateActivationTestResult,
  type ExternalCapability,
  type ExternalCapabilityAuthorization,
  type ExternalGateBoundary,
  type ExternalGateConfiguredStatus,
  type ExternalGateEffectIntent,
  type ExternalGateKey,
  type ExternalGateRecord,
} from "@clockwork/domain/system";

import type { RuntimeDatabase } from "../../client";
import { commerceUsers } from "../../schema";
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

export interface SetExternalGateEmergencyStateInput {
  gateKey: ExternalGateKey;
  expectedRowVersion: number;
  disabled: boolean;
  reason: string;
  evidenceReference: string;
  actor: Actor;
  requestId: string;
  now: Date;
}

export function mapExternalGateRow(
  row: typeof externalGates.$inferSelect,
): ExternalGateRecord {
  return {
    id: row.id,
    title: row.title,
    owner: row.owner,
    inputRequired: row.inputRequired,
    affectedFeature: row.affectedFeature,
    severity: row.severity,
    simulatorDetails: row.simulatorDetails,
    lastActivationTestedBy: row.lastActivationTestedBy,
    activationEvidenceReference: row.activationEvidenceReference,
    reviewOn: row.reviewOn,
    statusReason: row.statusReason,
    emergencyDisabledBy: row.emergencyDisabledBy,
    emergencyDisableReason: row.emergencyDisableReason,
    emergencyDisableEvidenceReference: row.emergencyDisableEvidenceReference,
    rowVersion: row.rowVersion,
    gateKey: ExternalGateKeySchema.parse(row.gateKey),
    configuredStatus: ExternalGateConfiguredStatusSchema.parse(
      row.configuredStatus,
    ),
    simulatorState: ExternalGateSimulatorStateSchema.parse(row.simulatorState),
    inputProvenance: ExternalGateInputProvenanceSchema.parse(
      row.inputProvenance,
    ),
    lastActivationTestStatus: ExternalGateActivationTestStatusSchema.parse(
      row.lastActivationTestStatus,
    ),
    lastActivationTestAt: row.lastActivationTestAt?.toISOString() ?? null,
    emergencyDisabledAt: row.emergencyDisabledAt?.toISOString() ?? null,
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
      return rows.map((row) =>
        evaluateExternalGate(mapExternalGateRow(row), input.now),
      );
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
      return evaluateExternalGate(mapExternalGateRow(row), input.now);
    });
  }

  public async authorizeCapability(input: {
    capability: ExternalCapability;
    boundary: ExternalGateBoundary;
    effectIntent: ExternalGateEffectIntent;
    requestId: string;
    now: Date;
  }): Promise<ExternalCapabilityAuthorization> {
    if (
      input.boundary === "recovery" &&
      input.effectIntent === "local_recovery"
    )
      return evaluateExternalCapabilityAuthorization({
        capability: input.capability,
        boundary: input.boundary,
        effectIntent: input.effectIntent,
        gates: new Map(),
      });
    const views = await this.list({
      requestId: input.requestId,
      now: input.now,
    });
    return evaluateExternalCapabilityAuthorization({
      capability: input.capability,
      boundary: input.boundary,
      effectIntent: input.effectIntent,
      gates: new Map(views.map((gate) => [gate.gateKey, gate])),
    });
  }

  public async requireCapability(input: {
    capability: ExternalCapability;
    boundary: ExternalGateBoundary;
    effectIntent: ExternalGateEffectIntent;
    requestId: string;
    now: Date;
  }): Promise<ExternalCapabilityAuthorization> {
    let authorization: ExternalCapabilityAuthorization;
    try {
      authorization = await this.authorizeCapability(input);
    } catch {
      throw new Error("EXTERNAL_GATE_REGISTER_UNAVAILABLE");
    }
    if (!authorization.allowed)
      throw new Error(
        `EXTERNAL_CAPABILITY_DENIED:${input.capability}:${input.boundary}:${authorization.deniedGateKeys.join(",")}`,
      );
    return authorization;
  }

  public async executeCapability<T>(input: {
    capability: ExternalCapability;
    boundary: ExternalGateBoundary;
    effectIntent: ExternalGateEffectIntent;
    requestId: string;
    now: Date;
    performExternalEffect: () => Promise<T>;
    enqueueOutbox: (result: T) => Promise<void>;
    performLocalRecovery?: () => Promise<T>;
  }): Promise<T> {
    const authorization = await this.requireCapability(input);
    return executeExternalCapabilityBoundary({
      authorization,
      performExternalEffect: input.performExternalEffect,
      enqueueOutbox: input.enqueueOutbox,
      ...(input.performLocalRecovery
        ? { performLocalRecovery: input.performLocalRecovery }
        : {}),
    });
  }

  public update(input: UpdateExternalGateInput) {
    return withInternalTransaction(this.db, input.requestId, async (tx) => {
      const existing = await tx.query.externalGates.findFirst({
        where: eq(externalGates.gateKey, input.gateKey),
      });
      if (!existing) throw new Error("EXTERNAL_GATE_NOT_FOUND");
      const before = mapExternalGateRow(existing);
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
      const after = mapExternalGateRow(updated);
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
      const before = mapExternalGateRow(existing);
      const evidenceReference = sanitizeActivationEvidenceReference(
        input.result.evidenceReference,
      );
      const testAllowsActivation =
        input.result.status === "passed" &&
        input.result.simulatorState === "ready" &&
        (!externalGateRequiresLiveSignedInput(input.gateKey) ||
          input.result.inputProvenance === "live_signed") &&
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
          inputProvenance: input.result.inputProvenance,
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
      const after = mapExternalGateRow(updated);
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

  /** Audited kill switch and restore control. Caller authorization is mandatory. */
  public setEmergencyState(input: SetExternalGateEmergencyStateInput) {
    if (input.actor.kind !== "user")
      throw new Error("EXTERNAL_GATE_INTERNAL_OPERATOR_REQUIRED");
    if (input.reason.trim().length < 8)
      throw new Error("EXTERNAL_GATE_CONTROL_REASON_REQUIRED");
    const evidenceReference = sanitizeActivationEvidenceReference(
      input.evidenceReference,
    );
    return withInternalTransaction(this.db, input.requestId, async (tx) => {
      const operator = await tx.query.commerceUsers.findFirst({
        where: eq(commerceUsers.id, input.actor.id),
      });
      if (!operator?.isInternalStaff || !operator.mfaEnrolled)
        throw new Error("EXTERNAL_GATE_INTERNAL_OPERATOR_REQUIRED");
      const existing = await tx.query.externalGates.findFirst({
        where: eq(externalGates.gateKey, input.gateKey),
      });
      if (!existing) throw new Error("EXTERNAL_GATE_NOT_FOUND");
      const before = mapExternalGateRow(existing);
      const candidate: ExternalGateRecord = {
        ...before,
        emergencyDisabledAt: input.disabled ? input.now.toISOString() : null,
        emergencyDisabledBy: input.disabled ? input.actor.id : null,
        emergencyDisableReason: input.disabled ? input.reason.trim() : null,
        emergencyDisableEvidenceReference: input.disabled
          ? evidenceReference
          : null,
      };
      if (!input.disabled) assertExternalGateTransition(candidate, input.now);
      const [updated] = await tx
        .update(externalGates)
        .set({
          emergencyDisabledAt: input.disabled ? input.now : null,
          emergencyDisabledBy: input.disabled ? input.actor.id : null,
          emergencyDisableReason: input.disabled ? input.reason.trim() : null,
          emergencyDisableEvidenceReference: input.disabled
            ? evidenceReference
            : null,
        })
        .where(
          and(
            eq(externalGates.gateKey, input.gateKey),
            eq(externalGates.rowVersion, input.expectedRowVersion),
          ),
        )
        .returning();
      if (!updated) throw new Error("EXTERNAL_GATE_VERSION_CONFLICT");
      const after = mapExternalGateRow(updated);
      await appendAuditAndOutbox(tx, {
        aggregateType: "external_gate",
        aggregateId: updated.id,
        aggregateVersion: updated.rowVersion,
        eventType: input.disabled
          ? "system.external_gate.emergency_disabled"
          : "system.external_gate.emergency_restored",
        actor: input.actor,
        requestId: input.requestId,
        occurredAt: input.now,
        before: { ...before },
        after: {
          ...after,
          controlReason: input.reason.trim(),
          controlEvidenceReference: evidenceReference,
        },
      });
      return evaluateExternalGate(after, input.now);
    });
  }
}
