# Existing-customer migration

Existing self-serve migration is a post-launch, feature-flagged operation. The
implementation is complete, but `EXT-MIGRATION-01` must supply production source
access, an approved quiet window, and named operators. Discovery and rehearsal
do not authorize a production run.

## Non-negotiable controls

- One legal entity maps to one commerce Account. Ambiguous Stripe, product, or
  legal-entity matches enter review; they never create a duplicate by default.
- Real execution requires the server-controlled migration feature flag, two
  distinct recently authenticated approvers, `destructive:request`, and an
  immutable source snapshot hash. Request payloads cannot assert their own flag
  or approvals.
- Never run migration against a mutable live export. Never use demo-reset
  tooling for migration, and never give reset tooling a production target or a
  force option.
- Existing commercial artifacts stay immutable. Missing historical acceptance
  evidence produces a re-acceptance interstitial rather than fabricated click
  evidence.

## Discovery and rehearsal

1. Record source systems, export time, record counts, source snapshot SHA-256,
   schema/version, and the approved mapping rules. Store the export in an
   access-controlled, retention-appropriate location.
2. Restore or load the snapshot into an isolated non-production project. Apply
   every canonical migration from zero and use only fictional or properly
   controlled snapshot data in the rehearsal environment.
3. Start `POST /v1/lifecycle/migrations` with `executionMode: "discovery"`, the
   snapshot hash, a batch size from 1 to 100, and no resume run for the first
   batch. Record the run ID and checkpoint.
4. Review exact, new, and ambiguous matches in `/internal/migrations`. Resolve
   an ambiguity through
   `POST /v1/lifecycle/migrations/{runId}/matches/{legacyAccountId}/decision`
   with create, attach, or skip; an attach requires the chosen Account. Record
   reason and immutable evidence.
5. Run `executionMode: "rehearsal"` from the same hash. Re-run batches and crash
   recovery to prove stable idempotency keys, deterministic counts,
   resumability, and no duplicate Accounts, Stripe customers, orders, or
   acceptance requests.
6. Verify PAYG order attachment, recoverable ToS evidence, required
   re-acceptance, account/organization scope, and separation of legacy and new
   populations. Obtain finance, operations, product, and security sign-off on
   the rehearsal report.

## Production execution

1. Complete the backup/restore drill in
   [disaster-recovery.md](./disaster-recovery.md), confirm alerts, freeze
   mapping changes, and open the approved quiet window. Record the pre-run
   database recovery point and provider/export hashes.
2. Activate the migration flag for the narrow approved window only. Verify two
   distinct named approvers and recent authentication, then start
   `executionMode: "execute"` against the exact rehearsed snapshot hash.
3. Process bounded batches through `lifecycle-migrations-scheduled-batch-v1`.
   Pause on every ambiguous match or invariant failure. Resume with the recorded
   run ID and checkpoint; do not start a parallel run for the same snapshot.
4. Monitor counts, exception queue, webhook/outbox health, identity scope,
   customer-facing re-acceptance, and provider rate limits. Disable the flag as
   soon as the approved run completes or the window closes.

## Rollback boundary

Before orders or external effects, staged records may be deleted through the
documented compensating path. Once order attachment or another external effect
begins, the run is forward-only: pause, preserve evidence, and use a reviewed
compensating migration. Never roll back by deleting issued orders, agreements,
audit events, or provider records, and never alter an applied SQL migration.

## Close

Reconcile input, created, attached, skipped, review, failed, and re-acceptance
counts to the source snapshot. Sample account and role isolation, Stripe and
product links, PAYG orders, timeline provenance, and customer interstitials.
Attach run/checkpoint IDs, approvals, flag history, recovery point, exception
disposition, and the reconciliation report to the append-only audit trail.
