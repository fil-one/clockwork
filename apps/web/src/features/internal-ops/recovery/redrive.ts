import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import {
  withInternalTransaction,
  type DeadLetterSource,
  type RuntimeDatabase,
} from "@clockwork/db";
import {
  submitDeadLetterRedrive,
  TriggerLifecycleRedriveSubmitter,
  type DeadLetterRedriveDispatch,
  type LifecycleTaskSubmissionPort,
} from "@clockwork/workflows/system";

const DispatchRowSchema = z
  .object({
    outbox_message_id: z.uuid(),
    topic: z.string().min(1),
    payload: z.unknown(),
  })
  .strict();

export type RedriveOutcome =
  | { status: "not_required" }
  | { status: "submitted" }
  | { status: "unmapped" }
  | { status: "unavailable"; code: string };

/**
 * The dispatch a stopped record was delivered from.
 *
 * A workflow run keeps a lease envelope in `input`, never its payload, so the
 * outbox message named by its `outbox:<id>` invocation key holds the only
 * surviving copy of the bytes the task ran on. A provisioning attempt is
 * re-driven through the order or POC event that raised the provisioning
 * command.
 */
function dispatchQuery(source: DeadLetterSource, id: string) {
  if (source === "workflow_run")
    return sql`
      select message.id::text as outbox_message_id,
             message.topic,
             message.payload
      from public.workflow_runs run
      join public.outbox_messages message
        on run.idempotency_key = 'outbox:' || message.id::text
      where run.id = ${id}::uuid
    `;
  return sql`
    select message.id::text as outbox_message_id,
           message.topic,
           message.payload
    from public.lifecycle_provisioning_attempts attempt
    join public.audit_events event
      on event.aggregate_id = coalesce(attempt.order_id, attempt.poc_id)
     and event.event_type = 'order.provisioning_requested'
    join public.outbox_messages message on message.event_id = event.id
    where attempt.id = ${id}::uuid
    order by event.occurred_at desc
    limit 1
  `;
}

export async function loadRedriveDispatch(
  database: RuntimeDatabase,
  input: { source: DeadLetterSource; id: string; requestId: string },
): Promise<DeadLetterRedriveDispatch | null> {
  if (input.source === "outbox_message") return null;
  const rows = await withInternalTransaction(
    database,
    input.requestId,
    (transaction) => transaction.execute(dispatchQuery(input.source, input.id)),
  );
  const parsed = DispatchRowSchema.safeParse(rows[0]);
  if (!parsed.success) return null;
  return {
    outboxMessageId: parsed.data.outbox_message_id,
    topic: parsed.data.topic,
    payload: parsed.data.payload,
  };
}

function failureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return /^[A-Z][A-Z0-9_:-]{3,}$/.test(message)
    ? message
    : "LIFECYCLE_REDRIVE_FAILED";
}

/**
 * Re-invokes the task behind a retried record.
 *
 * The outbox owns its own redelivery, so clearing its ceiling is the whole
 * retry and it never reaches here. The other two shapes only leave their
 * terminal state in the recovery store, and the re-invocation is this caller's
 * to supply.
 *
 * The decision and its audit row are already committed by the time this runs,
 * so a submission that fails is reported rather than thrown. The operator
 * re-submits the invocation; the decision is not repeated.
 */
export async function redriveRetriedWork(
  database: RuntimeDatabase,
  input: {
    source: DeadLetterSource;
    id: string;
    requestedBy: string;
    reason: string;
    requestId: string;
  },
  submission: LifecycleTaskSubmissionPort = new TriggerLifecycleRedriveSubmitter(),
): Promise<RedriveOutcome> {
  if (input.source === "outbox_message") return { status: "not_required" };
  try {
    const dispatch = await loadRedriveDispatch(database, {
      source: input.source,
      id: input.id,
      requestId: input.requestId,
    });
    if (!dispatch) return { status: "unmapped" };
    const result = await submitDeadLetterRedrive(
      dispatch,
      { requestedBy: input.requestedBy, reason: input.reason },
      submission,
    );
    return result.status === "submitted"
      ? { status: "submitted" }
      : { status: "unmapped" };
  } catch (error) {
    return { status: "unavailable", code: failureCode(error) };
  }
}
