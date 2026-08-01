# Runtime operations Instance 3: gates and ownership handoff

This lane implements persisted runtime gates, durable activation probes, and
account-scoped exception ownership without editing commercial or web files.

## Integration hooks

- Lifecycle command composition must replace
  `DatabaseLifecycleCommandRepositoryOptions.policies.exceptionQueues` as the
  source of open-case owners with `DatabasePersistedWorkflowExceptionRouting`
  (or an injected equivalent resolved from the affected account). Existing
  lifecycle decision code must preserve the persisted case owner/backup and pass
  the requester as an excluded user for separation of duties.
- Lifecycle, assisted-action, replay, redrive, recovery, and provider-effect
  callers must invoke `DatabaseExternalGateService.requireCapability` or
  `executeCapability` immediately before creating an external effect or its
  outbox record. Local-only recovery uses `boundary: "recovery"` and
  `effectIntent: "local_recovery"`; it must not create provider work or outbox.
- If `WorkflowExceptionRouting.resolve` is expanded by the workflow-core lane,
  pass `requestedBy` and the authoritative aggregate type. The new database
  router already accepts `requestedBy`; it currently derives type/account from
  the aggregate UUID because the shared interface supplies only `aggregateId`.
- Remove the obsolete `WORKFLOW_EXCEPTION_ROUTES_JSON` line from deployment
  templates. Runtime composition intentionally ignores it and constructs
  `DatabasePersistedWorkflowExceptionRouting` from the service database.
- Web/internal-admin integration should expose roster upsert/absence controls
  through `DatabaseExceptionRosterAdminService` and emergency gate controls
  through `DatabaseExternalGateService.setEmergencyState`. Do not accept owner,
  qualification, authority, activation evidence, or emergency-restore facts from
  unsigned client state.

## External inputs not supplied by this repository

- `EXT-APPROVERS-01`: real account/queue primary, backup, escalation users;
  current MFA/internal-staff state; qualification evidence and expiry; absence
  periods; response targets.
- Gate activation: live account credentials, provider enrollment/contracts,
  legal approvals, marketplace authority, teardown authority, and migration
  snapshots/windows. The repository stores and enforces these facts but does not
  invent them.
- Paging/backend credentials and live staging evidence remain external. No
  simulator is accepted by the production activation runner.

## Runtime task IDs

- `system.external-gates.activation.v1`
- `system.external-gates.activation-recovery.v1`

Both tasks use the same leased durable state machine. A recovery invocation with
`provider_succeeded` state commits the recorded result without repeating the
bounded HTTP probe after the prior lease expires.
