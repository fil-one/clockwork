-- The owner console's security feed reads audit_events by event type, newest
-- first (`event_type in (...) order by occurred_at desc, id desc limit 50`).
-- The table's indexes lead on the aggregate, the account or the request, so
-- that read scanned every audit row to find a few rare event types. This index
-- reaches each type's rows directly, already in feed order.
--
-- audit_events takes a row from every write in the product, so a plain build
-- would hold back all of them for as long as it runs. ADR-0009 gives such a
-- table its single `create index concurrently` in a file of its own: the runner
-- executes a file's first statement alone, and a concurrent build only works
-- outside a pipeline. `if not exists` lets a failed run be retried; a build that
-- fails part-way leaves an invalid index, which is dropped before the retry.
create index concurrently if not exists audit_event_type_timeline_idx
  on audit_events (event_type, occurred_at desc, id desc);
