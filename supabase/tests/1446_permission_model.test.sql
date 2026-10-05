begin;
select plan(29);
set local search_path = public, extensions;

-- Fixture: the seeded organizations (Clockwork Staff 30..08 on the Fil One
-- side, Northstar 30..01 a customer, Redwood 30..02 a referral partner, Blue
-- Harbor 30..04 a channel partner), users 20..01 (operator) and 20..02 (owner).

create function pg_temp.sign(claims jsonb) returns void
language plpgsql as $$
begin
  perform set_config('app.authorization_context', (jsonb_build_object(
    'userId','20000000-0000-4000-8000-000000000001',
    'accountIds','[]'::jsonb,
    'isInternalStaff',true,
    'requestId','pgtap-1446',
    'expiresAt',(clock_timestamp() + interval '5 minutes')::text
  ) || claims)::text, true);
  perform set_config('app.authorization_signature', encode(extensions.hmac(
    current_setting('app.authorization_context'),
    (select secret from private.authorization_secrets where active
     order by created_at desc limit 1),
    'sha256'),'hex'), true);
end $$;

-- =========================================================================
-- 1. Sides.
-- =========================================================================
select is(
  (select jsonb_object_agg(name, side) from organizations
   where id in ('30000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002',
                '30000000-0000-4000-8000-000000000004','30000000-0000-4000-8000-000000000008')),
  '{"Northstar Production":"customer","Redwood Partner":"referral_partner","Blue Harbor Portfolio":"channel_partner","Clockwork Staff":"fil_one"}'::jsonb,
  'seeded organizations sit on the side their members and accounts imply');
select col_not_null('public', 'organizations', 'side', 'every organization has a side');
select throws_ok($$
  update organizations set side = 'vendor' where id = '30000000-0000-4000-8000-000000000001'
$$, '23514', null, 'the side vocabulary is closed');

-- A new organization takes its side from its account unless it names one.
insert into organizations (id, account_id, name) values
  ('b1446000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003','Blue Harbor Second'),
  ('b1446000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','Redwood Second'),
  ('b1446000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','Northstar Second');
insert into organizations (id, account_id, name, side) values
  ('b1446000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000009','Fil One Second','fil_one');
select is(
  (select jsonb_object_agg(name, side) from organizations where id::text like 'b1446000%'),
  '{"Blue Harbor Second":"channel_partner","Redwood Second":"referral_partner","Northstar Second":"customer","Fil One Second":"fil_one"}'::jsonb,
  'a new organization takes its account''s side, and Fil One''s is named');

-- =========================================================================
-- 2. Roles fit the side.
-- =========================================================================
select throws_ok($$
  insert into memberships (organization_id, user_id, role)
  values ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','internal_operator')
$$, '23514', null, 'an internal role is refused in a customer organization');
select throws_ok($$
  insert into memberships (organization_id, user_id, role)
  values ('30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','owner')
$$, '23514', null, 'a customer role is refused in a partner organization');
select throws_ok($$
  insert into memberships (organization_id, user_id, role)
  values ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000003','partner_admin')
$$, '23514', null, 'a partner role is refused in a customer organization');
select throws_ok($$
  update memberships set role = 'internal_operator'
  where id = '31000000-0000-4000-8000-000000000001'
$$, '23514', null, 'a role change cannot leave the side either (the refuted WorkOS escalation)');
select throws_ok($$
  insert into membership_roles (membership_id, role)
  values ('31000000-0000-4000-8000-000000000001','finance_approver')
$$, '23514', null, 'an extra role is held to the side too');
select throws_ok($$
  update organizations set side = 'customer' where id = '30000000-0000-4000-8000-000000000008'
$$, '23514', null, 'an organization cannot move to a side its members'' roles do not fit');
select lives_ok($$
  update organizations set side = 'channel_partner' where id = '30000000-0000-4000-8000-000000000002'
$$, 'a partner organization may move between the partner sides');
update organizations set side = 'referral_partner' where id = '30000000-0000-4000-8000-000000000002';

-- =========================================================================
-- 3. Several roles per membership.
-- =========================================================================
select is(
  (select count(*)::integer from memberships m
   where not exists (select 1 from membership_roles r where r.membership_id = m.id and r.role = m.role)),
  0, 'every membership holds its primary role');
select lives_ok($$
  insert into membership_roles (membership_id, role, reason)
  values ('31000000-0000-4000-8000-000000000003','finance_approver','Covers month-end close')
$$, 'a staff membership takes an extra role');
select throws_ok($$
  delete from membership_roles
  where membership_id = '31000000-0000-4000-8000-000000000003' and role = 'internal_operator'
$$, '23514', null, 'the primary role cannot be removed while it is primary');
update memberships set role = 'finance_approver' where id = '31000000-0000-4000-8000-000000000003';
select is(
  (select array_agg(role order by role) from membership_roles
   where membership_id = '31000000-0000-4000-8000-000000000003'),
  array['finance_approver'],
  'changing the primary role replaces it, and an extra role already held stays once');
update memberships set role = 'internal_operator' where id = '31000000-0000-4000-8000-000000000003';
insert into membership_roles (membership_id, role)
values ('31000000-0000-4000-8000-000000000003','legal_approver');
select is(
  (select array_agg(role order by role) from membership_roles
   where membership_id = '31000000-0000-4000-8000-000000000003'),
  array['internal_operator','legal_approver'],
  'a primary role change keeps extra roles');

-- =========================================================================
-- 4. Stored-membership permissions.
-- =========================================================================
select ok(public.member_has_permission('20000000-0000-4000-8000-000000000001', 'agreement:approve'),
  'an extra role confers its permissions');
select ok(public.member_has_permission('20000000-0000-4000-8000-000000000001', 'operations:write'),
  'the primary role still confers its permissions');
select ok(not public.member_has_permission('20000000-0000-4000-8000-000000000001', 'staff:manage'),
  'a permission no role grants is not held');
select ok(public.member_has_permission('20000000-0000-4000-8000-000000000005', 'partner:quote:write'),
  'a channel partner administrator writes partner quotes');
select ok(not public.member_has_permission('20000000-0000-4000-8000-000000000003', 'partner:quote:write')
  and public.member_has_permission('20000000-0000-4000-8000-000000000003', 'deal:register'),
  'a referral partner administrator registers deals but writes no partner quotes');
select ok(
  public.member_has_permission('20000000-0000-4000-8000-000000000002', 'quote:write', '30000000-0000-4000-8000-000000000001')
  and not public.member_has_permission('20000000-0000-4000-8000-000000000002', 'quote:write', '30000000-0000-4000-8000-000000000008'),
  'the organization-scoped form answers for that organization only');

-- =========================================================================
-- 5. Signed permissions.
-- =========================================================================
select pg_temp.sign('{"roles":["internal_operator"]}');
set local role clockwork_runtime;
select ok(app_has_permission('operations:write') and not app_has_permission('billing:approve'),
  'a claim without permissions answers from its roles');
reset role;
select pg_temp.sign('{"roles":["commerce_admin"],"permissions":["account:read","impersonation:assume"]}');
set local role clockwork_runtime;
select ok(app_has_permission('impersonation:assume') and not app_has_permission('billing:approve')
  and not app_has_any_permission(array['quote:approve','staff:manage']),
  'signed permissions decide when present, so an assisted session''s withheld approvals stay withheld');
reset role;
select pg_temp.sign('{"roles":["commerce_admin"],"permissions":["account:read"]}');
select set_config('app.authorization_signature', repeat('0', 64), true);
set local role clockwork_runtime;
select ok(not app_has_permission('account:read'), 'an unsigned claim holds nothing');
reset role;

select ok(
  not has_table_privilege('clockwork_runtime', 'public.membership_roles', 'INSERT')
  and not has_table_privilege('clockwork_runtime', 'public.role_permissions', 'INSERT')
  and not has_table_privilege('clockwork_service', 'public.role_permissions', 'DELETE')
  and has_table_privilege('clockwork_runtime', 'public.role_permissions', 'SELECT'),
  'roles are granted only through the service pool, and the bundles are read-only at runtime');

-- =========================================================================
-- 6. Notices to the other administrators.
-- =========================================================================
insert into commerce_users (id, workos_user_id, email, name, is_internal_staff, mfa_enrolled) values
  ('b1446000-0000-4000-8000-000000000101','user_1446_admin_a','admin-a@clockwork.test','Admin A',true,true),
  ('b1446000-0000-4000-8000-000000000102','user_1446_admin_b','admin-b@clockwork.test','Admin B',true,true);
insert into memberships (organization_id, user_id, role) values
  ('30000000-0000-4000-8000-000000000008','b1446000-0000-4000-8000-000000000101','commerce_admin'),
  ('30000000-0000-4000-8000-000000000008','b1446000-0000-4000-8000-000000000102','commerce_admin');
insert into audit_events (id, account_id, aggregate_type, aggregate_id, aggregate_version,
  event_type, event_version, actor, occurred_at, request_id) values
  ('b1446000-0000-4000-8000-0000000000e1', null, 'membership', '31000000-0000-4000-8000-000000000003', 2,
   'staff.role_granted', 1, '{"kind":"user","id":"b1446000-0000-4000-8000-000000000101"}', now(), 'pgtap-1446-grant'),
  ('b1446000-0000-4000-8000-0000000000e2', null, 'membership', '31000000-0000-4000-8000-000000000003', 3,
   'core.orders.update', 1, '{"kind":"user","id":"b1446000-0000-4000-8000-000000000101"}', now(), 'pgtap-1446-other');
select is(
  (select array_agg(recipient_user_id::text) from staff_notices where audit_event_id = 'b1446000-0000-4000-8000-0000000000e1'),
  array['b1446000-0000-4000-8000-000000000102'],
  'a staff role change notifies every other administrator and not the actor');
select is(
  (select count(*)::integer from staff_notices where audit_event_id = 'b1446000-0000-4000-8000-0000000000e2'),
  0, 'ordinary events notify nobody');
select ok(
  has_column_privilege('clockwork_service', 'public.staff_notices', 'read_at', 'UPDATE')
  and not has_column_privilege('clockwork_service', 'public.staff_notices', 'recipient_user_id', 'UPDATE')
  and not has_table_privilege('clockwork_runtime', 'public.staff_notices', 'SELECT'),
  'a notice can only be marked read, and only through the service pool');

select * from finish();
rollback;
