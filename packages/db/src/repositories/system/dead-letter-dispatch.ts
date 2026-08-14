import { sql } from "drizzle-orm";
import { z } from "zod";

import type { RuntimeDatabase } from "../../client";
import { withInternalTransaction } from "../../transaction";
import type { DeadLetterSource } from "./dead-letter";

/**
 * The dispatch a stopped task was delivered from.
 *
 * A workflow run keeps a lease envelope in `input`, never its payload, so the
 * outbox message named by its `outbox:<id>` invocation key holds the only
 * surviving copy of the bytes the task ran on. A caller re-invoking the task
 * has to rebuild from here: a synthesised payload hashes differently and the
 * run store refuses the claim.
 */
export interface DeadLetterDispatch {
  outboxMessageId: string;
  topic: string;
  payload: unknown;
}

const DispatchRowSchema = z
  .object({
    outbox_message_id: z.uuid(),
    topic: z.string().min(1),
    payload: z.unknown(),
  })
  .strict();

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
  // `audit_aggregate_version_unique` leads on aggregate_type, so leaving it
  // unbound made this scan the whole audit log during the one incident that
  // reads it. The scope the attempt was raised under names the aggregate:
  // `lifecycle_provisioning_scope_check` guarantees exactly one of order_id and
  // poc_id is set -- `(poc_id is not null and order_id is null and operation =
  // 'sandbox') or (order_id is not null and poc_id is null and operation <>
  // 'sandbox')` -- which is what makes this case expression and the coalesce()
  // below agree, and what the emitter writes as `pocId ? 'poc' : 'order'`. A
  // literal 'order' would be wrong: a sandbox attempt would find nothing.
  return sql`
    select message.id::text as outbox_message_id,
           message.topic,
           message.payload
    from public.lifecycle_provisioning_attempts attempt
    join public.audit_events event
      on event.aggregate_type
           = case when attempt.order_id is not null then 'order' else 'poc' end
     and event.aggregate_id = coalesce(attempt.order_id, attempt.poc_id)
     and event.event_type = 'order.provisioning_requested'
    join public.outbox_messages message on message.event_id = event.id
    where attempt.id = ${id}::uuid
    order by event.occurred_at desc
    limit 1
  `;
}

/**
 * Returns null for an outbox message, which redelivers itself and needs no
 * dispatch lookup, and for a record whose dispatch is no longer present.
 */
export async function loadDeadLetterDispatch(
  database: RuntimeDatabase,
  input: { source: DeadLetterSource; id: string; requestId: string },
): Promise<DeadLetterDispatch | null> {
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
