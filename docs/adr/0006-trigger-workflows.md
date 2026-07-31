# ADR 0006: Trigger.dev durable workflow policy

Status: Accepted, 2026-07-31

Long-running and provider-facing work runs in Trigger.dev Cloud. Task IDs are
lane-prefixed and permanently versioned. An invocation idempotency key is
derived from aggregate type, ID, version, and operation; payload or retry count
never changes it. `workflow_runs` mirrors Trigger run IDs and outcomes.

Transient provider failures retry with bounded exponential backoff; permanent
failures enter an owned exception queue. Tasks claim transactional outbox rows,
use downstream idempotency keys, and can be replayed safely. Human waits are
durable waits, not polling loops. Local tests call pure handlers through the
deterministic runner; credentials are never required.
