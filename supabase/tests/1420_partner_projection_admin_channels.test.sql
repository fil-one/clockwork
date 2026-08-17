begin;
select plan(14);
set local search_path = public, extensions;

set local role clockwork_service;
insert into public.experience_portal_projections (
  audience, audience_account_id, subject_account_id, channel, record_key,
  aggregate_type, aggregate_id, command_resource, payload, source_hash,
  source_aggregate_version, source_updated_at, projected_at
) values
  ('partner', '10000000-0000-4000-8000-000000000002',
   '10000000-0000-4000-8000-000000000002', 'billing', 'pgtap-1420-billing',
   'invoice', '90000000-0000-4000-8000-000000001420', null,
   '{"allowedActions":[]}'::jsonb, repeat('a', 64), 1, now(), now()),
  ('partner', '10000000-0000-4000-8000-000000000002',
   '10000000-0000-4000-8000-000000000002', 'commissions', 'pgtap-1420-commission',
   'commission_statement', '92000000-0000-4000-8000-000000001420', null,
   '{"allowedActions":[]}'::jsonb, repeat('b', 64), 1, now(), now()),
  ('partner', '10000000-0000-4000-8000-000000000002',
   '10000000-0000-4000-8000-000000000002', 'portfolio', 'pgtap-1420-portfolio',
   'account', '10000000-0000-4000-8000-000000000002', null,
   '{"allowedActions":[]}'::jsonb, repeat('c', 64), 1, now(), now());
reset role;

select is(
  (select count(*)::integer from pg_policies
   where schemaname = 'public'
     and tablename = 'experience_portal_projections'
     and policyname = 'experience_projection_read'),
  1,
  'the projection read boundary has one policy'
);

select ok(
  (select position('partner_admin' in qual) > 0
          and position('experience_session_assisted_account' in qual) > 0
          and position('billing' in qual) > 0
          and position('commissions' in qual) > 0
          and position('renewals' in qual) > 0
          and position('sandboxes' in qual) > 0
          and position('brand' in qual) > 0
   from pg_policies
   where schemaname = 'public'
     and tablename = 'experience_portal_projections'
     and policyname = 'experience_projection_read'),
  'the live policy pins every application admin-only partner channel'
);

select set_config(
  'app.authorization_context',
  jsonb_build_object(
    'userId', '20000000-0000-4000-8000-000000000003',
    'accountIds', jsonb_build_array('10000000-0000-4000-8000-000000000002'),
    'roles', jsonb_build_array('partner_seller'),
    'isInternalStaff', false,
    'requestId', 'pgtap-1420-seller',
    'expiresAt', (clock_timestamp() + interval '5 minutes')::text
  )::text,
  true
);
select set_config(
  'app.authorization_signature',
  encode(extensions.hmac(
    current_setting('app.authorization_context'),
    (select secret from private.authorization_secrets where active order by created_at desc limit 1),
    'sha256'
  ), 'hex'),
  true
);
set local role clockwork_runtime;
select is((select count(*)::integer from experience_portal_projections where record_key = 'pgtap-1420-billing'), 0, 'a seller cannot read partner billing');
select is((select count(*)::integer from experience_portal_projections where record_key = 'pgtap-1420-commission'), 0, 'a seller cannot read partner commissions');
select is((select count(*)::integer from experience_portal_projections where record_key = 'pgtap-1420-portfolio'), 1, 'a seller still reads a shared portfolio channel');
reset role;

select set_config(
  'app.authorization_context',
  jsonb_set(current_setting('app.authorization_context')::jsonb, '{roles}', '["partner_admin"]'::jsonb)::text,
  true
);
select set_config(
  'app.authorization_signature',
  encode(extensions.hmac(
    current_setting('app.authorization_context'),
    (select secret from private.authorization_secrets where active order by created_at desc limit 1),
    'sha256'
  ), 'hex'),
  true
);
set local role clockwork_runtime;
select is((select count(*)::integer from experience_portal_projections where record_key = 'pgtap-1420-billing'), 1, 'a partner administrator reads partner billing');
select is((select count(*)::integer from experience_portal_projections where record_key = 'pgtap-1420-commission'), 1, 'a partner administrator reads partner commissions');
select is((select count(*)::integer from experience_portal_projections where record_key = 'pgtap-1420-portfolio'), 1, 'a partner administrator reads shared portfolio');
reset role;

select set_config(
  'app.authorization_context',
  jsonb_set(
    current_setting('app.authorization_context')::jsonb,
    '{accountIds}',
    '["10000000-0000-4000-8000-000000000003"]'::jsonb
  )::text,
  true
);
select set_config(
  'app.authorization_signature',
  encode(extensions.hmac(
    current_setting('app.authorization_context'),
    (select secret from private.authorization_secrets where active order by created_at desc limit 1),
    'sha256'
  ), 'hex'),
  true
);
set local role clockwork_runtime;
select is((select count(*)::integer from experience_portal_projections where record_key like 'pgtap-1420-%'), 0, 'an administrator on another account reads no records');
reset role;

select set_config(
  'app.authorization_context',
  jsonb_build_object(
    'userId', '20000000-0000-4000-8000-000000000001',
    'accountIds', jsonb_build_array('10000000-0000-4000-8000-000000000002'),
    'roles', jsonb_build_array('internal_operator'),
    'isInternalStaff', true,
    'requestId', 'pgtap-1420-assisted',
    'expiresAt', (clock_timestamp() + interval '5 minutes')::text
  )::text,
  true
);
select set_config(
  'app.authorization_signature',
  encode(extensions.hmac(
    current_setting('app.authorization_context'),
    (select secret from private.authorization_secrets where active order by created_at desc limit 1),
    'sha256'
  ), 'hex'),
  true
);
set local role clockwork_runtime;
select is((select count(*)::integer from experience_portal_projections where record_key = 'pgtap-1420-billing'), 1, 'assisted staff reads target-account partner billing');
select is((select count(*)::integer from experience_portal_projections where record_key = 'pgtap-1420-commission'), 1, 'assisted staff reads target-account partner commissions');
reset role;

select set_config(
  'app.authorization_context',
  jsonb_set(current_setting('app.authorization_context')::jsonb, '{accountIds}', '["10000000-0000-4000-8000-000000000003"]'::jsonb)::text,
  true
);
select set_config(
  'app.authorization_signature',
  encode(extensions.hmac(
    current_setting('app.authorization_context'),
    (select secret from private.authorization_secrets where active order by created_at desc limit 1),
    'sha256'
  ), 'hex'),
  true
);
set local role clockwork_runtime;
select is((select count(*)::integer from experience_portal_projections where record_key like 'pgtap-1420-%'), 0, 'assisted staff cannot read outside the signed target account');
reset role;

select set_config(
  'app.authorization_context',
  jsonb_set(current_setting('app.authorization_context')::jsonb, '{accountIds}', '[]'::jsonb)::text,
  true
);
select set_config(
  'app.authorization_signature',
  encode(extensions.hmac(
    current_setting('app.authorization_context'),
    (select secret from private.authorization_secrets where active order by created_at desc limit 1),
    'sha256'
  ), 'hex'),
  true
);
set local role clockwork_runtime;
select is((select count(*)::integer from experience_portal_projections where record_key like 'pgtap-1420-%'), 0, 'unassisted staff with no signed account reads no partner rows');
reset role;

set local role clockwork_service;
select is((select count(*)::integer from experience_portal_projections where record_key like 'pgtap-1420-%'), 3, 'the service materializer retains all three records');
reset role;

select * from finish();
rollback;
