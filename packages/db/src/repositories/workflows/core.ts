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
  exceptionCases,
  invoices,
  orders,
  providerOperations,
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
  }): Promise<{
    accountId: string;
    ownerUserId: string;
    backupUserId?: string;
    objectType: string;
    targetAt: string;
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
    replay?: Record<string, unknown>;
    metadata: Record<string, string>;
  }): Promise<{ caseId: string; duplicate?: boolean }> {
    const route = await this.routing.resolve(request);
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
