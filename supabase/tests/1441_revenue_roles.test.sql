begin;
select plan(33);
set local search_path = public, extensions;

-- Fixture: the seeded account 10..02 and internal users 20..01 and 20..06.
-- Claims are signed the way the application signs them; each scenario resets
-- to the owner to sign, then runs as clockwork_runtime.
create function pg_temp.sign_claims(roles jsonb, account_ids jsonb)
returns void language plpgsql as $$
begin
  perform set_config('app.authorization_context', jsonb_build_object(
    'userId','20000000-0000-4000-8000-000000000001',
    'accountIds',account_ids,'roles',roles,'isInternalStaff',true,
    'requestId','pgtap-1441',
    'expiresAt',(clock_timestamp() + interval '5 minutes')::text
  )::text, true);
  perform set_config('app.authorization_signature', encode(extensions.hmac(
    current_setting('app.authorization_context'),
    (select secret from private.authorization_secrets where active
     order by created_at desc limit 1),
    'sha256'),'hex'), true);
end $$;

-- =========================================================================
-- 1. Vocabulary.
-- =========================================================================
select ok(
  (select pg_get_constraintdef(oid) from pg_constraint where conname='memberships_role_check') like '%''revenue''%'
  and (select pg_get_constraintdef(oid) from pg_constraint where conname='memberships_role_check') like '%''commerce_admin''%',
  'memberships accept the revenue and commerce administrator roles'
);
select throws_ok($$
  insert into memberships (organization_id, user_id, role)
  values ('30000000-0000-4000-8000-000000000008',
          '20000000-0000-4000-8000-000000000006', 'superuser')
$$, '23514', null, 'the role vocabulary stays closed');
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

-- =========================================================================
-- 2. The administrator's expanded claim keeps operator work on the tenant
--    pool, keeps finance work, and keeps attribution.
-- =========================================================================
insert into report_exports (id, requested_by, report, parameters, status) values
  ('b1441000-0000-4000-8000-000000000001',
   '20000000-0000-4000-8000-000000000001','weekly_scorecard','{}','pending'),
  ('b1441000-0000-4000-8000-000000000002',
   '20000000-0000-4000-8000-000000000001','weekly_scorecard','{}','pending'),
  ('b1441000-0000-4000-8000-000000000003',
   '20000000-0000-4000-8000-000000000001','weekly_scorecard','{}','pending');
-- Another user's ordinary order audit row on the seeded account.
insert into audit_events (
  id, account_id, aggregate_type, aggregate_id, aggregate_version,
  event_type, event_version, actor, occurred_at, request_id
) values (
  'b1441000-0000-4000-8000-0000000000a1','10000000-0000-4000-8000-000000000002',
  'order','b1441000-0000-4000-8000-0000000000a2',1,'core.orders.update',1,
  '{"kind":"user","id":"20000000-0000-4000-8000-000000000006"}',
  clock_timestamp(),'pgtap-1441-foreign-order'
);

-- 2a. The baseline: an operator on its own.
select pg_temp.sign_claims('["internal_operator"]', '["10000000-0000-4000-8000-000000000002"]');
set local role clockwork_runtime;
set local search_path = public, extensions;
select lives_ok($$
  insert into audit_events (
    id, account_id, aggregate_type, aggregate_id, aggregate_version,
    event_type, event_version, actor, occurred_at, request_id
  ) values (
    'b1441000-0000-4000-8000-0000000000b1', null,'report_export',
    'b1441000-0000-4000-8000-000000000001',1,'core.reports.create',1,
    '{"kind":"user","id":"20000000-0000-4000-8000-000000000001"}',
    clock_timestamp(),'pgtap-1441-operator-report'
  )
$$, 'an operator audits its own report export on the tenant pool');
select is(
  (select count(*)::integer from audit_events where id='b1441000-0000-4000-8000-0000000000a1'),
  1, 'an operator reads another user''s audit row on its assisted account');
reset role;

-- 2b. The administrator, as the application signs it.
select pg_temp.sign_claims(
  '["commerce_admin","internal_operator","finance_approver","legal_approver","destructive_action_approver"]',
  '["10000000-0000-4000-8000-000000000002"]');
set local role clockwork_runtime;
set local search_path = public, extensions;
select lives_ok($$
  insert into report_exports (id, requested_by, report, parameters, status)
  values ('b1441000-0000-4000-8000-000000000004',
    '20000000-0000-4000-8000-000000000001','weekly_scorecard','{}','pending')
$$, 'the administrator requests a report export');
select lives_ok($$
  insert into audit_events (
    id, account_id, aggregate_type, aggregate_id, aggregate_version,
    event_type, event_version, actor, occurred_at, request_id
  ) values (
    'b1441000-0000-4000-8000-0000000000b2', null,'report_export',
    'b1441000-0000-4000-8000-000000000002',1,'core.reports.create',1,
    '{"kind":"user","id":"20000000-0000-4000-8000-000000000001"}',
    clock_timestamp(),'pgtap-1441-admin-report'
  )
$$, 'the administrator audits its own report export, as an operator does');
select lives_ok($$
  insert into outbox_messages (id, event_id, topic, payload)
  values ('b1441000-0000-4000-8000-0000000000c2',
    'b1441000-0000-4000-8000-0000000000b2','core.reports.create',
    jsonb_build_object(
      'eventId','b1441000-0000-4000-8000-0000000000b2',
      'eventType','core.reports.create','aggregateType','report_export',
      'aggregateId','b1441000-0000-4000-8000-000000000002',
      'requestId','pgtap-1441-admin-report'))
$$, 'the administrator queues the export it audited');
select is(
  (select count(*)::integer from audit_events where id='b1441000-0000-4000-8000-0000000000a1'),
  1, 'the administrator reads another user''s audit row on its assisted account');
select lives_ok($$
  insert into audit_events (
    account_id, aggregate_type, aggregate_id, aggregate_version,
    event_type, event_version, actor, occurred_at, request_id
  ) values (
    '10000000-0000-4000-8000-000000000002','order',
    'b1441000-0000-4000-8000-0000000000a3',1,'core.orders.update',1,
    '{"kind":"user","id":"20000000-0000-4000-8000-000000000001"}',
    clock_timestamp(),'pgtap-1441-admin-order'
  )
$$, 'the administrator audits ordinary work on its assisted account');
-- Finance work the role was added for.
select lives_ok($$
  insert into audit_events (
    account_id, aggregate_type, aggregate_id, aggregate_version,
    event_type, event_version, actor, occurred_at, request_id
  ) values (
    '10000000-0000-4000-8000-000000000002','commission_accrual',
    'b1441000-0000-4000-8000-0000000000a4',1,'core.commissions.accrue',1,
    '{"kind":"user","id":"20000000-0000-4000-8000-000000000001"}',
    clock_timestamp(),'pgtap-1441-admin-accrual'
  )
$$, 'the administrator audits a commission accrual');
select lives_ok($$
  insert into audit_events (
    account_id, aggregate_type, aggregate_id, aggregate_version,
    event_type, event_version, actor, occurred_at, request_id
  ) values (
    null,'invoice','b1441000-0000-4000-8000-0000000000a5',1,
    'core.invoices.void',1,
    '{"kind":"user","id":"20000000-0000-4000-8000-000000000001"}',
    clock_timestamp(),'pgtap-1441-admin-invoice'
  )
$$, 'the administrator audits a finance aggregate outside its accounts');
-- Attribution is not traded away.
select throws_ok($$
  insert into audit_events (
    account_id, aggregate_type, aggregate_id, aggregate_version,
    event_type, event_version, actor, occurred_at, request_id
  ) values (
    '10000000-0000-4000-8000-000000000002','order',
    'b1441000-0000-4000-8000-0000000000a6',1,'core.orders.update',1,
    '{"kind":"user","id":"20000000-0000-4000-8000-000000000006"}',
    clock_timestamp(),'pgtap-1441-admin-forged'
  )
$$, '42501', null, 'the administrator cannot audit under another user''s name');
select throws_ok($$
  insert into audit_events (
    account_id, aggregate_type, aggregate_id, aggregate_version,
    event_type, event_version, actor, occurred_at, request_id
  ) values (
    null,'report_export','b1441000-0000-4000-8000-000000000003',1,
    'core.reports.create',1,
    '{"kind":"user","id":"20000000-0000-4000-8000-000000000006"}',
    clock_timestamp(),'pgtap-1441-admin-forged-report'
  )
$$, '42501', null, 'nor attribute a report export to someone else');
reset role;

-- 2c. A pure finance approver is confined exactly as before.
select pg_temp.sign_claims('["finance_approver"]', '["10000000-0000-4000-8000-000000000002"]');
set local role clockwork_runtime;
set local search_path = public, extensions;
select throws_ok($$
  insert into audit_events (
    account_id, aggregate_type, aggregate_id, aggregate_version,
    event_type, event_version, actor, occurred_at, request_id
  ) values (
    null,'report_export','b1441000-0000-4000-8000-000000000003',1,
    'core.reports.create',1,
    '{"kind":"user","id":"20000000-0000-4000-8000-000000000001"}',
    clock_timestamp(),'pgtap-1441-finance-report'
  )
$$, '42501', null, 'a finance approver cannot audit a report export on the tenant pool');
select is(
  (select count(*)::integer from audit_events where id='b1441000-0000-4000-8000-0000000000a1'),
  0, 'a finance approver does not read another user''s ordinary audit row');
select throws_ok($$
  insert into audit_events (
    account_id, aggregate_type, aggregate_id, aggregate_version,
    event_type, event_version, actor, occurred_at, request_id
  ) values (
    '10000000-0000-4000-8000-000000000002','order',
    'b1441000-0000-4000-8000-0000000000a7',1,'core.orders.update',1,
    '{"kind":"user","id":"20000000-0000-4000-8000-000000000006"}',
    clock_timestamp(),'pgtap-1441-finance-forged'
  )
$$, '42501', null, 'a finance approver cannot audit under another user''s name');
reset role;

-- =========================================================================
-- 3. A verified MFA receipt marks the authenticator enrolled, once.
-- =========================================================================
insert into commerce_users (id, workos_user_id, email, name, is_internal_staff, mfa_enrolled)
values ('b1441000-0000-4000-8000-0000000000d1','user_pgtap_1441_mfa',
        'mfa-1441@fil.one','MFA staff',true,false);
set local role clockwork_service;
insert into experience_mfa_receipts
  (challenge_id, session_id, workos_user_id, workos_organization_id, factor_id)
values ('challenge-1441-a','session-1441','user_pgtap_1441_mfa','org_1441','factor-1441');
reset role;
select ok(
  (select mfa_enrolled from commerce_users where id='b1441000-0000-4000-8000-0000000000d1'),
  'a verified receipt marks the authenticator enrolled');
select is(
  (select count(*)::integer from audit_events
   where aggregate_id='b1441000-0000-4000-8000-0000000000d1'
     and event_type='identity.mfa_enrolled' and after->>'mfaEnrolled'='true'),
  1, 'the enrollment is audited');
select is(
  (select count(*)::integer from outbox_messages message
   join audit_events event on event.id = message.event_id
   where event.aggregate_id='b1441000-0000-4000-8000-0000000000d1'),
  1, 'the enrollment is queued');
set local role clockwork_service;
insert into experience_mfa_receipts
  (challenge_id, session_id, workos_user_id, workos_organization_id, factor_id)
values ('challenge-1441-b','session-1441b','user_pgtap_1441_mfa','org_1441','factor-1441');
reset role;
select is(
  (select count(*)::integer from audit_events
   where aggregate_id='b1441000-0000-4000-8000-0000000000d1'
     and event_type='identity.mfa_enrolled'),
  1, 'a later receipt records nothing new');
set local role clockwork_service;
insert into experience_mfa_receipts
  (challenge_id, session_id, workos_user_id, workos_organization_id, factor_id)
values ('challenge-1441-c','session-1441c','user_nobody_1441','org_1441','factor-1441');
reset role;
select is(
  (select count(*)::integer from audit_events where request_id='mfa-receipt:challenge-1441-c'),
  0, 'a receipt for no commerce user changes nothing');
select ok(
  not has_function_privilege('clockwork_service','public.mark_mfa_enrolled(text,text,timestamptz)','EXECUTE')
  and not has_function_privilege('clockwork_runtime','public.mark_mfa_enrolled(text,text,timestamptz)','EXECUTE'),
  'no runtime role can mark itself enrolled directly');

-- =========================================================================
-- 4. Only James is promoted, and only in a Fil One staff organization.
-- =========================================================================
insert into accounts (id, legal_name, relationship_roles, registered_address,
  billing_contact, ap_contact, invoice_delivery_email, domain, country, currency)
values ('b1441000-0000-4000-8000-0000000000e1','Fil One LLC',array['direct_client'],
  '{"line1":"1 Main St","city":"Wilmington","region":"DE","postalCode":"19801","country":"US"}',
  '{"name":"Billing","email":"billing@fil.one"}','{"name":"AP","email":"ap@fil.one"}',
  'billing@fil.one','fil.one','US','USD'),
  ('b1441000-0000-4000-8000-0000000000e2','Other Co',array['direct_client'],
  '{"line1":"1 Main St","city":"Wilmington","region":"DE","postalCode":"19801","country":"US"}',
  '{"name":"Billing","email":"billing@other.test"}','{"name":"AP","email":"ap@other.test"}',
  'billing@other.test','other.test','US','USD');
insert into organizations (id, account_id, name, workos_organization_id) values
  ('b1441000-0000-4000-8000-0000000000f1','b1441000-0000-4000-8000-0000000000e1',
   'Fil One LLC','org_01M21RDQDM5NHYD4CEHWJZFG3J'),
  ('b1441000-0000-4000-8000-0000000000f2','b1441000-0000-4000-8000-0000000000e2',
   'Other Co','org_1441_other');
insert into commerce_users (id, workos_user_id, email, name, is_internal_staff) values
  ('b1441000-0000-4000-8000-000000000101','user_1441_james','James@fil.one','James Kurz',true),
  ('b1441000-0000-4000-8000-000000000102','user_1441_rw','rw@fil.one','R.W. Holleman',true),
  ('b1441000-0000-4000-8000-000000000103','user_1441_seller','seller-1441@fil.one','Seller',true);
insert into memberships (id, organization_id, user_id, role) values
  ('b1441000-0000-4000-8000-000000000201','b1441000-0000-4000-8000-0000000000f1',
   'b1441000-0000-4000-8000-000000000101','internal_operator'),
  ('b1441000-0000-4000-8000-000000000202','b1441000-0000-4000-8000-0000000000f1',
   'b1441000-0000-4000-8000-000000000102','internal_operator'),
  ('b1441000-0000-4000-8000-000000000203','b1441000-0000-4000-8000-0000000000f1',
   'b1441000-0000-4000-8000-000000000103','revenue');

select is(private.promote_first_commerce_admin(), 1, 'one membership is promoted');
select is(
  (select role from memberships where id='b1441000-0000-4000-8000-000000000201'),
  'commerce_admin', 'James becomes the commerce administrator');
select is(
  (select role from memberships where id='b1441000-0000-4000-8000-000000000202'),
  'internal_operator', 'a second operator in the staff organization is not promoted');
select is(
  (select role from memberships where id='b1441000-0000-4000-8000-000000000203'),
  'revenue', 'a seller is not promoted');
select is(
  (select jsonb_build_object('actor', actor->>'kind', 'account', account_id,
     'aggregate', aggregate_type)
   from audit_events
   where aggregate_id='b1441000-0000-4000-8000-000000000201'
     and event_type='staff.role_changed'),
  '{"actor":"system","account":null,"aggregate":"membership"}'::jsonb,
  'the promotion is audited against the membership by the migration');
select is(
  (select jsonb_build_object('before',event.before,'after',event.after,
     'data',message.payload->'data','topic',message.topic)
   from audit_events event join outbox_messages message on message.event_id=event.id
   where event.aggregate_id='b1441000-0000-4000-8000-000000000201'),
  jsonb_build_object(
    'before','{"email":"James@fil.one","role":"internal_operator"}'::jsonb,
    'after','{"email":"James@fil.one","role":"commerce_admin"}'::jsonb,
    'data','{"email":"James@fil.one","role":"commerce_admin"}'::jsonb,
    'topic','staff.role_changed'),
  'the promotion is queued with the audited change');
select is(private.promote_first_commerce_admin(), 0, 'a second run promotes nobody');

-- James as an operator anywhere else is left alone.
update organizations set workos_organization_id='org_1441_moved'
where id='b1441000-0000-4000-8000-0000000000f1';
update memberships set role='internal_operator'
where id='b1441000-0000-4000-8000-000000000201';
select is(private.promote_first_commerce_admin(), 0,
  'outside the Fil One staff organizations nobody is promoted');
select ok(
  not has_function_privilege('clockwork_service','private.promote_first_commerce_admin()','EXECUTE'),
  'the promotion is not callable at runtime');

select * from finish();
rollback;
