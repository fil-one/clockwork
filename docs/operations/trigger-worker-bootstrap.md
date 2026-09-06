# Trigger worker bootstrap

Trigger task discovery enters through `packages/workflows/src/trigger/index.ts`.
The entrypoint activates the database-backed production runtime before importing
any task definition. A bootstrap error stops discovery; Clockwork never deploys
discoverable tasks with a dormant runtime.

## Required worker environment

- `NODE_ENV` is explicitly `development`, `test`, or `production`.
- `DIRECT_DATABASE_URL` is a direct Postgres service connection. Production
  rejects loopback targets and the database client enforces the
  `clockwork_service` login.
- `TRIGGER_PROJECT_REF` is the immutable Trigger.dev project reference.
- `TRIGGER_SECRET_KEY` is the scoped Trigger.dev environment secret.
- `AUTHORIZATION_CONTEXT_SECRET` verifies the signed account context used when
  authoritative invoice and commission task inputs are rebuilt from Postgres.
- `WORKFLOW_PROVIDER_CONTROL_BASE_URL` and `_TOKEN` address the activation-test
  control plane used before any live adapter activates.
- `ACCOUNTING_PROVIDER`, `NOTIFICATION_PROVIDER`, `USAGE_PROVIDER`,
  `PROVISIONING_PROVIDER`, `EVIDENCE_PROVIDER`, `DOCUMENT_RENDERER_PROVIDER`,
  and `WORKOS_MFA_PROVIDER` each require a `_BASE_URL` and scoped `_TOKEN`.
  Production requires HTTPS.
- `STRIPE_SECRET_KEY` and `WORKOS_API_KEY` are server-only live credentials.
- Named queue owners, distinct backups, qualification, and response targets are
  loaded from the FORCE-RLS `system_exception_roster` through
  `packages/db/src/repositories/system/exception-routing.ts`;
  `PLATFORM_ISSUER_JSON` contains the approved legal issuer identity.

Values are validated without logging credentials. Missing or malformed values
raise `WORKFLOW_BOOTSTRAP_INCOMPLETE` before task discovery.

## External activation inputs

The typed adapter factory must receive activated inputs for these external
gates; test fakes and in-memory adapters are never imported by the production
bootstrap:

- `EXT-ACC-01`: Trigger.dev, database, Stripe, WorkOS, and immutable evidence
  projects, credentials, bucket/KMS ownership, and malware scanner.
- `EXT-PROVIDER-01`: selected QBO/accounting export and transactional
  notification providers, immutable PDF renderer, posting model, sender
  configuration, and credentials.
- `EXT-PROVISION-01`: authenticated product usage/provisioning boundary and its
  lifecycle contract.
- `EXT-APPROVERS-01`: named exception owners, distinct backups, targets, and
  escalation roster.
- `EXT-LEGAL-01`: approved platform issuer identity and artifact rules.

## Internal composition status

There are no missing internal adapter factories. The default discovery path
constructs the Stripe gateway, provider-neutral accounting, notification, usage,
evidence, provisioning, WorkOS organization/MFA, exception-routing, and all
commercial/deletion artifact renderers and lifecycle task handlers from the
registered inputs above. Immutable S3 bucket, presigning, scanning,
pending-upload durability, and access enforcement are owned behind the selected
evidence-service contract and its activation test; they are not simulated inside
the production worker.

When supplied, `createProductionWorkflowRuntime` always installs database-backed
run, record, reporting, exception, and outbox stores. It also installs the
WorkOS organization outbox join and the deletion-certificate handler when its
explicit evidence/teardown configuration is present. The dispatcher claims only
topics with registered handlers. Explicit lifecycle outbox mappings submit
stable `outbox:<message-id>` task identities, and provisioning rebuilds its
command from the persisted attempt before calling the provider. Core finance
joins rebuild invoice and commission task inputs from authoritative database
state and submit them to Trigger.dev with global idempotency keys. The shared
`order.provisioning_confirmed` topic intentionally runs both lifecycle
confirmation ingestion and the provisioning-to-invoice projection.

`CLOCKWORK_ENABLE_SIMULATORS=true` is rejected in production. Deterministic
provider clients live in `@clockwork/testing` and may be injected only by test
or staging composition.

## Capability-scoped composition

The environment bootstrap reads persisted software capabilities before parsing
provider credentials. Enabled recovery work also retains its providers. An
entirely disabled registry boots without business provider credentials; a
onboarding-only pilot requires identity, screening, notifications, evidence, and
artifact rendering, while billing adds
billing/accounting/tax/usage/provisioning. Legal adds signature.
Partner/marketplace currently require the full provider set. Only selected
providers are probed and only their applicable external gates are required at
boot. External gates still apply at every execution.

Omitted providers use denial-only ports that throw
`WORKFLOW_PROVIDER_DISABLED:<provider>:restart_after_activation` before IO.
Restart the worker after activating an omitted capability. Production lifecycle
effects also recheck the software capability before provider work, so an
immediate disable is effective on the next attempt. Task registrations remain
available for observability and recovery; no simulated result is substituted.
Outbound CRM is independently off unless `CLOCKWORK_CRM_ENABLED=true`, which
requires `CRM_PROVIDER_BASE_URL` and `CRM_PROVIDER_TOKEN`.
