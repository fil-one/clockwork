# Workflow recovery

Use this runbook for a failed or stalled Trigger.dev task, outbox delivery, or
provider effect other than the specialized provisioning and webhook cases.
Durable work follows ADR 0005 and ADR 0006: the state change, audit event, and
outbox message commit in one Postgres transaction, while external effects use a
stable downstream idempotency key.

## Diagnose before replay

1. In the relevant internal queue, capture task ID/version, workflow run ID,
   aggregate type/ID/version, event ID, outbox ID, effect key, downstream
   idempotency key, request ID, actual/effective actor, attempts, and last
   error.
2. Check current commerce state and the provider result. Determine the failure
   boundary:
   - before the database transaction committed: no domain state or outbox work
     should exist;
   - after state/outbox commit but before provider call: resume the claimed
     outbox work;
   - after provider success but before local completion: query or replay through
     the adapter with the same downstream key;
   - after local completion: a duplicate invocation must return the stored
     result;
   - permanent failure or exhausted retries: an owned exception and explicit
     operator replay are required.
3. Confirm the payload hash and aggregate version match the original effect.
   Never reuse a key for changed payload bytes or a different aggregate version.

## Recover

1. Correct the external condition or validated input. Do not patch current
   state, audit rows, or outbox delivery metadata with application credentials
   or raw SQL.
2. Allow bounded exponential retry to handle a transient failure. Do not raise
   the retry ceiling to hide a permanent condition.
3. For an exhausted or permanent result, assign the owning exception queue and
   record operator, meaningful reason, ticket/evidence, and recent
   authentication. Use the route- or task-specific replay action.
4. Re-execute the original task ID and version with the original aggregate
   version and effect key. Human waits resume only from their documented event;
   do not replace them with polling.
5. If a crash occurred after an external effect, rely on the provider adapter's
   idempotency contract and verify the existing provider reference before any
   further action.

The permanent task IDs are catalogued in the core-finance and lifecycle
handoffs. Common recovery targets include invoice issuance, dunning, commission
settlement, usage/three-way reconciliation, e-sign evidence ingestion, POC
conversion, renewal evaluation, offboarding, exception escalation, and migration
batches.

## Verify and close

- Only one external effect exists for the effect key, and a duplicate run
  returns the stored result.
- Audit event, outbox delivery, workflow mirror, provider reference, and current
  state agree. No event is deleted; a correction is a new event.
- Account and partner scope still fail closed, and assisted work retains actual
  and effective actors.
- The exception is closed with cause, remediation, replay run ID, final result,
  and a targeted regression test when code changed.

Follow [stuck-provisioning.md](./stuck-provisioning.md) for provisioning,
[webhook-replay.md](./webhook-replay.md) for callbacks, and
[billing-reconciliation.md](./billing-reconciliation.md) for month-end financial
variances.
