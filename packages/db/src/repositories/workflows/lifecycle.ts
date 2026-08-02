import { createHash, randomUUID } from "node:crypto";

import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import {
  recordProvisioningDispatch,
  type ProvisioningAttempt,
} from "@clockwork/domain/lifecycle";

import type { RuntimeDatabase, RuntimeTransaction } from "../../client";
import {
  accounts,
  notificationDeliveries,
  pocs,
  providerOperations,
} from "../../schema";
import { accountContacts } from "../../schema/core/finance";
import {
  lifecycleDomainEvents,
  lifecycleProvisioningAttempts,
} from "../../schema/lifecycle";
import { withInternalTransaction } from "../../transaction";
import { appendAuditAndOutbox } from "../audit-outbox";

const ProvisioningAttemptSchema: z.ZodType<ProvisioningAttempt> = z.object({
  command: z.object({
    commandId: z.string().min(1),
    idempotencyKey: z.string().min(16),
    orderId: z.string().uuid(),
    orderVersion: z.number().int().positive(),
    organizationId: z.string().uuid(),
    operation: z.enum(["provision", "upgrade_poc", "sandbox", "teardown"]),
    tenantId: z.string().nullable(),
    entitlements: z.array(
      z.object({
        sku: z.string().min(1),
        productCode: z.string().min(1),
        entitlementKind: z.enum(["storage", "egress", "sandbox", "feature"]),
        quantity: z.string().min(1),
        region: z.string().min(1),
      }),
    ),
    requestedAt: z.string().datetime({ offset: true }),
  }),
  state: z.enum([
    "pending",
    "in_flight",
    "retry_scheduled",
    "dead_letter",
    "confirmed",
  ]),
  attempts: z.number().int().nonnegative(),
  nextAttemptAt: z.string().nullable(),
  lastError: z
    .object({
      code: z.string(),
      message: z.string(),
      kind: z.enum(["transient", "permanent"]),
    })
    .nullable(),
  providerOperationId: z.string().nullable(),
  confirmedAt: z.string().nullable(),
  operatorRecovery: z
    .object({
      operatorId: z.string(),
      reason: z.string(),
      recoveredAt: z.string(),
    })
    .nullable(),
});

export interface ProvisioningDispatchTarget {
  attemptId: string;
  rowVersion: number;
  attempt: ProvisioningAttempt;
}

export class DatabaseProvisioningDispatchStore {
  public constructor(
    private readonly database: RuntimeDatabase,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public load(input: {
    attemptId: string;
    orderId: string;
    organizationId: string;
    expectedAggregateVersion: number;
    requestId: string;
  }): Promise<ProvisioningDispatchTarget> {
    return withInternalTransaction(
      this.database,
      input.requestId,
      async (transaction) => {
        const row =
          await transaction.query.lifecycleProvisioningAttempts.findFirst({
            where: and(
              eq(lifecycleProvisioningAttempts.id, input.attemptId),
              eq(lifecycleProvisioningAttempts.orderId, input.orderId),
              eq(
                lifecycleProvisioningAttempts.organizationId,
                input.organizationId,
              ),
            ),
          });
        if (!row) throw new Error("PROVISIONING_DISPATCH_TARGET_NOT_FOUND");
        const attempt = ProvisioningAttemptSchema.parse(row.attempt);
        if (
          attempt.command.orderId !== input.orderId ||
          attempt.command.organizationId !== input.organizationId ||
          attempt.command.operation === "teardown" ||
          attempt.command.operation === "sandbox"
        )
          throw new Error("PROVISIONING_DISPATCH_BINDING_MISMATCH");
        if (
          row.rowVersion !== input.expectedAggregateVersion &&
          ![
            "retry_scheduled",
            "dead_letter",
            "in_flight",
            "confirmed",
          ].includes(attempt.state)
        )
          throw new Error(
            `PROVISIONING_DISPATCH_STALE_AGGREGATE_VERSION:${input.expectedAggregateVersion}:${row.rowVersion}`,
          );
        return { attemptId: row.id, rowVersion: row.rowVersion, attempt };
      },
    );
  }

  public claimProviderEffect(input: {
    target: ProvisioningDispatchTarget;
    requestId: string;
  }): Promise<
    | { status: "invoke"; leaseToken: string }
    | { status: "succeeded"; leaseToken: string; operationId: string }
    | { status: "permanent_failure"; code: string }
  > {
    const idempotencyKey = input.target.attempt.command.idempotencyKey;
    return withInternalTransaction(
      this.database,
      input.requestId,
      async (transaction) => {
        const leaseToken = randomUUID();
        const leaseUntil = new Date(this.now().getTime() + 60_000);
        const [inserted] = await transaction
          .insert(providerOperations)
          .values({
            provider: "lifecycle-provisioning",
            operation: "provision",
            idempotencyKey,
            aggregateType: "provider_operation",
            aggregateId: input.target.attemptId,
            status: "running",
            attemptCount: 1,
            providerReference: lifecycleEffectLease(leaseToken, leaseUntil),
            nextAttemptAt: leaseUntil,
          })
          .onConflictDoNothing()
          .returning();
        if (inserted) return { status: "invoke" as const, leaseToken };
        const existing = await transaction.query.providerOperations.findFirst({
          where: and(
            eq(providerOperations.provider, "lifecycle-provisioning"),
            eq(providerOperations.idempotencyKey, idempotencyKey),
          ),
        });
        if (!existing) throw new Error("PROVISIONING_EFFECT_CLAIM_RACE");
        if (
          existing.aggregateId !== input.target.attemptId ||
          existing.operation !== "provision"
        )
          throw new Error("PROVISIONING_EFFECT_BINDING_CONFLICT");
        if (existing.status === "succeeded") {
          const checkpoint = parseLifecycleEffectCheckpoint(
            existing.providerReference,
          );
          if (checkpoint.phase === "committed")
            return {
              status: "succeeded" as const,
              leaseToken,
              operationId: checkpoint.reference,
            };
          if (Date.parse(checkpoint.leaseUntil) > this.now().getTime())
            throw new Error("PROVISIONING_EFFECT_ALREADY_IN_PROGRESS");
          const [recovered] = await transaction
            .update(providerOperations)
            .set({
              providerReference: lifecycleEffectCheckpoint(
                "provider_succeeded",
                checkpoint.reference,
                leaseToken,
                leaseUntil,
              ),
            })
            .where(
              and(
                eq(providerOperations.id, existing.id),
                eq(providerOperations.rowVersion, existing.rowVersion),
              ),
            )
            .returning({ id: providerOperations.id });
          if (!recovered)
            throw new Error("PROVISIONING_EFFECT_ALREADY_IN_PROGRESS");
          return {
            status: "succeeded" as const,
            leaseToken,
            operationId: checkpoint.reference,
          };
        }
        if (existing.status === "failed")
          return {
            status: "permanent_failure" as const,
            code: existing.lastError ?? "PROVISIONING_EFFECT_FAILED",
          };
        if (
          existing.nextAttemptAt &&
          existing.nextAttemptAt.getTime() > this.now().getTime()
        )
          throw new Error("PROVISIONING_EFFECT_ALREADY_IN_PROGRESS");
        const [reclaimed] = await transaction
          .update(providerOperations)
          .set({
            status: "running",
            attemptCount: existing.attemptCount + 1,
            lastError: null,
            nextAttemptAt: leaseUntil,
            providerReference: lifecycleEffectLease(leaseToken, leaseUntil),
          })
          .where(
            and(
              eq(providerOperations.id, existing.id),
              eq(providerOperations.rowVersion, existing.rowVersion),
            ),
          )
          .returning({ id: providerOperations.id });
        if (!reclaimed) throw new Error("PROVISIONING_EFFECT_IN_PROGRESS");
        return { status: "invoke" as const, leaseToken };
      },
    );
  }

  public async checkpointProviderEffect(input: {
    target: ProvisioningDispatchTarget;
    leaseToken: string;
    result:
      | { ok: true; operationId: string }
      | {
          ok: false;
          kind: "transient" | "permanent";
          code: string;
          message: string;
        };
    requestId: string;
  }): Promise<void> {
    const idempotencyKey = input.target.attempt.command.idempotencyKey;
    await withInternalTransaction(
      this.database,
      input.requestId,
      async (transaction) => {
        const existing = await transaction.query.providerOperations.findFirst({
          where: and(
            eq(providerOperations.provider, "lifecycle-provisioning"),
            eq(providerOperations.idempotencyKey, idempotencyKey),
          ),
        });
        if (!existing) throw new Error("PROVISIONING_EFFECT_NOT_CLAIMED");
        if (
          existing.aggregateId !== input.target.attemptId ||
          existing.operation !== "provision"
        )
          throw new Error("PROVISIONING_EFFECT_BINDING_CONFLICT");
        if (existing.status === "succeeded") {
          const checkpoint = parseLifecycleEffectCheckpoint(
            existing.providerReference,
          );
          if (
            checkpoint.phase === "provider_succeeded" &&
            (checkpoint.leaseToken !== input.leaseToken ||
              Date.parse(checkpoint.leaseUntil) <= this.now().getTime())
          )
            throw new Error("STALE_PROVISIONING_EFFECT_LEASE");
          if (
            input.result.ok &&
            checkpoint.reference === input.result.operationId
          )
            return;
          throw new Error("PROVISIONING_EFFECT_RESULT_CONFLICT");
        }
        assertLifecycleEffectLease(
          existing.providerReference,
          input.leaseToken,
          this.now(),
        );
        const lastError = input.result.ok
          ? null
          : /^[A-Z0-9_]{3,100}$/.test(input.result.code)
            ? input.result.code
            : "PROVISIONING_PROVIDER_FAILURE";
        const status = input.result.ok
          ? "succeeded"
          : input.result.kind === "permanent"
            ? "failed"
            : "retrying";
        const [updated] = await transaction
          .update(providerOperations)
          .set({
            status,
            providerReference: input.result.ok
              ? lifecycleEffectCheckpoint(
                  "provider_succeeded",
                  input.result.operationId,
                  input.leaseToken,
                  existing.nextAttemptAt ??
                    new Date(this.now().getTime() + 60_000),
                )
              : null,
            lastError,
            nextAttemptAt:
              !input.result.ok && input.result.kind === "transient"
                ? new Date(this.now().getTime() + 1_000)
                : null,
          })
          .where(
            and(
              eq(providerOperations.id, existing.id),
              eq(providerOperations.rowVersion, existing.rowVersion),
            ),
          )
          .returning();
        if (!updated) throw new Error("PROVISIONING_EFFECT_STALE_CLAIM");
        if (input.result.ok) return;
        await appendAuditAndOutbox(transaction, {
          aggregateType: "provider_operation",
          aggregateId: updated.id,
          aggregateVersion: updated.rowVersion,
          eventType:
            input.result.kind === "permanent"
              ? "lifecycle.provider_effect.dead_lettered"
              : "lifecycle.provider_effect.retry_scheduled",
          actor: { kind: "system", id: "lifecycle-runtime" },
          requestId: input.requestId,
          occurredAt: this.now(),
          after: {
            provider: "lifecycle-provisioning",
            operation: "provision",
            status,
            attempt: updated.attemptCount,
            ...(lastError ? { code: lastError } : {}),
          },
        });
      },
    );
  }

  public async finalizeProviderEffect(input: {
    target: ProvisioningDispatchTarget;
    leaseToken: string;
    operationId: string;
    requestId: string;
  }): Promise<void> {
    await withInternalTransaction(
      this.database,
      input.requestId,
      async (transaction) => {
        const existing = await transaction.query.providerOperations.findFirst({
          where: and(
            eq(providerOperations.provider, "lifecycle-provisioning"),
            eq(
              providerOperations.idempotencyKey,
              input.target.attempt.command.idempotencyKey,
            ),
          ),
        });
        if (!existing) throw new Error("PROVISIONING_EFFECT_NOT_CLAIMED");
        const checkpoint = parseLifecycleEffectCheckpoint(
          existing.providerReference,
        );
        if (checkpoint.reference !== input.operationId)
          throw new Error("PROVISIONING_EFFECT_RESULT_CONFLICT");
        if (checkpoint.phase === "committed") return;
        if (
          checkpoint.leaseToken !== input.leaseToken ||
          Date.parse(checkpoint.leaseUntil) <= this.now().getTime()
        )
          throw new Error("STALE_PROVISIONING_EFFECT_LEASE");
        const [committed] = await transaction
          .update(providerOperations)
          .set({
            providerReference: lifecycleEffectCheckpoint(
              "committed",
              input.operationId,
            ),
          })
          .where(
            and(
              eq(providerOperations.id, existing.id),
              eq(providerOperations.rowVersion, existing.rowVersion),
            ),
          )
          .returning();
        if (!committed) throw new Error("PROVISIONING_EFFECT_STALE_CLAIM");
        await appendAuditAndOutbox(transaction, {
          aggregateType: "provider_operation",
          aggregateId: committed.id,
          aggregateVersion: committed.rowVersion,
          eventType: "lifecycle.provider_effect.succeeded",
          actor: { kind: "system", id: "lifecycle-runtime" },
          requestId: input.requestId,
          occurredAt: this.now(),
          after: {
            provider: "lifecycle-provisioning",
            operation: "provision",
            status: "succeeded",
            attempt: committed.attemptCount,
          },
        });
      },
    );
  }

  public record(input: {
    target: ProvisioningDispatchTarget;
    result:
      | { ok: true; operationId: string }
      | {
          ok: false;
          kind: "transient" | "permanent";
          code: string;
          message: string;
        };
    requestId: string;
  }): Promise<ProvisioningAttempt> {
    return withInternalTransaction(
      this.database,
      input.requestId,
      async (transaction) => {
        const row =
          await transaction.query.lifecycleProvisioningAttempts.findFirst({
            where: eq(lifecycleProvisioningAttempts.id, input.target.attemptId),
          });
        if (!row) throw new Error("PROVISIONING_DISPATCH_TARGET_NOT_FOUND");
        const current = ProvisioningAttemptSchema.parse(row.attempt);
        if (
          row.rowVersion !== input.target.rowVersion &&
          current.providerOperationId
        )
          return current;
        const next = recordProvisioningDispatch(current, input.result, {
          now: this.now().toISOString(),
        });
        const [updated] = await transaction
          .update(lifecycleProvisioningAttempts)
          .set({
            state: next.state,
            attempt: next,
            providerOperationId: next.providerOperationId,
            rowVersion: row.rowVersion + 1,
          })
          .where(
            and(
              eq(lifecycleProvisioningAttempts.id, row.id),
              eq(lifecycleProvisioningAttempts.rowVersion, row.rowVersion),
            ),
          )
          .returning({ id: lifecycleProvisioningAttempts.id });
        if (!updated) throw new Error("PROVISIONING_DISPATCH_CONCURRENT_WRITE");
        return next;
      },
    );
  }
}

export interface PreparedLifecycleEffect {
  effectKey: string;
  taskId: string;
  aggregateId: string;
  aggregateVersion: number;
  loader:
    | "account"
    | "procurement_profile"
    | "signature_envelope"
    | "provisioning_attempt"
    | "poc"
    | "quote"
    | "order"
    | "termination"
    | "exception_case"
    | "migration_run";
  transition: string;
  effectBoundary:
    | "screening_provider"
    | "notification_provider"
    | "signature_provider"
    | "evidence_provider"
    | "provisioning_provider"
    | "persisted_transition"
    | "human_wait";
  persistedState: Readonly<Record<string, unknown>>;
}

/**
 * Explicit authoritative reads for scheduler/wait tasks. These tasks never
 * accept financial or tenancy state from Trigger payloads; domain mutations
 * remain in DatabaseLifecycleCommandRepository transactions.
 */
export class DatabaseAuthoritativeLifecycleTaskStore {
  public constructor(
    private readonly database: RuntimeDatabase,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public prepare(input: {
    spec: {
      taskId: string;
      loader: PreparedLifecycleEffect["loader"];
      transition: string;
      effectBoundary: PreparedLifecycleEffect["effectBoundary"];
    };
    aggregateId: string;
    expectedAggregateVersion: number;
    scheduled: boolean;
    requestId: string;
  }): Promise<readonly PreparedLifecycleEffect[]> {
    return withInternalTransaction(
      this.database,
      input.requestId,
      async (tx) => {
        const limit = 100;
        let aggregates: readonly {
          aggregateId: string;
          aggregateVersion: number;
          persistedState: Readonly<Record<string, unknown>>;
        }[];
        switch (input.spec.taskId) {
          case "lifecycle-onboarding-screening-refresh-v1":
            aggregates = (await tx.query.accounts.findMany({ limit })).map(
              (row) => ({
                aggregateId: row.id,
                aggregateVersion: row.rowVersion,
                persistedState: row,
              }),
            );
            break;
          case "lifecycle-onboarding-procurement-reminders-v1":
            aggregates = (
              await tx.query.procurementProfiles.findMany({ limit })
            ).map((row) => ({
              aggregateId: row.id,
              aggregateVersion: row.rowVersion,
              persistedState: row,
            }));
            break;
          case "lifecycle-agreements-envelope-dispatch-v1":
          case "lifecycle-agreements-signature-reminder-v1":
          case "lifecycle-agreements-evidence-ingestion-v1":
            aggregates = (
              await tx.query.lifecycleSignatureEnvelopes.findMany({ limit })
            ).map((row) => ({
              aggregateId: row.id,
              aggregateVersion: row.rowVersion,
              persistedState: row,
            }));
            break;
          case "lifecycle-provisioning-confirmation-ingestion-v1":
          case "lifecycle-provisioning-stuck-recovery-v1":
            aggregates = (
              await tx.query.lifecycleProvisioningAttempts.findMany({ limit })
            ).map((row) => ({
              aggregateId: row.id,
              aggregateVersion: row.rowVersion,
              persistedState: row,
            }));
            break;
          case "lifecycle-pocs-milestones-v1":
          case "lifecycle-pocs-expiry-v1":
          case "lifecycle-pocs-proposal-v1":
          case "lifecycle-pocs-conversion-v1":
            aggregates = (await tx.query.pocs.findMany({ limit })).map(
              (row) => ({
                aggregateId: row.id,
                aggregateVersion: row.rowVersion,
                persistedState: row,
              }),
            );
            break;
          case "lifecycle-quotes-expiry-alerts-v1":
            aggregates = (await tx.query.quotes.findMany({ limit })).map(
              (row) => ({
                aggregateId: row.id,
                aggregateVersion: row.rowVersion,
                persistedState: row,
              }),
            );
            break;
          case "lifecycle-renewals-term-alerts-v1":
          case "lifecycle-renewals-notice-windows-v1":
          case "lifecycle-renewals-auto-renew-evaluation-v1":
            aggregates = (await tx.query.orders.findMany({ limit })).map(
              (row) => ({
                aggregateId: row.id,
                aggregateVersion: row.rowVersion,
                persistedState: row,
              }),
            );
            break;
          case "lifecycle-offboarding-retrieval-window-v1":
          case "lifecycle-offboarding-retention-release-v1":
          case "lifecycle-offboarding-teardown-v1":
          case "lifecycle-offboarding-confirmation-v1":
            aggregates = (await tx.query.terminations.findMany({ limit })).map(
              (row) => ({
                aggregateId: row.id,
                aggregateVersion: row.rowVersion,
                persistedState: row,
              }),
            );
            break;
          case "lifecycle-exceptions-escalation-v1":
          case "lifecycle-exceptions-human-decision-v1":
            aggregates = (
              await tx.query.exceptionCases.findMany({ limit })
            ).map((row) => ({
              aggregateId: row.id,
              aggregateVersion: row.rowVersion,
              persistedState: row,
            }));
            break;
          case "lifecycle-migrations-discovery-v1":
          case "lifecycle-migrations-scheduled-batch-v1":
          case "lifecycle-migrations-review-wait-v1":
            aggregates = (
              await tx.query.lifecycleMigrationRuns.findMany({ limit })
            ).map((row) => ({
              aggregateId: row.id,
              aggregateVersion: row.rowVersion,
              persistedState: row,
            }));
            break;
          default:
            throw new Error(
              `LIFECYCLE_TASK_NOT_ALLOWLISTED:${input.spec.taskId}`,
            );
        }
        const selected = input.scheduled
          ? aggregates
          : aggregates.filter(
              (aggregate) => aggregate.aggregateId === input.aggregateId,
            );
        if (!input.scheduled && selected.length === 0)
          throw new Error("LIFECYCLE_TASK_AGGREGATE_NOT_FOUND");
        const stale = selected.find(
          (aggregate) =>
            aggregate.aggregateVersion !== input.expectedAggregateVersion,
        );
        if (!input.scheduled && stale)
          throw new Error(
            `LIFECYCLE_TASK_STALE_AGGREGATE_VERSION:${input.expectedAggregateVersion}:${stale.aggregateVersion}`,
          );
        const now = this.now();
        const due = selected.filter((aggregate) =>
          shouldPlanLifecycleTransition(
            input.spec.taskId,
            aggregate.persistedState,
            input.scheduled,
            now,
          ),
        );
        // Commercial recipients are read from persisted contacts. An account
        // with no active commercial contact is skipped rather than guessed at.
        const recipients = await lifecycleAlertRecipients(
          tx,
          input.spec.taskId,
          due.map((aggregate) => aggregate.persistedState),
        );
        return due
          .filter(
            (aggregate) =>
              !isLifecycleAlertTask(input.spec.taskId) ||
              (recipients.get(aggregate.aggregateId)?.length ?? 0) > 0,
          )
          .map((aggregate) => {
            const persistedState = withLifecycleProviderInput(
              input.spec.taskId,
              {
                ...aggregate.persistedState,
                alertRecipients: recipients.get(aggregate.aggregateId) ?? [],
              },
              now,
            );
            const fingerprint = sanitizedPlannerFingerprint(
              input.spec,
              {
                ...aggregate,
                persistedState,
              },
              input.scheduled ? input.aggregateId : undefined,
            );
            return {
              effectKey: `lifecycle-effect:${createHash("sha256")
                .update(fingerprint)
                .digest("hex")}`,
              taskId: input.spec.taskId,
              aggregateId: aggregate.aggregateId,
              aggregateVersion: aggregate.aggregateVersion,
              loader: input.spec.loader,
              transition: input.spec.transition,
              effectBoundary: input.spec.effectBoundary,
              persistedState,
            };
          })
          .sort((left, right) =>
            left.aggregateId.localeCompare(right.aggregateId),
          );
      },
    );
  }

  public claimEffect(input: {
    effect: PreparedLifecycleEffect;
    requestId: string;
  }): Promise<
    | { status: "invoke"; leaseToken: string }
    | {
        status: "provider_succeeded";
        leaseToken: string;
        reference: string;
        output?: unknown;
      }
    | { status: "committed"; reference: string }
    | { status: "permanent_failure"; code: string }
  > {
    return withInternalTransaction(
      this.database,
      input.requestId,
      async (tx) => {
        const leaseUntil = new Date(this.now().getTime() + 60_000);
        const leaseToken = randomUUID();
        const [inserted] = await tx
          .insert(providerOperations)
          .values({
            provider: "lifecycle-runtime",
            operation: input.effect.transition,
            idempotencyKey: input.effect.effectKey,
            aggregateType: input.effect.loader,
            aggregateId: input.effect.aggregateId,
            status: "running",
            attemptCount: 1,
            nextAttemptAt: leaseUntil,
            providerReference: lifecycleEffectLease(leaseToken, leaseUntil),
          })
          .onConflictDoNothing()
          .returning();
        if (inserted) return { status: "invoke" as const, leaseToken };
        const existing = await tx.query.providerOperations.findFirst({
          where: and(
            eq(providerOperations.provider, "lifecycle-runtime"),
            eq(providerOperations.idempotencyKey, input.effect.effectKey),
          ),
        });
        if (!existing) throw new Error("LIFECYCLE_EFFECT_CLAIM_RACE");
        assertLifecycleEffectBinding(existing, input.effect);
        if (existing.status === "succeeded") {
          const checkpoint = parseLifecycleEffectCheckpoint(
            existing.providerReference,
          );
          if (checkpoint.phase === "committed")
            return {
              status: "committed" as const,
              reference: checkpoint.reference,
            };
          if (Date.parse(checkpoint.leaseUntil) > this.now().getTime())
            throw new Error("LIFECYCLE_EFFECT_ALREADY_IN_PROGRESS");
          const [recovered] = await tx
            .update(providerOperations)
            .set({
              providerReference: lifecycleEffectCheckpoint(
                "provider_succeeded",
                checkpoint.reference,
                leaseToken,
                leaseUntil,
                checkpoint.output,
              ),
            })
            .where(
              and(
                eq(providerOperations.id, existing.id),
                eq(providerOperations.rowVersion, existing.rowVersion),
              ),
            )
            .returning({ id: providerOperations.id });
          if (!recovered)
            throw new Error("LIFECYCLE_EFFECT_ALREADY_IN_PROGRESS");
          return {
            status: "provider_succeeded" as const,
            leaseToken,
            reference: checkpoint.reference,
            ...(checkpoint.output === undefined
              ? {}
              : { output: checkpoint.output }),
          };
        }
        if (existing.status === "failed")
          return {
            status: "permanent_failure" as const,
            code: existing.lastError ?? "LIFECYCLE_EFFECT_FAILED",
          };
        if (
          existing.nextAttemptAt &&
          existing.nextAttemptAt.getTime() > this.now().getTime()
        )
          throw new Error("LIFECYCLE_EFFECT_ALREADY_IN_PROGRESS");
        const [reclaimed] = await tx
          .update(providerOperations)
          .set({
            status: "running",
            attemptCount: existing.attemptCount + 1,
            nextAttemptAt: leaseUntil,
            lastError: null,
            providerReference: lifecycleEffectLease(leaseToken, leaseUntil),
          })
          .where(
            and(
              eq(providerOperations.id, existing.id),
              eq(providerOperations.rowVersion, existing.rowVersion),
            ),
          )
          .returning({ id: providerOperations.id });
        if (!reclaimed) throw new Error("LIFECYCLE_EFFECT_ALREADY_IN_PROGRESS");
        return { status: "invoke" as const, leaseToken };
      },
    );
  }

  public async checkpointEffectSuccess(input: {
    effect: PreparedLifecycleEffect;
    leaseToken: string;
    reference: string;
    output?: unknown;
    requestId: string;
  }): Promise<void> {
    await withInternalTransaction(
      this.database,
      input.requestId,
      async (tx) => {
        const existing = await effectOperation(tx, input.effect);
        if (existing.status === "succeeded") {
          const checkpoint = parseLifecycleEffectCheckpoint(
            existing.providerReference,
          );
          if (checkpoint.phase === "committed") {
            if (checkpoint.reference === input.reference) return;
            throw new Error("LIFECYCLE_EFFECT_RESULT_CONFLICT");
          }
          if (
            checkpoint.leaseToken !== input.leaseToken ||
            Date.parse(checkpoint.leaseUntil) <= this.now().getTime()
          )
            throw new Error("STALE_LIFECYCLE_EFFECT_LEASE");
          if (checkpoint.reference === input.reference) return;
          throw new Error("LIFECYCLE_EFFECT_RESULT_CONFLICT");
        }
        assertLifecycleEffectLease(
          existing.providerReference,
          input.leaseToken,
          this.now(),
        );
        const [updated] = await tx
          .update(providerOperations)
          .set({
            status: "succeeded",
            providerReference: lifecycleEffectCheckpoint(
              "provider_succeeded",
              input.reference,
              input.leaseToken,
              existing.nextAttemptAt ?? new Date(this.now().getTime() + 60_000),
              input.output,
            ),
            nextAttemptAt: null,
            lastError: null,
          })
          .where(
            and(
              eq(providerOperations.id, existing.id),
              eq(providerOperations.rowVersion, existing.rowVersion),
            ),
          )
          .returning({ id: providerOperations.id });
        if (!updated) throw new Error("LIFECYCLE_EFFECT_STALE_CLAIM");
      },
    );
  }

  public async finalizeEffect(input: {
    effect: PreparedLifecycleEffect;
    leaseToken: string;
    reference: string;
    output?: unknown;
    requestId: string;
  }): Promise<void> {
    await withInternalTransaction(
      this.database,
      input.requestId,
      async (tx) => {
        const actualVersion = await currentLifecycleAggregateVersion(
          tx,
          input.effect.loader,
          input.effect.aggregateId,
        );
        if (actualVersion !== input.effect.aggregateVersion)
          throw new Error(
            `LIFECYCLE_EFFECT_STALE_AGGREGATE_VERSION:${input.effect.aggregateVersion}:${actualVersion}`,
          );
        const existing = await effectOperation(tx, input.effect);
        const checkpoint = parseLifecycleEffectCheckpoint(
          existing.providerReference,
        );
        if (checkpoint.reference !== input.reference)
          throw new Error("LIFECYCLE_EFFECT_RESULT_CONFLICT");
        if (checkpoint.phase === "committed") return;
        if (
          checkpoint.leaseToken !== input.leaseToken ||
          Date.parse(checkpoint.leaseUntil) <= this.now().getTime()
        )
          throw new Error("STALE_LIFECYCLE_EFFECT_LEASE");
        const applied = await applyLifecycleSourceTransition(
          tx,
          input.effect,
          input.output,
          { requestId: input.requestId, occurredAt: this.now() },
        );
        const priorEvents = await tx.query.lifecycleDomainEvents.findMany({
          columns: { sequence: true },
          where: and(
            eq(lifecycleDomainEvents.aggregateType, input.effect.loader),
            eq(lifecycleDomainEvents.aggregateId, input.effect.aggregateId),
          ),
          orderBy: (event, { desc }) => [desc(event.sequence)],
          limit: 1,
        });
        const transitionPayload = {
          taskId: input.effect.taskId,
          sourceAggregateVersion: applied.aggregateVersion,
          transition: input.effect.transition,
          effectBoundary: input.effect.effectBoundary,
          effectKey: input.effect.effectKey,
          providerReference: input.reference,
          application: applied.application,
        };
        const transitionJson = JSON.stringify(transitionPayload);
        await tx.insert(lifecycleDomainEvents).values({
          aggregateType: input.effect.loader,
          aggregateId: input.effect.aggregateId,
          sequence: (priorEvents[0]?.sequence ?? 0) + 1,
          eventType: input.effect.transition,
          payloadHash: createHash("sha256")
            .update(transitionJson)
            .digest("hex"),
          payload: transitionPayload,
          occurredAt: this.now(),
        });
        const [committed] = await tx
          .update(providerOperations)
          .set({
            providerReference: lifecycleEffectCheckpoint(
              "committed",
              input.reference,
            ),
          })
          .where(
            and(
              eq(providerOperations.id, existing.id),
              eq(providerOperations.rowVersion, existing.rowVersion),
            ),
          )
          .returning();
        if (!committed) throw new Error("LIFECYCLE_EFFECT_STALE_CLAIM");
        await recordLifecycleNotification(tx, input.effect, this.now(), {
          status: "sent",
          providerMessageId: input.reference,
        });
        await appendAuditAndOutbox(tx, {
          aggregateType: "provider_operation",
          aggregateId: committed.id,
          aggregateVersion: committed.rowVersion,
          eventType: "lifecycle.effect.committed",
          actor: { kind: "system", id: "lifecycle-runtime" },
          requestId: input.requestId,
          occurredAt: this.now(),
          after: {
            taskId: input.effect.taskId,
            sourceAggregateType: input.effect.loader,
            sourceAggregateId: input.effect.aggregateId,
            sourceAggregateVersion: applied.aggregateVersion,
            transition: input.effect.transition,
            effectBoundary: input.effect.effectBoundary,
            effectKey: input.effect.effectKey,
            application: applied.application,
          },
        });
      },
    );
  }

  public async failEffect(input: {
    effect: PreparedLifecycleEffect;
    leaseToken: string;
    failure: {
      kind: "transient" | "permanent";
      code: string;
      message: string;
    };
    requestId: string;
  }): Promise<void> {
    await withInternalTransaction(
      this.database,
      input.requestId,
      async (tx) => {
        const existing = await effectOperation(tx, input.effect);
        assertLifecycleEffectLease(
          existing.providerReference,
          input.leaseToken,
          this.now(),
        );
        const code = /^[A-Z0-9_]{3,100}$/.test(input.failure.code)
          ? input.failure.code
          : "LIFECYCLE_EFFECT_FAILURE";
        const [failed] = await tx
          .update(providerOperations)
          .set({
            status: input.failure.kind === "permanent" ? "failed" : "retrying",
            lastError: code,
            nextAttemptAt:
              input.failure.kind === "transient"
                ? new Date(this.now().getTime() + 1_000)
                : null,
          })
          .where(
            and(
              eq(providerOperations.id, existing.id),
              eq(providerOperations.rowVersion, existing.rowVersion),
            ),
          )
          .returning();
        if (!failed) throw new Error("LIFECYCLE_EFFECT_STALE_CLAIM");
        if (input.failure.kind === "permanent")
          await recordLifecycleNotification(tx, input.effect, this.now(), {
            status: "failed",
            failureCode: code,
          });
        await appendAuditAndOutbox(tx, {
          aggregateType: "provider_operation",
          aggregateId: failed.id,
          aggregateVersion: failed.rowVersion,
          eventType:
            input.failure.kind === "permanent"
              ? "lifecycle.effect.dead_lettered"
              : "lifecycle.effect.retry_scheduled",
          actor: { kind: "system", id: "lifecycle-runtime" },
          requestId: input.requestId,
          occurredAt: this.now(),
          after: {
            taskId: input.effect.taskId,
            transition: input.effect.transition,
            effectBoundary: input.effect.effectBoundary,
            effectKey: input.effect.effectKey,
            code,
          },
        });
      },
    );
  }
}

const plannerFingerprintFields = [
  "state",
  "status",
  "screeningStatus",
  "supplierPortalStatus",
  "expiresAt",
  "kickoffAt",
  "midpointAt",
  "finalReportAt",
  "serviceEndsOn",
  "noticeOn",
  "effectiveAt",
  "deletionScheduledAt",
  "teardownStatus",
  "teardownConfirmedAt",
  "targetAt",
  "executionMode",
  "sourceSnapshotHash",
  "providerOperationId",
  "lastProviderOccurredAt",
  "providerInput",
] as const;

const lifecycleAlertSubjects: Readonly<
  Record<string, { alertKind: string; subjectType: string }>
> = {
  "lifecycle-renewals-term-alerts-v1": {
    alertKind: "renewal_term_window",
    subjectType: "order",
  },
  "lifecycle-renewals-notice-windows-v1": {
    alertKind: "renewal_notice_window",
    subjectType: "order",
  },
  "lifecycle-pocs-milestones-v1": {
    alertKind: "poc_milestone",
    subjectType: "poc",
  },
  "lifecycle-quotes-expiry-alerts-v1": {
    alertKind: "quote_expiry",
    subjectType: "quote",
  },
};

/**
 * The delivery record commits with the effect it describes, so an alert the
 * platform claims to have sent always has a row naming the recipients, and one
 * that permanently failed has a row naming why.
 */
async function recordLifecycleNotification(
  transaction: RuntimeTransaction,
  effect: PreparedLifecycleEffect,
  now: Date,
  outcome:
    | { status: "sent"; providerMessageId: string }
    | { status: "failed"; failureCode: string },
): Promise<void> {
  if (effect.effectBoundary !== "notification_provider") return;
  const subject = lifecycleAlertSubjects[effect.taskId];
  if (!subject) return;
  const providerInput = effect.persistedState.providerInput;
  if (!providerInput || typeof providerInput !== "object") return;
  const { template, recipients } = providerInput as {
    template?: unknown;
    recipients?: unknown;
  };
  const accountId = alertAccountId(effect.taskId, effect.persistedState);
  if (
    !accountId ||
    typeof template !== "string" ||
    !Array.isArray(recipients) ||
    recipients.length === 0
  )
    return;
  await transaction
    .insert(notificationDeliveries)
    .values({
      accountId,
      channel: "email",
      alertKind: subject.alertKind,
      subjectType: subject.subjectType,
      subjectId: effect.aggregateId,
      template,
      recipients: recipients.map(String),
      idempotencyKey: effect.effectKey,
      requestedAt: now,
      ...(outcome.status === "sent"
        ? {
            status: "sent",
            providerMessageId: outcome.providerMessageId,
            deliveredAt: now,
          }
        : { status: "failed", failureCode: outcome.failureCode }),
    })
    .onConflictDoNothing({ target: notificationDeliveries.idempotencyKey });
}

/**
 * Every boundary here is a date the contract already fixed: the notice date, the
 * service end date, the POC milestones agreed at kickoff, and the quote's own
 * expiry. No lead time is invented, because how far ahead a warning should go
 * out is commercial policy the platform does not hold.
 */
function alertBoundary(
  taskId: string,
  state: Readonly<Record<string, unknown>>,
  now: Date,
): { template: string; window: string; at: string } | undefined {
  if (taskId === "lifecycle-renewals-term-alerts-v1") {
    const boundary = reachedAlertBoundary(
      [{ window: "service_end", at: state.serviceEndsOn }],
      now,
    );
    return boundary
      ? { template: "renewals.term_end.v1", ...boundary }
      : undefined;
  }
  if (taskId === "lifecycle-renewals-notice-windows-v1") {
    const boundary = reachedAlertBoundary(
      [{ window: "notice_open", at: state.noticeOn }],
      now,
    );
    return boundary
      ? { template: "renewals.notice_window.v1", ...boundary }
      : undefined;
  }
  if (taskId === "lifecycle-pocs-milestones-v1") {
    const boundary = reachedAlertBoundary(
      [
        { window: "kickoff", at: state.kickoffAt },
        { window: "midpoint", at: state.midpointAt },
        { window: "final_report", at: state.finalReportAt },
      ],
      now,
    );
    return boundary
      ? { template: "pocs.milestone.v1", ...boundary }
      : undefined;
  }
  if (taskId === "lifecycle-quotes-expiry-alerts-v1") {
    const boundary = reachedAlertBoundary(
      [{ window: "expired", at: state.expiresAt }],
      now,
    );
    return boundary ? { template: "quotes.expiry.v1", ...boundary } : undefined;
  }
  return undefined;
}

const lifecycleAlertTaskIds = new Set([
  "lifecycle-renewals-term-alerts-v1",
  "lifecycle-renewals-notice-windows-v1",
  "lifecycle-pocs-milestones-v1",
  "lifecycle-quotes-expiry-alerts-v1",
]);

export function isLifecycleAlertTask(taskId: string): boolean {
  return lifecycleAlertTaskIds.has(taskId);
}

/**
 * A resale order is owned by the partner, so its commercial notices go to the
 * partner's contacts; every other subject notifies its own account.
 */
function alertAccountId(
  taskId: string,
  state: Readonly<Record<string, unknown>>,
): string | undefined {
  const accountId =
    typeof state.accountId === "string" ? state.accountId : undefined;
  if (taskId.startsWith("lifecycle-renewals-") && state.sourcing === "resale")
    return typeof state.partnerAccountId === "string"
      ? state.partnerAccountId
      : undefined;
  return accountId;
}

async function lifecycleAlertRecipients(
  transaction: RuntimeTransaction,
  taskId: string,
  states: readonly Readonly<Record<string, unknown>>[],
): Promise<ReadonlyMap<string, readonly string[]>> {
  const result = new Map<string, readonly string[]>();
  if (!isLifecycleAlertTask(taskId) || states.length === 0) return result;
  const byAccount = new Map<string, string[]>();
  for (const state of states) {
    const aggregateId = typeof state.id === "string" ? state.id : undefined;
    const accountId = alertAccountId(taskId, state);
    if (!aggregateId || !accountId) continue;
    const bucket = byAccount.get(accountId);
    if (bucket) bucket.push(aggregateId);
    else byAccount.set(accountId, [aggregateId]);
  }
  if (byAccount.size === 0) return result;
  const contacts = await transaction.query.accountContacts.findMany({
    columns: { accountId: true, email: true },
    where: and(
      inArray(accountContacts.accountId, [...byAccount.keys()]),
      eq(accountContacts.kind, "commercial"),
      eq(accountContacts.active, true),
    ),
  });
  const emails = new Map<string, string[]>();
  for (const contact of contacts) {
    const bucket = emails.get(contact.accountId);
    if (bucket) bucket.push(contact.email);
    else emails.set(contact.accountId, [contact.email]);
  }
  for (const [accountId, aggregateIds] of byAccount) {
    const addresses = [...new Set(emails.get(accountId) ?? [])].sort();
    for (const aggregateId of aggregateIds) result.set(aggregateId, addresses);
  }
  return result;
}

function withLifecycleProviderInput(
  taskId: string,
  state: Readonly<Record<string, unknown>>,
  now: Date,
): Readonly<Record<string, unknown>> {
  const providerInput = deriveLifecycleProviderInput(taskId, state, now);
  return providerInput === undefined ? state : { ...state, providerInput };
}

/**
 * The alert boundary a subject has actually reached, or undefined when none
 * has. Encoding the boundary in the provider input is what makes each window
 * fire exactly once: the effect key changes only when a new boundary is due.
 */
function reachedAlertBoundary(
  boundaries: readonly { window: string; at: unknown }[],
  now: Date,
): { window: string; at: string } | undefined {
  const reached = boundaries
    .flatMap((boundary) => {
      const at = dateValue(boundary.at);
      return at !== undefined && at <= now.getTime()
        ? [{ window: boundary.window, at }]
        : [];
    })
    .sort((left, right) => right.at - left.at);
  const latest = reached[0];
  return latest
    ? { window: latest.window, at: new Date(latest.at).toISOString() }
    : undefined;
}

/** Pure, allow-listed planner projection; absence means fail closed. */
export function deriveLifecycleProviderInput(
  taskId: string,
  state: Readonly<Record<string, unknown>>,
  now: Date = new Date(),
): unknown {
  if (isLifecycleAlertTask(taskId)) {
    const recipients = Array.isArray(state.alertRecipients)
      ? state.alertRecipients.filter(
          (value): value is string => typeof value === "string",
        )
      : [];
    if (recipients.length === 0) return undefined;
    const boundary = alertBoundary(taskId, state, now);
    if (!boundary) return undefined;
    return {
      template: boundary.template,
      recipients,
      data: {
        subjectId: state.id,
        window: boundary.window,
        boundaryAt: boundary.at,
      },
    };
  }
  if (taskId === "lifecycle-onboarding-screening-refresh-v1")
    return {
      accountId: state.id,
      legalName: state.legalName,
      country: state.country,
      // The stable ProviderPorts screening contract currently names this
      // reason registration; no broader reason is invented at runtime.
      reason: "registration",
    };
  if (taskId === "lifecycle-agreements-envelope-dispatch-v1")
    return {
      accountId: state.accountId,
      documentId: state.documentId,
      signerEmail: state.signerEmail,
    };
  if (
    taskId === "lifecycle-provisioning-stuck-recovery-v1" &&
    state.attempt &&
    typeof state.attempt === "object" &&
    "command" in state.attempt &&
    state.attempt.command &&
    typeof state.attempt.command === "object" &&
    "operation" in state.attempt.command &&
    state.attempt.command.operation === "provision"
  ) {
    const command = state.attempt.command as Record<string, unknown>;
    return {
      operation: "provision",
      orderId: command.orderId,
      organizationId: command.organizationId,
      entitlements: command.entitlements,
    };
  }
  return undefined;
}

function stablePlannerValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(stablePlannerValue);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stablePlannerValue(item)]),
    );
  return value;
}

function sanitizedPlannerFingerprint(
  spec: {
    taskId: string;
    loader: string;
    transition: string;
    effectBoundary: string;
  },
  aggregate: {
    aggregateId: string;
    aggregateVersion: number;
    persistedState: Readonly<Record<string, unknown>>;
  },
  scheduleOccurrenceId?: string,
): string {
  const plannerState = Object.fromEntries(
    plannerFingerprintFields.flatMap((key) =>
      key in aggregate.persistedState
        ? [[key, stablePlannerValue(aggregate.persistedState[key])]]
        : [],
    ),
  );
  return JSON.stringify({
    taskId: spec.taskId,
    loader: spec.loader,
    transition: spec.transition,
    effectBoundary: spec.effectBoundary,
    aggregateId: aggregate.aggregateId,
    aggregateVersion: aggregate.aggregateVersion,
    ...(scheduleOccurrenceId ? { scheduleOccurrenceId } : {}),
    plannerState,
  });
}

function dateValue(value: unknown): number | undefined {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function shouldPlanLifecycleTransition(
  taskId: string,
  state: Readonly<Record<string, unknown>>,
  scheduled: boolean,
  now: Date,
): boolean {
  if (!scheduled) return true;
  const status = typeof state.status === "string" ? state.status : undefined;
  const envelopeState =
    typeof state.state === "string" ? state.state : undefined;
  switch (taskId) {
    case "lifecycle-onboarding-screening-refresh-v1":
      return state.screeningStatus !== "blocked";
    case "lifecycle-onboarding-procurement-reminders-v1":
      return state.supplierPortalStatus !== "complete";
    case "lifecycle-agreements-signature-reminder-v1":
      return envelopeState === "sent" || envelopeState === "viewed";
    case "lifecycle-provisioning-stuck-recovery-v1":
      return ["pending", "in_flight", "retry_scheduled"].includes(
        envelopeState ?? "",
      );
    case "lifecycle-pocs-milestones-v1":
      return (
        status === "active" &&
        (dateValue(state.kickoffAt) ?? Number.POSITIVE_INFINITY) <=
          now.getTime()
      );
    case "lifecycle-quotes-expiry-alerts-v1":
      return (
        status === "issued" &&
        (dateValue(state.expiresAt) ?? Number.POSITIVE_INFINITY) <=
          now.getTime()
      );
    case "lifecycle-pocs-expiry-v1":
      return (
        status === "active" &&
        (dateValue(state.expiresAt) ?? Number.POSITIVE_INFINITY) <=
          now.getTime()
      );
    case "lifecycle-pocs-proposal-v1":
      return status === "proposed" || status === "approved";
    case "lifecycle-renewals-term-alerts-v1":
      return (
        ["active", "amended"].includes(status ?? "") &&
        (dateValue(state.serviceEndsOn) ?? Number.POSITIVE_INFINITY) <=
          now.getTime()
      );
    case "lifecycle-renewals-notice-windows-v1":
      return (
        ["active", "amended"].includes(status ?? "") &&
        (dateValue(state.noticeOn) ?? Number.POSITIVE_INFINITY) <= now.getTime()
      );
    case "lifecycle-renewals-auto-renew-evaluation-v1":
      return ["active", "amended"].includes(status ?? "");
    case "lifecycle-offboarding-retrieval-window-v1":
      return (
        state.teardownStatus !== "confirmed" &&
        (dateValue(state.effectiveAt) ?? Number.POSITIVE_INFINITY) <=
          now.getTime()
      );
    case "lifecycle-offboarding-retention-release-v1":
      return (
        dateValue(state.deletionScheduledAt) !== undefined &&
        (dateValue(state.deletionScheduledAt) ?? Number.POSITIVE_INFINITY) <=
          now.getTime()
      );
    case "lifecycle-exceptions-escalation-v1":
      return (
        status === "open" &&
        (dateValue(state.targetAt) ?? Number.POSITIVE_INFINITY) <= now.getTime()
      );
    case "lifecycle-migrations-scheduled-batch-v1":
      return !["complete", "failed"].includes(status ?? "");
    default:
      return true;
  }
}

function lifecycleEffectCheckpoint(
  phase: "provider_succeeded" | "committed",
  reference: string,
  leaseToken?: string,
  leaseUntil?: Date,
  output?: unknown,
): string {
  if (!reference.trim()) throw new Error("LIFECYCLE_EFFECT_REFERENCE_REQUIRED");
  if (phase === "provider_succeeded" && (!leaseToken || !leaseUntil))
    throw new Error("LIFECYCLE_EFFECT_LEASE_REQUIRED");
  return JSON.stringify({
    phase,
    reference,
    ...(phase === "provider_succeeded"
      ? { leaseToken, leaseUntil: leaseUntil?.toISOString() }
      : {}),
    ...(output === undefined
      ? {}
      : { output: jsonSafeLifecycleOutput(output) }),
  });
}

function jsonSafeLifecycleOutput(output: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(output));
  } catch {
    throw new Error("LIFECYCLE_EFFECT_OUTPUT_NOT_SERIALIZABLE");
  }
}

function lifecycleEffectLease(leaseToken: string, leaseUntil: Date): string {
  return JSON.stringify({
    phase: "lease",
    leaseToken,
    leaseUntil: leaseUntil.toISOString(),
  });
}

function parseLifecycleEffectCheckpoint(value: string | null):
  | { phase: "committed"; reference: string }
  | {
      phase: "provider_succeeded";
      reference: string;
      leaseToken: string;
      leaseUntil: string;
      output?: unknown;
    } {
  if (!value) throw new Error("LIFECYCLE_EFFECT_CHECKPOINT_MISSING");
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (
      parsed.phase === "committed" &&
      typeof parsed.reference === "string" &&
      parsed.reference.length > 0
    )
      return {
        phase: "committed",
        reference: parsed.reference,
      };
    if (
      parsed.phase === "provider_succeeded" &&
      typeof parsed.reference === "string" &&
      parsed.reference.length > 0 &&
      typeof parsed.leaseToken === "string" &&
      parsed.leaseToken.length > 0 &&
      typeof parsed.leaseUntil === "string" &&
      Number.isFinite(Date.parse(parsed.leaseUntil))
    )
      return {
        phase: "provider_succeeded",
        reference: parsed.reference,
        leaseToken: parsed.leaseToken,
        leaseUntil: parsed.leaseUntil,
        ...(parsed.output === undefined ? {} : { output: parsed.output }),
      };
  } catch {
    // Converted below to one stable operational error.
  }
  throw new Error("LIFECYCLE_EFFECT_CHECKPOINT_CORRUPT");
}

function assertLifecycleEffectLease(
  value: string | null,
  leaseToken: string,
  now: Date,
): void {
  try {
    const parsed = JSON.parse(value ?? "") as Record<string, unknown>;
    if (
      parsed.leaseToken === leaseToken &&
      typeof parsed.leaseUntil === "string" &&
      Date.parse(parsed.leaseUntil) > now.getTime()
    )
      return;
  } catch {
    // Converted below to one stable operational error.
  }
  throw new Error("STALE_LIFECYCLE_EFFECT_LEASE");
}

function assertLifecycleEffectBinding(
  operation: typeof providerOperations.$inferSelect,
  effect: PreparedLifecycleEffect,
): void {
  if (
    operation.operation !== effect.transition ||
    operation.aggregateType !== effect.loader ||
    operation.aggregateId !== effect.aggregateId
  )
    throw new Error("LIFECYCLE_EFFECT_BINDING_CONFLICT");
}

async function effectOperation(
  transaction: RuntimeTransaction,
  effect: PreparedLifecycleEffect,
) {
  const operation = await transaction.query.providerOperations.findFirst({
    where: and(
      eq(providerOperations.provider, "lifecycle-runtime"),
      eq(providerOperations.idempotencyKey, effect.effectKey),
    ),
  });
  if (!operation) throw new Error("LIFECYCLE_EFFECT_NOT_CLAIMED");
  assertLifecycleEffectBinding(operation, effect);
  return operation;
}

async function currentLifecycleAggregateVersion(
  transaction: RuntimeTransaction,
  loader: string,
  aggregateId: string,
): Promise<number> {
  let row: { rowVersion: number } | undefined;
  switch (loader) {
    case "account":
      row = await transaction.query.accounts.findFirst({
        columns: { rowVersion: true },
        where: (table, { eq }) => eq(table.id, aggregateId),
      });
      break;
    case "procurement_profile":
      row = await transaction.query.procurementProfiles.findFirst({
        columns: { rowVersion: true },
        where: (table, { eq }) => eq(table.id, aggregateId),
      });
      break;
    case "signature_envelope":
      row = await transaction.query.lifecycleSignatureEnvelopes.findFirst({
        columns: { rowVersion: true },
        where: (table, { eq }) => eq(table.id, aggregateId),
      });
      break;
    case "provisioning_attempt":
      row = await transaction.query.lifecycleProvisioningAttempts.findFirst({
        columns: { rowVersion: true },
        where: (table, { eq }) => eq(table.id, aggregateId),
      });
      break;
    case "poc":
      row = await transaction.query.pocs.findFirst({
        columns: { rowVersion: true },
        where: (table, { eq }) => eq(table.id, aggregateId),
      });
      break;
    case "quote":
      row = await transaction.query.quotes.findFirst({
        columns: { rowVersion: true },
        where: (table, { eq }) => eq(table.id, aggregateId),
      });
      break;
    case "order":
      row = await transaction.query.orders.findFirst({
        columns: { rowVersion: true },
        where: (table, { eq }) => eq(table.id, aggregateId),
      });
      break;
    case "termination":
      row = await transaction.query.terminations.findFirst({
        columns: { rowVersion: true },
        where: (table, { eq }) => eq(table.id, aggregateId),
      });
      break;
    case "exception_case":
      row = await transaction.query.exceptionCases.findFirst({
        columns: { rowVersion: true },
        where: (table, { eq }) => eq(table.id, aggregateId),
      });
      break;
    case "migration_run":
      row = await transaction.query.lifecycleMigrationRuns.findFirst({
        columns: { rowVersion: true },
        where: (table, { eq }) => eq(table.id, aggregateId),
      });
      break;
    default:
      throw new Error(`LIFECYCLE_EFFECT_LOADER_NOT_ALLOWLISTED:${loader}`);
  }
  if (!row) throw new Error("LIFECYCLE_EFFECT_AGGREGATE_NOT_FOUND");
  return row.rowVersion;
}

async function applyLifecycleSourceTransition(
  transaction: RuntimeTransaction,
  effect: PreparedLifecycleEffect,
  output: unknown,
  evidence: { requestId: string; occurredAt: Date },
): Promise<{
  aggregateVersion: number;
  application: "source_mutation" | "domain_event";
}> {
  if (effect.transition === "plan_poc_expiry") {
    const [expired] = await transaction
      .update(pocs)
      .set({ status: "expired" })
      .where(
        and(
          eq(pocs.id, effect.aggregateId),
          eq(pocs.rowVersion, effect.aggregateVersion),
          eq(pocs.status, "active"),
        ),
      )
      .returning({ rowVersion: pocs.rowVersion, accountId: pocs.accountId });
    if (!expired) throw new Error("LIFECYCLE_POC_EXPIRY_CONCURRENT_WRITE");
    await appendAuditAndOutbox(transaction, {
      accountId: expired.accountId,
      aggregateType: "poc",
      aggregateId: effect.aggregateId,
      aggregateVersion: expired.rowVersion,
      eventType: "poc.expired",
      actor: { kind: "system", id: "lifecycle-runtime" },
      requestId: evidence.requestId,
      occurredAt: evidence.occurredAt,
      after: {
        pocId: effect.aggregateId,
        status: "expired",
        taskId: effect.taskId,
        transition: effect.transition,
      },
    });
    return {
      aggregateVersion: expired.rowVersion,
      application: "source_mutation",
    };
  }
  if (
    effect.transition === "plan_screening_refresh" &&
    output &&
    typeof output === "object" &&
    "decision" in output &&
    ["clear", "review", "blocked"].includes(String(output.decision))
  ) {
    const [screened] = await transaction
      .update(accounts)
      .set({ screeningStatus: String(output.decision) })
      .where(
        and(
          eq(accounts.id, effect.aggregateId),
          eq(accounts.rowVersion, effect.aggregateVersion),
        ),
      )
      .returning({ rowVersion: accounts.rowVersion });
    if (!screened) throw new Error("LIFECYCLE_SCREENING_CONCURRENT_WRITE");
    return {
      aggregateVersion: screened.rowVersion,
      application: "source_mutation",
    };
  }
  // Some lifecycle transitions are event-sourced (notifications, reminders,
  // waits and provider confirmations). Their authoritative local state is the
  // immutable lifecycle_domain_events record inserted by finalizeEffect.
  return {
    aggregateVersion: effect.aggregateVersion,
    application: "domain_event",
  };
}
