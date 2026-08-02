import { createHash, randomUUID } from "node:crypto";

import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import {
  MoneySchema,
  type Actor,
  type IdempotencyKey,
} from "@clockwork/contracts";

import type { RuntimeDatabase, RuntimeTransaction } from "../../client";
import {
  accounts,
  documents,
  exceptionCases,
  invoices,
  notificationDeliveries,
  orders,
  providerOperations,
  reportExports,
  workflowRuns,
} from "../../schema";
import { withInternalTransaction } from "../../transaction";
import { appendAuditAndOutbox } from "../audit-outbox";

export interface DatabaseWorkflowClaimRequest {
  taskId: string;
  invocationKey: IdempotencyKey;
  payloadHash: string;
  aggregateId: string;
  aggregateVersion: number;
  requestId: string;
  replay?:
    | {
        requestedBy: string;
        reason: string;
        ticketReference?: string | undefined;
      }
    | undefined;
}

export type DatabaseWorkflowClaim =
  | { status: "acquired"; attempt: number; leaseToken: string }
  | { status: "completed"; output: unknown }
  | { status: "in_progress" }
  | { status: "permanent_failure"; output: unknown }
  | { status: "payload_conflict"; existingPayloadHash: string };

const RunEnvelopeSchema = z
  .object({
    payloadHash: z.string().min(1),
    aggregateVersion: z.number().int().positive(),
    requestId: z.string().min(1),
    leaseToken: z.string().min(1),
    leaseUntil: z.string().datetime({ offset: true }),
    retryAt: z.string().datetime({ offset: true }).optional(),
    replay: z
      .object({
        requestedBy: z.string(),
        reason: z.string(),
        ticketReference: z.string().optional(),
      })
      .optional(),
  })
  .passthrough();

type RunEnvelope = z.infer<typeof RunEnvelopeSchema>;

function envelope(value: unknown): RunEnvelope {
  const parsed = RunEnvelopeSchema.safeParse(value);
  if (!parsed.success) throw new Error("WORKFLOW_RUN_INPUT_CORRUPT");
  return parsed.data;
}

function jsonValue(value: unknown): unknown {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export class DatabaseWorkflowRunStore {
  public constructor(
    private readonly db: RuntimeDatabase,
    private readonly options: {
      clock?: () => Date;
      leaseMs?: number;
    } = {},
  ) {}

  private now(): Date {
    return this.options.clock?.() ?? new Date();
  }

  private leaseMs(): number {
    return this.options.leaseMs ?? 60_000;
  }

  public claim(
    request: DatabaseWorkflowClaimRequest,
  ): Promise<DatabaseWorkflowClaim> {
    return withInternalTransaction(
      this.db,
      request.requestId,
      async (transaction) => {
        const now = this.now();
        const leaseToken = randomUUID();
        const input: RunEnvelope = {
          payloadHash: request.payloadHash,
          aggregateVersion: request.aggregateVersion,
          requestId: request.requestId,
          leaseToken,
          leaseUntil: new Date(now.getTime() + this.leaseMs()).toISOString(),
          ...(request.replay ? { replay: request.replay } : {}),
        };
        const inserted = await transaction
          .insert(workflowRuns)
          .values({
            taskIdentifier: request.taskId,
            idempotencyKey: request.invocationKey,
            aggregateType: "workflow",
            aggregateId: request.aggregateId,
            status: "running",
            attemptCount: 1,
            input,
          })
          .onConflictDoNothing()
          .returning({ attempt: workflowRuns.attemptCount });
        if (inserted.length === 1)
          return { status: "acquired", attempt: 1, leaseToken };

        const existing = await transaction.query.workflowRuns.findFirst({
          where: and(
            eq(workflowRuns.taskIdentifier, request.taskId),
            eq(workflowRuns.idempotencyKey, request.invocationKey),
          ),
        });
        if (!existing) throw new Error("WORKFLOW_CLAIM_RACE");
        const prior = envelope(existing.input);
        if (prior.payloadHash !== request.payloadHash)
          return {
            status: "payload_conflict",
            existingPayloadHash: prior.payloadHash,
          };
        if (existing.status === "succeeded")
          return { status: "completed", output: existing.output };
        if (existing.status === "failed" && !request.replay)
          return { status: "permanent_failure", output: existing.output };
        if (
          existing.status === "running" &&
          Date.parse(prior.leaseUntil) > now.getTime()
        )
          return { status: "in_progress" };
        if (
          existing.status === "retrying" &&
          prior.retryAt &&
          Date.parse(prior.retryAt) > now.getTime()
        )
          return { status: "in_progress" };

        const reclaimed = await transaction
          .update(workflowRuns)
          .set({
            status: "running",
            attemptCount: existing.attemptCount + 1,
            input,
            output: null,
            lastError: null,
          })
          .where(
            and(
              eq(workflowRuns.id, existing.id),
              eq(workflowRuns.rowVersion, existing.rowVersion),
            ),
          )
          .returning({ attempt: workflowRuns.attemptCount });
        const claimed = reclaimed[0];
        return claimed
          ? { status: "acquired", attempt: claimed.attempt, leaseToken }
          : { status: "in_progress" };
      },
    );
  }

  public markCompleted(input: {
    invocationKey: IdempotencyKey;
    leaseToken: string;
    output: unknown;
    completedAt: string;
  }): Promise<void> {
    return this.finish(input, "succeeded", null, input.completedAt);
  }

  public markPermanentFailure(input: {
    invocationKey: IdempotencyKey;
    leaseToken: string;
    output: unknown;
    failedAt: string;
  }): Promise<void> {
    return this.finish(
      input,
      "failed",
      "WORKFLOW_PERMANENT_FAILURE",
      input.failedAt,
    );
  }

  /**
   * Closes a task that was denied before any external effect was authorized.
   * Deliberately emits no audit/outbox row: a closed gate must not manufacture
   * a forbidden effect notification. Gate-state audit is owned by the gate
   * register itself.
   */
  public async markPolicyDenied(input: {
    invocationKey: IdempotencyKey;
    leaseToken: string;
    code: string;
  }): Promise<void> {
    const code = /^[A-Z0-9_]{3,100}$/.test(input.code)
      ? input.code
      : "WORKFLOW_POLICY_DENIED";
    await withInternalTransaction(
      this.db,
      `workflow-denied:${input.invocationKey}`,
      async (transaction) => {
        const row = await this.leasedRow(
          transaction,
          input.invocationKey,
          input.leaseToken,
        );
        const [updated] = await transaction
          .update(workflowRuns)
          .set({
            status: "failed",
            output: { code },
            lastError: code,
          })
          .where(
            and(
              eq(workflowRuns.id, row.id),
              eq(workflowRuns.rowVersion, row.rowVersion),
            ),
          )
          .returning({ id: workflowRuns.id });
        if (!updated) throw new Error("STALE_WORKFLOW_LEASE");
      },
    );
  }

  public async markRetrying(input: {
    invocationKey: IdempotencyKey;
    leaseToken: string;
    code: string;
    retryAfterMs?: number;
    failedAt: string;
  }): Promise<void> {
    await withInternalTransaction(
      this.db,
      `workflow-retry:${input.invocationKey}`,
      async (transaction) => {
        const row = await this.leasedRow(
          transaction,
          input.invocationKey,
          input.leaseToken,
        );
        const prior = envelope(row.input);
        const retryAt = new Date(
          Date.parse(input.failedAt) + (input.retryAfterMs ?? 0),
        ).toISOString();
        const updated = await transaction
          .update(workflowRuns)
          .set({
            status: "retrying",
            input: { ...prior, retryAt, leaseUntil: input.failedAt },
            lastError: /^[A-Z0-9_]{3,100}$/.test(input.code)
              ? input.code
              : "WORKFLOW_RETRYABLE_FAILURE",
          })
          .where(
            and(
              eq(workflowRuns.id, row.id),
              eq(workflowRuns.rowVersion, row.rowVersion),
            ),
          )
          .returning();
        const transitioned = updated[0];
        if (!transitioned) throw new Error("STALE_WORKFLOW_LEASE");
        await appendWorkflowRunTransition(transaction, transitioned, {
          eventType: "workflow.task.retry_scheduled",
          requestId: `workflow-retry:${input.invocationKey}`,
          occurredAt: new Date(input.failedAt),
          after: {
            status: transitioned.status,
            attempt: transitioned.attemptCount,
            retryAt,
            code: transitioned.lastError,
          },
        });
      },
    );
  }

  private async finish(
    input: {
      invocationKey: IdempotencyKey;
      leaseToken: string;
      output: unknown;
    },
    status: "succeeded" | "failed",
    lastError: string | null,
    transitionedAt: string,
  ): Promise<void> {
    await withInternalTransaction(
      this.db,
      `workflow-finish:${input.invocationKey}`,
      async (transaction) => {
        const row = await this.leasedRow(
          transaction,
          input.invocationKey,
          input.leaseToken,
        );
        const updated = await transaction
          .update(workflowRuns)
          .set({ status, output: jsonValue(input.output), lastError })
          .where(
            and(
              eq(workflowRuns.id, row.id),
              eq(workflowRuns.rowVersion, row.rowVersion),
            ),
          )
          .returning();
        const transitioned = updated[0];
        if (!transitioned) throw new Error("STALE_WORKFLOW_LEASE");
        const occurredAt = new Date(transitionedAt);
        await appendWorkflowRunTransition(transaction, transitioned, {
          eventType:
            status === "succeeded"
              ? "workflow.task.completed"
              : "workflow.task.dead_lettered",
          requestId: `workflow-finish:${input.invocationKey}`,
          occurredAt,
          after: {
            status: transitioned.status,
            attempt: transitioned.attemptCount,
            ...(lastError ? { code: lastError } : {}),
          },
        });
      },
    );
  }

  private async leasedRow(
    transaction: RuntimeTransaction,
    invocationKey: IdempotencyKey,
    leaseToken: string,
  ) {
    const rows = await transaction
      .select()
      .from(workflowRuns)
      .where(
        and(
          eq(workflowRuns.idempotencyKey, invocationKey),
          eq(workflowRuns.status, "running"),
          sql`${workflowRuns.input}->>'leaseToken' = ${leaseToken}`,
        ),
      );
    const row = rows[0];
    if (
      !row ||
      Date.parse(envelope(row.input).leaseUntil) <= this.now().getTime()
    )
      throw new Error("STALE_WORKFLOW_LEASE");
    return row;
  }
}

async function appendWorkflowRunTransition(
  transaction: RuntimeTransaction,
  run: typeof workflowRuns.$inferSelect,
  input: {
    eventType:
      | "workflow.task.completed"
      | "workflow.task.retry_scheduled"
      | "workflow.task.dead_lettered";
    requestId: string;
    occurredAt: Date;
    after: Record<string, unknown>;
  },
): Promise<void> {
  if (!Number.isFinite(input.occurredAt.valueOf()))
    throw new Error("WORKFLOW_TRANSITION_TIME_INVALID");
  // rowVersion is incremented by the database trigger on every workflow state
  // transition. It is the audit aggregate version; source aggregate versions
  // and attempt numbers are not monotonic across crash recovery and redrive.
  await appendAuditAndOutbox(transaction, {
    aggregateType: "workflow_run",
    aggregateId: run.id,
    aggregateVersion: run.rowVersion,
    eventType: input.eventType,
    actor: workflowActor,
    requestId: input.requestId,
    occurredAt: input.occurredAt,
    after: {
      taskId: run.taskIdentifier,
      invocationKey: run.idempotencyKey,
      ...input.after,
    },
  });
}

export interface WorkflowExceptionRouting {
  resolve(input: {
    queue: string;
    aggregateId: string;
    occurredAt: string;
    severity: "warning" | "blocking";
    requestedBy?: string;
  }): Promise<{
    accountId: string;
    ownerUserId: string;
    backupUserId?: string;
    escalationUserId?: string;
    objectType: string;
    targetAt: string;
    absenceEscalated?: boolean;
    rosterEntryIds?: readonly string[];
  }>;
}

const workflowActor: Actor = { kind: "system", id: "workflow-runtime" };

export class DatabaseWorkflowExceptionPort {
  public constructor(
    private readonly db: RuntimeDatabase,
    private readonly routing: WorkflowExceptionRouting,
  ) {}

  public async open(request: {
    taskId: string;
    exceptionKey: IdempotencyKey;
    queue: string;
    code: string;
    safeDetail: string;
    aggregateId: string;
    aggregateVersion: number;
    requestId: string;
    occurredAt: string;
    severity: "warning" | "blocking";
    replay?: {
      requestedBy: string;
      reason: string;
      ticketReference?: string;
    };
    metadata: Record<string, string>;
  }): Promise<{ caseId: string; duplicate?: boolean }> {
    const requestedBy = request.replay?.requestedBy;
    const route = await this.routing.resolve({
      queue: request.queue,
      aggregateId: request.aggregateId,
      occurredAt: request.occurredAt,
      severity: request.severity,
      ...(requestedBy ? { requestedBy } : {}),
    });
    const requestHash = sha256(request);
    return withInternalTransaction(this.db, request.requestId, async (tx) => {
      const inserted = await tx
        .insert(providerOperations)
        .values({
          provider: "clockwork-workflow-exception",
          operation: request.taskId,
          idempotencyKey: request.exceptionKey,
          aggregateType: "exception_case",
          aggregateId: request.aggregateId,
          status: "running",
          attemptCount: 1,
          providerReference: requestHash,
        })
        .onConflictDoNothing()
        .returning();
      let operation = inserted[0];
      if (!operation) {
        const existing = await tx.query.providerOperations.findFirst({
          where: and(
            eq(providerOperations.provider, "clockwork-workflow-exception"),
            eq(providerOperations.idempotencyKey, request.exceptionKey),
          ),
        });
        if (!existing) throw new Error("WORKFLOW_EXCEPTION_CLAIM_RACE");
        const reference = existing.providerReference ?? "";
        const separator = reference.indexOf(":");
        if (separator >= 0) {
          const caseId = reference.slice(0, separator);
          const priorHash = reference.slice(separator + 1);
          if (priorHash !== requestHash)
            throw new Error("WORKFLOW_EXCEPTION_PAYLOAD_CONFLICT");
          if (!caseId) throw new Error("WORKFLOW_EXCEPTION_INCOMPLETE");
          return { caseId, duplicate: true };
        }
        if (reference !== requestHash)
          throw new Error("WORKFLOW_EXCEPTION_PAYLOAD_CONFLICT");
        const [reclaimed] = await tx
          .update(providerOperations)
          .set({
            status: "running",
            attemptCount: existing.attemptCount + 1,
            lastError: null,
          })
          .where(
            and(
              eq(providerOperations.id, existing.id),
              eq(providerOperations.rowVersion, existing.rowVersion),
            ),
          )
          .returning();
        if (!reclaimed) throw new Error("WORKFLOW_EXCEPTION_IN_PROGRESS");
        operation = reclaimed;
      }
      const [created] = await tx
        .insert(exceptionCases)
        .values({
          accountId: route.accountId,
          queue: request.queue,
          objectType: route.objectType,
          objectId: request.aggregateId,
          ownerUserId: route.ownerUserId,
          backupUserId: route.backupUserId,
          escalationOwnerUserId: route.escalationUserId,
          requesterUserId: requestedBy,
          separationRequired: true,
          ownershipRosterEntryIds: [...(route.rosterEntryIds ?? [])],
          ownershipAbsenceEscalated: route.absenceEscalated ?? false,
          targetAt: new Date(route.targetAt),
          status: "open",
        })
        .onConflictDoNothing()
        .returning();
      const exceptionCase =
        created ??
        (await tx.query.exceptionCases.findFirst({
          where: and(
            eq(exceptionCases.queue, request.queue),
            eq(exceptionCases.objectType, route.objectType),
            eq(exceptionCases.objectId, request.aggregateId),
            eq(exceptionCases.status, "open"),
          ),
        }));
      if (!exceptionCase) throw new Error("WORKFLOW_EXCEPTION_INSERT_FAILED");
      await appendAuditAndOutbox(tx, {
        aggregateType: "provider_operation",
        aggregateId: operation.id,
        aggregateVersion: 1,
        eventType: "workflow.exception.opened",
        actor: workflowActor,
        requestId: request.requestId,
        after: {
          caseId: exceptionCase.id,
          queue: request.queue,
          code: request.code,
          safeDetail: request.safeDetail,
          severity: request.severity,
          requestedBy: requestedBy ?? null,
          ownerUserId: route.ownerUserId,
          backupUserId: route.backupUserId ?? null,
          escalationUserId: route.escalationUserId ?? null,
          ownershipRosterEntryIds: route.rosterEntryIds ?? [],
          ownershipAbsenceEscalated: route.absenceEscalated ?? false,
          metadata: request.metadata,
        },
      });
      await tx
        .update(providerOperations)
        .set({
          status: "succeeded",
          providerReference: `${exceptionCase.id}:${requestHash}`,
        })
        .where(eq(providerOperations.id, operation.id));
      return { caseId: exceptionCase.id };
    });
  }
}

export class DatabaseCoreWorkflowRecordPort {
  public constructor(private readonly db: RuntimeDatabase) {}

  public async record(input: {
    invocationKey: IdempotencyKey;
    aggregateId: string;
    aggregateVersion: number;
    requestId: string;
    occurredAt: string;
    record: { kind: string; taskId: string; [key: string]: unknown };
  }): Promise<{ duplicate?: boolean }> {
    const recordHash = sha256(input.record);
    const invoiceIssued =
      input.record.kind === "invoice_issued"
        ? InvoiceIssuedWorkflowRecordSchema.parse(input.record)
        : undefined;
    const reportExported =
      input.record.kind === "report_exported"
        ? ReportExportedWorkflowRecordSchema.parse(input.record)
        : undefined;
    const dunningDecided =
      input.record.kind === "dunning_decided"
        ? DunningDecidedWorkflowRecordSchema.parse(input.record)
        : undefined;
    return withInternalTransaction(this.db, input.requestId, async (tx) => {
      const inserted = await tx
        .insert(providerOperations)
        .values({
          provider: "clockwork-workflow-record",
          operation: input.record.kind,
          idempotencyKey: input.invocationKey,
          aggregateType: "workflow_run",
          aggregateId: input.aggregateId,
          status: "running",
          attemptCount: 1,
          providerReference: recordHash,
        })
        .onConflictDoNothing()
        .returning();
      let operation = inserted[0];
      if (!operation) {
        const existing = await tx.query.providerOperations.findFirst({
          where: and(
            eq(providerOperations.provider, "clockwork-workflow-record"),
            eq(providerOperations.idempotencyKey, input.invocationKey),
          ),
        });
        if (!existing) throw new Error("WORKFLOW_RECORD_CLAIM_RACE");
        const reference = existing.providerReference ?? "";
        const separator = reference.indexOf(":");
        if (separator >= 0) {
          const priorHash = reference.slice(separator + 1);
          if (priorHash !== recordHash)
            throw new Error("WORKFLOW_RECORD_PAYLOAD_CONFLICT");
          if (invoiceIssued)
            await assertInvoiceIssuedProjection(tx, input, invoiceIssued);
          if (reportExported)
            await assertReportExportedProjection(tx, input, reportExported);
          return { duplicate: true };
        }
        if (reference !== recordHash)
          throw new Error("WORKFLOW_RECORD_PAYLOAD_CONFLICT");
        const [reclaimed] = await tx
          .update(providerOperations)
          .set({
            status: "running",
            attemptCount: existing.attemptCount + 1,
            lastError: null,
          })
          .where(
            and(
              eq(providerOperations.id, existing.id),
              eq(providerOperations.rowVersion, existing.rowVersion),
            ),
          )
          .returning();
        if (!reclaimed) throw new Error("WORKFLOW_RECORD_IN_PROGRESS");
        operation = reclaimed;
      }
      if (invoiceIssued) {
        await projectInvoiceIssued(
          tx,
          input,
          invoiceIssued,
          operation.id,
          recordHash,
        );
        return {};
      }
      if (reportExported) {
        await projectReportExported(
          tx,
          input,
          reportExported,
          operation.id,
          recordHash,
        );
        return {};
      }
      if (dunningDecided)
        await recordDunningNotification(tx, input, dunningDecided);
      const appended = await appendAuditAndOutbox(tx, {
        aggregateType: "provider_operation",
        aggregateId: operation.id,
        aggregateVersion: 1,
        eventType: `workflow.${input.record.kind}`,
        actor: workflowActor,
        requestId: input.requestId,
        occurredAt: new Date(input.occurredAt),
        after: {
          sourceAggregateId: input.aggregateId,
          sourceAggregateVersion: input.aggregateVersion,
          record: input.record,
        },
      });
      await tx
        .update(providerOperations)
        .set({
          status: "succeeded",
          providerReference: `${appended.event.id}:${recordHash}`,
        })
        .where(eq(providerOperations.id, operation.id));
      return {};
    });
  }
}

const DunningDecidedWorkflowRecordSchema = z
  .object({
    kind: z.literal("dunning_decided"),
    taskId: z.literal("core.collections.dunning.v1"),
    input: z
      .object({
        invoiceId: z.uuid(),
        billingAccountId: z.uuid(),
        collectionsOwner: z.email(),
        billingRecipients: z.array(z.email()).min(1).max(100),
      })
      .passthrough(),
    decision: z.object({ stage: z.string().min(1) }).passthrough(),
    notificationMessageId: z.string().min(1).max(255).optional(),
  })
  .passthrough();

type DunningDecidedWorkflowRecord = z.infer<
  typeof DunningDecidedWorkflowRecordSchema
>;

/**
 * A dunning notice is only defensible if the platform can show who it reached.
 * The delivery lands in the same transaction as the workflow record, so the
 * evidence cannot survive a rolled-back decision or go missing after one.
 */
async function recordDunningNotification(
  transaction: RuntimeTransaction,
  input: { invocationKey: IdempotencyKey; occurredAt: string },
  record: DunningDecidedWorkflowRecord,
): Promise<void> {
  if (!record.notificationMessageId) return;
  const occurredAt = new Date(input.occurredAt);
  if (!Number.isFinite(occurredAt.valueOf()))
    throw new Error("DUNNING_NOTIFICATION_OCCURRED_AT_INVALID");
  await transaction
    .insert(notificationDeliveries)
    .values({
      accountId: record.input.billingAccountId,
      channel: "email",
      alertKind: "collections_dunning",
      subjectType: "invoice",
      subjectId: record.input.invoiceId,
      template: `collections.${record.decision.stage}.v1`,
      recipients: [
        ...new Set([
          record.input.collectionsOwner,
          ...record.input.billingRecipients,
        ]),
      ].sort(),
      idempotencyKey: input.invocationKey,
      status: "sent",
      providerMessageId: record.notificationMessageId,
      requestedAt: occurredAt,
      deliveredAt: occurredAt,
    })
    .onConflictDoNothing({
      target: notificationDeliveries.idempotencyKey,
    });
}

const InvoiceIssuedWorkflowRecordSchema = z
  .object({
    kind: z.literal("invoice_issued"),
    taskId: z.literal("core.billing.issue-invoice.v1"),
    input: z
      .object({
        invoiceId: z.uuid(),
        orderId: z.uuid(),
        billingAccountId: z.uuid(),
        customerId: z.string().min(1),
        commercialShape: z.enum([
          "direct",
          "referral",
          "resale",
          "distributor",
          "marketplace",
        ]),
        collectionMethod: z.enum(["auto_charge", "bank_transfer", "net_terms"]),
        amount: MoneySchema,
        poNumber: z.string().min(1).max(100).optional(),
      })
      .passthrough(),
    providerInvoiceId: z.string().min(1).max(255),
    providerStatus: z.literal("open"),
    accountingPostingId: z.string().min(1).max(255).optional(),
  })
  .strict();

type InvoiceIssuedWorkflowRecord = z.infer<
  typeof InvoiceIssuedWorkflowRecordSchema
>;

const ReportScalarSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
const ReportExportedWorkflowRecordSchema = z
  .object({
    kind: z.literal("report_exported"),
    taskId: z.literal("core.reporting.export.v1"),
    input: z
      .object({
        reportExportId: z.uuid(),
        reportType: z.enum([
          "revenue_forecast",
          "capacity_planning",
          "renewal_churn_exposure",
          "partner_performance",
          "funnel_cycle_time",
          "margin_poc_cost",
          "weekly_scorecard",
        ]),
        asOf: z.iso.datetime({ offset: true }),
        from: z.iso.date().optional(),
        to: z.iso.date().optional(),
        accountId: z.uuid().optional(),
        partnerAccountId: z.uuid().optional(),
        requestedColumns: z.array(z.string().min(1)).optional(),
        costIngestionComplete: z.boolean(),
        retainUntil: z.iso.datetime({ offset: true }),
      })
      .passthrough(),
    rowCount: z.number().int().nonnegative(),
    columns: z.array(z.string().min(1)).max(250),
    rows: z.array(z.record(z.string(), ReportScalarSchema)),
    sourceVersion: z.string().min(1).max(80),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    byteLength: z.number().int().positive(),
    documentId: z.uuid(),
    storageKey: z.string().min(1),
    versionId: z.string().min(1),
    marginLabel: z.enum(["modeled", "realized"]).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.rowCount !== value.rows.length)
      context.addIssue({
        code: "custom",
        path: ["rowCount"],
        message: "Report row count does not match the persisted rows",
      });
    if (new Set(value.columns).size !== value.columns.length)
      context.addIssue({
        code: "custom",
        path: ["columns"],
        message: "Report columns must be unique",
      });
    if (
      value.rows.some((row) =>
        Object.keys(row).some((column) => !value.columns.includes(column)),
      )
    )
      context.addIssue({
        code: "custom",
        path: ["rows"],
        message: "Report rows contain an unbound column",
      });
  });
type ReportExportedWorkflowRecord = z.infer<
  typeof ReportExportedWorkflowRecordSchema
>;

function reportRenderSource(record: ReportExportedWorkflowRecord) {
  return {
    columns: record.columns,
    rows: record.rows,
    rowCount: record.rowCount,
    sourceVersion: record.sourceVersion,
    contentHash: record.contentHash,
    byteLength: record.byteLength,
    ...(record.marginLabel ? { marginLabel: record.marginLabel } : {}),
  };
}

function assertReportInputBinding(
  parameters: unknown,
  record: ReportExportedWorkflowRecord,
): Record<string, unknown> {
  const parsed = z.record(z.string(), z.unknown()).parse(parameters);
  const expected = {
    reportType: record.input.reportType,
    asOf: record.input.asOf,
    ...(record.input.from ? { from: record.input.from } : {}),
    ...(record.input.to ? { to: record.input.to } : {}),
    ...(record.input.accountId ? { accountId: record.input.accountId } : {}),
    ...(record.input.partnerAccountId
      ? { partnerAccountId: record.input.partnerAccountId }
      : {}),
    ...(record.input.requestedColumns
      ? { requestedColumns: record.input.requestedColumns }
      : {}),
    costIngestionComplete: record.input.costIngestionComplete,
    retainUntil: record.input.retainUntil,
  };
  const actual = Object.fromEntries(
    Object.keys(expected).map((key) => [key, parsed[key]]),
  );
  if (sha256(actual) !== sha256(expected))
    throw new Error("REPORT_EXPORT_INPUT_BINDING_MISMATCH");
  return parsed;
}

async function assertReportExportedProjection(
  transaction: RuntimeTransaction,
  input: { aggregateId: string; aggregateVersion: number },
  record: ReportExportedWorkflowRecord,
): Promise<void> {
  const report = await transaction.query.reportExports.findFirst({
    where: eq(reportExports.id, record.input.reportExportId),
  });
  if (
    input.aggregateId !== record.input.reportExportId ||
    !report ||
    report.status !== "complete" ||
    report.documentId !== record.documentId ||
    report.report !== record.input.reportType
  )
    throw new Error("REPORT_EXPORT_PROJECTION_MISMATCH");
  const parameters = assertReportInputBinding(report.parameters, record);
  if (sha256(parameters.renderSource) !== sha256(reportRenderSource(record)))
    throw new Error("REPORT_EXPORT_SOURCE_PROJECTION_MISMATCH");
}

async function projectReportExported(
  transaction: RuntimeTransaction,
  input: {
    aggregateId: string;
    aggregateVersion: number;
    requestId: string;
    occurredAt: string;
  },
  record: ReportExportedWorkflowRecord,
  operationId: string,
  recordHash: string,
): Promise<void> {
  if (input.aggregateId !== record.input.reportExportId)
    throw new Error("REPORT_EXPORT_WORKFLOW_AGGREGATE_MISMATCH");
  const report = await transaction.query.reportExports.findFirst({
    where: eq(reportExports.id, record.input.reportExportId),
  });
  if (
    !report ||
    report.report !== record.input.reportType ||
    !["pending", "running"].includes(report.status) ||
    report.rowVersion !== input.aggregateVersion ||
    report.documentId !== null
  )
    throw new Error("REPORT_EXPORT_NOT_COMPLETABLE");
  const parameters = assertReportInputBinding(report.parameters, record);
  await transaction.insert(documents).values({
    id: record.documentId,
    accountId: null,
    kind: "report_export_csv",
    storageKey: record.storageKey,
    contentHash: record.contentHash,
    mimeType: "text/csv",
    byteLength: BigInt(record.byteLength),
    objectLockMode: "COMPLIANCE",
    retainUntil: new Date(record.input.retainUntil),
    legalHold: false,
    storageVersionId: record.versionId,
    createdAt: new Date(input.occurredAt),
  });
  const [updated] = await transaction
    .update(reportExports)
    .set({
      status: "complete",
      documentId: record.documentId,
      parameters: {
        ...parameters,
        renderSource: reportRenderSource(record),
      },
      updatedAt: new Date(input.occurredAt),
    })
    .where(
      and(
        eq(reportExports.id, report.id),
        eq(reportExports.rowVersion, report.rowVersion),
      ),
    )
    .returning({ rowVersion: reportExports.rowVersion });
  if (!updated) throw new Error("REPORT_EXPORT_VERSION_CONFLICT");
  const appended = await appendAuditAndOutbox(transaction, {
    aggregateType: "report_export",
    aggregateId: report.id,
    aggregateVersion: updated.rowVersion,
    eventType: "workflow.report_exported",
    actor: workflowActor,
    requestId: input.requestId,
    occurredAt: new Date(input.occurredAt),
    after: {
      reportExportId: report.id,
      reportType: record.input.reportType,
      documentId: record.documentId,
      sourceVersion: record.sourceVersion,
      contentHash: record.contentHash,
      rowCount: record.rowCount,
    },
  });
  await transaction
    .update(providerOperations)
    .set({
      status: "succeeded",
      providerReference: `${appended.event.id}:${recordHash}`,
    })
    .where(eq(providerOperations.id, operationId));
}

async function invoiceIssuedState(
  transaction: RuntimeTransaction,
  input: {
    aggregateId: string;
    aggregateVersion: number;
  },
  record: InvoiceIssuedWorkflowRecord,
) {
  if (
    input.aggregateId !== record.input.invoiceId ||
    input.aggregateVersion < 1
  )
    throw new Error("INVOICE_WORKFLOW_AGGREGATE_MISMATCH");
  const invoice = await transaction.query.invoices.findFirst({
    where: eq(invoices.id, record.input.invoiceId),
  });
  if (!invoice) throw new Error("INVOICE_WORKFLOW_INVOICE_NOT_FOUND");
  const [order, account] = await Promise.all([
    transaction.query.orders.findFirst({
      where: eq(orders.id, invoice.orderId),
    }),
    transaction.query.accounts.findFirst({
      where: eq(accounts.id, invoice.accountId),
    }),
  ]);
  if (!order) throw new Error("INVOICE_WORKFLOW_ORDER_NOT_FOUND");
  if (!account?.stripeCustomerId)
    throw new Error("INVOICE_WORKFLOW_CUSTOMER_NOT_BOUND");
  if (
    record.input.orderId !== invoice.orderId ||
    record.input.billingAccountId !== invoice.accountId ||
    record.input.customerId !== account.stripeCustomerId ||
    record.input.commercialShape !== order.sourcing ||
    record.input.amount.currency !== invoice.currency ||
    BigInt(record.input.amount.minor) !== invoice.amountMinor ||
    (record.input.poNumber ?? null) !== invoice.poNumber
  )
    throw new Error("INVOICE_WORKFLOW_PERSISTED_TRUTH_MISMATCH");
  if (
    (record.input.collectionMethod === "net_terms") !==
    (record.accountingPostingId !== undefined)
  )
    throw new Error("INVOICE_WORKFLOW_ACCOUNTING_POSTING_MISMATCH");
  return invoice;
}

async function assertInvoiceIssuedProjection(
  transaction: RuntimeTransaction,
  input: {
    aggregateId: string;
    aggregateVersion: number;
  },
  record: InvoiceIssuedWorkflowRecord,
): Promise<void> {
  const invoice = await invoiceIssuedState(transaction, input, record);
  if (
    invoice.status !== "open" ||
    invoice.stripeInvoiceId !== record.providerInvoiceId ||
    invoice.accountingPostingId !== (record.accountingPostingId ?? null)
  )
    throw new Error("INVOICE_WORKFLOW_REPLAY_STATE_CONFLICT");
}

async function projectInvoiceIssued(
  transaction: RuntimeTransaction,
  input: {
    aggregateId: string;
    aggregateVersion: number;
    requestId: string;
    occurredAt: string;
  },
  record: InvoiceIssuedWorkflowRecord,
  operationId: string,
  recordHash: string,
): Promise<void> {
  const before = await invoiceIssuedState(transaction, input, record);
  if (before.rowVersion !== input.aggregateVersion)
    throw new Error("INVOICE_WORKFLOW_STALE_AGGREGATE_VERSION");
  if (
    before.status !== "draft" ||
    before.stripeInvoiceId !== null ||
    before.accountingPostingId !== null
  )
    throw new Error("INVOICE_WORKFLOW_ALREADY_PROJECTED");
  const occurredAt = new Date(input.occurredAt);
  if (!Number.isFinite(occurredAt.valueOf()))
    throw new Error("INVOICE_WORKFLOW_OCCURRED_AT_INVALID");
  const [after] = await transaction
    .update(invoices)
    .set({
      stripeInvoiceId: record.providerInvoiceId,
      accountingPostingId: record.accountingPostingId ?? null,
      status: "open",
      updatedAt: occurredAt,
    })
    .where(
      and(
        eq(invoices.id, before.id),
        eq(invoices.rowVersion, before.rowVersion),
        isNull(invoices.stripeInvoiceId),
      ),
    )
    .returning();
  if (!after) throw new Error("INVOICE_WORKFLOW_CONCURRENT_BINDING_CONFLICT");
  const appended = await appendAuditAndOutbox(transaction, {
    accountId: after.accountId,
    aggregateType: "invoice",
    aggregateId: after.id,
    aggregateVersion: after.rowVersion,
    eventType: "workflow.invoice_issued",
    actor: workflowActor,
    requestId: input.requestId,
    occurredAt,
    before: {
      status: before.status,
      stripeInvoiceId: before.stripeInvoiceId,
      accountingPostingId: before.accountingPostingId,
    },
    after: {
      status: after.status,
      stripeInvoiceId: after.stripeInvoiceId,
      accountingPostingId: after.accountingPostingId,
      orderId: after.orderId,
      accountId: after.accountId,
      currency: after.currency,
      amountMinor: after.amountMinor.toString(),
    },
  });
  const updated = await transaction
    .update(providerOperations)
    .set({
      status: "succeeded",
      providerReference: `${appended.event.id}:${recordHash}`,
    })
    .where(eq(providerOperations.id, operationId))
    .returning({ id: providerOperations.id });
  if (updated.length !== 1)
    throw new Error("INVOICE_WORKFLOW_OPERATION_COMPLETION_FAILED");
}
