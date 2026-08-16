import { sql } from "drizzle-orm";
import { z } from "zod";

import type { Actor, EntityName } from "@clockwork/contracts";

import type { RuntimeDatabase, RuntimeTransaction } from "../../client";
import { withInternalTransaction } from "../../transaction";
import { appendAuditAndOutbox } from "../audit-outbox";

/**
 * Work that has stopped and will not move again without an operator.
 *
 * Three engines record exhaustion differently, so the read model unifies them
 * on the columns each engine already indexes:
 *
 * - `outbox_message`: `processed_at is null` with `attempt_count` at the
 *   dispatcher ceiling, which the claim query itself excludes;
 * - `provisioning_attempt`: the `state` column the provisioning CHECK
 *   constrains, mirrored from the attempt document;
 * - `workflow_run`: the terminal `failed` status the task runner writes,
 *   excluding the dispatcher's own run -- see `outboxDispatchTaskIdentifier`.
 *
 * None of these is a JSONB or pattern predicate, so listing stays on
 * `outbox_dispatch_queue_idx`, `lifecycle_provisioning_state_idx`, and
 * `workflow_runs_status_idx`.
 */
export const deadLetterSources = [
  "outbox_message",
  "provisioning_attempt",
  "workflow_run",
] as const;

export type DeadLetterSource = (typeof deadLetterSources)[number];

/** Operator decisions are audit events, so the aggregate is the source row. */
const auditAggregateBySource: Readonly<Record<DeadLetterSource, EntityName>> = {
  outbox_message: "outbox_message",
  provisioning_attempt: "provisioning_attempt",
  workflow_run: "workflow_run",
};

export const deadLetterRetryEventType = "system.dead_letter.retry_requested";
export const deadLetterAbandonEventType = "system.dead_letter.abandoned";

export type DeadLetterDecision = "open" | "retry_requested";

export interface DeadLetterOperation {
  id: string;
  source: DeadLetterSource;
  /** Dispatch topic, provisioning operation, or task identifier. */
  reference: string;
  /** The record the stopped work was acting on. */
  subjectType: string;
  subjectId: string;
  accountId: string | null;
  failureCode: string;
  attemptCount: number;
  failedAt: string;
  /**
   * Identity a caller needs to re-invoke the work: the task invocation key for
   * a workflow run, the provisioning command id for an attempt. The outbox
   * redelivers itself, so it has none.
   */
  redriveKey: string | null;
  decision: DeadLetterDecision;
  decisionReason: string | null;
  decidedAt: string | null;
}

const RowSchema = z
  .object({
    source: z.enum(deadLetterSources),
    id: z.string(),
    reference: z.string(),
    subject_type: z.string(),
    subject_id: z.string(),
    account_id: z.uuid().nullable(),
    failure_code: z.string(),
    attempt_count: z.coerce.number().int().nonnegative(),
    failed_at: z.coerce.date(),
    redrive_key: z.string().nullable(),
    decision_event: z.string().nullable(),
    decision_reason: z.string().nullable(),
    decided_at: z.coerce.date().nullable(),
  })
  .strict();

const ListInputSchema = z
  .object({
    sources: z.array(z.enum(deadLetterSources)).optional(),
    limit: z.number().int().min(1).max(200).default(50),
    requestId: z.string().min(8).max(255),
  })
  .strict();

const RecoveryInputSchema = z
  .object({
    source: z.enum(deadLetterSources),
    id: z.string().min(1).max(255),
    reason: z.string().trim().min(8).max(500),
    actor: z.custom<Actor>(),
    requestId: z.string().min(8).max(255),
    occurredAt: z.date().optional(),
  })
  .strict();

export type DeadLetterRecoveryInput = z.input<typeof RecoveryInputSchema>;

export class DeadLetterRecoveryError extends Error {
  public constructor(
    public readonly code:
      | "DEAD_LETTER_OPERATION_NOT_FOUND"
      | "DEAD_LETTER_OPERATION_NOT_STOPPED"
      | "DEAD_LETTER_OPERATION_ALREADY_DECIDED"
      /**
       * The id names the dispatcher's own run rather than work an operator
       * decides. Distinct from NOT_FOUND, which says the work has moved on: this
       * row is present, still `failed`, and still refused, because the message
       * it dispatches carries the only decision that reaches it.
       */
      | "DEAD_LETTER_OPERATION_NOT_ADDRESSABLE"
      | "DEAD_LETTER_RETRY_UNSUPPORTED",
  ) {
    super(code);
    this.name = "DeadLetterRecoveryError";
  }
}

/**
 * The dispatcher ceiling. A message at or above it is already unclaimable, so
 * exhaustion needs no separate marker column.
 */
const outboxMaximumAttempts = 8;

/**
 * The dispatcher's own run, and the one `workflow_runs` identity that is not an
 * operator's to decide.
 *
 * Every other failed run is a task the operator re-invokes: it is claimed by
 * `DatabaseWorkflowRunStore.claim`, which refuses a run left `failed`, so
 * moving it to `pending` is what makes the redrive's re-claim possible. A
 * `system.outbox.dispatch.v1` run is claimed by nothing of the sort. Its
 * claimer is the message-side query in
 * `packages/db/src/repositories/system/outbox.ts`, which reaches the run only
 * through the left join on `outbox:<messageId>` and admits it in exactly three
 * states -- absent, `running` past its lease, `retrying` past its backoff.
 * Neither `pending` nor `cancelled` is among them, so neither decision moves
 * the work; and because `DatabaseOutboxDispatcherStore.fail` writes this run
 * `failed` at the same instant it puts the message at the ceiling, the incident
 * is already on this list under the message, whose retry repairs both rows.
 *
 * So the run is not a second lever on that incident. It is the same incident's
 * second row, and every decision addressable on it is either redundant with the
 * message's or destructive:
 *
 * - retry writes `pending`, which the claim query rejects, and which also
 *   disarms the working lever -- `reopenOutboxDispatchRun` reopens a run only
 *   while it is still `failed`, so the message's own retry afterwards resets
 *   the counter onto a run no query will admit again;
 * - abandon writes `cancelled`, equally unclaimable, leaving the message at the
 *   ceiling and on this list with no control left that can move it;
 * - and the decision is keyed on the run, so a message already abandoned --
 *   `processed_at` stamped, gone from the outbox branch -- would still surface
 *   here undecided, where a retry re-invokes through `redriveRetriedWork` the
 *   very delivery an operator just refused.
 *
 * It is therefore excluded from the read model and refused by the recovery
 * store. The message is the whole of the operator's control over this work.
 */
const outboxDispatchTaskIdentifier = "system.outbox.dispatch.v1";

/**
 * Decisions are read from the audit trail rather than a status column, so a
 * decision cannot exist without its evidence. The lookup is keyed on
 * `audit_aggregate_version_unique`, whose leading columns are the aggregate
 * type and id.
 */
function latestDecision(
  aggregateType: string,
  idExpression: ReturnType<typeof sql>,
) {
  return sql`
    left join lateral (
      select decision.event_type, decision.after, decision.occurred_at
      from public.audit_events decision
      where decision.aggregate_type = ${aggregateType}
        and decision.aggregate_id = ${idExpression}
        and decision.event_type in (
          ${deadLetterRetryEventType}, ${deadLetterAbandonEventType}
        )
      order by decision.occurred_at desc, decision.aggregate_version desc
      limit 1
    ) decision on true
  `;
}

export class DatabaseDeadLetterReadModel {
  public constructor(private readonly database: RuntimeDatabase) {}

  /**
   * Stopped work that no operator has abandoned. An abandoned record leaves
   * the queue by design; its decision stays readable on the audit trail.
   */
  public async list(input: {
    sources?: readonly DeadLetterSource[];
    limit?: number;
    requestId: string;
  }): Promise<readonly DeadLetterOperation[]> {
    const parsed = ListInputSchema.parse({
      ...(input.sources ? { sources: [...input.sources] } : {}),
      ...(input.limit === undefined ? {} : { limit: input.limit }),
      requestId: input.requestId,
    });
    const selected = new Set<DeadLetterSource>(
      parsed.sources && parsed.sources.length > 0
        ? parsed.sources
        : deadLetterSources,
    );
    const rows = await withInternalTransaction(
      this.database,
      parsed.requestId,
      (transaction) =>
        transaction.execute(sql`
          ${sql.join(
            [
              ...(selected.has("outbox_message") ? [this.outboxBranch()] : []),
              ...(selected.has("provisioning_attempt")
                ? [this.provisioningBranch()]
                : []),
              ...(selected.has("workflow_run") ? [this.workflowBranch()] : []),
            ],
            sql` union all `,
          )}
          order by failed_at desc
          limit ${parsed.limit}
        `),
    );
    return rows.map((row) => this.present(RowSchema.parse(row)));
  }

  public async get(input: {
    source: DeadLetterSource;
    id: string;
    requestId: string;
  }): Promise<DeadLetterOperation | null> {
    const operations = await this.list({
      sources: [input.source],
      limit: 200,
      requestId: input.requestId,
    });
    return operations.find((operation) => operation.id === input.id) ?? null;
  }

  private present(row: z.infer<typeof RowSchema>): DeadLetterOperation {
    return {
      id: row.id,
      source: row.source,
      reference: row.reference,
      subjectType: row.subject_type,
      subjectId: row.subject_id,
      accountId: row.account_id,
      failureCode: row.failure_code,
      attemptCount: row.attempt_count,
      failedAt: row.failed_at.toISOString(),
      redriveKey: row.redrive_key,
      decision:
        row.decision_event === deadLetterRetryEventType
          ? "retry_requested"
          : "open",
      decisionReason: row.decision_reason,
      decidedAt: row.decided_at?.toISOString() ?? null,
    };
  }

  private outboxBranch() {
    return sql`
      select 'outbox_message'::text as source,
             message.id::text as id,
             message.topic as reference,
             event.aggregate_type as subject_type,
             event.aggregate_id::text as subject_id,
             event.account_id,
             coalesce(message.last_error, 'OUTBOX_DISPATCH_DEAD_LETTERED') as failure_code,
             message.attempt_count,
             message.available_at as failed_at,
             null::text as redrive_key,
             decision.event_type as decision_event,
             decision.after->>'reason' as decision_reason,
             decision.occurred_at as decided_at
      from public.outbox_messages message
      join public.audit_events event on event.id = message.event_id
      ${latestDecision("outbox_message", sql`message.id`)}
      where message.processed_at is null
        and message.attempt_count >= ${outboxMaximumAttempts}
        and decision.event_type is distinct from ${deadLetterAbandonEventType}
    `;
  }

  private provisioningBranch() {
    return sql`
      select 'provisioning_attempt'::text as source,
             attempt.id::text as id,
             attempt.operation as reference,
             case when attempt.order_id is null then 'poc' else 'order' end as subject_type,
             coalesce(attempt.order_id, attempt.poc_id)::text as subject_id,
             attempt.account_id,
             coalesce(attempt.attempt->'lastError'->>'code', 'PROVISIONING_DEAD_LETTER') as failure_code,
             coalesce((attempt.attempt->>'attempts')::int, 0) as attempt_count,
             attempt.updated_at as failed_at,
             attempt.command_id as redrive_key,
             decision.event_type as decision_event,
             decision.after->>'reason' as decision_reason,
             decision.occurred_at as decided_at
      from public.lifecycle_provisioning_attempts attempt
      ${latestDecision("provisioning_attempt", sql`attempt.id`)}
      where attempt.state = 'dead_letter'
        and decision.event_type is distinct from ${deadLetterAbandonEventType}
    `;
  }

  private workflowBranch() {
    return sql`
      select 'workflow_run'::text as source,
             run.id::text as id,
             run.task_identifier as reference,
             run.aggregate_type as subject_type,
             run.aggregate_id::text as subject_id,
             null::uuid as account_id,
             coalesce(run.last_error, 'WORKFLOW_TASK_DEAD_LETTERED') as failure_code,
             run.attempt_count,
             run.updated_at as failed_at,
             run.idempotency_key as redrive_key,
             decision.event_type as decision_event,
             decision.after->>'reason' as decision_reason,
             decision.occurred_at as decided_at
      from public.workflow_runs run
      ${latestDecision("workflow_run", sql`run.id`)}
      where run.status = 'failed'
        and run.task_identifier <> ${outboxDispatchTaskIdentifier}
        and decision.event_type is distinct from ${deadLetterAbandonEventType}
    `;
  }
}

/**
 * Applies an operator decision to stopped work and records the evidence in the
 * same transaction. Authorization belongs to the caller; this store checks only
 * that the record is still stopped and still undecided.
 */
export class DatabaseDeadLetterRecoveryStore {
  public constructor(
    private readonly database: RuntimeDatabase,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Returns the work to the engine that stopped it.
   *
   * Only the outbox has a self-service retry, and it is the only one with no
   * caller behind it, so this has to leave the message genuinely claimable
   * rather than merely off the ceiling: both the message counter and the
   * `system.outbox.dispatch.v1` run the claim query joins are returned to
   * states that query admits. The other two shapes are re-invoked by the caller
   * through the lifecycle redrive, so this records the request and leaves the
   * record where the operator can see the retry is already in flight.
   */
  public retry(input: DeadLetterRecoveryInput): Promise<DeadLetterOperation> {
    return this.decide(input, deadLetterRetryEventType);
  }

  /** Closes the work permanently. Nothing re-runs it after this. */
  public abandon(input: DeadLetterRecoveryInput): Promise<DeadLetterOperation> {
    return this.decide(input, deadLetterAbandonEventType);
  }

  private async decide(
    raw: DeadLetterRecoveryInput,
    eventType:
      typeof deadLetterRetryEventType | typeof deadLetterAbandonEventType,
  ): Promise<DeadLetterOperation> {
    const input = RecoveryInputSchema.parse(raw);
    const occurredAt = input.occurredAt ?? this.now();
    return withInternalTransaction(
      this.database,
      input.requestId,
      async (transaction) => {
        const current = await this.lockedRow(
          transaction,
          input.source,
          input.id,
        );
        if (eventType === deadLetterRetryEventType)
          await this.applyRetry(
            transaction,
            input.source,
            input.id,
            occurredAt,
          );
        else
          await this.applyAbandon(
            transaction,
            input.source,
            input.id,
            occurredAt,
          );
        const version = await this.nextDecisionVersion(
          transaction,
          input.source,
          input.id,
        );
        await appendAuditAndOutbox(transaction, {
          ...(current.accountId ? { accountId: current.accountId } : {}),
          aggregateType: auditAggregateBySource[input.source],
          aggregateId: input.id,
          aggregateVersion: version,
          eventType,
          actor: input.actor,
          requestId: input.requestId,
          occurredAt,
          after: {
            source: input.source,
            reference: current.reference,
            failureCode: current.failureCode,
            attemptCount: current.attemptCount,
            reason: input.reason.trim(),
          },
        });
        return {
          id: input.id,
          source: input.source,
          reference: current.reference,
          subjectType: current.subjectType,
          subjectId: current.subjectId,
          accountId: current.accountId,
          failureCode: current.failureCode,
          attemptCount: current.attemptCount,
          failedAt: current.failedAt,
          redriveKey: current.redriveKey,
          decision:
            eventType === deadLetterRetryEventType ? "retry_requested" : "open",
          decisionReason: input.reason.trim(),
          decidedAt: occurredAt.toISOString(),
        };
      },
    );
  }

  /**
   * Reads the stopped record under a row lock so two operators cannot decide
   * the same work concurrently, and refuses anything already abandoned or not
   * an operator's to decide.
   */
  private async lockedRow(
    transaction: RuntimeTransaction,
    source: DeadLetterSource,
    id: string,
  ): Promise<
    Omit<DeadLetterOperation, "decision" | "decisionReason" | "decidedAt">
  > {
    // The read model stopped listing this run, but the store is addressed by
    // source and id -- a page rendered before the exclusion, or any caller
    // holding the id, still reaches it. Refusing here is what makes the removal
    // a refusal rather than a hidden control: see `outboxDispatchTaskIdentifier`
    // for why no decision on this row can move the work.
    if (source === "workflow_run") {
      const dispatchRun = await transaction.execute(sql`
        select 1 as dispatch
        from public.workflow_runs run
        where run.id = ${id}::uuid
          and run.task_identifier = ${outboxDispatchTaskIdentifier}
      `);
      if (dispatchRun.length > 0)
        throw new DeadLetterRecoveryError(
          "DEAD_LETTER_OPERATION_NOT_ADDRESSABLE",
        );
    }
    const abandoned = await transaction.execute(sql`
      select 1 as decided
      from public.audit_events decision
      where decision.aggregate_type = ${auditAggregateBySource[source]}
        and decision.aggregate_id = ${id}::uuid
        and decision.event_type = ${deadLetterAbandonEventType}
      limit 1
    `);
    if (abandoned.length > 0)
      throw new DeadLetterRecoveryError(
        "DEAD_LETTER_OPERATION_ALREADY_DECIDED",
      );
    const rows = await transaction.execute(this.lockedSelect(source, id));
    const row = rows[0];
    if (!row)
      throw new DeadLetterRecoveryError("DEAD_LETTER_OPERATION_NOT_FOUND");
    const parsed = RowSchema.omit({
      decision_event: true,
      decision_reason: true,
      decided_at: true,
    }).parse(row);
    return {
      id: parsed.id,
      source: parsed.source,
      reference: parsed.reference,
      subjectType: parsed.subject_type,
      subjectId: parsed.subject_id,
      accountId: parsed.account_id,
      failureCode: parsed.failure_code,
      attemptCount: parsed.attempt_count,
      failedAt: parsed.failed_at.toISOString(),
      redriveKey: parsed.redrive_key,
    };
  }

  private lockedSelect(source: DeadLetterSource, id: string) {
    if (source === "outbox_message")
      return sql`
        select 'outbox_message'::text as source,
               message.id::text as id,
               message.topic as reference,
               event.aggregate_type as subject_type,
               event.aggregate_id::text as subject_id,
               event.account_id,
               coalesce(message.last_error, 'OUTBOX_DISPATCH_DEAD_LETTERED') as failure_code,
               message.attempt_count,
               message.available_at as failed_at,
               null::text as redrive_key
        from public.outbox_messages message
        join public.audit_events event on event.id = message.event_id
        where message.id = ${id}::uuid
          and message.processed_at is null
          and message.attempt_count >= ${outboxMaximumAttempts}
        for update of message
      `;
    if (source === "provisioning_attempt")
      return sql`
        select 'provisioning_attempt'::text as source,
               attempt.id::text as id,
               attempt.operation as reference,
               case when attempt.order_id is null then 'poc' else 'order' end as subject_type,
               coalesce(attempt.order_id, attempt.poc_id)::text as subject_id,
               attempt.account_id,
               coalesce(attempt.attempt->'lastError'->>'code', 'PROVISIONING_DEAD_LETTER') as failure_code,
               coalesce((attempt.attempt->>'attempts')::int, 0) as attempt_count,
               attempt.updated_at as failed_at,
               attempt.command_id as redrive_key
        from public.lifecycle_provisioning_attempts attempt
        where attempt.id = ${id}::uuid
          and attempt.state = 'dead_letter'
        for update of attempt
      `;
    return sql`
      select 'workflow_run'::text as source,
             run.id::text as id,
             run.task_identifier as reference,
             run.aggregate_type as subject_type,
             run.aggregate_id::text as subject_id,
             null::uuid as account_id,
             coalesce(run.last_error, 'WORKFLOW_TASK_DEAD_LETTERED') as failure_code,
             run.attempt_count,
             run.updated_at as failed_at,
             run.idempotency_key as redrive_key
      from public.workflow_runs run
      where run.id = ${id}::uuid
        and run.status = 'failed'
      for update of run
    `;
  }

  /**
   * Retry semantics per engine.
   *
   * The outbox owns its own redelivery, so returning the message to the
   * dispatcher's claim query is the whole retry. A provisioning attempt and a
   * workflow run are re-invoked by their task runner, so their rows move out of
   * the terminal state and the caller supplies the redrive.
   *
   * `pending` on a workflow run is not a state anything polls, and no poller is
   * missing: `packages/db/src/repositories/workflows/core.ts` claims a run by
   * invocation key when the caller re-invokes it, and the only status that
   * decides the outcome there is `failed`, which returns `permanent_failure`
   * without a replay marker. `pending` falls past every guard in that claim to
   * the re-lease, so it is precisely what lets `redriveRetriedWork` re-enter the
   * same run on the same payload hash -- which is why the redrive submitter
   * notes replay authority need not survive its queue hop. The one run this
   * would not be true of is refused before it reaches here; see
   * `outboxDispatchTaskIdentifier`.
   */
  private async applyRetry(
    transaction: RuntimeTransaction,
    source: DeadLetterSource,
    id: string,
    occurredAt: Date,
  ): Promise<void> {
    if (source === "outbox_message") {
      await transaction.execute(sql`
        update public.outbox_messages
        set attempt_count = 0, last_error = null, available_at = ${occurredAt.toISOString()}::timestamptz
        where id = ${id}::uuid
      `);
      await this.reopenOutboxDispatchRun(transaction, id, occurredAt);
      return;
    }
    if (source === "workflow_run") {
      await transaction.execute(sql`
        update public.workflow_runs
        set status = 'pending', last_error = null
        where id = ${id}::uuid and status = 'failed'
      `);
      return;
    }
    await transaction.execute(sql`
      update public.lifecycle_provisioning_attempts
      set state = 'retry_scheduled',
          attempt = jsonb_set(attempt, '{state}', '"retry_scheduled"'::jsonb)
      where id = ${id}::uuid and state = 'dead_letter'
    `);
  }

  /**
   * Clears the second row the dispatcher's exhaustion writes.
   *
   * A message is dispatched under a `system.outbox.dispatch.v1` run keyed
   * `outbox:<id>`, and the claim query in
   * `packages/db/src/repositories/system/outbox.ts` admits a message only when
   * that run is absent, `running` past its lease, or `retrying` past its
   * backoff. `DatabaseOutboxDispatcherStore.fail` writes `failed` at exactly
   * the attempt ceiling that puts the message on this list, and `failed` is in
   * none of those three branches -- so resetting `attempt_count` alone leaves a
   * message that is off the ceiling, on the queue, and still unreachable. The
   * outbox is the one source with no caller-supplied redrive behind it
   * (`redriveRetriedWork` returns `not_required` for it), so nothing downstream
   * would compensate.
   *
   * `retrying` rather than deleting the run: the attempt history is the
   * evidence for the incident being recovered, and `retryAt` moves with the
   * message's own `available_at` so both gates open at the same instant. The
   * `failed` guard means a run someone has already re-leased is left alone.
   */
  private async reopenOutboxDispatchRun(
    transaction: RuntimeTransaction,
    id: string,
    occurredAt: Date,
  ): Promise<void> {
    await transaction.execute(sql`
      update public.workflow_runs
      set status = 'retrying',
          attempt_count = 0,
          output = null,
          last_error = null,
          input = jsonb_set(
            case when jsonb_typeof(input) = 'object' then input else '{}'::jsonb end,
            '{retryAt}',
            to_jsonb(${occurredAt.toISOString()}::text)
          )
      where task_identifier = ${outboxDispatchTaskIdentifier}
        and idempotency_key = ${`outbox:${id}`}
        and status = 'failed'
    `);
  }

  /**
   * Abandon semantics per engine. The decision is uniform; what the engine can
   * enforce is not, so each shape is closed as firmly as its own model allows.
   *
   * - `outbox_message`: `processed_at` is stamped, which the dispatcher's claim
   *   query excludes unconditionally. The event is never delivered, so nothing
   *   downstream of it happens.
   * - `workflow_run`: the run moves to `cancelled`, a terminal status no
   *   lease or redrive re-enters.
   * - `provisioning_attempt`: the attempt stays `dead_letter`, which is as
   *   terminal as its CHECK constraint allows. No provider call is issued for
   *   it again, and the order or POC it was provisioning stays unprovisioned
   *   until a new command is raised. The abandonment itself is carried by the
   *   audit decision rather than the column.
   */
  private async applyAbandon(
    transaction: RuntimeTransaction,
    source: DeadLetterSource,
    id: string,
    occurredAt: Date,
  ): Promise<void> {
    if (source === "outbox_message") {
      await transaction.execute(sql`
        update public.outbox_messages
        set processed_at = ${occurredAt.toISOString()}::timestamptz,
            last_error = 'OUTBOX_DISPATCH_ABANDONED'
        where id = ${id}::uuid and processed_at is null
      `);
      return;
    }
    if (source === "workflow_run") {
      await transaction.execute(sql`
        update public.workflow_runs
        set status = 'cancelled'
        where id = ${id}::uuid and status = 'failed'
      `);
      return;
    }
  }

  /**
   * Audit versions are unique per aggregate, and these source rows carry no
   * version of their own that advances on a decision, so decisions are numbered
   * in their own sequence.
   */
  private async nextDecisionVersion(
    transaction: RuntimeTransaction,
    source: DeadLetterSource,
    id: string,
  ): Promise<number> {
    const rows = await transaction.execute(sql`
      select coalesce(max(decision.aggregate_version), 0) + 1 as next
      from public.audit_events decision
      where decision.aggregate_type = ${auditAggregateBySource[source]}
        and decision.aggregate_id = ${id}::uuid
    `);
    return z.object({ next: z.coerce.number().int().positive() }).parse(rows[0])
      .next;
  }
}
