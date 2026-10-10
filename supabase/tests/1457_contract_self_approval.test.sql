-- Self-approval on template contract approval (001457): a holder of
-- approval:self may approve a contract they prepared, with a reason and the
-- `self_approved` marker; the database audits it and notifies the other
-- commerce administrators. Without the marker the preparer still cannot
-- approve.
begin;
select plan(17);
set local search_path = public, extensions;

-- Fixture: two commerce administrators (Ada, Ben) and a finance approver
-- (Cy) in the Fil One staff organization 30..08; one contract prepared by Ada
-- and one by Cy.
insert into commerce_users (id, workos_user_id, email, name, is_internal_staff, mfa_enrolled) values
  ('a1457000-0000-4000-8000-000000000001','pgtap_1457_ada','ada-1457@fil-one.test','Ada Admin',true,true),
  ('a1457000-0000-4000-8000-000000000002','pgtap_1457_ben','ben-1457@fil-one.test','Ben Admin',true,true),
  ('a1457000-0000-4000-8000-000000000003','pgtap_1457_cy','cy-1457@fil-one.test','Cy Finance',true,true);
insert into memberships (organization_id, user_id, role) values
  ('30000000-0000-4000-8000-000000000008','a1457000-0000-4000-8000-000000000001','commerce_admin'),
  ('30000000-0000-4000-8000-000000000008','a1457000-0000-4000-8000-000000000002','commerce_admin'),
  ('30000000-0000-4000-8000-000000000008','a1457000-0000-4000-8000-000000000003','finance_approver');
insert into commerce_contracts (id, counterparty_name, contract_type, paper, status, owner_name, created_by_id, created_by_name) values
  ('c1457000-0000-4000-8000-000000000001','Bluefin','other','ours','draft','Ada','a1457000-0000-4000-8000-000000000001','Ada Admin'),
  ('c1457000-0000-4000-8000-000000000002','Bluefin','other','ours','draft','Cy','a1457000-0000-4000-8000-000000000003','Cy Finance');
insert into commerce_contract_signing (contract_id, template_id, template_version, template_hash, document_name, input,
  counterparty_signer, countersigner, preparer_id, preparer_name, approval_required, approval_state, test_mode) values
  ('c1457000-0000-4000-8000-000000000001','test-fixture','1',repeat('b',64),'Doc','{}','{}','{}',
   'a1457000-0000-4000-8000-000000000001','Ada Admin',true,'pending',true),
  ('c1457000-0000-4000-8000-000000000002','test-fixture','1',repeat('b',64),'Doc','{}','{}','{}',
   'a1457000-0000-4000-8000-000000000003','Cy Finance',true,'pending',true);

create function pg_temp.events(subject uuid) returns bigint language sql as $$
  select count(*) from audit_events
  where event_type = 'approval.self_approved'
    and after->>'subjectId' = subject::text
$$;

-- =========================================================================
-- 1. The table shape.
-- =========================================================================
select ok(not exists (
  select 1 from pg_constraint
  where conrelid = 'public.commerce_contract_signing'::regclass
    and pg_get_constraintdef(oid) = 'CHECK (((approver_id IS NULL) OR (approver_id <> preparer_id)))'
), 'the unnamed two-person constraint from 001443 is gone');
select is(
  (select array_agg(conname::text order by conname) from pg_constraint
   where conrelid = 'public.commerce_contract_signing'::regclass
     and conname in ('commerce_contract_signing_two_person_check',
                     'commerce_contract_signing_self_approval_check')),
  array['commerce_contract_signing_self_approval_check',
        'commerce_contract_signing_two_person_check'],
  'the two-person and self-approval constraints are named');

set local role clockwork_service;

-- =========================================================================
-- 2. Without the marker the preparer still cannot approve.
-- =========================================================================
select throws_ok($$
  update commerce_contract_signing set approval_state = 'approved', approver_id = preparer_id,
    approver_name = 'Ada Admin', decided_at = now()
  where contract_id = 'c1457000-0000-4000-8000-000000000001'
$$, '23514', null, 'a preparer approving without the self-approval marker is refused as before');
select throws_ok($$
  update commerce_contract_signing set self_approval_reason = 'A reason without the marker'
  where contract_id = 'c1457000-0000-4000-8000-000000000001'
$$, '23514', null, 'a reason without the marker is refused');
select throws_ok($$
  update commerce_contract_signing set approval_state = 'approved', approver_id = preparer_id,
    approver_name = 'Ada Admin', decided_at = now(), self_approved = true
  where contract_id = 'c1457000-0000-4000-8000-000000000001'
$$, '23514', null, 'a self-approval without a reason is refused');
select throws_ok($$
  update commerce_contract_signing set approval_state = 'approved', approver_id = preparer_id,
    approver_name = 'Ada Admin', decided_at = now(), self_approved = true,
    self_approval_reason = 'short'
  where contract_id = 'c1457000-0000-4000-8000-000000000001'
$$, '23514', null, 'a self-approval reason under 8 characters is refused');
select throws_ok($$
  update commerce_contract_signing set approval_state = 'rejected', approver_id = preparer_id,
    approver_name = 'Ada Admin', decided_at = now(), rejection_reason = 'No',
    self_approved = true, self_approval_reason = 'Rejecting my own draft'
  where contract_id = 'c1457000-0000-4000-8000-000000000001'
$$, '23514', null, 'the marker goes only with an approval');
select throws_ok($$
  update commerce_contract_signing set approval_state = 'approved',
    approver_id = 'a1457000-0000-4000-8000-000000000001', approver_name = 'Ada Admin',
    decided_at = now(), self_approved = true, self_approval_reason = 'Approving a colleague''s draft'
  where contract_id = 'c1457000-0000-4000-8000-000000000002'
$$, '23514', null, 'the marker goes only with the preparer as approver');
select throws_ok($$
  update commerce_contract_signing set approval_state = 'approved', approver_id = preparer_id,
    approver_name = 'Cy Finance', decided_at = now(), self_approved = true,
    self_approval_reason = 'Approving my own draft today'
  where contract_id = 'c1457000-0000-4000-8000-000000000002'
$$, '42501', 'SELF_APPROVAL_NOT_PERMITTED: only a holder of approval:self may approve their own request',
  'a preparer without approval:self cannot self-approve');
select is(pg_temp.events('c1457000-0000-4000-8000-000000000001')
  + pg_temp.events('c1457000-0000-4000-8000-000000000002'), 0::bigint,
  'no refused attempt leaves an audit event');

-- =========================================================================
-- 3. A holder of approval:self approves their own contract.
-- =========================================================================
select lives_ok($$
  update commerce_contract_signing set approval_state = 'approved', approver_id = preparer_id,
    approver_name = 'Ada Admin', decided_at = now(), self_approved = true,
    self_approval_reason = '  Two-person team, colleague travelling '
  where contract_id = 'c1457000-0000-4000-8000-000000000001'
$$, 'the preparer holding approval:self approves with the marker and a reason');
select is(pg_temp.events('c1457000-0000-4000-8000-000000000001'), 1::bigint,
  'the self-approval writes one approval.self_approved audit event');
select is(
  (select after - 'subjectId' - 'approverId' from audit_events
   where event_type = 'approval.self_approved'
     and after->>'subjectId' = 'c1457000-0000-4000-8000-000000000001'),
  jsonb_build_object('control', 'contract_approval', 'subjectType', 'contract',
    'decision', 'approved', 'reason', 'Two-person team, colleague travelling'),
  'the audit event names the control, the decision and the trimmed reason');
reset role;
select ok(exists (
  select 1 from staff_notices notice join audit_events event on event.id = notice.audit_event_id
  where event.event_type = 'approval.self_approved'
    and event.after->>'subjectId' = 'c1457000-0000-4000-8000-000000000001'
    and notice.recipient_user_id = 'a1457000-0000-4000-8000-000000000002'
), 'the other commerce administrator gets a notice');
select ok(not exists (
  select 1 from staff_notices notice join audit_events event on event.id = notice.audit_event_id
  where event.event_type = 'approval.self_approved'
    and event.after->>'subjectId' = 'c1457000-0000-4000-8000-000000000001'
    and notice.recipient_user_id = 'a1457000-0000-4000-8000-000000000001'
), 'the self-approver gets no notice of their own decision');
set local role clockwork_service;

select throws_ok($$
  update commerce_contract_signing set self_approval_reason = 'A different reason entirely'
  where contract_id = 'c1457000-0000-4000-8000-000000000001'
$$, '55000', 'SELF_APPROVAL_IMMUTABLE: a recorded self-approval cannot change',
  'a recorded self-approval cannot change');
select lives_ok($$
  update commerce_contract_signing set state = 'preparing'
  where contract_id = 'c1457000-0000-4000-8000-000000000001'
$$, 'a self-approved contract may be sent');
reset role;

select * from finish();
rollback;
