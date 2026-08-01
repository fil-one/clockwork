# Runtime operations Instance 3 handoff — 2026-07-31

This is the uniquely named integration handoff for branch
`rc/runtime-operations`. It does not edit commercial-core, web, UI, document,
generated API, canonical-specification, backlog, release-report, CI, or shared
traceability ownership.

## Runtime contracts delivered

- All 24 lifecycle task IDs resolve to an exhaustive persisted loader,
  transition planner, and typed effect boundary. Workflow/effect claims use
  optimistic versions, lease tokens, deterministic idempotency keys, retry and
  dead-letter state, provider-success checkpoints, crash recovery, audit, and
  outbox persistence.
- `TypedLifecycleProviderEffectExecutor` is composed by the default production
  factory. Capability authorization runs before ledger creation and again with
  provider authorization immediately before HTTP. Missing authoritative input is
  a permanent no-call result; the runtime does not infer recipients, evidence
  bytes, approvals, credentials, enrollment, teardown authority, or a migration
  snapshot.
- `DatabaseExternalGateService` owns the eight-capability matrix at lifecycle,
  provider-effect, replay, assisted-action, redrive, and recovery boundaries.
  Denied external work invokes neither effect nor outbox callbacks. Independent
  local recovery remains available with both permissions false.
- `DatabasePersistedWorkflowExceptionRouting` derives the affected account and
  uses the persisted qualified roster. `DatabaseExceptionRosterAdminService`
  audits qualification, absence, assignment, and open-case reassignment.
- `DatabaseExternalGateActivationTaskStore` and
  `DurableExternalGateActivationRunner` persist intent before the bounded HTTP
  probe, checkpoint provider success, fence stale workers, and recover local
  finalization without probing twice.
- Provider enforcement, executable activation contracts, OTLP/HTTP protobuf,
  eight telemetry boundaries, eight dashboards, eight P1 alerts, eight synthetic
  failures, and linked runbooks are backend-neutral.

Migration: `001130_runtime_gates_and_exception_roster.sql` creates the exception
roster and leased activation task store and adds audited emergency gate state.

Task IDs:

- `system.external-gates.activation.v1`
- `system.external-gates.activation-recovery.v1`

## Commercial-lane hooks

1. Replace static `DatabaseLifecycleCommandRepositoryOptions.policies` exception
   owners with persisted account/queue roster resolution. Preserve the case’s
   resolved owner and backup; pass the requester for self-approval exclusion.
   The runtime factory has already removed its environment queue-to-account map.
2. Call `DatabaseExternalGateService.requireCapability` or `executeCapability`
   immediately before each commercial lifecycle/outbox boundary: new business,
   legal execution, provisioning/invoicing, partner, white-label, marketplace,
   teardown, and migration. Pass the real boundary (`assisted_action`, `replay`,
   `redrive`, or `recovery`), never a client claim.
3. Persist typed provider inputs before scheduling work. Existing runtime joins
   safely cover screening, signature-envelope dispatch, and ordinary
   provisioning recovery. Commercial ownership must supply validated
   notification recipients/templates, immutable evidence bytes/hash/retention,
   two distinct teardown approval IDs, and approved migration authority before
   those effects can execute.
4. If the shared `WorkflowExceptionRouting.resolve` contract is expanded, add
   authoritative aggregate type and `requestedBy`; the database router already
   supports requester exclusion internally.
5. Pass only durable request/workflow/task/audit/outbox identifiers into
   telemetry. Do not add amounts, parties, addresses, emails, document bytes,
   provider payloads, or storage URLs.

## Web/API-lane hooks

1. Expose internal-only, MFA-protected roster assignment/absence/reassignment
   controls through `DatabaseExceptionRosterAdminService`. Expose gate emergency
   disable/restore and activation controls through `DatabaseExternalGateService`
   and the two registered Trigger tasks. Require optimistic row versions and
   evidence references; never accept unsigned owner, approval, or authority
   facts.
2. Start `RuntimeBoundaryInstrumentation.server` at the request proxy using a
   code-owned route template and parsed `traceparent`; start `.api` after
   authentication. Propagate the child trace context and attach durable IDs only
   after creation. Never emit URLs, queries, headers, cookies, bodies, identity,
   email, or raw errors.
3. Deployment configuration must remove obsolete
   `WORKFLOW_EXCEPTION_ROUTES_JSON`; add live screening/signature endpoint
   credentials and `SIGNATURE_PROVIDER_SIGNING_ORIGINS_JSON`. Production keeps
   simulators disabled.

## Shared runtime and operations hooks

- Wrap internal/authorized transaction callbacks with `.db`; durable
  claim/execute with `.workflow`; raw-body verify/claim/apply with `.webhook`;
  queue and outbox claim/dispatch/ack with `.queue`/`.outbox`. Use code-owned
  operation names and the authoritative correlation IDs.
- Compose `TelemetryProviderJsonTransport` inside `GuardedProviderJsonTransport`
  so a persisted denial occurs before network telemetry. Configure standard
  `OTEL_EXPORTER_OTLP_*` variables; the signal-specific traces endpoint is used
  verbatim and the generic endpoint appends `/v1/traces`.
- Run DB gate/ownership/activation integration suites serially: their existing
  fixtures intentionally share `EXT-ACC-01`. Unit suites and unrelated runtime
  suites remain parallel-safe.

## Live P1 inputs still absent

- Hosted accounts and scoped live credentials; selected provider contracts;
  signature/screening enrollment; marketplace enrollment and payout/tax
  profiles; current approver roster and MFA/qualification evidence; legal and
  teardown authority; approved immutable migration snapshot and execution
  window.
- OTLP collector/backend selection, collector credentials, retention and data
  residency, paging delivery/rota, and executed staging dashboard, alert, and
  synthetic-failure evidence.

Deterministic fakes and simulators prove contracts only. They cannot activate a
production gate or manufacture any of the inputs above.
