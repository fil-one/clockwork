-- Activation: two distinct approvers, enforced in the database, and an
-- append-only record of every publication and signature.
begin;
select plan(14);
set local role clockwork_service;
set local search_path = public, extensions;

select has_table(
  'public', 'core_tax_rule_book_activation_events',
  'every publication and signature decision has somewhere to be recorded'
);

insert into core_tax_rule_books (
  id, jurisdiction, version, effective_from, authority_reference, subdivision_scope
) values (
  'cc100000-0000-4000-8000-000000000001','PT',1,'2026-01-01','pgTAP fixture','whole_jurisdiction'
);
insert into core_tax_rates (tax_rule_book_id, tax_code, rate_kind, rate_ppm, legal_basis)
values ('cc100000-0000-4000-8000-000000000001','txcd_demo','standard',230000,'pgTAP fixture');

-- ACTIVATION REQUIRES TWO DISTINCT APPROVERS. This is the assertion that could
-- not be made about price books: their two-person rule lives only in
-- database-finance.ts:5261-5333, and 1360_price_book_activation.test.sql:26
-- activates a price book from SQL with no approval at all and passes.
select throws_ok($$
  update core_tax_rule_books set status = 'active'
  where id = 'cc100000-0000-4000-8000-000000000001'
$$, '55000', null, 'a rule book cannot be published with no approval at all');

insert into approvals (
  id, action, object_type, object_id, requested_by, status, requested_at
) values (
  'cc200000-0000-4000-8000-000000000001','tax_rule_book_activation','tax_rule_book',
  'cc100000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
  'pending','2026-01-01T00:00:00Z'
);
select throws_ok($$
  update core_tax_rule_books set status = 'active'
  where id = 'cc100000-0000-4000-8000-000000000001'
$$, '55000', null, 'a request awaiting a second person is not an approval');

-- The requester cannot be the approver. approvals_two_person_check (000001:136)
-- is what makes that unrepresentable, so the two controls are shown together.
select throws_ok($$
  update approvals
  set status = 'approved', approved_by = '20000000-0000-4000-8000-000000000001',
      decided_at = '2026-01-01T01:00:00Z'
  where id = 'cc200000-0000-4000-8000-000000000001'
$$, '23514', null, 'the person who requested an activation cannot approve it');

update approvals
set status = 'approved', approved_by = '20000000-0000-4000-8000-000000000002',
    decided_at = '2026-01-01T01:00:00Z'
where id = 'cc200000-0000-4000-8000-000000000001';
select lives_ok($$
  update core_tax_rule_books set status = 'active'
  where id = 'cc100000-0000-4000-8000-000000000001'
$$, 'a second distinct approver publishes the jurisdiction');
select is(
  (select status from core_tax_rule_books where id = 'cc100000-0000-4000-8000-000000000001'),
  'active', 'the jurisdiction is now live'
);

-- Publishing straight to 'retired' would be the same control bypassed by
-- choosing a different target status, because a retired book still answers a
-- back-dated tax point.
insert into core_tax_rule_books (
  id, jurisdiction, version, status, effective_from, effective_to, authority_reference
) values (
  'cc100000-0000-4000-8000-000000000002','MC',1,'draft','2020-01-01','2026-01-01','pgTAP fixture'
);
insert into core_tax_rates (tax_rule_book_id, tax_code, rate_kind, rate_ppm, legal_basis)
values ('cc100000-0000-4000-8000-000000000002','txcd_demo','standard',200000,'pgTAP fixture');
select throws_ok($$
  update core_tax_rule_books set status = 'retired'
  where id = 'cc100000-0000-4000-8000-000000000002'
$$, '55000', null, 'publishing straight to retired needs the same two approvers');

-- A book with no rates determines nothing, and activating it would answer a
-- determination with silence instead of a refusal.
insert into core_tax_rule_books (
  id, jurisdiction, version, effective_from, authority_reference
) values (
  'cc100000-0000-4000-8000-000000000003','SM',1,'2026-01-01','pgTAP fixture'
);
insert into approvals (
  action, object_type, object_id, requested_by, approved_by, status, requested_at, decided_at
) values (
  'tax_rule_book_activation','tax_rule_book','cc100000-0000-4000-8000-000000000003',
  '20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002',
  'approved','2026-01-01T00:00:00Z','2026-01-01T01:00:00Z'
);
select throws_ok($$
  update core_tax_rule_books set status = 'active'
  where id = 'cc100000-0000-4000-8000-000000000003'
$$, '23514', null, 'a rule book with no rates cannot be published');

-- The record of the decision.
insert into core_tax_rule_book_activation_events (
  id, tax_rule_book_id, action, previous_status, resulting_status,
  effective_at, actor_user_id, reason, request_id
) values (
  'cc300000-0000-4000-8000-000000000001','cc100000-0000-4000-8000-000000000001',
  'activate','draft','active','2026-01-01T01:00:00Z',
  '20000000-0000-4000-8000-000000000002','Second approver confirmed the matrix.','pgtap-tax-activation'
);
select throws_ok($$
  update core_tax_rule_book_activation_events set reason = 'rewritten'
  where id = 'cc300000-0000-4000-8000-000000000001'
$$, '55000', null, 'the activation record is append-only');
select throws_ok($$
  insert into core_tax_rule_book_activation_events (
    tax_rule_book_id, action, previous_status, resulting_status,
    effective_at, actor_user_id, reason, request_id
  ) values (
    'cc100000-0000-4000-8000-000000000001','publish','draft','active',
    '2026-01-01T01:00:00Z','20000000-0000-4000-8000-000000000002','Unsupported.','pgtap-bad'
  )
$$, '23514', null, 'the recorded action stays within its vocabulary');
select throws_ok($$
  insert into core_tax_rule_book_activation_events (
    tax_rule_book_id, action, previous_status, resulting_status,
    effective_at, actor_user_id, reason, request_id
  ) values (
    'cc100000-0000-4000-8000-000000000001','sign','active','active',
    '2026-02-01T00:00:00Z','20000000-0000-4000-8000-000000000002','Signed.','pgtap-sign'
  )
$$, '23514', null, 'a signature decision must say what the provenance became');
select lives_ok($$
  insert into core_tax_rule_book_activation_events (
    tax_rule_book_id, action, previous_status, resulting_status,
    previous_provenance, resulting_provenance,
    effective_at, actor_user_id, reason, request_id
  ) values (
    'cc100000-0000-4000-8000-000000000001','sign','active','active',
    'repository_fixture','live_signed',
    '2026-02-01T00:00:00Z','20000000-0000-4000-8000-000000000002',
    'Accountant signed the Portuguese matrix.','pgtap-sign'
  )
$$, 'signing a jurisdiction is recorded on the same timeline as its activation');

-- The seed walks the real flow rather than inserting published rows.
select is(
  (select count(*)::integer from approvals
    where action = 'tax_rule_book_activation' and status = 'approved'
      and approved_by <> requested_by
      and object_id between '97200000-0000-4000-8000-000000000001'::uuid
      and '97200000-0000-4000-8000-000000000014'::uuid),
  14, 'every seeded rule book was published by two distinct people'
);
select is(
  (select count(*)::integer from core_tax_rule_book_activation_events
    where request_id = 'seed-2026-07-31'),
  14, 'every seeded publication left a record with its reason and deciding user'
);

select * from finish();
rollback;
