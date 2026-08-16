# Unhandled runtime errors

Durable runtime failures are listed at `/internal/unhandled-errors`, grouped by
event type, safe code and aggregate, with first and last occurrence. Each row
carries the request id, the aggregate type and id, the audit event id and the
outbox message id. All eight catalogued writers append through
`appendAuditAndOutbox`, so an outbox row is expected on every one of these
events; a row that somehow lacks one reads "no outbox row" rather than showing a
blank. The boundary and the task identifier are shown as two separate facts,
each stating plainly when the writer recorded none. Reaching the surface
requires `system:operate`. Recording a containment or a release there re-reads
the operator's roles at execution time, requires recent authentication, carries
a reason between 8 and 2000 characters, and writes one audit event paired with
its outbox row in the same transaction.

## What the surface reads

Eight audit event types, each bound in
`apps/web/src/features/internal-ops/unhandled-errors/model.ts` to the module
that appends it:

| Event type                                  | Appended by                                                    |
| ------------------------------------------- | -------------------------------------------------------------- |
| `workflow.task.retry_scheduled`             | `packages/db/src/repositories/workflows/core.ts`               |
| `workflow.task.dead_lettered`               | `packages/db/src/repositories/workflows/core.ts`               |
| `lifecycle.effect.retry_scheduled`          | `packages/db/src/repositories/workflows/lifecycle.ts`          |
| `lifecycle.effect.dead_lettered`            | `packages/db/src/repositories/workflows/lifecycle.ts`          |
| `lifecycle.provider_effect.retry_scheduled` | `packages/db/src/repositories/workflows/lifecycle.ts`          |
| `lifecycle.provider_effect.dead_lettered`   | `packages/db/src/repositories/workflows/lifecycle.ts`          |
| `order.provisioning_dead_lettered`          | `packages/db/src/repositories/lifecycle/command-repository.ts` |
| `experience.projection_action.failed`       | `packages/db/src/repositories/experience/portal-runtime.ts`    |

This is a curated list, and the page says so. Two tests in `model.test.ts` hold
it to the tree and they fail in opposite directions. The binding reconstructs
each event type from source fragments in the module named as its writer, so an
entry cannot survive its writer being deleted or renamed, and cannot be
satisfied by naming a module that happens to contain a common token. The
completeness check scans `packages/db/src/repositories` and
`packages/workflows/src` for double-quoted dotted literals whose last segment is
failure-shaped, and fails when one is neither on the list nor excluded by name,
with a reason, in `excludedFailureShapedEventTypes`. The net is deliberately
wider than the catalogue: it also catches business rejections and operator
decisions, which is why the exclusion list has eleven entries.

The second half is there because its absence caused a real defect.
`lifecycle.provider_effect.dead_lettered` is appended by
`checkpointProviderEffect` on every permanent provisioning-provider failure, and
the `store.record()` call paired with it updates the attempt row and appends no
audit event at all, so this is the durable record of that failure. While it was
uncatalogued, this page showed nothing during exactly the outage this runbook
exists for — above an empty state asserting that every workflow task, lifecycle
effect, provisioning command and portal action had either succeeded or not run.

## Where a cause survives, and where it does not

**Step 3 is where diagnosis starts for most of these types.** Four write sites
pass the failure through `/^[A-Z0-9_]{3,100}$/` and substitute a constant when
it does not match — two in `packages/db/src/repositories/workflows/core.ts`
writing `workflow_runs.last_error`, and two in
`packages/db/src/repositories/workflows/lifecycle.ts` writing
`provider_operations.last_error` — so the provider's own description never
reaches those columns. `experience_projection_action_claims.last_error` stores
the failure code and nothing else. A row whose cause is nowhere else is labelled
`Code only`, with the write site that discarded it named in the cell.

Provisioning is the exception, and the page reaches it two ways:

- `order.provisioning_dead_lettered` carries `commandId`, which joins the
  provisioning attempt document. Its `lastError` object keeps `message` beside
  `code`, and the attempt is dead-lettered, so the message is terminal. Shown as
  "from this command's provisioning attempt".
- `lifecycle.provider_effect.*` carries no `commandId`; it is written against
  the provider operation. `provider_operations.aggregate_id` is the provisioning
  attempt id, so the same `lastError.message` is two joins away. Shown as "the
  provisioning attempt's most recent error", because that is what it is: for a
  retry sequence the attempt's `lastError` can have moved on from the event
  being read.

Both joins are left joins, so a missing attempt row degrades the cell to
`Code only` rather than to a blank. Provider-supplied text is clamped to 300
characters.

## What the surface does not do

**Containment is not applied here.** The control that disables a provider
capability is the emergency state on the external gate register at
`/internal/gates`; work that has already exhausted its attempts is retried or
abandoned at `/internal/recovery`. The record written here says a containment
was applied, by whom, why, and against which failure — it applies none itself,
and changes no runtime state. That is deliberate: `provider_operations` uses
`next_attempt_at` as a lease deadline and `provider_reference` as an effect
checkpoint, so an operator write to those rows would break the effect protocol
mid-flight.

Operator records are anchored on the failure's own immutable audit event and
numbered in their own sequence over it, because no runtime writer versions an
`audit_event` aggregate. Anchoring them on `provider_operation`, `workflow_run`
or `report_export` would consume the version the next runtime transition is
about to use and make that transition fail on `audit_aggregate_version_unique`.

## Known limits

- The route is not in `apps/web/src/features/shell/navigation.ts`, unlike
  `/internal/recovery`, `/internal/gates` and `/internal/webhook-replay`. Reach
  it by URL until it is added.
- `audit_events` has no index on `event_type` or on `occurred_at` alone — only
  `(account_id, occurred_at)` and `(request_id)` — so the read is a bounded scan
  and sort, capped at 200 rows.
- `decision-store.integration.test.ts` seeds runtime-failure audit events, and
  `audit_events` is append-only with the delete refused by a trigger. Running
  `pnpm test:integration` therefore adds fixture failures to the target database
  permanently, and they render on this page as ordinary incidents.
  `pnpm db:reset` is the only way to remove them. Treat a developer database's
  contents here accordingly.

## Procedure

1. Record the alert, deploy revision, environment, boundary, safe error type and
   code, request/workflow/task/audit/outbox IDs, and first/last occurrence. The
   surface carries the boundary, the code, the task identifier, the request,
   aggregate, audit and outbox identifiers, and first and last occurrence, and
   states which of those the writer did not record rather than substituting a
   neighbouring value. The alert, the deploy revision and the environment are
   not on the surface; they come from your own deployment records. Do not add
   the exception message, stack arguments, request body, or user data to
   telemetry or tickets.
2. Contain only the affected route, task, topic, or provider capability. Keep
   unrelated recovery paths available. If the error followed provider success,
   preserve and replay the original idempotency key rather than invoking a new
   effect.
3. Reproduce with a sanitized deterministic scenario. Validate authorization,
   aggregate version, transaction ordering, idempotency, and persisted gate
   state before changing retry policy.
4. Add an exact regression test, deploy through staging, execute the linked
   synthetic failure, and verify the alert resolves through the configured
   paging route. Live staging evidence and paging delivery remain required
   external evidence; a local test cannot substitute for them.
