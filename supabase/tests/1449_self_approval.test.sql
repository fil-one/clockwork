-- Self-approval on the two-person controls (001449): a holder of
-- approval:self (the commerce administrator) may decide their own request with
-- a reason; the row records it, an audit event is written and every other
-- commerce administrator gets a notice. Everyone else keeps the
-- distinct-approver rule exactly.
begin;
select plan(58);
set local search_path = public, extensions;

-- Fixture: two commerce administrators (Ada, Ben) and a finance approver
-- (Cy) in the Fil One staff organization 30..08.
insert into commerce_users (id, workos_user_id, email, name, is_internal_staff, mfa_enrolled) values
  ('a1449000-0000-4000-8000-000000000001','pgtap_1449_ada','ada@fil-one.test','Ada Admin',true,true),
  ('a1449000-0000-4000-8000-000000000002','pgtap_1449_ben','ben@fil-one.test','Ben Admin',true,true),
  ('a1449000-0000-4000-8000-000000000003','pgtap_1449_cy','cy@fil-one.test','Cy Finance',true,true);
insert into memberships (organization_id, user_id, role) values
  ('30000000-0000-4000-8000-000000000008','a1449000-0000-4000-8000-000000000001','commerce_admin'),
  ('30000000-0000-4000-8000-000000000008','a1449000-0000-4000-8000-000000000002','commerce_admin'),
  ('30000000-0000-4000-8000-000000000008','a1449000-0000-4000-8000-000000000003','finance_approver');

create function pg_temp.events(subject uuid) returns bigint language sql as $$
  select count(*) from audit_events
  where event_type = 'approval.self_approved'
    and after->>'subjectId' = subject::text
$$;

-- =========================================================================
-- 1. Who holds approval:self.
-- =========================================================================
select is(
  (select array_agg(role order by role) from role_permissions where permission = 'approval:self'),
  array['commerce_admin'],
  'only the commerce administrator holds approval:self');
select ok(member_can_self_approve('a1449000-0000-4000-8000-000000000001'),
  'a commerce administrator enrolled in MFA may approve their own requests');
select ok(not member_can_self_approve('a1449000-0000-4000-8000-000000000003'),
  'a finance approver may not');
update commerce_users set mfa_enrolled = false where id = 'a1449000-0000-4000-8000-000000000002';
select ok(not member_can_self_approve('a1449000-0000-4000-8000-000000000002'),
  'a commerce administrator without MFA enrolment may not');
update commerce_users set mfa_enrolled = true where id = 'a1449000-0000-4000-8000-000000000002';

set local role clockwork_service;

-- =========================================================================
-- 2. approvals: tax rule book activation (and the price book and teardown
--    decisions that share the table).
-- =========================================================================
insert into core_tax_rule_books (
  id, jurisdiction, version, effective_from, authority_reference, subdivision_scope
) values (
  'c1449000-0000-4000-8000-000000000001','PT',1449,'2026-01-01','pgTAP 1449','whole_jurisdiction'
);
insert into core_tax_rates (tax_rule_book_id, tax_code, rate_kind, rate_ppm, legal_basis)
values ('c1449000-0000-4000-8000-000000000001','txcd_demo','standard',230000,'pgTAP 1449');
insert into approvals (id, action, object_type, object_id, requested_by, status, requested_at) values
  ('c1449000-0000-4000-8000-000000000011','tax_rule_book_activation','tax_rule_book',
   'c1449000-0000-4000-8000-000000000001','a1449000-0000-4000-8000-000000000001','pending',now()),
  ('c1449000-0000-4000-8000-000000000012','tax_rule_book_activation','tax_rule_book',
   'c1449000-0000-4000-8000-000000000099','a1449000-0000-4000-8000-000000000003','pending',now());

select throws_ok($$
  update approvals set status = 'approved', approved_by = requested_by, decided_at = now()
  where id = 'c1449000-0000-4000-8000-000000000011'
$$, '23514', null, 'an administrator deciding their own request without the self-approval flag is refused as before');
select throws_ok($$
  update approvals set status = 'approved', approved_by = requested_by, decided_at = now(),
    self_approved = true
  where id = 'c1449000-0000-4000-8000-000000000011'
$$, '23514', null, 'a self-approval without a reason is refused');
select throws_ok($$
  update approvals set status = 'approved', approved_by = requested_by, decided_at = now(),
    self_approved = true, self_approval_reason = 'short'
  where id = 'c1449000-0000-4000-8000-000000000011'
$$, '23514', null, 'a self-approval reason under 8 characters is refused');
select throws_ok($$
  update approvals set status = 'approved', approved_by = requested_by, decided_at = now(),
    self_approved = true, self_approval_reason = repeat('x', 501)
  where id = 'c1449000-0000-4000-8000-000000000011'
$$, '23514', null, 'a self-approval reason over 500 characters is refused');
select throws_ok($$
  update approvals set status = 'approved', approved_by = requested_by, decided_at = now(),
    self_approved = true, self_approval_reason = 'Second approver is away this week'
  where id = 'c1449000-0000-4000-8000-000000000012'
$$, '42501', null, 'a finance approver cannot approve their own request, flag or no flag');
select throws_ok($$
  update approvals set status = 'approved', approved_by = 'a1449000-0000-4000-8000-000000000002',
    decided_at = now(), self_approved = true, self_approval_reason = 'Second approver is away this week'
  where id = 'c1449000-0000-4000-8000-000000000012'
$$, '23514', null, 'a self-approval marker on someone else''s request is refused');

select lives_ok($$
  update approvals set status = 'approved', approved_by = requested_by, decided_at = now(),
    self_approved = true, self_approval_reason = '  Second approver is away this week  '
  where id = 'c1449000-0000-4000-8000-000000000011'
$$, 'a commerce administrator approves their own tax rule book request with a reason');
select is(pg_temp.events('c1449000-0000-4000-8000-000000000001'), 1::bigint,
  'the self-approval writes one approval.self_approved event');
select is(
  (select jsonb_build_object('account', account_id, 'aggregate', aggregate_type,
     'actor', actor->>'id', 'control', after->>'control', 'reason', after->>'reason',
     'decision', after->>'decision')
   from audit_events where event_type = 'approval.self_approved'
     and after->>'subjectId' = 'c1449000-0000-4000-8000-000000000001'),
  jsonb_build_object('account', null, 'aggregate', 'self_approval',
    'actor', 'a1449000-0000-4000-8000-000000000001', 'control', 'tax_rule_book_activation',
    'reason', 'Second approver is away this week', 'decision', 'approved'),
  'the event is account-less and names the control, the actor and the trimmed reason');
select is(
  (select count(*) from outbox_messages message join audit_events event on event.id = message.event_id
   where event.event_type = 'approval.self_approved'
     and event.after->>'subjectId' = 'c1449000-0000-4000-8000-000000000001'),
  1::bigint, 'the event has its outbox row, as every audit event does');
select ok(
  exists (select 1 from staff_notices notice join audit_events event on event.id = notice.audit_event_id
    where event.after->>'subjectId' = 'c1449000-0000-4000-8000-000000000001'
      and notice.recipient_user_id = 'a1449000-0000-4000-8000-000000000002'),
  'the other commerce administrator is told');
select ok(
  not exists (select 1 from staff_notices notice join audit_events event on event.id = notice.audit_event_id
    where event.after->>'subjectId' = 'c1449000-0000-4000-8000-000000000001'
      and notice.recipient_user_id in ('a1449000-0000-4000-8000-000000000001',
        'a1449000-0000-4000-8000-000000000003')),
  'the approver and people without staff:manage are not');
select throws_ok($$
  update approvals set self_approval_reason = 'A different reason entirely'
  where id = 'c1449000-0000-4000-8000-000000000011'
$$, '55000', null, 'a recorded self-approval cannot be rewritten');
select throws_ok($$
  update approvals set status = 'rejected'
  where id = 'c1449000-0000-4000-8000-000000000011'
$$, '55000', 'SELF_APPROVAL_IMMUTABLE: a self-approved decision cannot change',
  'a self-approved decision cannot be flipped to a rejection');
select throws_ok($$
  update approvals set requested_by = 'a1449000-0000-4000-8000-000000000002',
    approved_by = 'a1449000-0000-4000-8000-000000000002'
  where id = 'c1449000-0000-4000-8000-000000000011'
$$, '55000', 'SELF_APPROVAL_IMMUTABLE: a self-approved decision cannot change',
  'a self-approved decision cannot be relabelled to another person');
select throws_ok($$
  update approvals set object_id = 'c1449000-0000-4000-8000-000000000098'
  where id = 'c1449000-0000-4000-8000-000000000011'
$$, '55000', 'SELF_APPROVAL_IMMUTABLE: a self-approved decision cannot change',
  'a self-approved decision cannot be moved to another subject');
insert into approvals (id, action, object_type, object_id, requested_by, status, requested_at) values
  ('c1449000-0000-4000-8000-000000000013','tax_rule_book_activation','tax_rule_book',
   'c1449000-0000-4000-8000-000000000097','a1449000-0000-4000-8000-000000000001','pending',now());
select throws_ok($$
  update approvals set status = 'rejected', approved_by = requested_by, decided_at = now(),
    self_approved = true, self_approval_reason = 'Withdrawing my own request'
  where id = 'c1449000-0000-4000-8000-000000000013'
$$, '23514', null, 'a self-approval marker is only ever on an approval, never a rejection');
select lives_ok($$
  update core_tax_rule_books set status = 'active'
  where id = 'c1449000-0000-4000-8000-000000000001'
$$, 'a self-approved tax rule book publishes');

-- A second person still approves as before, with no marker and no event.
select lives_ok($$
  update approvals set status = 'approved', approved_by = 'a1449000-0000-4000-8000-000000000002',
    decided_at = now()
  where id = 'c1449000-0000-4000-8000-000000000012'
$$, 'a second administrator approving someone else''s request needs no reason');
select is(pg_temp.events('c1449000-0000-4000-8000-000000000099'), 0::bigint,
  'and writes no self-approval event');

-- A self-approval whose approver has lost the right no longer publishes.
insert into core_tax_rule_books (
  id, jurisdiction, version, effective_from, authority_reference, subdivision_scope
) values (
  'c1449000-0000-4000-8000-000000000002','PT',1450,'2026-01-01','pgTAP 1449','whole_jurisdiction'
);
insert into core_tax_rates (tax_rule_book_id, tax_code, rate_kind, rate_ppm, legal_basis)
values ('c1449000-0000-4000-8000-000000000002','txcd_demo','standard',230000,'pgTAP 1449');
insert into approvals (action, object_type, object_id, requested_by, approved_by, status,
  requested_at, decided_at, self_approved, self_approval_reason)
values ('tax_rule_book_activation','tax_rule_book','c1449000-0000-4000-8000-000000000002',
  'a1449000-0000-4000-8000-000000000001','a1449000-0000-4000-8000-000000000001','approved',
  now(), now(), true, 'Decided alone while the team is offsite');
reset role;
update memberships set role = 'internal_operator'
where user_id = 'a1449000-0000-4000-8000-000000000001';
set local role clockwork_service;
select throws_ok($$
  update core_tax_rule_books set status = 'active'
  where id = 'c1449000-0000-4000-8000-000000000002'
$$, '55000', null, 'a self-approval stops publishing once its approver no longer holds approval:self');
reset role;
update memberships set role = 'commerce_admin'
where user_id = 'a1449000-0000-4000-8000-000000000001';
set local role clockwork_service;

-- =========================================================================
-- 3. Capability switches.
-- =========================================================================
insert into system_capability_requests (id, capability_key, base_version, enable_recovery,
  requested_by, requested_at, reason, evidence_reference)
select 'c1449000-0000-4000-8000-000000000021', capability_key, row_version, false,
  'a1449000-0000-4000-8000-000000000001', now(), 'Turn on partner sales for pilot', 'TICKET-1449'
from system_capabilities where capability_key = 'partner';
select throws_ok($$
  update system_capability_requests set status = 'approved', decided_by = requested_by,
    decided_at = now(), decision_reason = 'Approving my own switch'
  where id = 'c1449000-0000-4000-8000-000000000021'
$$, '23514', null, 'a switch request still needs a second person without the flag');
select lives_ok($$
  update system_capability_requests set status = 'approved', decided_by = requested_by,
    decided_at = now(), decision_reason = 'Approving my own switch',
    self_approved = true, self_approval_reason = 'Approving my own switch'
  where id = 'c1449000-0000-4000-8000-000000000021'
$$, 'a commerce administrator approves their own switch request');
select is(pg_temp.events('c1449000-0000-4000-8000-000000000021'), 1::bigint,
  'the switch self-approval is audited');
select is(
  (select after->>'control' from audit_events where event_type = 'approval.self_approved'
   and after->>'subjectId' = 'c1449000-0000-4000-8000-000000000021'),
  'capability_activation', 'and names the control');

-- =========================================================================
-- 4. Channel policy and PAYG offers: the approver may not have written or
--    proposed the version, unless it is their own approval.
-- =========================================================================
insert into core_channel_policy_versions (id, terms, created_by, last_edited_by) values (
  'c1449000-0000-4000-8000-000000000031',
  jsonb_build_object('version',1449,'effectiveFrom','2099-01-01','selfServeThresholdTb',100,
    'defaultProtectionDays',90,'maximumProtectionDays',90,'extensionDays',30,
    'maximumExtensions',1,'sourceEvidence','pgTAP 1449 source'),
  'a1449000-0000-4000-8000-000000000001','a1449000-0000-4000-8000-000000000001');
update core_channel_policy_versions set status = 'proposed', row_version = 2,
  proposed_by = 'a1449000-0000-4000-8000-000000000001'
where id = 'c1449000-0000-4000-8000-000000000031';
select throws_ok($$
  update core_channel_policy_versions set status = 'approved', row_version = 3,
    approved_by = 'a1449000-0000-4000-8000-000000000001', approval_evidence = 'Board minutes 1449'
  where id = 'c1449000-0000-4000-8000-000000000031'
$$, '23514', null, 'the author cannot approve a channel policy without the flag');
select throws_ok($$
  update core_channel_policy_versions set status = 'approved', row_version = 3,
    approved_by = 'a1449000-0000-4000-8000-000000000002', approval_evidence = 'Board minutes 1449',
    self_approved = true, self_approval_reason = 'Not my version at all'
  where id = 'c1449000-0000-4000-8000-000000000031'
$$, '23514', null, 'someone else cannot mark a channel policy self-approved');
select lives_ok($$
  update core_channel_policy_versions set status = 'approved', row_version = 3,
    approved_by = 'a1449000-0000-4000-8000-000000000001', approval_evidence = 'Board minutes 1449',
    self_approved = true, self_approval_reason = 'Approved alone; Ben is out'
  where id = 'c1449000-0000-4000-8000-000000000031'
$$, 'the author approves their own channel policy with a reason');
select is(pg_temp.events('c1449000-0000-4000-8000-000000000031'), 1::bigint,
  'the channel policy self-approval is audited');

insert into core_payg_offer_versions (id, sku, region, version, terms, created_by, last_edited_by)
values ('c1449000-0000-4000-8000-000000000041','S3-1449','eu-1449',1,
  jsonb_build_object('sku','S3-1449','region','eu-1449','version',1),
  'a1449000-0000-4000-8000-000000000003','a1449000-0000-4000-8000-000000000003');
update core_payg_offer_versions set status = 'proposed', row_version = 2,
  proposed_by = 'a1449000-0000-4000-8000-000000000003'
where id = 'c1449000-0000-4000-8000-000000000041';
select throws_ok($$
  update core_payg_offer_versions set status = 'approved', row_version = 3,
    approved_by = 'a1449000-0000-4000-8000-000000000003', approval_evidence_id = 'DOC-1449',
    self_approved = true, self_approval_reason = 'Finance approving alone'
  where id = 'c1449000-0000-4000-8000-000000000041'
$$, '42501', null, 'a finance approver cannot approve their own PAYG offer');
select lives_ok($$
  update core_payg_offer_versions set status = 'approved', row_version = 3,
    approved_by = 'a1449000-0000-4000-8000-000000000002', approval_evidence_id = 'DOC-1449'
  where id = 'c1449000-0000-4000-8000-000000000041'
$$, 'a second person approves it as before');
insert into core_payg_offer_versions (id, sku, region, version, terms, created_by, last_edited_by)
values ('c1449000-0000-4000-8000-000000000042','S3-1449','eu-1449',2,
  jsonb_build_object('sku','S3-1449','region','eu-1449','version',2),
  'a1449000-0000-4000-8000-000000000002','a1449000-0000-4000-8000-000000000002');
update core_payg_offer_versions set status = 'proposed', row_version = 2,
  proposed_by = 'a1449000-0000-4000-8000-000000000002'
where id = 'c1449000-0000-4000-8000-000000000042';
select lives_ok($$
  update core_payg_offer_versions set status = 'approved', row_version = 3,
    approved_by = 'a1449000-0000-4000-8000-000000000002', approval_evidence_id = 'DOC-1450',
    self_approved = true, self_approval_reason = 'Launch day, approving my own offer'
  where id = 'c1449000-0000-4000-8000-000000000042'
$$, 'a commerce administrator approves their own PAYG offer');
select ok(
  exists (select 1 from staff_notices notice join audit_events event on event.id = notice.audit_event_id
    where event.after->>'subjectId' = 'c1449000-0000-4000-8000-000000000042'
      and notice.recipient_user_id = 'a1449000-0000-4000-8000-000000000001'),
  'and Ada hears about Ben''s self-approval');
select throws_ok($$
  update core_payg_offer_versions set status = 'retired', row_version = 4,
    self_approval_reason = 'Changed the reason later'
  where id = 'c1449000-0000-4000-8000-000000000042'
$$, '55000', null, 'the marker and reason stay fixed when the offer retires');

-- =========================================================================
-- 5. Exception decisions (below-floor pricing included).
-- =========================================================================
insert into exception_cases (id, account_id, queue, object_type, object_id, owner_user_id,
  requester_user_id, target_at, status)
values ('c1449000-0000-4000-8000-000000000051','10000000-0000-4000-8000-000000000001','pricing',
  'quote','c1449000-0000-4000-8000-000000000052','a1449000-0000-4000-8000-000000000002',
  'a1449000-0000-4000-8000-000000000001', now() + interval '1 day','open');
select throws_ok($$
  update exception_cases set status = 'rejected', self_approved = true,
    self_approval_reason = 'Rejecting my own case'
  where id = 'c1449000-0000-4000-8000-000000000051'
$$, '23514', null, 'only an approval can be self-approved');
select lives_ok($$
  update exception_cases set status = 'approved', decision_reason = 'Below floor for pilot',
    self_approved = true, self_approval_reason = 'Below floor for pilot'
  where id = 'c1449000-0000-4000-8000-000000000051'
$$, 'the requester approves their own pricing exception');
select is(pg_temp.events('c1449000-0000-4000-8000-000000000051'), 1::bigint,
  'the exception self-approval is audited');
select throws_ok($$
  update exception_cases set requester_user_id = 'a1449000-0000-4000-8000-000000000002'
  where id = 'c1449000-0000-4000-8000-000000000051'
$$, '55000', 'SELF_APPROVAL_IMMUTABLE: a self-approved case cannot change hands',
  'the requester of a self-approved case cannot be relabelled');

-- =========================================================================
-- 6. Terminations and teardown: one self-approval fills both slots.
-- =========================================================================
reset role;
insert into terminations (id, account_id, order_id, effective_at, final_billing_status, teardown_status)
values ('c1449000-0000-4000-8000-000000000061','10000000-0000-4000-8000-000000000001',
  '80000000-0000-4000-8000-000000000001','2027-01-01T00:00:00Z','settled','retrieval_window');
insert into lifecycle_offboarding_plans (termination_id, account_id, organization_id, requested_by, reason, plan)
values ('c1449000-0000-4000-8000-000000000061','10000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001','a1449000-0000-4000-8000-000000000001','customer_request',
  jsonb_build_object('terminationId','c1449000-0000-4000-8000-000000000061',
    'accountId','10000000-0000-4000-8000-000000000001',
    'orderId','80000000-0000-4000-8000-000000000001',
    'organizationId','30000000-0000-4000-8000-000000000001','reason','customer_request',
    'requestedBy','a1449000-0000-4000-8000-000000000001','finalBillingStatus','settled',
    'status','retrieval_window','lockedExclusions',jsonb_build_array(),
    'approvals',jsonb_build_array(),
    'teardownOperationId',null,'teardownConfirmedAt',null));
set local role clockwork_service;
insert into approvals (id, account_id, action, object_type, object_id, requested_by, approved_by,
  status, requested_at, decided_at, self_approved, self_approval_reason)
values ('c1449000-0000-4000-8000-000000000062','10000000-0000-4000-8000-000000000001',
  'termination_teardown','termination','c1449000-0000-4000-8000-000000000061',
  'a1449000-0000-4000-8000-000000000001','a1449000-0000-4000-8000-000000000001','approved',
  now(), now(), true, 'Customer asked twice; closing it myself');
select is(pg_temp.events('c1449000-0000-4000-8000-000000000061'), 1::bigint,
  'the termination self-approval is audited once');

create function pg_temp.entry(self boolean) returns jsonb language sql as $$
  select jsonb_build_object('approvalId','c1449000-0000-4000-8000-000000000062',
    'approverId','a1449000-0000-4000-8000-000000000001','decision','approved',
    'reason','Customer asked twice; closing it myself') ||
    case when self then jsonb_build_object('selfApproved', true) else '{}'::jsonb end
$$;
select throws_ok($$
  update lifecycle_offboarding_plans set row_version = row_version + 1,
    plan = plan || jsonb_build_object('status','ready_for_teardown',
      'approvals', jsonb_build_array(pg_temp.entry(false), pg_temp.entry(false)))
  where termination_id = 'c1449000-0000-4000-8000-000000000061'
$$, '23514', null, 'the requester''s approval must be marked self-approved');
select throws_ok($$
  update lifecycle_offboarding_plans set row_version = row_version + 1,
    plan = plan || jsonb_build_object('status','ready_for_teardown',
      'approvals', jsonb_build_array(pg_temp.entry(true)))
  where termination_id = 'c1449000-0000-4000-8000-000000000061'
$$, '23514', null, 'one entry alone does not make two approvals');
select lives_ok($$
  update lifecycle_offboarding_plans set row_version = row_version + 1,
    plan = plan || jsonb_build_object('status','ready_for_teardown',
      'approvals', jsonb_build_array(pg_temp.entry(true), pg_temp.entry(true)))
  where termination_id = 'c1449000-0000-4000-8000-000000000061'
$$, 'one self-approval fills both approver slots and readies teardown');
select is(
  (select jsonb_path_query_array(plan, '$.approvals[*].selfApproved') from lifecycle_offboarding_plans
   where termination_id = 'c1449000-0000-4000-8000-000000000061'),
  '[true, true]'::jsonb, 'both slots are recorded as self-approved');

-- Teardown is requested only while the self-approver still may.
reset role;
update memberships set role = 'internal_operator'
where user_id = 'a1449000-0000-4000-8000-000000000001';
set local role clockwork_service;
select throws_ok($$
  update lifecycle_offboarding_plans set row_version = row_version + 1,
    plan = plan || jsonb_build_object('status','teardown_requested')
  where termination_id = 'c1449000-0000-4000-8000-000000000061'
$$, '42501',
  'TEARDOWN_SELF_APPROVAL_REVOKED: the self-approver no longer holds approval:self; obtain a new approval',
  'teardown fails closed once the self-approver loses approval:self');
reset role;
update memberships set role = 'commerce_admin'
where user_id = 'a1449000-0000-4000-8000-000000000001';

-- Before final billing settles a self-approval fills one slot and the plan
-- waits in pending approval; the requester fills the other once it settles.
insert into terminations (id, account_id, order_id, effective_at, final_billing_status, teardown_status)
values ('c1449000-0000-4000-8000-000000000063','10000000-0000-4000-8000-000000000001',
  '80000000-0000-4000-8000-000000000001','2027-01-01T00:00:00Z','pending','pending_final_billing');
insert into lifecycle_offboarding_plans (termination_id, account_id, organization_id, requested_by, reason, plan)
values ('c1449000-0000-4000-8000-000000000063','10000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001','a1449000-0000-4000-8000-000000000001','customer_request',
  jsonb_build_object('terminationId','c1449000-0000-4000-8000-000000000063',
    'accountId','10000000-0000-4000-8000-000000000001',
    'orderId','80000000-0000-4000-8000-000000000001',
    'organizationId','30000000-0000-4000-8000-000000000001','reason','customer_request',
    'requestedBy','a1449000-0000-4000-8000-000000000001','finalBillingStatus','pending',
    'status','pending_final_billing','lockedExclusions',jsonb_build_array(),
    'approvals',jsonb_build_array(),'teardownOperationId',null,'teardownConfirmedAt',null));
set local role clockwork_service;
insert into approvals (id, account_id, action, object_type, object_id, requested_by, approved_by,
  status, requested_at, decided_at, self_approved, self_approval_reason)
values
  ('c1449000-0000-4000-8000-000000000064','10000000-0000-4000-8000-000000000001',
   'termination_teardown','termination','c1449000-0000-4000-8000-000000000063',
   'a1449000-0000-4000-8000-000000000001','a1449000-0000-4000-8000-000000000001','approved',
   now(), now(), true, 'Approving now; billing still closing'),
  ('c1449000-0000-4000-8000-000000000065','10000000-0000-4000-8000-000000000001',
   'termination_teardown','termination','c1449000-0000-4000-8000-000000000063',
   'a1449000-0000-4000-8000-000000000001','a1449000-0000-4000-8000-000000000001','approved',
   now(), now(), true, 'Billing settled; second slot');
create function pg_temp.self_entry(approval uuid) returns jsonb language sql as $$
  select jsonb_build_object('approvalId', approval,
    'approverId','a1449000-0000-4000-8000-000000000001','decision','approved',
    'reason','Approving my own termination','selfApproved', true)
$$;
select lives_ok($$
  update lifecycle_offboarding_plans set row_version = row_version + 1,
    plan = plan || jsonb_build_object('status','pending_approval',
      'approvals', jsonb_build_array(pg_temp.self_entry('c1449000-0000-4000-8000-000000000064')))
  where termination_id = 'c1449000-0000-4000-8000-000000000063'
$$, 'before billing settles a self-approval fills one slot and waits in pending approval');
select throws_ok($$
  update lifecycle_offboarding_plans set row_version = row_version + 1,
    plan = plan || jsonb_build_object('status','ready_for_teardown',
      'approvals', jsonb_build_array(pg_temp.self_entry('c1449000-0000-4000-8000-000000000064'),
        pg_temp.self_entry('c1449000-0000-4000-8000-000000000065')))
  where termination_id = 'c1449000-0000-4000-8000-000000000063'
$$, '23514', null, 'teardown stays unready while final billing is unsettled');
select lives_ok($$
  update lifecycle_offboarding_plans set row_version = row_version + 1,
    plan = plan || jsonb_build_object('status','ready_for_teardown','finalBillingStatus','settled',
      'approvals', jsonb_build_array(pg_temp.self_entry('c1449000-0000-4000-8000-000000000064'),
        pg_temp.self_entry('c1449000-0000-4000-8000-000000000065')))
  where termination_id = 'c1449000-0000-4000-8000-000000000063'
$$, 'once billing settles the requester fills the second slot');

-- A non-holder's own teardown approval stays refused at the approval itself.
select throws_ok($$
  insert into approvals (account_id, action, object_type, object_id, requested_by, approved_by,
    status, requested_at, decided_at, self_approved, self_approval_reason)
  values ('10000000-0000-4000-8000-000000000001','termination_teardown','termination',
    '93600000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000002','approved', now(), now(), true,
    'Customer closing their own account')
$$, '42501', null, 'a customer cannot self-approve a termination');

-- =========================================================================
-- 7. The tenant pool can neither record a self-approval nor forge its event.
-- =========================================================================
reset role;
create function pg_temp.sign() returns void language plpgsql as $$
begin
  perform set_config('app.authorization_context', jsonb_build_object(
    'userId','a1449000-0000-4000-8000-000000000001','accountIds',jsonb_build_array(),
    'roles',jsonb_build_array('commerce_admin'),
    'permissions',jsonb_build_array('operations:read','approval:self','audit:append'),
    'side','fil_one','isInternalStaff',true,'requestId','pgtap-1449',
    'expiresAt',(clock_timestamp() + interval '5 minutes')::text)::text, true);
  perform set_config('app.authorization_signature', encode(extensions.hmac(
    current_setting('app.authorization_context'),
    (select secret from private.authorization_secrets where active
     order by created_at desc limit 1), 'sha256'),'hex'), true);
end $$;
select ok(exists (
  select 1 from pg_policies
  where schemaname = 'public' and tablename = 'audit_events'
    and policyname = 'audit_events_self_approval_service_only'
    and permissive = 'RESTRICTIVE' and cmd = 'INSERT'
    and roles @> array['clockwork_runtime']::name[]
), 'audit_events_self_approval_service_only restricts tenant inserts');
select pg_temp.sign();
set local role clockwork_runtime;
select throws_ok($$
  insert into audit_events (account_id, aggregate_type, aggregate_id, aggregate_version,
    event_type, event_version, actor, occurred_at, request_id, after)
  values (null, 'self_approval', gen_random_uuid(), 1, 'approval.self_approved', 1,
    '{"kind":"user","id":"a1449000-0000-4000-8000-000000000001"}', now(), 'pgtap', '{}')
$$, '42501', null, 'a tenant session cannot write a self-approval event');
reset role;
-- The same row with another event type is admitted, so the refusal above is
-- this policy's, not a missing account grant.
create function pg_temp.sign_account() returns void language plpgsql as $$
begin
  perform set_config('app.authorization_context', jsonb_build_object(
    'userId','a1449000-0000-4000-8000-000000000001',
    'accountIds',jsonb_build_array('10000000-0000-4000-8000-000000000001'),
    'roles',jsonb_build_array('commerce_admin'),
    'permissions',jsonb_build_array('account:write','operations:read','approval:self',
      'audit:read','audit:append'),
    'side','fil_one','isInternalStaff',true,'requestId','pgtap-1449',
    'expiresAt',(clock_timestamp() + interval '5 minutes')::text)::text, true);
  perform set_config('app.authorization_signature', encode(extensions.hmac(
    current_setting('app.authorization_context'),
    (select secret from private.authorization_secrets where active
     order by created_at desc limit 1), 'sha256'),'hex'), true);
end $$;
select pg_temp.sign_account();
set local role clockwork_runtime;
select lives_ok($$
  insert into audit_events (account_id, aggregate_type, aggregate_id, aggregate_version,
    event_type, event_version, actor, occurred_at, request_id, after)
  values ('10000000-0000-4000-8000-000000000001', 'account', gen_random_uuid(), 1,
    'pgtap.self_approval_control', 1,
    '{"kind":"user","id":"a1449000-0000-4000-8000-000000000001"}', now(), 'pgtap', '{}')
$$, 'the tenant session may write an ordinary event on its own account');
select throws_ok($$
  insert into audit_events (account_id, aggregate_type, aggregate_id, aggregate_version,
    event_type, event_version, actor, occurred_at, request_id, after)
  values ('10000000-0000-4000-8000-000000000001', 'account', gen_random_uuid(), 1,
    'approval.self_approved', 1,
    '{"kind":"user","id":"a1449000-0000-4000-8000-000000000001"}', now(), 'pgtap', '{}')
$$, '42501', null, 'but not the same row as a self-approval event');
reset role;
-- Even reached directly, the recorder refuses the tenant pool by name.
grant usage on schema private to clockwork_runtime;
grant execute on function private.record_self_approval(text, text, uuid, uuid, text, text)
  to clockwork_runtime;
set local role clockwork_runtime;
select throws_ok($$
  select private.record_self_approval('price_book_activation','price_book',
    gen_random_uuid(),'a1449000-0000-4000-8000-000000000001','Recorded from a tenant','approved')
$$, '42501', 'SELF_APPROVAL_SERVICE_ONLY: a self-approval is recorded on the service pool only',
  'the recorder refuses the tenant pool');
reset role;

-- =========================================================================
-- 8. Price book schedules may rest on a self-approved decision.
-- =========================================================================
set local role clockwork_service;
insert into price_books (id, name, currency, effective_from, status, version)
values ('c1449000-0000-4000-8000-000000000071','Self-approval schedule','USD','2099-01-01','draft',91449);
insert into approvals (id, action, object_type, object_id, requested_by, approved_by, status,
  requested_at, decided_at, self_approved, self_approval_reason)
values ('c1449000-0000-4000-8000-000000000072','price_book_activation','price_book',
  'c1449000-0000-4000-8000-000000000071','a1449000-0000-4000-8000-000000000001',
  'a1449000-0000-4000-8000-000000000001','approved','2026-10-05T10:00:00Z','2026-10-05T10:00:00Z',
  true,'Scheduling my own price book for January');
select lives_ok($$
  insert into core_price_book_schedules (price_book_id, approval_id, currency, effective_from,
    approved_row_version, approved_by, approved_at)
  select id, 'c1449000-0000-4000-8000-000000000072', currency, effective_from, row_version,
    'a1449000-0000-4000-8000-000000000001', '2026-10-05T10:00:00Z'
  from price_books where id = 'c1449000-0000-4000-8000-000000000071'
$$, 'a price book schedule may rest on a self-approved decision');
reset role;

select * from finish();
rollback;
