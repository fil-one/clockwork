begin;
select plan(6);
set local search_path=public,extensions;
select ok(
  (select pg_get_constraintdef(oid) from pg_constraint where conname='memberships_role_check') like '%''revenue''%',
  'memberships accept the revenue role'
);
select ok(
  (select pg_get_constraintdef(oid) from pg_constraint where conname='memberships_role_check') like '%''commerce_admin''%',
  'memberships accept the commerce administrator role'
);
select ok(
  (select pg_get_constraintdef(oid) from pg_constraint where conname='memberships_role_check') not like '%''superuser''%',
  'the role vocabulary stays closed'
);
select ok(
  pg_get_functiondef('public.guard_customer_acquisition_request()'::regprocedure)
    like '%m.role in (''finance_approver'',''commerce_admin'')%',
  'an administrator may resolve an acquisition request as the finance approver of record'
);
select ok(
  pg_get_functiondef('public.validate_payg_credit_source()'::regprocedure)
    like '%membership.role in (''finance_approver'',''commerce_admin'')%',
  'an administrator may approve a PAYG credit as the finance approver of record'
);
select is(
  (select count(*)::integer from memberships membership
     join organizations staff_organization on staff_organization.id=membership.organization_id
   where staff_organization.workos_organization_id in ('org_01M21Q2N3ER4KWVJ30VRN8G0PV','org_01M21RDQDM5NHYD4CEHWJZFG3J')
     and membership.role='internal_operator'),
  0,
  'no Fil One staff membership is left as an internal operator'
);
select * from finish();
rollback;
