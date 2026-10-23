begin;
select plan(16);

select has_table('public', 'commerce_hubspot_connections', 'HubSpot connection table exists');
select has_table('public', 'commerce_external_links', 'external link table exists');
select has_table('public', 'commerce_hubspot_imports', 'HubSpot import table exists');
select has_table('public', 'commerce_hubspot_import_items', 'HubSpot import item table exists');

select ok((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class where oid in (
  'public.commerce_hubspot_connections'::regclass, 'public.commerce_external_links'::regclass,
  'public.commerce_hubspot_imports'::regclass, 'public.commerce_hubspot_import_items'::regclass)),
  'forced row security on every HubSpot table');

select ok(not has_table_privilege('clockwork_runtime', 'public.commerce_hubspot_imports', 'SELECT')
  and not has_table_privilege('authenticated', 'public.commerce_external_links', 'SELECT')
  and not has_table_privilege('anon', 'public.commerce_hubspot_connections', 'SELECT'),
  'tenants and browsers cannot read HubSpot data');

select ok(has_table_privilege('clockwork_service', 'public.commerce_external_links', 'INSERT')
  and not has_table_privilege('clockwork_service', 'public.commerce_external_links', 'UPDATE')
  and not has_table_privilege('clockwork_service', 'public.commerce_external_links', 'DELETE'),
  'links are append-only for staff');

select ok(not has_table_privilege('clockwork_service', 'public.commerce_hubspot_imports', 'DELETE'),
  'imports are never deleted');

-- Fixtures: an approved connection and a partner to link.
update public.commerce_hubspot_connections set status = 'disconnected', disconnected_at = now(), version = version + 1
  where status = 'active';
insert into public.commerce_hubspot_connections
  (id, portal_id, ui_domain, status, audience, approved_by_id, approved_by_name, approved_at, scope)
values ('00000000-0000-4000-8000-0000000014a1', '1483', 'app.hubspot.com', 'active', 'staff_sales_read',
  gen_random_uuid(), 'Admin', now(),
  '{"company": [], "deal": [], "contact": [], "pipelines": [], "notes": false, "files": false}');
insert into public.commerce_partners (id, name, created_by_id, created_by_name)
values ('00000000-0000-4000-8000-0000000014b1', 'Pgtap Partner One', gen_random_uuid(), 'Seller'),
       ('00000000-0000-4000-8000-0000000014b2', 'Pgtap Partner Two', gen_random_uuid(), 'Seller');
insert into public.commerce_external_links
  (id, provider, portal_id, object_type, object_id, destination_type, partner_id, company_name, created_by_id, created_by_name)
values ('00000000-0000-4000-8000-0000000014c1', 'hubspot', '1483', 'company', '1', 'partner',
  '00000000-0000-4000-8000-0000000014b1', 'Pgtap Co', gen_random_uuid(), 'Seller');

select throws_ok($$insert into public.commerce_hubspot_connections
  (id, portal_id, ui_domain, status, audience, approved_by_id, approved_by_name, approved_at, scope)
  values (gen_random_uuid(), '1484', 'app.hubspot.com', 'active', 'staff_sales_read', gen_random_uuid(), 'Admin', now(),
  '{"company": [], "deal": [], "contact": [], "pipelines": [], "notes": false, "files": false}')$$,
  '23505', null, 'only one connection is active at a time');

select throws_ok($$insert into public.commerce_external_links
  (id, provider, portal_id, object_type, object_id, destination_type, partner_id, company_name, created_by_id, created_by_name)
  values (gen_random_uuid(), 'hubspot', '1483', 'company', '1', 'partner',
  '00000000-0000-4000-8000-0000000014b2', 'Pgtap Co', gen_random_uuid(), 'Seller')$$,
  '23505', null, 'a company becomes at most one partner');

select throws_ok($$insert into public.commerce_external_links
  (id, provider, portal_id, object_type, object_id, destination_type, partner_id, company_name, created_by_id, created_by_name)
  values (gen_random_uuid(), 'hubspot', '1483', 'company', '2', 'partner',
  '00000000-0000-4000-8000-0000000014b1', 'Other Co', gen_random_uuid(), 'Seller')$$,
  '23505', null, 'a partner links to one company per portal');

select throws_ok($$insert into public.commerce_external_links
  (id, provider, portal_id, object_type, object_id, destination_type, account_id, company_name, created_by_id, created_by_name)
  values (gen_random_uuid(), 'hubspot', '1483', 'company', '3', 'partner',
  '10000000-0000-4000-8000-000000000001', 'Typed Co', gen_random_uuid(), 'Seller')$$,
  '23514', null, 'the destination type matches the linked record');

insert into public.commerce_hubspot_imports
  (id, link_id, partner_id, connection_id, portal_id, company_id, created_partner, status, plan, snapshot,
   request_digest, created_by_id, created_by_name)
values ('00000000-0000-4000-8000-0000000014d1', '00000000-0000-4000-8000-0000000014c1',
  '00000000-0000-4000-8000-0000000014b1', '00000000-0000-4000-8000-0000000014a1', '1483', '1', true,
  'needs_attention', '{"fields": []}', '{"values": []}', repeat('a', 64), gen_random_uuid(), 'Seller');
insert into public.commerce_hubspot_import_items
  (id, import_id, file_id, note_id, file_name, title, document_kind, status, excluded_reason)
values ('00000000-0000-4000-8000-0000000014e1', '00000000-0000-4000-8000-0000000014d1', '8', '6',
  'a.pdf', 'A', 'other', 'excluded', 'Not needed');

select throws_ok($$update public.commerce_hubspot_imports set plan = '{"fields": [1]}', version = version + 1
  where id = '00000000-0000-4000-8000-0000000014d1'$$,
  'P0001', 'HUBSPOT_IMPORT_IMMUTABLE', 'a reviewed plan never changes');

select throws_ok($$update public.commerce_hubspot_import_items set status = 'pending', excluded_reason = null,
  version = version + 1 where id = '00000000-0000-4000-8000-0000000014e1'$$,
  'P0001', 'HUBSPOT_ITEM_RESOLVED', 'a resolved document stays resolved');

select throws_ok($$update public.commerce_hubspot_imports set status = 'complete', completed_at = now()
  where id = '00000000-0000-4000-8000-0000000014d1'$$,
  'P0001', 'HUBSPOT_VERSION_MUST_ADVANCE', 'every change advances the version');

select throws_ok($$insert into public.commerce_hubspot_import_items
  (id, import_id, file_id, note_id, file_name, title, document_kind, status)
  values (gen_random_uuid(), '00000000-0000-4000-8000-0000000014d1', '9', '6', 'b.pdf', 'B', 'other', 'attached')$$,
  '23514', null, 'an attached document names its attachment');

select * from finish();
rollback;
