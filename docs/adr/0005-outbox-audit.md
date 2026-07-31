# ADR 0005: Transactional outbox and append-only audit

Status: Accepted, 2026-07-31

Every state change appends an `audit_events` row and its `outbox_messages` row
in the same Postgres transaction. The aggregate ID plus version is unique. Audit
rows are database-enforced append-only; corrections are new events. Outbox rows
may change only in delivery metadata and are claimed with skip-locked queue
semantics by a durable workflow.

Events carry the request ID, actual actor, effective actor during assisted
actions, before/after projections, event schema version, and occurrence time.
Consumers deduplicate by event ID. The event stream drives account timelines and
projections but does not replace current-state tables.
