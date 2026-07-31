begin;
select plan(10);

select is((select relrowsecurity from pg_class where oid = 'public.accounts'::regclass), true, 'accounts RLS is enabled');
select is((select relforcerowsecurity from pg_class where oid = 'public.accounts'::regclass), true, 'accounts RLS is forced');
select is((select rolbypassrls from pg_roles where rolname = 'clockwork_runtime'), false, 'runtime role cannot bypass RLS');
select is((select rolbypassrls from pg_roles where rolname = 'clockwork_service'), false, 'service role cannot bypass RLS');
select is((select count(*)::integer from pg_policies where schemaname = 'public' and tablename = 'orders'), 1, 'orders have an account scope policy');

select set_config(
  'app.authorization_context',
  jsonb_build_object(
    'userId', '20000000-0000-4000-8000-000000000002',
    'accountIds', jsonb_build_array('10000000-0000-4000-8000-000000000001'),
    'roles', jsonb_build_array('owner'),
    'isInternalStaff', false,
    'requestId', 'pgtap-rls',
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
set local search_path = public, extensions;

select is((select count(*)::integer from accounts), 1, 'signed tenant context sees only its account');
select is((select count(*)::integer from accounts where id = '10000000-0000-4000-8000-000000000002'), 0, 'signed tenant context cannot see another account');

set local app.is_internal = 'true';
select is((select count(*)::integer from accounts), 1, 'unsigned internal GUC cannot escalate runtime role');

select set_config(
  'app.authorization_context',
  jsonb_set(current_setting('app.authorization_context')::jsonb, '{accountIds}', '["10000000-0000-4000-8000-000000000002"]')::text,
  true
);
select is((select count(*)::integer from accounts), 0, 'tampering with signed account scope fails closed');

reset role;
set local role clockwork_service;
set local search_path = public, extensions;
select is((select count(*)::integer from accounts), 9, 'service role has explicit cross-account access');

select * from finish();
rollback;
