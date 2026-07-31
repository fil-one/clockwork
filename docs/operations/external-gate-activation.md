# External-gate activation

Use this runbook for every entry in the external-gate register. An environment
variable, credential, operator assertion, or successful simulator alone never
activates a gate.

## Preconditions

- The named owner and a distinct reviewer are present.
- Required input is versioned or content-addressed; secrets stay in the approved
  secret manager and never appear in evidence or logs.
- The affected feature is disabled or routed to its deterministic simulator.
- The gate's review date is current and rollback steps are known.

## Simulator check

Run the contract or replay suite named in `docs/external-gates.md` with live
network access disabled. Exercise success, permanent and transient failure,
duplicate delivery, delayed delivery, reordering, payload conflict, and crash
recovery where the boundary supports them. Record the commit SHA, suite name,
counts, and sanitized artifact reference. A missing scenario sets the simulator
state to `degraded`; an unavailable fake sets it to `unavailable`.

## Activation test

1. Select the staging resource by immutable project/account identifier and prove
   the production identifier is rejected by the test harness.
2. Rotate or install a least-privilege staging credential through the secret
   manager. Never paste it into Clockwork.
3. Run the gate-specific activation test in `docs/external-gates.md`.
4. Exercise an expected denial as well as the successful path.
5. Run replay/idempotency and provider partial-failure recovery.
6. Verify audit, outbox, exception queue, alert, and admin status projections.
7. Attach a sanitized evidence reference, tester identity, test timestamp, and
   review expiry. Record unexplained variance as failure.

The activation result must come from the executed test evidence. If the test
fails, expires, loses its evidence object, or its credential/policy version
changes, set the gate to `blocked` and keep the affected provider boundary
fail-closed.

## Approval record

Record these fields in `/internal/gates`:

- gate ID, affected feature, configured and effective status;
- owner, tester, distinct reviewer, and escalation owner;
- required input version/hash and non-secret evidence reference;
- simulator state/details and activation-test result/time;
- review date, rollback reference, and blocked reasons.

Only after all fields are present and the persisted policy reports
`activationAllowed=true` may the matching feature flag or provider route be
enabled. Re-run the critical path immediately after activation. On error,
disable the feature, preserve evidence, and follow the relevant provisioning,
webhook, billing, workflow-recovery, offboarding, migration, or disaster-
recovery runbook.
