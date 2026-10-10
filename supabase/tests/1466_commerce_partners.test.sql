begin;
select plan(26);
set local search_path=public,extensions;

select ok((select relrowsecurity and relforcerowsecurity from pg_class
  where oid = 'public.commerce_partners'::regclass),
  'partner records force row security');
select ok((select relrowsecurity and relforcerowsecurity from pg_class
  where oid = 'public.commerce_partner_deals'::regclass),
  'registered deals force row security');
select ok(not has_table_privilege('clockwork_runtime','public.commerce_partners','SELECT'),
  'customer identities cannot read partner terms');
select ok(not has_table_privilege('clockwork_runtime','public.commerce_partner_deals','SELECT'),
  'customer identities cannot read registered deals');
select ok(not has_table_privilege('authenticated','public.commerce_partners','SELECT'),
  'authenticated cannot read partner terms');
select ok(not has_table_privilege('anon','public.commerce_partner_deals','INSERT'),
  'anonymous callers cannot register deals');
select ok(has_table_privilege('clockwork_service','public.commerce_partners','UPDATE')
  and has_table_privilege('clockwork_service','public.commerce_partner_deals','UPDATE'),
  'the service role records and edits partners and deals');
select ok(not has_table_privilege('clockwork_service','public.commerce_partners','DELETE')
  and not has_table_privilege('clockwork_service','public.commerce_partner_deals','DELETE'),
  'partners and deals are never deleted');

set local role clockwork_service;
select lives_ok($$insert into commerce_partners(id,name,models,status,commission_pct,margin_pct,currency,created_by_id,created_by_name)
  values('019a44ae-0000-7000-8000-00000000a001','Northwind, Inc.',array['referral','teaming'],'talking',32.5,100,'EUR',
  '019a44ae-0000-7000-8000-00000000b001','R.W.')$$,
  'a partner with a 32.5% commission and a full margin is recorded');
select is((select normalized_name from commerce_partners where id='019a44ae-0000-7000-8000-00000000a001'),
  'northwind', 'the partner name is normalized with the MNDA register''s rules');
select throws_ok($$insert into commerce_partners(id,name,commission_pct,created_by_id,created_by_name)
  values('019a44ae-0000-7000-8000-00000000a002','Over',100.5,'019a44ae-0000-7000-8000-00000000b001','R.W.')$$,
  '23514',null,'a commission above 100% is refused');
select throws_ok($$insert into commerce_partners(id,name,margin_pct,created_by_id,created_by_name)
  values('019a44ae-0000-7000-8000-00000000a002','Under',-1,'019a44ae-0000-7000-8000-00000000b001','R.W.')$$,
  '23514',null,'a negative margin is refused');
select throws_ok($$insert into commerce_partners(id,name,models,created_by_id,created_by_name)
  values('019a44ae-0000-7000-8000-00000000a002','Odd',array['franchise'],'019a44ae-0000-7000-8000-00000000b001','R.W.')$$,
  '23514',null,'only the listed partnership models are stored');
select throws_ok($$insert into commerce_partners(id,name,owner_id,created_by_id,created_by_name)
  values('019a44ae-0000-7000-8000-00000000a002','Owned','019a44ae-0000-7000-8000-00000000b001','019a44ae-0000-7000-8000-00000000b001','R.W.')$$,
  '23514',null,'an owner is stored with a name');
select throws_ok($$update commerce_partners set status='negotiating' where id='019a44ae-0000-7000-8000-00000000a001'$$,
  'P0001','PARTNER_VERSION_MUST_ADVANCE','every edit advances the version');
select throws_ok($$update commerce_partners set created_by_id='019a44ae-0000-7000-8000-00000000b002', version=2
  where id='019a44ae-0000-7000-8000-00000000a001'$$,
  'P0001','PARTNER_ROW_CREATION_IMMUTABLE','who recorded the partner never changes');
select lives_ok($$update commerce_partners set status='terms_agreed', commission_pct=20, version=2
  where id='019a44ae-0000-7000-8000-00000000a001'$$,
  'the terms are edited');

insert into commerce_partners(id,name,created_by_id,created_by_name)
values('019a44ae-0000-7000-8000-00000000a003','Southwind','019a44ae-0000-7000-8000-00000000b001','R.W.');

select lives_ok($$insert into commerce_partner_deals(id,partner_id,end_client,registered_on,protected_until,estimated_size,size_unit,created_by_id,created_by_name)
  values('019a44ae-0000-7000-8000-00000000c001','019a44ae-0000-7000-8000-00000000a001','Acme, Inc.','2026-10-10','2027-01-08',1.5,'PiB',
  '019a44ae-0000-7000-8000-00000000b001','R.W.')$$,
  'a deal is registered with an estimated size');
select lives_ok($$insert into commerce_partner_deals(id,partner_id,end_client,registered_on,protected_until,created_by_id,created_by_name)
  values('019a44ae-0000-7000-8000-00000000c002','019a44ae-0000-7000-8000-00000000a003','ACME Inc','2026-10-10','2027-01-08',
  '019a44ae-0000-7000-8000-00000000b001','R.W.')$$,
  'another partner may register the same end client');
select is((select count(distinct normalized_end_client)::int from commerce_partner_deals
  where id in ('019a44ae-0000-7000-8000-00000000c001','019a44ae-0000-7000-8000-00000000c002')),
  1, 'both registrations name the same normalized end client');
select throws_ok($$insert into commerce_partner_deals(id,partner_id,end_client,registered_on,protected_until,estimated_size,created_by_id,created_by_name)
  values('019a44ae-0000-7000-8000-00000000c003','019a44ae-0000-7000-8000-00000000a001','Globex','2026-10-10','2027-01-08',10,
  '019a44ae-0000-7000-8000-00000000b001','R.W.')$$,
  '23514',null,'an estimated size carries a unit');
select throws_ok($$insert into commerce_partner_deals(id,partner_id,end_client,registered_on,protected_until,created_by_id,created_by_name)
  values('019a44ae-0000-7000-8000-00000000c003','019a44ae-0000-7000-8000-00000000a001','Globex','2026-10-10','2026-10-01',
  '019a44ae-0000-7000-8000-00000000b001','R.W.')$$,
  '23514',null,'protection does not end before the registration');
select throws_ok($$insert into commerce_partner_deals(id,partner_id,end_client,registered_on,protected_until,created_by_id,created_by_name)
  values('019a44ae-0000-7000-8000-00000000c003','019a44ae-0000-7000-8000-00000000a009','Globex','2026-10-10','2027-01-08',
  '019a44ae-0000-7000-8000-00000000b001','R.W.')$$,
  '23503',null,'a deal belongs to a recorded partner');
select throws_ok($$update commerce_partner_deals set partner_id='019a44ae-0000-7000-8000-00000000a003', version=2
  where id='019a44ae-0000-7000-8000-00000000c001'$$,
  'P0001','PARTNER_DEAL_PARTNER_IMMUTABLE','a registration stays with its partner');
select lives_ok($$update commerce_partner_deals set status='withdrawn', version=2
  where id='019a44ae-0000-7000-8000-00000000c002'$$,
  'a registration is withdrawn');
select throws_ok($$update commerce_partner_deals set status='closed', version=3
  where id='019a44ae-0000-7000-8000-00000000c002'$$,
  '23514',null,'only the listed deal statuses are stored');
reset role;

select * from finish();
rollback;
