import { and, eq } from "drizzle-orm";
import { z } from "zod";

import {
  recordProvisioningDispatch,
  type ProvisioningAttempt,
} from "@clockwork/domain/lifecycle";

import type { RuntimeDatabase } from "../../client";
import { lifecycleProvisioningAttempts } from "../../schema/lifecycle";
import { withInternalTransaction } from "../../transaction";

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
        return { attemptId: row.id, rowVersion: row.rowVersion, attempt };
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

export interface AuthoritativeLifecycleTaskResult {
  taskId: string;
  status: "authoritative_state_loaded";
  candidateIds: readonly string[];
}

/**
 * Explicit authoritative reads for scheduler/wait tasks. These tasks never
 * accept financial or tenancy state from Trigger payloads; domain mutations
 * remain in DatabaseLifecycleCommandRepository transactions.
 */
export class DatabaseAuthoritativeLifecycleTaskStore {
  public constructor(private readonly database: RuntimeDatabase) {}

  public run(input: {
    taskId: string;
    aggregateId: string;
    scheduled: boolean;
    requestId: string;
  }): Promise<AuthoritativeLifecycleTaskResult> {
    return withInternalTransaction(
      this.database,
      input.requestId,
      async (tx) => {
        const limit = 100;
        let candidateIds: readonly string[];
        switch (input.taskId) {
          case "lifecycle-onboarding-screening-refresh-v1":
            candidateIds = (await tx.query.accounts.findMany({ limit })).map(
              (row) => row.id,
            );
            break;
          case "lifecycle-onboarding-procurement-reminders-v1":
            candidateIds = (
              await tx.query.procurementProfiles.findMany({ limit })
            ).map((row) => row.id);
            break;
          case "lifecycle-agreements-envelope-dispatch-v1":
          case "lifecycle-agreements-signature-reminder-v1":
          case "lifecycle-agreements-evidence-ingestion-v1":
            candidateIds = (
              await tx.query.lifecycleSignatureEnvelopes.findMany({ limit })
            ).map((row) => row.id);
            break;
          case "lifecycle-provisioning-confirmation-ingestion-v1":
          case "lifecycle-provisioning-stuck-recovery-v1":
            candidateIds = (
              await tx.query.lifecycleProvisioningAttempts.findMany({ limit })
            ).map((row) => row.id);
            break;
          case "lifecycle-pocs-milestones-v1":
          case "lifecycle-pocs-expiry-v1":
          case "lifecycle-pocs-proposal-v1":
          case "lifecycle-pocs-conversion-v1":
            candidateIds = (await tx.query.pocs.findMany({ limit })).map(
              (row) => row.id,
            );
            break;
          case "lifecycle-renewals-term-alerts-v1":
          case "lifecycle-renewals-notice-windows-v1":
          case "lifecycle-renewals-auto-renew-evaluation-v1":
            candidateIds = [
              ...(await tx.query.orders.findMany({ limit })).map(
                (row) => row.id,
              ),
              ...(
                await tx.query.lifecycleRenewalActions.findMany({ limit })
              ).map((row) => row.id),
            ].slice(0, limit);
            break;
          case "lifecycle-offboarding-retrieval-window-v1":
          case "lifecycle-offboarding-retention-release-v1":
          case "lifecycle-offboarding-teardown-v1":
          case "lifecycle-offboarding-confirmation-v1":
            candidateIds = [
              ...(await tx.query.terminations.findMany({ limit })).map(
                (row) => row.id,
              ),
              ...(
                await tx.query.lifecycleOffboardingPlans.findMany({ limit })
              ).map((row) => row.terminationId),
            ].slice(0, limit);
            break;
          case "lifecycle-exceptions-escalation-v1":
          case "lifecycle-exceptions-human-decision-v1":
            candidateIds = (
              await tx.query.exceptionCases.findMany({ limit })
            ).map((row) => row.id);
            break;
          case "lifecycle-migrations-discovery-v1":
          case "lifecycle-migrations-scheduled-batch-v1":
          case "lifecycle-migrations-review-wait-v1":
            candidateIds = (
              await tx.query.lifecycleMigrationRuns.findMany({ limit })
            ).map((row) => row.id);
            break;
          default:
            throw new Error(`LIFECYCLE_TASK_NOT_ALLOWLISTED:${input.taskId}`);
        }
        return {
          taskId: input.taskId,
          status: "authoritative_state_loaded" as const,
          candidateIds,
        };
      },
    );
  }
}
