begin;
select plan(20);

select has_table('public', 'experience_assisted_sessions',
  'assisted sessions have a durable authority record');
select has_table('public', 'experience_release_proof_sessions',
  'release-proof authentication has a durable fixture record');
select has_column('public', 'experience_assisted_sessions', 'actor_snapshot_name',
  'assisted sessions snapshot the immutable actor name');
select has_column('public', 'experience_assisted_sessions', 'actor_snapshot_email',
  'assisted sessions snapshot the immutable actor email');
select has_index('public', 'experience_assisted_sessions',
  'experience_assisted_session_single_live_idx',
  'one live assisted session is enforced by an index');
select has_index('public', 'experience_release_proof_sessions',
  'experience_release_proof_session_expiry_idx',
  'release-proof expiry and revocation are indexed');
select is((select relrowsecurity from pg_class
  where oid = 'public.experience_assisted_sessions'::regclass), true,
  'assisted sessions enforce RLS');
select is((select relforcerowsecurity from pg_class
  where oid = 'public.experience_assisted_sessions'::regclass), true,
  'assisted sessions force RLS');
select is((select relrowsecurity from pg_class
  where oid = 'public.experience_release_proof_sessions'::regclass), true,
  'release-proof sessions enforce RLS');
select is((select relforcerowsecurity from pg_class
  where oid = 'public.experience_release_proof_sessions'::regclass), true,
  'release-proof sessions force RLS');

set local role clockwork_runtime;
set local search_path = public, extensions;
select throws_ok(
  $$select * from experience_assisted_sessions$$,
  '42501', null, 'runtime role cannot read assisted-session authority');
select throws_ok(
  $$select * from experience_release_proof_sessions$$,
  '42501', null, 'runtime role cannot read release-proof credentials');

reset role;
set local role clockwork_service;
set local search_path = public, extensions;
select throws_ok(
  $$delete from experience_assisted_sessions$$,
  '42501', null, 'service role cannot delete assisted-session evidence');
select throws_ok(
  $$delete from experience_release_proof_sessions$$,
  '42501', null, 'service role cannot delete release-proof fixtures');

reset role;
set local search_path = public, extensions;
insert into experience_assisted_sessions (
  id, authentication_session_id, internal_user_id,
  actor_snapshot_name, actor_snapshot_email, target_account_id,
  reason, started_at, expires_at, request_id
) values (
  '12000000-0000-4000-8000-000000000090',
  'pgtap-assisted-auth-session',
  '20000000-0000-4000-8000-000000000001',
  'Iris Operator', 'operator@clockwork.test',
  '10000000-0000-4000-8000-000000000001',
  'Customer requested help for case CASE-PGTAP',
  '2030-07-31T16:00:00Z', '2030-07-31T16:15:00Z',
  'pgtap:assisted:create'
);
select throws_ok(
  $$update experience_assisted_sessions set actor_snapshot_name = 'Changed actor'
    where id = '12000000-0000-4000-8000-000000000090'$$,
  '23514', 'assisted session identity is immutable',
  'actor name snapshot cannot mutate');
select throws_ok(
  $$update experience_assisted_sessions set actor_snapshot_email = 'changed@clockwork.test'
    where id = '12000000-0000-4000-8000-000000000090'$$,
  '23514', 'assisted session identity is immutable',
  'actor email snapshot cannot mutate');
select throws_ok(
  $$update experience_assisted_sessions
    set target_account_id = '10000000-0000-4000-8000-000000000004'
    where id = '12000000-0000-4000-8000-000000000090'$$,
  '23514', 'assisted session identity is immutable',
  'effective account cannot mutate');
select throws_ok(
  $$insert into experience_assisted_sessions (
      authentication_session_id, internal_user_id,
      actor_snapshot_name, actor_snapshot_email, target_account_id,
      reason, started_at, expires_at, request_id
    ) values (
      'pgtap-assisted-auth-session',
      '20000000-0000-4000-8000-000000000001',
      'Iris Operator', 'operator@clockwork.test',
      '10000000-0000-4000-8000-000000000004',
      'Second live session should be rejected',
      '2030-07-31T16:00:00Z', '2030-07-31T16:15:00Z',
      'pgtap:assisted:duplicate'
    )$$,
  '23505', null, 'only one live assisted session can exist per auth session');
select lives_ok(
  $$update experience_assisted_sessions set ended_at = '2030-07-31T16:10:00Z'
    where id = '12000000-0000-4000-8000-000000000090'$$,
  'server-backed exit may end the session once');
select throws_ok(
  $$update experience_assisted_sessions set ended_at = '2030-07-31T16:11:00Z'
    where id = '12000000-0000-4000-8000-000000000090'$$,
  '23514', 'assisted session exit is immutable',
  'ended state cannot be rewritten');

select * from finish();
rollback;
