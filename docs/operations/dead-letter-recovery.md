# Dead-letter recovery

Stopped work is listed at `/internal/recovery` and decided there. This page
covers what the two decisions mean, because they mean different things to each
of the three engines.

Reaching the surface requires `system:operate`. Every decision re-reads the
operator's roles at execution time, requires recent authentication, carries a
reason of at least 8 characters, and writes one audit event with the state
change in the same transaction.

## What counts as stopped

| Engine         | Stopped when                                                              | Read from                         |
| -------------- | ------------------------------------------------------------------------- | --------------------------------- |
| Dispatch queue | `processed_at is null` and `attempt_count` at the dispatcher ceiling of 8 | `outbox_messages`                 |
| Provisioning   | `state = 'dead_letter'`                                                   | `lifecycle_provisioning_attempts` |
| Workflow task  | `status = 'failed'`                                                       | `workflow_runs`                   |

Each predicate is an indexed column comparison, so the queue stays cheap to list
as the tables grow.

A record that has been retried stays on the queue until it succeeds, labelled
with the reason it was retried. A record that has been abandoned leaves the
queue; its decision stays on the audit trail under the source row's aggregate
id.

## Retry

| Engine         | What happens                                                                                                                                                                |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dispatch queue | `attempt_count` resets to zero and the message becomes claimable again. The dispatcher redelivers on its own loop.                                                          |
| Provisioning   | The attempt returns to `retry_scheduled` and the operator redrive re-invokes the provisioning task. A new provider attempt is issued and the provider may create resources. |
| Workflow task  | The run returns to `pending` and the operator redrive re-invokes the task from its recorded input.                                                                          |

The redrive keeps the original task identity and idempotency key. Operator
authority and reason travel with the request and are never read back out of the
task payload.

If the decision commits but the task runner refuses the redrive, the surface
reports that the decision is recorded and the submission is not. Repeat the
submission. Do not repeat the decision.

## Abandon

Abandon is terminal and audited everywhere. How firmly each engine can enforce
that differs, and the difference matters when you are deciding.

| Engine         | What happens                                                                                                  | Enforced by                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Dispatch queue | `processed_at` is stamped and the message is never delivered. Everything waiting on that event stays undone.  | The dispatcher's claim query excludes it unconditionally.                                                 |
| Workflow task  | The run moves to `cancelled`.                                                                                 | A terminal status no lease or redrive re-enters.                                                          |
| Provisioning   | No further provider attempt is made. The order or POC stays unprovisioned until someone raises a new command. | The audit decision. The attempt stays `dead_letter`, which is as terminal as its CHECK constraint allows. |

The provisioning row is the weak one. Its state constraint has no value meaning
abandoned, so the column cannot carry the decision and the audit trail does.
Treat an abandoned provisioning attempt as closed, and raise a new command
rather than expecting the old attempt to resume.

Abandoning work that another operator already abandoned is refused. The first
decision stands.

## Before you decide

1. Read the failure code on the row. A permanent provider rejection will fail
   the same way on retry.
2. For the dispatch queue, know what is waiting on the event. Abandoning it
   means that work never happens, and nothing downstream reports the gap.
3. For provisioning, confirm whether the provider already created resources. The
   retry issues a new attempt, and a provider without idempotency on that
   operation can duplicate them. See
   [stuck-provisioning.md](./stuck-provisioning.md).
4. Write the reason for the next person, who will read it without your context.

Related: [queue-outbox-health.md](./queue-outbox-health.md),
[workflow-recovery.md](./workflow-recovery.md),
[webhook-replay.md](./webhook-replay.md).
