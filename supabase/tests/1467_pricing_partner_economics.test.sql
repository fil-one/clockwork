begin;
select plan(5);
set local search_path=public,extensions;

select has_column('public','commerce_pricing_scenarios','partner_economics',
  'scenarios carry partner economics');
select col_is_null('public','commerce_pricing_scenarios','partner_economics',
  'a direct scenario has none');

set local role clockwork_service;
select lives_ok($$insert into commerce_pricing_scenarios(id,owner_id,owner_name,name,company,currency,as_of,price_books,lines,partner_economics)
  values('019a44ac-0000-7000-8000-00000000ac01','019a44ac-0000-7000-8000-00000000ab02','R.W.','Resale','Acme','USD','2026-10-10',
  '[{"id":"60000000-0000-4000-8000-000000000001","version":1}]','[{"sku":"STORAGE-TB"}]',
  '{"model":"resale","customerPriceMinor":"650","marginBps":3200}')$$,
  'a seller saves resale inputs');
select throws_ok($$insert into commerce_pricing_scenarios(id,owner_id,owner_name,name,company,currency,as_of,price_books,lines,partner_economics)
  values('019a44ac-0000-7000-8000-00000000ac02','019a44ac-0000-7000-8000-00000000ab02','R.W.','Bad','Acme','USD','2026-10-10',
  '[{"id":"60000000-0000-4000-8000-000000000001","version":1}]','[{}]','[]')$$,
  '23514',null,'partner economics are an object');
select throws_ok($$insert into commerce_pricing_scenarios(id,owner_id,owner_name,name,company,currency,as_of,price_books,lines,partner_economics)
  values('019a44ac-0000-7000-8000-00000000ac03','019a44ac-0000-7000-8000-00000000ab02','R.W.','Bad','Acme','USD','2026-10-10',
  '[{"id":"60000000-0000-4000-8000-000000000001","version":1}]','[{}]','{"model":"direct"}')$$,
  '23514',null,'a direct scenario stores null, not a model');
reset role;

select * from finish();
rollback;
