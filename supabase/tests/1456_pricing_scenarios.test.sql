begin;
select plan(15);
set local search_path=public,extensions;

select ok((select relrowsecurity and relforcerowsecurity from pg_class
  where oid = 'public.commerce_pricing_scenarios'::regclass),
  'pricing scenarios force row security');
select ok(not has_table_privilege('clockwork_runtime','public.commerce_pricing_scenarios','SELECT'),
  'customer identities cannot read scenarios');
select ok(not has_table_privilege('authenticated','public.commerce_pricing_scenarios','SELECT'),
  'authenticated cannot read scenarios');
select ok(not has_table_privilege('anon','public.commerce_pricing_scenarios','INSERT'),
  'anonymous callers cannot write scenarios');
select ok(not has_table_privilege('clockwork_runtime','public.commerce_pricing_scenarios','INSERT'),
  'customer identities cannot write scenarios');
select ok(has_table_privilege('clockwork_service','public.commerce_pricing_scenarios','DELETE'),
  'the service role deletes scenarios');

set local role clockwork_service;
select lives_ok($$insert into commerce_pricing_scenarios(id,owner_id,owner_name,name,company,currency,as_of,price_books,lines)
  values('019a44ac-0000-7000-8000-00000000ab01','019a44ac-0000-7000-8000-00000000ab02','R.W.','Pilot','Acme, Inc.','USD','2026-10-10',
  '[{"id":"60000000-0000-4000-8000-000000000001","version":1}]','[{"sku":"STORAGE-TB"}]')$$,
  'a seller saves a scenario');
select throws_ok($$insert into commerce_pricing_scenarios(id,owner_id,owner_name,name,company,currency,as_of,price_books,lines)
  values('019a44ac-0000-7000-8000-00000000ab03','019a44ac-0000-7000-8000-00000000ab02','R.W.','Pilot','Acme','USD','2026-10-10',
  '[{"id":"60000000-0000-4000-8000-000000000001","version":1}]','[]')$$,
  '23514',null,'a scenario needs at least one line');
select throws_ok($$insert into commerce_pricing_scenarios(id,owner_id,owner_name,name,company,currency,as_of,price_books,lines)
  values('019a44ac-0000-7000-8000-00000000ab04','019a44ac-0000-7000-8000-00000000ab02','R.W.','Pilot','Acme','JPY','2026-10-10',
  '[{"id":"60000000-0000-4000-8000-000000000001","version":1}]','[{}]')$$,
  '23514',null,'only book currencies are accepted');
select throws_ok($$insert into commerce_pricing_scenarios(id,owner_id,owner_name,name,company,currency,as_of,price_books,lines)
  values('019a44ac-0000-7000-8000-00000000ab05','019a44ac-0000-7000-8000-00000000ab02','R.W.','  ','Acme','USD','2026-10-10',
  '[{"id":"60000000-0000-4000-8000-000000000001","version":1}]','[{}]')$$,
  '23514',null,'a scenario needs a name');
select lives_ok($$update commerce_pricing_scenarios set name='Pilot, revised', company='Acme Corp', version=2, updated_at=now()
  where id='019a44ac-0000-7000-8000-00000000ab01'$$,
  'an edit overwrites the scenario');
select throws_ok($$update commerce_pricing_scenarios set created_at=created_at - interval '1 day', version=3
  where id='019a44ac-0000-7000-8000-00000000ab01'$$,
  'P0001','Pricing scenario owner and creation are immutable','the creation time never changes');
select throws_ok($$update commerce_pricing_scenarios set owner_id='019a44ac-0000-7000-8000-00000000ab09', version=3
  where id='019a44ac-0000-7000-8000-00000000ab01'$$,
  'P0001','Pricing scenario owner and creation are immutable','the owner never changes');
select throws_ok($$update commerce_pricing_scenarios set name='Stale', version=2
  where id='019a44ac-0000-7000-8000-00000000ab01'$$,
  'P0001','Pricing scenario version must advance by one','an overwrite advances the version');
select lives_ok($$delete from commerce_pricing_scenarios where id='019a44ac-0000-7000-8000-00000000ab01'$$,
  'a scenario is deleted');
reset role;

select * from finish();
rollback;
