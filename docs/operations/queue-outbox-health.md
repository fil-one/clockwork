# Queue, dead-letter, and outbox health

Use this runbook for excessive queue age, lifecycle dead letters, outbox
backlog, or a growing delivery retry population.

1. Capture the oldest age, pending/retrying/dead-letter counts, task and topic,
   request/workflow/task/audit/outbox IDs, aggregate version, attempt, and last
   typed error code. Do not replay from an alert payload.
2. Determine whether work is undispatched, leased, provider-success/local-
   failure, transiently retrying, permanently denied by persisted gate policy,
   or dead-lettered. `PROVIDER_GATE_*`, simulator-denial, and recovery-effect
   denial are fail-closed policy results; they do not authorize a retry or a new
   outbox message.
3. Check the persisted external gate and emergency-disable state before any
   provider call. Missing, expired, inactive, or unavailable state creates no
   new effect. Internal reconciliation/recovery that emits neither provider
   effects nor effect outbox remains available.
4. Recover a committed task or outbox item with its original identity and
   downstream idempotency key. Follow
   [workflow-recovery.md](./workflow-recovery.md); provisioning uses
   [stuck-provisioning.md](./stuck-provisioning.md). Never delete or reset a
   claim to force processing.
5. Close after age and backlog return below threshold, duplicates are no-ops,
   dead letters have audited disposition, and provider/audit/outbox state is
   reconciled.
