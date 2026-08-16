-- The supplier side: legal entities and the operator's registration statements.
begin;
select plan(18);
set local role clockwork_service;
set local search_path = public, extensions;

select has_table('public', 'core_legal_entities', 'the schema now models our selling entities');
select has_table('public', 'core_tax_registrations', 'the schema now models where a merchant is registered');
select is(
  (select relrowsecurity and relforcerowsecurity from pg_class
    where oid = 'public.core_tax_registrations'::regclass),
  true, 'registrations are behind forced row level security'
);

-- merchant_role and account_id are a biconditional, not two independent columns.
select throws_ok($$
  insert into core_legal_entities (
    legal_name, merchant_role, account_id, established_country, registered_address
  ) values ('Orphan Partner Entity','partner_entity',null,'ES','{"country":"ES"}')
$$, '23514', null, 'a partner merchant of record must name the account it is');
select throws_ok($$
  insert into core_legal_entities (
    legal_name, merchant_role, account_id, established_country, registered_address
  ) values ('Confused Entity','our_entity','10000000-0000-4000-8000-000000000003','GB','{"country":"GB"}')
$$, '23514', null, 'one of our own entities is not also a counterparty account');

insert into core_legal_entities (
  id, legal_name, merchant_role, account_id, established_country, registered_address
) values (
  'ca100000-0000-4000-8000-000000000001','Fixture Supplier Ltd','our_entity',null,'GB',
  '{"line1":"1 Test Row","country":"GB"}'
);
select is(
  (select established_country from core_legal_entities
    where id = 'ca100000-0000-4000-8000-000000000001'),
  'GB', 'an entity of ours records the country it is established in'
);
select throws_ok($$
  insert into core_legal_entities (
    legal_name, merchant_role, established_country, registered_address
  ) values ('Lowercase Country','our_entity','gb','{"country":"gb"}')
$$, '23514', null, 'establishment is an ISO 3166-1 alpha-2 country code');

-- An active registration is what authorises charging tax in someone else's
-- country. Recording that with no evidence is the claim without the basis.
select throws_ok($$
  insert into core_tax_registrations (
    legal_entity_id, jurisdiction, scheme, registration_number,
    effective_from, status, stated_by, stated_at
  ) values (
    'ca100000-0000-4000-8000-000000000001','GB','vat','GB111111111',
    '2024-01-01','active','20000000-0000-4000-8000-000000000001','2026-01-01T00:00:00Z'
  )
$$, '23514', null, 'an active registration cannot be stated without evidence');

-- A pending application may have none: the certificate arrives after the
-- application, and refusing to record it would block a legitimate operation.
select lives_ok($$
  insert into core_tax_registrations (
    id, legal_entity_id, jurisdiction, scheme, registration_number,
    effective_from, status, stated_by, stated_at
  ) values (
    'ca110000-0000-4000-8000-000000000001',
    'ca100000-0000-4000-8000-000000000001','DE','vat','DE111111111',
    '2026-01-01','pending','20000000-0000-4000-8000-000000000001','2026-01-01T00:00:00Z'
  )
$$, 'an application with no certificate yet is recordable as pending');

insert into core_tax_registrations (
  id, legal_entity_id, jurisdiction, scheme, registration_number,
  effective_from, status, stated_by, stated_at, evidence_document_id
) values (
  'ca110000-0000-4000-8000-000000000002',
  'ca100000-0000-4000-8000-000000000001','GB','vat','GB111111111',
  '2024-01-01','active','20000000-0000-4000-8000-000000000001','2026-01-01T00:00:00Z',
  '40000000-0000-4000-8000-000000000001'
);

-- One entity holds one active registration per jurisdiction and scheme. Two
-- would be two answers to "are we registered here", which is what the
-- determination asks.
select throws_ok($$
  insert into core_tax_registrations (
    legal_entity_id, jurisdiction, scheme, registration_number,
    effective_from, status, stated_by, stated_at, evidence_document_id
  ) values (
    'ca100000-0000-4000-8000-000000000001','GB','vat','GB222222222',
    '2025-01-01','active','20000000-0000-4000-8000-000000000001','2026-01-01T00:00:00Z',
    '40000000-0000-4000-8000-000000000001'
  )
$$, '23505', null, 'one entity cannot hold two active registrations for one jurisdiction and scheme');

-- A stated registration is the recorded basis for tax already charged under it.
select throws_ok($$
  update core_tax_registrations set registration_number = 'GB999999999'
  where id = 'ca110000-0000-4000-8000-000000000002'
$$, '55000', null, 'a stated registration number is immutable; state a new registration');
select throws_ok($$
  update core_tax_registrations set stated_by = '20000000-0000-4000-8000-000000000002'
  where id = 'ca110000-0000-4000-8000-000000000002'
$$, '55000', null, 'who stated a registration cannot be rewritten');
select throws_ok($$
  delete from core_tax_registrations where id = 'ca110000-0000-4000-8000-000000000002'
$$, '55000', null, 'a stated registration is deregistered, not deleted');
select lives_ok($$
  update core_tax_registrations set status = 'deregistered', effective_to = '2026-06-01'
  where id = 'ca110000-0000-4000-8000-000000000002'
$$, 'a registration can be closed by deregistering it');
select throws_ok($$
  update core_tax_registrations set status = 'active'
  where id = 'ca110000-0000-4000-8000-000000000002'
$$, '23514', null, 'a deregistered registration does not come back to life');

-- The seed states the supplier side the determination has to read.
select is(
  (select count(*)::integer from core_legal_entities
    where merchant_role = 'our_entity'
      and id between '97000000-0000-4000-8000-000000000001'::uuid
      and '97000000-0000-4000-8000-000000000099'::uuid),
  2, 'the seed states two selling entities of ours'
);
select is(
  (select account_id from core_legal_entities
    where id = '97000000-0000-4000-8000-000000000003'),
  '10000000-0000-4000-8000-000000000003'::uuid,
  'a partner acting as merchant of record is modelled as a legal entity pointing at its account'
);
-- The absence that proves the rule: Connecticut has rates and no registration.
select is(
  (select count(*)::integer from core_tax_registrations
    where jurisdiction = 'US-CT' and status = 'active'),
  0, 'the seed deliberately states no Connecticut registration'
);

select * from finish();
rollback;
