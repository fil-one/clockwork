# Runtime operations instance 3: provider and telemetry handoff

Current disposition: historical provenance. Provider/telemetry joins were
considered repository-qualified when this handoff was written; the current
backlog controls present status and residue, and no RC/launch is declared here.

This handoff is lane-local. It does not modify commercial core, web, generated
API, canonical specification, backlog, release-report, or shared traceability
files.

## Provider runtime contracts

`@clockwork/integrations` exports `ProviderRuntime`,
`PersistedProviderGateStateStore`, `GuardedProviderJsonTransport`, and
`ProviderEffectBoundaryExecutor`. Production composition passes the existing
database-backed external-gate service directly to
`PersistedProviderGateStateStore`; its required shape is
`list({requestId, now})`. There is no environment-variable or in-memory
fallback. Every effect authorization records the exact gate row versions used.

The typed permanent policy error is `ProviderRuntimeDeniedError`, detected with
`isProviderRuntimeDeniedError`. Stable codes are:

- `PRODUCTION_SIMULATOR_FORBIDDEN`
- `PROVIDER_GATE_REGISTER_UNAVAILABLE`
- `PROVIDER_GATE_INACTIVE`
- `PROVIDER_EFFECT_IDEMPOTENCY_REQUIRED`
- `RECOVERY_EFFECT_FORBIDDEN`

`providerTransportFailure` preserves these as permanent results, allowing
callers to suppress retry and new effect outbox state without parsing text.
Internal recovery uses `recovery.internal`; its authorization explicitly sets
`mayInvokeProvider=false` and `mayCreateEffectOutbox=false` and remains
available when the external register is unavailable.

`TypedLifecycleProviderEffectExecutor` is the production implementation of the
workflow `LifecycleEffectExecutor`. The default workflow factory constructs it
from persisted gate state and the selected live providers, then passes it as
`effects` to `createAuthoritativeLifecycleHandlers`. Its `authorize(effect)`
runs before the workflow ledger claim; `execute(effect)` repeats authorization
at the last mile before invoking the typed screening, notification, signature,
evidence, or provisioning port.

The database planner currently supplies `persistedState.providerInput` only when
the authoritative aggregate already contains every required fact:

- screening: account ID, legal name, two-letter country, screening reason;
- signature: account ID, document ID, signer email;
- provisioning recovery: an ordinary persisted provision command with
  order/organization/entitlements.

Missing or invalid provider input returns permanent
`LIFECYCLE_PROVIDER_INPUT_INVALID` and invokes no port. The executor never
infers a notification recipient, evidence bytes, approval, credential,
unsupported provisioning operation, migration authority, or teardown authority
from the Trigger payload. Those operations remain fail-closed until their owning
lanes persist the exact inputs described in the consolidated runtime handoff.
Live screening and signature selections use authenticated HTTP contracts;
signing redirects are HTTPS and origin allow-listed.

Executable activation contracts cover `EXT-ACC-01`, `EXT-PROVIDER-01`,
`EXT-PROVISION-01`, `EXT-APPROVERS-01`, `EXT-TEARDOWN-01`, `EXT-MARKETPLACE-01`,
and `EXT-MIGRATION-01`. A deterministic probe executes every network-free
contract scenario but always returns `activationEligible=false`. Only a complete
live staging probe can be eligible. Production construction rejects simulator
mode; no code manufactures credentials, provider selection, enrollment,
approval, teardown authority, or a migration snapshot.

## Telemetry integration hooks

Compose `OtlpHttpTelemetrySink`, `ClockworkTelemetry`, and
`RuntimeBoundaryInstrumentation` once in the server process. The exporter uses
standard OTLP/HTTP protobuf, standard `OTEL_*` environment names, HTTPS in
production, and no hosted-vendor API.

The following integration edits belong to their owning lanes:

- Web/server: in the request proxy/server entry, parse only `traceparent`, start
  `boundaries.server`, attach the authoritative request ID, and forward the
  child trace context. Use a route template, never the URL, query, headers,
  cookies, body, identity, or email.
- API: wrap the authenticated Hono route dispatch in `boundaries.api`; add the
  workflow/task/audit/outbox identifiers only after each durable object exists.
- Database: wrap the callback inside authorized/internal transaction helpers in
  `boundaries.db` with `db.system.name=postgresql` and a code-owned operation
  name. Never emit SQL, bind values, account names, or connection strings.
- Workflow: wrap the persisted task claim/execute boundary in
  `boundaries.workflow`; propagate request/workflow/task IDs and add
  audit/outbox IDs from the committed record, not from Trigger payload claims.
- Webhook: wrap raw-body verify/claim/apply in `boundaries.webhook`; emit only
  provider name, safe error code, request/workflow/task/audit/outbox IDs. Never
  emit raw body, signature, provider payload, endpoint query, or recipient.
- Queue and outbox: wrap durable claim/dispatch/ack with `boundaries.queue` and
  `boundaries.outbox`; emit code-owned destination, age, attempt outcome, and
  correlation IDs. A gate-denial result is `denied`, not an adapter outage.
- Commercial runtime: when invoice, agreement, and evidence workflows cross into
  the shared runtime, pass only authoritative audit/outbox IDs. Commercial
  amounts, parties, addresses, document bytes, and storage URLs are not
  telemetry attributes.
- HTTP providers: compose `TelemetryProviderJsonTransport` around the inner
  transport and `GuardedProviderJsonTransport` outside it so persisted policy
  denies before telemetry reports a network effect. Correlation factories may
  receive the idempotency key to locate durable state, but the key itself is
  never emitted.

## Operations data and external inputs

`docs/operations/runtime-dashboards.json` contains eight backend-neutral panels.
`runtime-alerts.json` contains eight P1 definitions and the matching synthetic
failure/runbook link for auth anomalies, DB/PITR, queue age, dead letters,
outbox backlog, provisioning, reconciliation, and unhandled errors.

Repository completion does not claim live monitoring. Under `EXT-ACC-01`, the
deployment owner must still supply collector/backend selection, scoped collector
credentials, retention/residency settings, paging integration and rota, and
executed staging dashboard/alert/synthetic evidence. Provider gates likewise
still require the live accounts, credentials, contracts, enrollment, authority,
approvals, and immutable source snapshot named by their executable contracts.
