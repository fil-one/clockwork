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
  // Two emitters write `order.provisioning_requested`, and they disagree
  // about the aggregate binding:
  //
  // - the acceptance path, packages/db/src/repositories/lifecycle/
  //   accepted-order-provisioning.ts:137-153, writes aggregate_type
  //   'provider_operation' keyed on the attempt id and carries the full
  //   command in `after.command` -- the bytes the dispatch actually ran on;
  // - the operator recovery path, packages/db/src/repositories/lifecycle/
  //   command-repository.ts:3466-3481 (recoverProvisioning), writes
  //   `pocId ? 'poc' : 'order'` keyed on the subject and carries only a stub
  //   `{ commandId, state, recoveredBy, reason }`.
  //
  // The correctness key is the one thing both payloads carry: the command id.
  // But this read exists to recover the bytes the task ran on, and only the
  // acceptance payload has them -- the recovery stub hashes differently, so
  // the run store refuses its claim, and the dispatch handler's
  // ProvisioningRequestedEventSchema (packages/workflows/src/runtime/
  // provider-lifecycle.ts) rejects the stub's aggregate shape outright. So
  // `after->'command'->>'commandId'` requires the full command instead of
  // taking the most recent event, which after a recovery would be the stub.
  // Do not "simplify" this to a bare recency pick.
  //
  // `audit_aggregate_version_unique` leads on aggregate_type, so the
  // aggregate bindings stay in the join as index predicates, one arm per
  // emitter above; keying on the command id alone would scan the whole audit
  // log during the one incident that reads it. In the second arm,
  // `lifecycle_provisioning_scope_check` guarantees exactly one of order_id
  // and poc_id is set (poc_id iff operation = 'sandbox'), which is what makes
  // its case expression and the coalesce() agree with that emitter.
  return sql`
    select message.id::text as outbox_message_id,
           message.topic,
           message.payload
    from public.lifecycle_provisioning_attempts attempt
    join public.audit_events event
      on event.event_type = 'order.provisioning_requested'
     and event.after->'command'->>'commandId' = attempt.command_id
     and (
       (event.aggregate_type = 'provider_operation'
          and event.aggregate_id = attempt.id)
       or (event.aggregate_type
             = case when attempt.order_id is not null then 'order' else 'poc' end
          and event.aggregate_id = coalesce(attempt.order_id, attempt.poc_id))
     )
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
