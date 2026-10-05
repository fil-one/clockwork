begin;
select plan(14);
set local search_path = public, extensions;

-- Gaining a grant must never turn an allow into a deny (001447). For a fixed
-- set of tenant-pool commands, every role alone and every pair of roles is
-- signed the way the application signs it (roles plus the union of their
-- bundles from role_permissions), the command is run, and its effect rolled
-- back. A pair may never be refused a command that one of its roles alone
-- was admitted to. A pure finance approver stays confined.
--
-- Fixture: the seeded partner account 10..02, internal users 20..01 (the
-- acting user) and 20..06 (somebody else).

create function pg_temp.sign(granted text[]) returns void
language plpgsql as $$
begin
  perform set_config('app.authorization_context', jsonb_build_object(
    'userId','20000000-0000-4000-8000-000000000001',
    'accountIds',jsonb_build_array('10000000-0000-4000-8000-000000000002'),
    'roles',to_jsonb(granted),
    'permissions',coalesce((
      select jsonb_agg(distinct permission order by permission)
      from public.role_permissions where role = any(granted)), '[]'::jsonb),
    'isInternalStaff',true,
    'requestId','pgtap-1447-monotonicity',
    'expiresAt',(clock_timestamp() + interval '5 minutes')::text
  )::text, true);
  perform set_config('app.authorization_signature', encode(extensions.hmac(
    current_setting('app.authorization_context'),
    (select secret from private.authorization_secrets where active
     order by created_at desc limit 1),
    'sha256'),'hex'), true);
end $$;

-- Runs `command` as the tenant pool under `granted` and reports whether it was
-- admitted. A write is undone by raising after it succeeds; a read is
-- admitted when it returns true.
create function pg_temp.admitted(granted text[], command text, is_read boolean)
returns boolean language plpgsql as $$
declare
  result boolean := false;
begin
  perform pg_temp.sign(granted);
  begin
    perform set_config('role', 'clockwork_runtime', true);
    if is_read then
      execute command into result;
    else
      execute command;
      result := true;
    end if;
    raise exception using errcode = 'P0001', message = 'PGTAP_ROLLBACK';
  exception when others then
    if sqlerrm <> 'PGTAP_ROLLBACK' then result := false; end if;
  end;
  perform set_config('role', 'none', true);
  return coalesce(result, false);
end $$;

create temp table monotonicity_commands (name text primary key, command text, is_read boolean);
grant select on monotonicity_commands to clockwork_runtime;

-- Fixtures the commands refer to.
insert into report_exports (id, requested_by, report, parameters, status) values
  ('b1447000-0000-4000-8000-000000000001',
   '20000000-0000-4000-8000-000000000001','weekly_scorecard','{}','pending');
insert into audit_events (
  id, account_id, aggregate_type, aggregate_id, aggregate_version,
  event_type, event_version, actor, occurred_at, request_id
) values
  ('b1447000-0000-4000-8000-0000000000a1','10000000-0000-4000-8000-000000000002',
   'order','b1447000-0000-4000-8000-0000000000a2',1,'core.orders.update',1,
   '{"kind":"user","id":"20000000-0000-4000-8000-000000000006"}',
   clock_timestamp(),'pgtap-1447-foreign-order'),
  ('b1447000-0000-4000-8000-0000000000a3','10000000-0000-4000-8000-000000000002',
   'invoice','b1447000-0000-4000-8000-0000000000a4',1,'core.invoices.void',1,
   '{"kind":"user","id":"20000000-0000-4000-8000-000000000001"}',
   clock_timestamp(),'pgtap-1447-own-invoice');

insert into monotonicity_commands values
  ('audit a report export', $c$
    insert into audit_events (account_id, aggregate_type, aggregate_id, aggregate_version,
      event_type, event_version, actor, occurred_at, request_id)
    values (null,'report_export','b1447000-0000-4000-8000-000000000001',1,
      'core.reports.create',1,'{"kind":"user","id":"20000000-0000-4000-8000-000000000001"}',
      clock_timestamp(),'pgtap-1447-report')$c$, false),
  ('audit a commission accrual', $c$
    insert into audit_events (account_id, aggregate_type, aggregate_id, aggregate_version,
      event_type, event_version, actor, occurred_at, request_id)
    values ('10000000-0000-4000-8000-000000000002','commission_accrual',gen_random_uuid(),1,
      'core.commissions.accrue',1,'{"kind":"user","id":"20000000-0000-4000-8000-000000000001"}',
      clock_timestamp(),'pgtap-1447-accrual')$c$, false),
  ('append an order audit row on the account', $c$
    insert into audit_events (account_id, aggregate_type, aggregate_id, aggregate_version,
      event_type, event_version, actor, occurred_at, request_id)
    values ('10000000-0000-4000-8000-000000000002','order',gen_random_uuid(),1,
      'core.orders.update',1,'{"kind":"user","id":"20000000-0000-4000-8000-000000000006"}',
      clock_timestamp(),'pgtap-1447-order')$c$, false),
  ('read another user''s order audit row', $c$
    select exists (select 1 from audit_events
      where id = 'b1447000-0000-4000-8000-0000000000a1')$c$, true),
  ('read one''s own invoice audit row', $c$
    select exists (select 1 from audit_events
      where id = 'b1447000-0000-4000-8000-0000000000a3')$c$, true),
  ('queue one''s own invoice event', $c$
    insert into outbox_messages (event_id, topic, payload)
    values ('b1447000-0000-4000-8000-0000000000a3','core.invoices.void',
      jsonb_build_object('eventId','b1447000-0000-4000-8000-0000000000a3',
        'eventType','core.invoices.void','aggregateType','invoice',
        'aggregateId','b1447000-0000-4000-8000-0000000000a4',
        'requestId','pgtap-1447-own-invoice'))$c$, false),
  ('request a report export', $c$
    insert into report_exports (requested_by, report, parameters, status)
    values ('20000000-0000-4000-8000-000000000001','weekly_scorecard','{}','pending')$c$, false);

create temp table monotonicity_results as
with role_list as (
  select distinct role from public.role_permissions
),
grants as (
  select array[a.role] as granted, a.role as base, null::text as added
  from role_list a
  union all
  select array[a.role, b.role], a.role, b.role
  from role_list a join role_list b on a.role <> b.role
)
select command.name, grants.base, grants.added, grants.granted,
  pg_temp.admitted(grants.granted, command.command, command.is_read) as admitted
from monotonicity_commands command cross join grants;

-- Every command is reachable by somebody, so the suite measures something.
select is(
  (select count(*)::integer from monotonicity_commands command
   where not exists (select 1 from monotonicity_results result
     where result.name = command.name and result.admitted)),
  0, 'every representative command is admitted for at least one role');

-- The property, per command.
select is(
  (select string_agg(format('%s + %s', alone.base, pair.added), ', ' order by alone.base, pair.added)
   from monotonicity_results alone
   join monotonicity_results pair
     on pair.name = alone.name and pair.base = alone.base and pair.added is not null
   where alone.added is null and alone.admitted and not pair.admitted
     and alone.name = command.name),
  null, format('adding a role never refuses: %s', command.name))
from monotonicity_commands command order by command.name;

-- The 001401 and 001441 cases by name.
select ok(
  (select admitted from monotonicity_results where name = 'audit a report export'
     and granted = array['internal_operator','finance_approver']),
  'an operator who is also a finance approver audits a report export');
select ok(
  (select admitted from monotonicity_results where name = 'append an order audit row on the account'
     and granted = array['owner','finance_approver']),
  'an owner who is also a finance approver keeps the owner''s appends');

-- A pure finance approver is confined exactly as designed.
select ok(
  not (select admitted from monotonicity_results where name = 'read another user''s order audit row'
     and granted = array['finance_approver']),
  'a finance approver alone does not read another user''s ordinary audit row');
select ok(
  not (select admitted from monotonicity_results where name = 'append an order audit row on the account'
     and granted = array['finance_approver']),
  'a finance approver alone cannot audit under another user''s name');
select ok(
  (select admitted from monotonicity_results where name = 'read one''s own invoice audit row'
     and granted = array['finance_approver']),
  'a finance approver alone reads its own finance record');

-- Static half of the rule: no restrictive policy negates a permission.
select is(
  (select string_agg(tablename || '.' || policyname, ', ')
   from pg_policies
   where schemaname = 'public' and permissive = 'RESTRICTIVE'
     and coalesce(qual, '') || coalesce(with_check, '')
       ~* 'not\s*\(*\s*app_has_(any_)?permission'),
  null, 'no restrictive policy tests for the absence of a permission');

select * from finish();
rollback;
