# Disaster recovery

This runbook covers loss or corruption of the Clockwork application,
Supabase/Postgres data, durable workflow state, or immutable evidence access.
Production and staging are separate managed Supabase projects; a recovery is
rehearsed into an isolated project before any promotion. Exact project IDs,
region/residency, RPO, RTO, PITR retention, and named responders remain
deployment inputs under `EXT-ACC-01` and `EXT-APPROVERS-01`.

## Declare and contain

1. The incident commander records detection time, scope, affected environment,
   last known good request/event, data residency, suspected destructive action,
   and the approved RPO/RTO. Start an evidence-preserving incident timeline.
2. Stop new mutations using the narrowest environment or feature-flag control.
   Preserve portal read access when safe. Do not run demo reset, database reset,
   migration, or ad hoc cleanup against production.
3. Revoke or rotate suspected credentials through the platform owner. Preserve
   audit logs, webhook bodies/hashes, outbox rows, workflow runs, provider IDs,
   Vercel deployment IDs, and S3 object versions.
4. Confirm whether the event affects Postgres current state, provider
   projections, Trigger.dev execution, or versioned Object Lock evidence. A
   database restore does not authorize overwriting or deleting immutable S3
   objects.

## Restore into isolation

1. Select the recovery point at or before the last verified good transaction,
   within the approved PITR window. Record source project, recovery timestamp,
   backup/PITR reference, and operator.
2. Restore into a new isolated Supabase project with network restrictions. Do
   not restore over the production project. Pin the same application revision,
   migrations, Node/pnpm toolchain, and environment-variable registry used by
   the affected release.
3. Run schema and migration validation from zero on a separate empty database,
   then validate the isolated restored database without applying an old or
   edited migration. Applied canonical SQL files never change.
4. Reconnect only sandbox or read-only provider adapters initially. Keep email,
   billing mutation, provisioning, teardown, migration, and external outbox
   delivery disabled until reconciliation completes.

## Validate the restore

- Check account, membership, order-level partner visibility, RLS, and domain
  authorization with cross-account and cross-partner denial tests.
- Reconcile immutable agreements, evidence hashes, issued quotes, orders,
  amendments, notices, certificates, audit events, outbox messages, webhook
  claims, workflow mirrors, invoices, payments, and provider IDs.
- Run database constraints/pgTAP, repository integration, provider-contract,
  webhook replay, critical path, production build, and smoke/persona tests.
- Reconcile platform revenue to Stripe and QBO using
  [billing-reconciliation.md](./billing-reconciliation.md). Explain all
  post-recovery-point provider effects before enabling writes.
- Verify Object Lock downloads by stored version and SHA-256. Missing evidence
  is a legal/security incident; never substitute newly rendered bytes for an
  executed artifact.

## Cutover or rollback

1. Product, platform, security, finance, and incident-command approvers review
   the validation record. Counsel joins when executed evidence, retention, or
   personal data is affected.
2. Establish DNS, Vercel, WorkOS, Supabase, Trigger.dev, webhook, and provider
   endpoint changes as an explicit cutover plan with rollback points. Verify
   TLS, CSRF origins, AuthKit redirect, MFA enforcement, and signed webhook
   delivery before traffic.
3. Resume outbox and workflows in controlled order. Consumers deduplicate by
   event/effect ID; recover permanent failures explicitly through
   [workflow-recovery.md](./workflow-recovery.md). Monitor duplicate financial
   or provisioning effects.
4. If validation fails, leave production isolated/read-only, roll application
   traffic back to the last known-good deployment where safe, and select an
   earlier recovery point. Do not promote a partially validated database.

## Required drill evidence

At least once before launch and on the approved cadence thereafter, restore a
production-shaped backup into isolation and record actual recovery-point loss,
restore time, validation duration, RPO/RTO result, test results, reconciliation,
credential and alert checks, approver names/timestamps, and cleanup of the
isolated project. Production promotion is not part of a drill.
