-- The scheduled SignWell check's bookkeeping column (001453). Marking a request
-- writes reconciled_at alone: the update triggers accept it on open and closed
-- requests, and the request's version and last-changed time stay as they were.
begin;
select plan(14);
set local search_path = public, extensions;

select has_column('public', 'commerce_mnda_requests', 'reconciled_at',
  'MNDA requests record the last scheduled SignWell check');
select col_type_is('public', 'commerce_mnda_requests', 'reconciled_at',
  'timestamp with time zone', 'the MNDA check time is a timestamp with zone');
select col_is_null('public', 'commerce_mnda_requests', 'reconciled_at',
  'an MNDA request never checked has no check time');
select col_hasnt_default('public', 'commerce_mnda_requests', 'reconciled_at',
  'a new MNDA request starts unchecked');
select has_column('public', 'commerce_contract_signing', 'reconciled_at',
  'contract signing requests record the last scheduled SignWell check');
select col_type_is('public', 'commerce_contract_signing', 'reconciled_at',
  'timestamp with time zone', 'the contract check time is a timestamp with zone');
select col_is_null('public', 'commerce_contract_signing', 'reconciled_at',
  'a contract signing request never checked has no check time');
select ok(
  has_column_privilege('clockwork_service', 'public.commerce_mnda_requests', 'reconciled_at', 'UPDATE')
  and has_column_privilege('clockwork_service', 'public.commerce_contract_signing', 'reconciled_at', 'UPDATE'),
  'the service role may record a check');

-- Fixture: one sent MNDA and one declined (closed) MNDA, both bound.
insert into commerce_mnda_requests
  (id, input, countersigner, owner_id, owner_name, template_hash, test_mode, state, provider_id, updated_at, version)
values
  ('a1453000-0000-4000-8000-000000000001', '{"company":"Pgtap 1453 Sent"}', '{"email":"cs@fil-one.test"}',
   'a1453000-0000-4000-8000-0000000000ff', 'Seller', repeat('a', 64), true, 'sent',
   'pgtap-1453-sent', '2000-01-01T00:00:00Z', 4),
  ('a1453000-0000-4000-8000-000000000002', '{"company":"Pgtap 1453 Declined"}', '{"email":"cs@fil-one.test"}',
   'a1453000-0000-4000-8000-0000000000ff', 'Seller', repeat('a', 64), true, 'declined',
   'pgtap-1453-declined', '2000-01-01T00:00:00Z', 7);

set local role clockwork_service;
update commerce_mnda_requests set reconciled_at = now()
  where id in ('a1453000-0000-4000-8000-000000000001', 'a1453000-0000-4000-8000-000000000002');
reset role;

select is(
  (select count(*) from commerce_mnda_requests
    where id in ('a1453000-0000-4000-8000-000000000001', 'a1453000-0000-4000-8000-000000000002')
      and reconciled_at is not null),
  2::bigint, 'the service role records a check on open and closed requests');
select is(
  (select updated_at from commerce_mnda_requests where id = 'a1453000-0000-4000-8000-000000000001'),
  '2000-01-01T00:00:00Z'::timestamptz, 'a check leaves the last-changed time');
select is(
  (select version from commerce_mnda_requests where id = 'a1453000-0000-4000-8000-000000000001'),
  4, 'a check leaves the version');
select is(
  (select state from commerce_mnda_requests where id = 'a1453000-0000-4000-8000-000000000002'),
  'declined', 'a closed request stays closed');
-- The protection triggers still guard what they guarded.
select throws_ok(
  $$update commerce_mnda_requests set state = 'sent', reconciled_at = now()
     where id = 'a1453000-0000-4000-8000-000000000002'$$,
  'MNDA terminal state is immutable',
  'a check cannot carry a closed request back open');
select is(
  (select count(*) from audit_events where aggregate_id = 'a1453000-0000-4000-8000-000000000001'),
  0::bigint, 'a check is bookkeeping, not an audited change');

select * from finish();
rollback;
