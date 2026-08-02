begin;
select plan(11);
set local role clockwork_service;
set local search_path = public, extensions;

select has_column(
  'public', 'usage_events', 'ledger_kind',
  'usage events distinguish a measurement from a correction of one'
);
select has_column(
  'public', 'usage_events', 'corrects_usage_event_id',
  'a correction names the event it reverses'
);
select has_table(
  'public', 'core_commitment_allowance_adjustments',
  'allowance amendments are recorded so a ledger replay reproduces them'
);

-- Provider dedup: the same measurement delivered twice consumes the allowance once.
insert into usage_events (
  id, entitlement_id, external_event_id, measured_at, quantity, kind
) values (
  'c1000000-0000-4000-8000-000000000001',
  '83000000-0000-4000-8000-000000000001',
  'ledger-dedup-001', '2026-06-15T10:00:00Z', 3, 'storage'
);
select throws_ok(
  $$insert into usage_events (id, entitlement_id, external_event_id, measured_at, quantity, kind) values ('c1000000-0000-4000-8000-000000000002', '83000000-0000-4000-8000-000000000001', 'ledger-dedup-001', '2026-06-15T10:00:00Z', 3, 'storage')$$,
  '23505',
  'duplicate key value violates unique constraint "usage_events_provider_dedup_unique"',
  'a repeated provider event id cannot be ingested twice for one entitlement'
);

select throws_ok(
  $$insert into usage_events (id, entitlement_id, external_event_id, measured_at, quantity, kind) values ('c1000000-0000-4000-8000-000000000003', '83000000-0000-4000-8000-000000000001', 'ledger-negative-001', '2026-06-15T10:00:00Z', -1, 'storage')$$,
  '23514',
  'new row for relation "usage_events" violates check constraint "usage_events_usage_sign_check"',
  'raw usage cannot subtract from the ledger; a correction must'
);

select throws_ok(
  $$insert into usage_events (id, entitlement_id, external_event_id, measured_at, quantity, kind, ledger_kind) values ('c1000000-0000-4000-8000-000000000004', '83000000-0000-4000-8000-000000000001', 'ledger-orphan-001', '2026-06-15T10:00:00Z', -1, 'storage', 'correction')$$,
  '23514',
  'new row for relation "usage_events" violates check constraint "usage_events_correction_target_check"',
  'a correction without a corrected event is rejected'
);

select lives_ok(
  $$insert into usage_events (id, entitlement_id, external_event_id, measured_at, quantity, kind, ledger_kind, corrects_usage_event_id) values ('c1000000-0000-4000-8000-000000000005', '83000000-0000-4000-8000-000000000001', 'ledger-correction-001', '2026-06-15T10:00:00Z', -1, 'storage', 'correction', 'c1000000-0000-4000-8000-000000000001')$$,
  'a correction reverses a named measurement instead of rewriting it'
);

select throws_ok(
  $$update usage_events set quantity = 99 where id = 'c1000000-0000-4000-8000-000000000001'$$,
  '55000', 'usage_events is append-only/immutable',
  'an ingested measurement can never be rewritten'
);

insert into core_commitment_allowance_adjustments (
  id, ledger_id, period_id, effective_at, quantity_delta, reason,
  source_reference, recorded_by, recorded_at
) values (
  'c2000000-0000-4000-8000-000000000001',
  '84000000-0000-4000-8000-000000000001',
  '84300000-0000-4000-8000-000000000001',
  '2026-06-01T00:00:00Z', 4, 'amendment', 'AMD-001',
  '20000000-0000-4000-8000-000000000001', '2026-06-01T00:00:00Z'
);
select throws_ok(
  $$insert into core_commitment_allowance_adjustments (id, ledger_id, effective_at, quantity_delta, reason, source_reference, recorded_by, recorded_at) values ('c2000000-0000-4000-8000-000000000002', '84000000-0000-4000-8000-000000000001', '2026-06-01T00:00:00Z', 4, 'amendment', 'AMD-001', '20000000-0000-4000-8000-000000000001', '2026-06-01T00:00:00Z')$$,
  '23505',
  'duplicate key value violates unique constraint "core_commitment_allowance_adjustment_source_unique"',
  'one amendment reference adjusts an allowance once'
);
select throws_ok(
  $$update core_commitment_allowance_adjustments set quantity_delta = 400 where id = 'c2000000-0000-4000-8000-000000000001'$$,
  '55000', 'core_commitment_allowance_adjustments is append-only/immutable',
  'an allowance amendment cannot be restated in place'
);

select is(
  (select relforcerowsecurity from pg_class
    where oid = 'public.core_commitment_allowance_adjustments'::regclass),
  true,
  'allowance amendments are read only through the order scope that owns them'
);

select * from finish();
rollback;
