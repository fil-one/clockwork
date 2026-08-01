import { and, eq, gt } from "drizzle-orm";

import type { Actor } from "@clockwork/contracts";
import {
  evaluateExternalGate,
  externalGateActivationTestIsCurrent,
  ExternalGateActivationTestResultSchema,
  ExternalGateKeySchema,
  sanitizeActivationEvidenceReference,
  type ExternalGateActivationTestResult,
  type ExternalGateKey,
} from "@clockwork/domain/system";

import type { RuntimeDatabase } from "../../client";
import {
  externalGates,
  systemExternalGateActivationTasks,
} from "../../schema/system";
import { withInternalTransaction } from "../../transaction";
import { appendAuditAndOutbox } from "../audit-outbox";
import { mapExternalGateRow } from "./external-gates";

export type ExternalGateActivationTaskStatus =
  | "pending"
  | "probing"
  | "provider_succeeded"
  | "succeeded"
  | "retrying"
  | "dead_letter";

export interface ExternalGateActivationTask {
  id: string;
  taskKey: string;
  gateKey: ExternalGateKey;
  provider: string;
  mode: "live" | "simulator";
  status: ExternalGateActivationTaskStatus;
  attemptCount: number;
  probeResult: ExternalGateActivationTestResult | null;
  lastError: string | null;
  nextAttemptAt: string | null;
  leaseToken: string | null;
  leaseUntil: string | null;
  completedAt: string | null;
  rowVersion: number;
}

function taskStatus(value: string): ExternalGateActivationTaskStatus {
  if (
    ![
      "pending",
      "probing",
      "provider_succeeded",
      "succeeded",
      "retrying",
      "dead_letter",
    ].includes(value)
  )
    throw new Error("EXTERNAL_GATE_ACTIVATION_TASK_STATUS_INVALID");
  return value as ExternalGateActivationTaskStatus;
}

function mapTask(
  row: typeof systemExternalGateActivationTasks.$inferSelect,
): ExternalGateActivationTask {
  return {
    id: row.id,
    taskKey: row.taskKey,
    gateKey: ExternalGateKeySchema.parse(row.gateKey),
    provider: row.provider,
    mode: row.mode === "live" ? "live" : "simulator",
    status: taskStatus(row.status),
    attemptCount: row.attemptCount,
    probeResult: row.probeResult
      ? ExternalGateActivationTestResultSchema.parse(row.probeResult)
      : null,
    lastError: row.lastError,
    nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null,
    leaseToken: row.leaseToken,
    leaseUntil: row.leaseUntil?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    rowVersion: row.rowVersion,
  };
}

function safeFailureCode(error: unknown): string {
  if (error instanceof Error) {
    const candidate = error.message.split(":", 1)[0] ?? "";
    if (/^[A-Z][A-Z0-9_.-]{2,100}$/.test(candidate)) return candidate;
  }
  return "EXTERNAL_GATE_ACTIVATION_PROBE_FAILED";
}

/** Durable provider-success/local-commit recovery store for activation probes. */
export class DatabaseExternalGateActivationTaskStore {
  public constructor(private readonly database: RuntimeDatabase) {}

  public claim(input: {
    taskKey: string;
    gateKey: ExternalGateKey;
    provider: string;
    mode: "live" | "simulator";
    runtimeEnvironment: "development" | "test" | "production";
    requestId: string;
    now: Date;
    leaseMs?: number;
  }): Promise<ExternalGateActivationTask> {
    if (input.taskKey.trim().length < 8)
      throw new Error("EXTERNAL_GATE_ACTIVATION_TASK_KEY_INVALID");
    if (!input.provider.trim())
      throw new Error("EXTERNAL_GATE_ACTIVATION_PROVIDER_REQUIRED");
    if (input.runtimeEnvironment === "production" && input.mode !== "live")
      throw new Error("EXTERNAL_GATE_PRODUCTION_SIMULATOR_FORBIDDEN");
    const leaseMs = input.leaseMs ?? 30_000;
    if (!Number.isSafeInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 300_000)
      throw new Error("EXTERNAL_GATE_ACTIVATION_LEASE_INVALID");
    return withInternalTransaction(
      this.database,
      input.requestId,
      async (transaction) => {
        const gate = await transaction.query.externalGates.findFirst({
          where: eq(externalGates.gateKey, input.gateKey),
        });
        if (!gate) throw new Error("EXTERNAL_GATE_NOT_FOUND");
        if (gate.emergencyDisabledAt)
          throw new Error("EXTERNAL_GATE_EMERGENCY_DISABLED");
        await transaction
          .insert(systemExternalGateActivationTasks)
          .values({
            taskKey: input.taskKey,
            gateKey: input.gateKey,
            provider: input.provider,
            mode: input.mode,
            status: "pending",
          })
          .onConflictDoNothing();
        const existing =
          await transaction.query.systemExternalGateActivationTasks.findFirst({
            where: eq(systemExternalGateActivationTasks.taskKey, input.taskKey),
          });
        if (!existing)
          throw new Error("EXTERNAL_GATE_ACTIVATION_TASK_INSERT_FAILED");
        if (
          existing.gateKey !== input.gateKey ||
          existing.provider !== input.provider ||
          existing.mode !== input.mode
        )
          throw new Error("EXTERNAL_GATE_ACTIVATION_TASK_CONFLICT");
        if (existing.status === "succeeded") return mapTask(existing);
        if (existing.status === "dead_letter")
          throw new Error("EXTERNAL_GATE_ACTIVATION_TASK_DEAD_LETTERED");
        if (
          existing.status === "retrying" &&
          existing.nextAttemptAt &&
          existing.nextAttemptAt > input.now
        )
          throw new Error("EXTERNAL_GATE_ACTIVATION_TASK_NOT_READY");
        if (
          ["probing", "provider_succeeded"].includes(existing.status) &&
          existing.leaseUntil &&
          existing.leaseUntil > input.now
        )
          throw new Error("EXTERNAL_GATE_ACTIVATION_TASK_BUSY");
        const leaseToken = crypto.randomUUID();
        const leaseUntil = new Date(input.now.getTime() + leaseMs);
        const recoveredProviderSuccess =
          existing.status === "provider_succeeded";
        const [claimed] = await transaction
          .update(systemExternalGateActivationTasks)
          .set({
            status: recoveredProviderSuccess ? "provider_succeeded" : "probing",
            attemptCount: recoveredProviderSuccess
              ? existing.attemptCount
              : existing.attemptCount + 1,
            lastError: null,
            nextAttemptAt: null,
            leaseToken,
            leaseUntil,
            updatedAt: input.now,
          })
          .where(
            and(
              eq(systemExternalGateActivationTasks.id, existing.id),
              eq(
                systemExternalGateActivationTasks.rowVersion,
                existing.rowVersion,
              ),
            ),
          )
          .returning();
        if (!claimed) throw new Error("EXTERNAL_GATE_ACTIVATION_TASK_BUSY");
        return mapTask(claimed);
      },
    );
  }

  public recordProviderSuccess(input: {
    taskKey: string;
    expectedRowVersion: number;
    leaseToken: string;
    result: ExternalGateActivationTestResult;
    requestId: string;
    now: Date;
  }): Promise<ExternalGateActivationTask> {
    const result = ExternalGateActivationTestResultSchema.parse({
      ...input.result,
      evidenceReference: sanitizeActivationEvidenceReference(
        input.result.evidenceReference,
      ),
    });
    return withInternalTransaction(
      this.database,
      input.requestId,
      async (transaction) => {
        const [updated] = await transaction
          .update(systemExternalGateActivationTasks)
          .set({
            status: "provider_succeeded",
            probeResult: result,
            lastError: null,
            nextAttemptAt: null,
            updatedAt: input.now,
          })
          .where(
            and(
              eq(systemExternalGateActivationTasks.taskKey, input.taskKey),
              eq(
                systemExternalGateActivationTasks.rowVersion,
                input.expectedRowVersion,
              ),
              eq(systemExternalGateActivationTasks.status, "probing"),
              eq(
                systemExternalGateActivationTasks.leaseToken,
                input.leaseToken,
              ),
              gt(systemExternalGateActivationTasks.leaseUntil, input.now),
            ),
          )
          .returning();
        if (!updated)
          throw new Error("EXTERNAL_GATE_ACTIVATION_TASK_VERSION_CONFLICT");
        return mapTask(updated);
      },
    );
  }

  public recordProviderFailure(input: {
    taskKey: string;
    expectedRowVersion: number;
    leaseToken: string;
    error: unknown;
    maxAttempts: number;
    requestId: string;
    now: Date;
    retryAt: Date;
  }): Promise<ExternalGateActivationTask> {
    return withInternalTransaction(
      this.database,
      input.requestId,
      async (transaction) => {
        const task =
          await transaction.query.systemExternalGateActivationTasks.findFirst({
            where: eq(systemExternalGateActivationTasks.taskKey, input.taskKey),
          });
        if (!task) throw new Error("EXTERNAL_GATE_ACTIVATION_TASK_NOT_FOUND");
        const deadLetter = task.attemptCount >= input.maxAttempts;
        const [updated] = await transaction
          .update(systemExternalGateActivationTasks)
          .set({
            status: deadLetter ? "dead_letter" : "retrying",
            lastError: safeFailureCode(input.error),
            nextAttemptAt: deadLetter ? null : input.retryAt,
            leaseToken: null,
            leaseUntil: null,
            updatedAt: input.now,
          })
          .where(
            and(
              eq(systemExternalGateActivationTasks.id, task.id),
              eq(
                systemExternalGateActivationTasks.rowVersion,
                input.expectedRowVersion,
              ),
              eq(systemExternalGateActivationTasks.status, "probing"),
              eq(
                systemExternalGateActivationTasks.leaseToken,
                input.leaseToken,
              ),
              gt(systemExternalGateActivationTasks.leaseUntil, input.now),
            ),
          )
          .returning();
        if (!updated)
          throw new Error("EXTERNAL_GATE_ACTIVATION_TASK_VERSION_CONFLICT");
        return mapTask(updated);
      },
    );
  }

  /**
   * Applies the probe result against the gate version read in this transaction,
   * never the version captured before the HTTP call. This permanently removes
   * the activation expected-version mismatch while retaining optimistic writes.
   */
  public finalize(input: {
    taskKey: string;
    leaseToken: string;
    actor: Actor;
    requestId: string;
    now: Date;
  }) {
    return withInternalTransaction(
      this.database,
      input.requestId,
      async (transaction) => {
        const task =
          await transaction.query.systemExternalGateActivationTasks.findFirst({
            where: eq(systemExternalGateActivationTasks.taskKey, input.taskKey),
          });
        if (!task) throw new Error("EXTERNAL_GATE_ACTIVATION_TASK_NOT_FOUND");
        if (task.status === "succeeded") {
          const gate = await transaction.query.externalGates.findFirst({
            where: eq(externalGates.gateKey, task.gateKey),
          });
          if (!gate) throw new Error("EXTERNAL_GATE_NOT_FOUND");
          return {
            task: mapTask(task),
            gate: evaluateExternalGate(mapExternalGateRow(gate), input.now),
          };
        }
        if (task.status !== "provider_succeeded" || !task.probeResult)
          throw new Error("EXTERNAL_GATE_ACTIVATION_RESULT_NOT_READY");
        if (
          task.leaseToken !== input.leaseToken ||
          !task.leaseUntil ||
          task.leaseUntil <= input.now
        )
          throw new Error("EXTERNAL_GATE_ACTIVATION_LEASE_STALE");
        const result = ExternalGateActivationTestResultSchema.parse(
          task.probeResult,
        );
        const existing = await transaction.query.externalGates.findFirst({
          where: eq(externalGates.gateKey, task.gateKey),
        });
        if (!existing) throw new Error("EXTERNAL_GATE_NOT_FOUND");
        if (existing.emergencyDisabledAt)
          throw new Error("EXTERNAL_GATE_EMERGENCY_DISABLED");
        const before = mapExternalGateRow(existing);
        const testAllowsActivation =
          result.status === "passed" &&
          result.simulatorState === "ready" &&
          externalGateActivationTestIsCurrent(result.testedAt, input.now);
        const configuredStatus =
          before.configuredStatus === "active" && !testAllowsActivation
            ? "blocked"
            : before.configuredStatus;
        const [gateRow] = await transaction
          .update(externalGates)
          .set({
            configuredStatus,
            simulatorState: result.simulatorState,
            simulatorDetails: result.simulatorDetails,
            lastActivationTestStatus: result.status,
            lastActivationTestAt: new Date(result.testedAt),
            lastActivationTestedBy: result.testedBy,
            activationEvidenceReference: sanitizeActivationEvidenceReference(
              result.evidenceReference,
            ),
          })
          .where(
            and(
              eq(externalGates.gateKey, task.gateKey),
              eq(externalGates.rowVersion, existing.rowVersion),
            ),
          )
          .returning();
        if (!gateRow) throw new Error("EXTERNAL_GATE_VERSION_CONFLICT");
        const [completed] = await transaction
          .update(systemExternalGateActivationTasks)
          .set({
            status: "succeeded",
            completedAt: input.now,
            leaseToken: null,
            leaseUntil: null,
            updatedAt: input.now,
          })
          .where(
            and(
              eq(systemExternalGateActivationTasks.id, task.id),
              eq(systemExternalGateActivationTasks.rowVersion, task.rowVersion),
              eq(
                systemExternalGateActivationTasks.status,
                "provider_succeeded",
              ),
              eq(
                systemExternalGateActivationTasks.leaseToken,
                input.leaseToken,
              ),
              gt(systemExternalGateActivationTasks.leaseUntil, input.now),
            ),
          )
          .returning();
        if (!completed)
          throw new Error("EXTERNAL_GATE_ACTIVATION_TASK_VERSION_CONFLICT");
        const after = mapExternalGateRow(gateRow);
        await appendAuditAndOutbox(transaction, {
          aggregateType: "external_gate",
          aggregateId: gateRow.id,
          aggregateVersion: gateRow.rowVersion,
          eventType: "system.external_gate.activation_test_completed",
          actor: input.actor,
          requestId: input.requestId,
          occurredAt: input.now,
          before: { ...before },
          after: { ...after, activationTaskId: task.id },
        });
        return {
          task: mapTask(completed),
          gate: evaluateExternalGate(after, input.now),
        };
      },
    );
  }
}
