begin;
select plan(5);
set local search_path = public, extensions;

-- 001454 wrapped every permission test in a row policy in a scalar subquery,
-- so Postgres evaluates it once per statement (an InitPlan) instead of
-- verifying the signed claim again for every row. A policy written later with
-- a bare call would quietly put that cost back.
select is(
  (select string_agg(tablename || '.' || policyname, ', ' order by tablename, policyname)
   from pg_policies
   where schemaname = 'public'
     and coalesce(qual, '') || ' ' || coalesce(with_check, '')
       ~ '(?<!SELECT )app_has_(any_)?permission\('),
  null, 'every permission test in a row policy runs once per statement');

-- The other claim helpers that read no column of the row are wrapped too, in
-- the policies that test a permission.
select is(
  (select string_agg(tablename || '.' || policyname, ', ' order by tablename, policyname)
   from pg_policies
   where schemaname = 'public'
     and coalesce(qual, '') || ' ' || coalesce(with_check, '')
       ~ 'app_has_(any_)?permission\('
     and coalesce(qual, '') || ' ' || coalesce(with_check, '')
       ~ '(?<!SELECT )(app_current_user_id|experience_session_is_internal|experience_session_assisted_account|app_is_internal)\(\)'),
  null, 'row-independent claim helpers in permission policies run once per statement');

create function pg_temp.sign(granted text[], accounts jsonb) returns void
language plpgsql as $$
begin
  perform set_config('app.authorization_context', jsonb_build_object(
    'userId','20000000-0000-4000-8000-000000000002',
    'accountIds',accounts,
    'roles',to_jsonb(granted),
    'permissions',coalesce((
      select jsonb_agg(distinct permission order by permission)
      from public.role_permissions where role = any(granted)), '[]'::jsonb),
    'isInternalStaff',false,
    'requestId','pgtap-1454',
    'expiresAt',(clock_timestamp() + interval '5 minutes')::text
  )::text, true);
  perform set_config('app.authorization_signature', encode(extensions.hmac(
    current_setting('app.authorization_context'),
    (select secret from private.authorization_secrets where active
     order by created_at desc limit 1),
    'sha256'),'hex'), true);
end $$;

create function pg_temp.plan_lines(query text) returns setof text
language plpgsql as $$
declare
  plan_line text;
begin
  for plan_line in execute 'explain (costs off) ' || query loop
    return next plan_line;
  end loop;
end $$;

create temp table expected_invoices on commit drop as
select count(*) filter (
    where account_id = '10000000-0000-4000-8000-000000000001') as own,
  count(*) as total
from public.invoices;
grant select on expected_invoices to clockwork_runtime;

-- In the plan, the finance read on invoices is an InitPlan; only the account
-- scope is tested per row.
select pg_temp.sign(array['owner'], '["10000000-0000-4000-8000-000000000001"]');
set local role clockwork_runtime;
select ok(
  exists (select 1 from pg_temp.plan_lines('select id from public.invoices') line
    where line like '%InitPlan%')
  and not exists (select 1 from pg_temp.plan_lines('select id from public.invoices') line
    where line like '%Filter:%app_has_permission%'),
  'a customer''s invoice read tests billing:approve once, not per row');

-- The wrapped test still decides the rows: a customer owner reads its own
-- account's invoices, and a finance approver with no account reads them all.
select is(
  (select count(*) from public.invoices),
  (select own from expected_invoices),
  'a customer owner reads only its own account''s invoices');
reset role;
select pg_temp.sign(array['finance_approver'], '[]');
set local role clockwork_runtime;
select is(
  (select count(*) from public.invoices),
  (select total from expected_invoices),
  'a finance approver reads every invoice');
reset role;

select * from finish();
rollback;
