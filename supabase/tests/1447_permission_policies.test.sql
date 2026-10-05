begin;
select plan(16);
set local search_path = public, extensions;

-- 001447 replaced every role test in the row policies with a permission test.
-- Each replacement must admit exactly the roles the old test admitted, as the
-- application signed them before: a commerce administrator's claim then
-- carried the four internal roles it acts as, so it passed any test naming
-- one of them. Each role below is signed alone, the way the application signs
-- it now (its role and its bundle), and the permission test is evaluated.

create function pg_temp.sign(granted text[]) returns void
language plpgsql as $$
begin
  perform set_config('app.authorization_context', jsonb_build_object(
    'userId','20000000-0000-4000-8000-000000000001',
    'accountIds','[]'::jsonb,
    'roles',to_jsonb(granted),
    'permissions',coalesce((
      select jsonb_agg(distinct permission order by permission)
      from public.role_permissions where role = any(granted)), '[]'::jsonb),
    'isInternalStaff',true,
    'requestId','pgtap-1447-equivalence',
    'expiresAt',(clock_timestamp() + interval '5 minutes')::text
  )::text, true);
  perform set_config('app.authorization_signature', encode(extensions.hmac(
    current_setting('app.authorization_context'),
    (select secret from private.authorization_secrets where active
     order by created_at desc limit 1),
    'sha256'),'hex'), true);
end $$;

create function pg_temp.holds(granted text[], test text) returns boolean
language plpgsql as $$
declare result boolean;
begin
  perform pg_temp.sign(granted);
  perform set_config('role', 'clockwork_runtime', true);
  execute 'select ' || test into result;
  perform set_config('role', 'none', true);
  return coalesce(result, false);
end $$;

create temp table replacements (old_roles text[], test text);
insert into replacements values
  (array['finance_approver'], $$app_has_permission('billing:approve')$$),
  (array['finance_approver'], $$app_has_permission('quote:approve')$$),
  (array['internal_operator'], $$app_has_permission('operations:write')$$),
  (array['destructive_action_approver'], $$app_has_permission('destructive:approve')$$),
  (array['legal_approver','finance_approver','destructive_action_approver'],
   $$app_has_any_permission(array['agreement:approve','quote:approve','billing:approve','destructive:approve'])$$),
  (array['internal_operator','finance_approver'],
   $$app_has_any_permission(array['operations:write','billing:approve'])$$),
  (array['destructive_action_approver','internal_operator'], $$app_has_permission('system:operate')$$),
  (array['owner','admin','partner_admin','internal_operator'], $$app_has_permission('account:write')$$),
  (array['owner','admin','partner_admin','internal_operator'], $$app_has_permission('order:write')$$),
  (array['owner','admin','partner_admin','internal_operator'], $$app_has_permission('poc:manage')$$),
  (array['owner','billing','internal_operator','finance_approver'],
   $$app_has_any_permission(array['billing:write','billing:approve','operations:write'])$$),
  (array['owner','admin','partner_admin','internal_operator','legal_approver'],
   $$app_has_any_permission(array['account:write','agreement:approve'])$$),
  (array['owner','admin','partner_admin','partner_seller','internal_operator','finance_approver'],
   $$app_has_any_permission(array['quote:write','partner:quote:write','quote:approve'])$$),
  (array['partner_admin','partner_seller','internal_operator'],
   $$app_has_any_permission(array['deal:register','operations:write'])$$),
  (array['owner','admin','billing','partner_admin','partner_seller','internal_operator',
         'finance_approver','legal_approver','destructive_action_approver'],
   $$app_has_any_permission(array['account:write','billing:write','partner:quote:write','deal:register','billing:approve','agreement:approve','destructive:approve'])$$);

create temp table equivalence as
select replacement.test, role_list.role,
  role_list.role = any(replacement.old_roles)
    or (role_list.role = 'commerce_admin' and replacement.old_roles && array[
      'internal_operator','finance_approver','legal_approver','destructive_action_approver']) as before,
  pg_temp.holds(array[role_list.role], replacement.test) as after
from replacements replacement
cross join (select distinct role from public.role_permissions) role_list;

select is(
  (select string_agg(format('%s: %s was %s', test, role, before), '; ' order by role)
   from equivalence e where e.test = r.test and e.before is distinct from e.after),
  null, format('admits exactly the old roles: %s', r.test))
from (select distinct test from replacements) r order by r.test;

-- No row policy names a role any more, and the role helpers are gone.
select ok(
  not exists (
    select 1 from pg_policies where schemaname = 'public'
      and coalesce(qual, '') || coalesce(with_check, '') ~ 'app_has_role|app_has_any_role|experience_session_has_role')
  and to_regprocedure('public.app_has_role(text)') is null
  and to_regprocedure('public.app_has_any_role(text[])') is null
  and to_regprocedure('public.experience_session_has_role(text)') is null,
  'no policy tests a role name');

select * from finish();
rollback;
