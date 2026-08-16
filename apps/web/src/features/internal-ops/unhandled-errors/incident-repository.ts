import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { withInternalTransaction, type RuntimeDatabase } from "@clockwork/db";

import { unhandledErrorsCopy } from "./copy";
import {
  causeDiscardSite,
  providerMessageProvenance,
  runtimeFailureEventTypes,
  unhandledErrorContainEvent,
  unhandledErrorReleaseEvent,
  type IncidentQueue,
  type RuntimeFailureIncident,
} from "./model";

/** No connection was configured, so no query was attempted. */
export const unwiredIncidentQueue: IncidentQueue = {
  incidents: [],
  source: unhandledErrorsCopy.sourceLabel.unwired,
  readable: false,
  state: "no_connection",
};

/** A connection existed and the read raised. */
export const unreadableIncidentQueue: IncidentQueue = {
  incidents: [],
  source: unhandledErrorsCopy.sourceLabel.unavailable,
  readable: false,
  state: "read_failed",
};

const RowSchema = z
  .object({
    audit_event_id: z.string(),
    event_type: z.string(),
    aggregate_type: z.string(),
    aggregate_id: z.string(),
    account_id: z.string().nullable(),
    request_id: z.string(),
    occurred_at: z.coerce.date(),
    boundary: z.string().nullable(),
    safe_code: z.string().nullable(),
    task_identifier: z.string().nullable(),
    outbox_message_id: z.string().nullable(),
    command_provider_message: z.string().nullable(),
    operation_provider_message: z.string().nullable(),
    decision_event: z.string().nullable(),
    decision_reason: z.string().nullable(),
    decided_at: z.coerce.date().nullable(),
    decision_count: z.coerce.number().int().nonnegative(),
  })
  .strict();

/**
 * A provider message is provider-supplied text. It is bounded here rather than
 * rendered at whatever length arrived: the runbook forbids putting an exception
 * message into telemetry or a ticket, and this page is neither, but an
 * unbounded remote string still has no business setting the height of an
 * operator's table row.
 */
export const providerMessageLimit = 300;

/**
 * Picks the cause to show and says which join reached it.
 *
 * The command join is preferred because it lands on the attempt this exact
 * command dead-lettered, whose `lastError` is terminal. The provider-operation
 * join reaches the attempt behind a `lifecycle.provider_effect.*` event, where
 * `lastError` is whatever the most recent dispatch wrote -- accurate for a
 * permanent failure, and possibly a later attempt than the event being read
 * during a retry sequence. Both are labelled rather than merged.
 */
function diagnose(
  row: z.infer<typeof RowSchema>,
): RuntimeFailureIncident["diagnosis"] {
  const command = row.command_provider_message?.trim();
  if (command)
    return {
      kind: "provider_message",
      message: command.slice(0, providerMessageLimit),
      provenance: providerMessageProvenance.commandAttempt,
    };
  const operation = row.operation_provider_message?.trim();
  if (operation)
    return {
      kind: "provider_message",
      message: operation.slice(0, providerMessageLimit),
      provenance: providerMessageProvenance.operationAttempt,
    };
  return { kind: "code_only", discardedAt: causeDiscardSite(row.event_type) };
}

function present(row: z.infer<typeof RowSchema>): RuntimeFailureIncident {
  return {
    auditEventId: row.audit_event_id,
    eventType: row.event_type,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    accountId: row.account_id,
    requestId: row.request_id,
    occurredAt: row.occurred_at.toISOString(),
    boundary: row.boundary,
    safeCode: row.safe_code,
    taskIdentifier: row.task_identifier,
    outboxMessageId: row.outbox_message_id,
    diagnosis: diagnose(row),
    decisionCount: row.decision_count,
    latestDecision:
      row.decision_event === unhandledErrorContainEvent
        ? "contain"
        : row.decision_event === unhandledErrorReleaseEvent
          ? "release"
          : null,
    latestDecisionReason: row.decision_reason,
    latestDecisionAt: row.decided_at?.toISOString() ?? null,
  };
}

/**
 * Reads the durable runtime failures an operator works from.
 *
 * `audit_events` carries no index on `event_type` or on `occurred_at` alone --
 * only `(account_id, occurred_at)` and `(request_id)` -- so this is a bounded
 * scan and sort. That is stated rather than hidden; the index belongs to a
 * migration this lane cannot write.
 *
 * A trail that cannot be read reports that it cannot be read. Nothing falls
 * back to a sample, because "no failures" and "we could not look" lead an
 * operator to opposite conclusions.
 */
export async function readRuntimeFailureIncidents(
  database: RuntimeDatabase,
  input: { requestId: string; limit?: number },
): Promise<IncidentQueue> {
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 200);
  const rows = await withInternalTransaction(
    database,
    input.requestId,
    (transaction) =>
      transaction.execute(sql`
        select failure.id::text as audit_event_id,
               failure.event_type,
               failure.aggregate_type,
               failure.aggregate_id::text as aggregate_id,
               failure.account_id::text as account_id,
               failure.request_id,
               failure.occurred_at,
               failure.after->>'effectBoundary' as boundary,
               coalesce(
                 failure.after->>'code', failure.after->>'resultCode'
               ) as safe_code,
               coalesce(
                 failure.after->>'taskId', failure.after->>'transition'
               ) as task_identifier,
               message.id::text as outbox_message_id,
               command_attempt.attempt->'lastError'->>'message'
                 as command_provider_message,
               operation_attempt.attempt->'lastError'->>'message'
                 as operation_provider_message,
               decision.event_type as decision_event,
               decision.after->>'reason' as decision_reason,
               decision.occurred_at as decided_at,
               coalesce(decisions.total, 0) as decision_count
        from public.audit_events failure
        left join public.outbox_messages message
          on message.event_id = failure.id
        left join public.lifecycle_provisioning_attempts command_attempt
          on command_attempt.command_id = failure.after->>'commandId'
        -- The provisioning-provider path writes its audit row against the
        -- provider operation and carries no commandId, but the paired
        -- store.record() call puts the provider's own message on the attempt
        -- document. provider_operations.aggregate_id is the attempt id (see
        -- claimProviderEffect in packages/db/src/repositories/workflows/
        -- lifecycle.ts), so the cause is two joins away rather than absent.
        left join public.provider_operations operation
          on failure.aggregate_type = 'provider_operation'
         and operation.id = failure.aggregate_id
         and operation.provider = 'lifecycle-provisioning'
        left join public.lifecycle_provisioning_attempts operation_attempt
          on operation_attempt.id = operation.aggregate_id
        left join lateral (
          select record.event_type, record.after, record.occurred_at
          from public.audit_events record
          where record.aggregate_type = 'audit_event'
            and record.aggregate_id = failure.id
            and record.event_type in (
              ${unhandledErrorContainEvent}, ${unhandledErrorReleaseEvent}
            )
          order by record.aggregate_version desc
          limit 1
        ) decision on true
        -- Counted by event type, not by aggregate. Only this store writes to
        -- an audit_event aggregate today, so counting every row there is
        -- correct until it is not; naming the two types keeps the number
        -- meaning what the column heading says the first time another writer
        -- appears.
        left join lateral (
          select count(*)::int as total
          from public.audit_events record
          where record.aggregate_type = 'audit_event'
            and record.aggregate_id = failure.id
            and record.event_type in (
              ${unhandledErrorContainEvent}, ${unhandledErrorReleaseEvent}
            )
        ) decisions on true
        where failure.event_type in (
          ${sql.join(
            runtimeFailureEventTypes.map((value) => sql`${value}`),
            sql`, `,
          )}
        )
        order by failure.occurred_at desc
        limit ${limit}
      `),
  );
  return {
    incidents: rows.map((row) => present(RowSchema.parse(row))),
    source: unhandledErrorsCopy.sourceLabel.live,
    readable: true,
    state: "read",
  };
}
