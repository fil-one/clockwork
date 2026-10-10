-- partner_details (001458): what the partner entered at signing is written by
-- the change that completes the request and never changed afterwards. It is
-- an object of bounded size, held only by completed requests. The branches
-- 001442 added are covered by 1442 and 1453.
begin;
select plan(15);
set local search_path = public, extensions;

select has_column('public', 'commerce_mnda_requests', 'partner_details',
  'MNDA requests keep what the partner entered at signing');
select col_type_is('public', 'commerce_mnda_requests', 'partner_details', 'jsonb',
  'partner details are a JSON object');
select col_is_null('public', 'commerce_mnda_requests', 'partner_details',
  'a request the partner completed nothing on has no partner details');

-- Fixture: two sent MNDAs with their executed PDFs archived, and one draft.
insert into commerce_mnda_requests
  (id, input, countersigner, owner_id, owner_name, template_hash, test_mode, state, provider_id)
values
  ('a1458000-0000-4000-8000-000000000001', '{"company":"Pgtap 1458 Reference"}', '{"email":"cs@fil-one.test"}',
   'a1458000-0000-4000-8000-0000000000ff', 'Seller', repeat('a', 64), true, 'sent', 'pgtap-1458-one'),
  ('a1458000-0000-4000-8000-000000000002', '{"company":"Pgtap 1458 Unreported"}', '{"email":"cs@fil-one.test"}',
   'a1458000-0000-4000-8000-0000000000ff', 'Seller', repeat('a', 64), true, 'sent', 'pgtap-1458-two'),
  ('a1458000-0000-4000-8000-000000000003', '{"company":"Pgtap 1458 Draft"}', '{"email":"cs@fil-one.test"}',
   'a1458000-0000-4000-8000-0000000000ff', 'Seller', repeat('a', 64), true, 'draft', null);
insert into commerce_mnda_artifacts (id, request_id, kind, sha256, base64)
values
  ('a1458000-0000-4000-8000-0000000000a1', 'a1458000-0000-4000-8000-000000000001',
   'executed', repeat('d', 64), 'JVBERi0='),
  ('a1458000-0000-4000-8000-0000000000a2', 'a1458000-0000-4000-8000-000000000002',
   'executed', repeat('d', 64), 'JVBERi0=');

select throws_ok(
  $$update commerce_mnda_requests set partner_details = '{"entity":"Delaware corporation"}'
     where id = 'a1458000-0000-4000-8000-000000000001'$$,
  'P0001', 'MNDA partner details are recorded only with completion',
  'an open request cannot take partner details without completing');
select throws_ok(
  $$insert into commerce_mnda_requests
      (id, input, countersigner, owner_id, owner_name, template_hash, test_mode, partner_details)
    values ('a1458000-0000-4000-8000-000000000004', '{"company":"Pgtap 1458 Insert"}', '{"email":"cs@fil-one.test"}',
      'a1458000-0000-4000-8000-0000000000ff', 'Seller', repeat('a', 64), true, '{}')$$,
  '23514', null, 'a new draft cannot carry partner details');
select throws_ok(
  $$update commerce_mnda_requests set state = 'completed', completed_at = now(),
       partner_details = '["Acme Holdings LLC"]'
     where id = 'a1458000-0000-4000-8000-000000000001'$$,
  '23514', null, 'partner details are an object');
select throws_ok(
  format($$update commerce_mnda_requests set state = 'completed', completed_at = now(),
       partner_details = jsonb_build_object('entity', %L)
     where id = 'a1458000-0000-4000-8000-000000000001'$$, repeat('x', 16400)),
  '23514', null, 'partner details stay under 16 KB');

set local role clockwork_service;
select lives_ok(
  $$update commerce_mnda_requests set state = 'completed', completed_at = now(),
       partner_details = '{"company_sign":"Acme Holdings LLC","entity":"Delaware limited liability company"}'
     where id = 'a1458000-0000-4000-8000-000000000001'$$,
  'the service role records partner details with completion');
select lives_ok(
  $$update commerce_mnda_requests set state = 'completed', completed_at = now(), partner_details = '{}'
     where id = 'a1458000-0000-4000-8000-000000000002'$$,
  'a completion SignWell reported no values for keeps an empty object');
reset role;

select is(
  (select partner_details->>'company_sign' from commerce_mnda_requests
    where id = 'a1458000-0000-4000-8000-000000000001'),
  'Acme Holdings LLC', 'the completed legal name is stored');
select is(
  (select partner_details from commerce_mnda_requests
    where id = 'a1458000-0000-4000-8000-000000000002'),
  '{}'::jsonb, 'an unreported completion stores an empty object');
select throws_ok(
  $$update commerce_mnda_requests set partner_details = '{"company_sign":"Someone Else Inc."}'
     where id = 'a1458000-0000-4000-8000-000000000001'$$,
  'P0001', 'MNDA partner details are recorded only with completion',
  'partner details never change after completion');
select throws_ok(
  $$update commerce_mnda_requests set partner_details = null
     where id = 'a1458000-0000-4000-8000-000000000002'$$,
  'P0001', 'MNDA partner details are recorded only with completion',
  'partner details are never cleared after completion');
select throws_ok(
  $$update commerce_mnda_requests set partner_details = '{}'
     where id = 'a1458000-0000-4000-8000-000000000003'$$,
  'P0001', 'MNDA partner details are recorded only with completion',
  'a draft cannot take partner details');
select is(
  (select normalized_company from commerce_mnda_requests
    where id = 'a1458000-0000-4000-8000-000000000001'),
  commerce_mnda_normalize_company('Pgtap 1458 Reference'),
  'the normalized company still reads what staff entered');

select * from finish();
rollback;
