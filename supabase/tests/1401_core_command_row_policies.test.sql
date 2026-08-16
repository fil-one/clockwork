begin;
select plan(12);
set local search_path = public, extensions;

-- The row-level half of the four core-command defects 001401 closes. The
-- command half -- which is what found all four -- is
-- `packages/db/src/repositories/core/core-command-row-policies.integration.test.ts`.
-- This file states the REFUSED SETS, because an admission asserted without its
-- matching refusal is a widening dressed as a fix.
--
-- Every assertion here was measured against 001400 before it was written.
--
-- Fixture: the seeded direct account 10..01 with owner 20..02, the seeded
-- overdue invoice 90..01 on that account, the seeded distributor quote 70..04
-- (end client 10..04, partner 10..05), internal users 20..01 and 20..06, and
-- the seeded document 40..02.

-- =========================================================================
-- 1. `audit_events_finance_insert_guard` is attribution, not an allowlist.
-- =========================================================================
insert into report_exports (id, requested_by, report, parameters, status)
values
  ('b1401000-0000-4000-8000-000000000001',
   '20000000-0000-4000-8000-000000000001','weekly_scorecard','{}','pending'),
  ('b1401000-0000-4000-8000-000000000002',
   '20000000-0000-4000-8000-000000000006','weekly_scorecard','{}','pending');

select set_config('app.authorization_context', jsonb_build_object(
  'userId','20000000-0000-4000-8000-000000000001',
  'accountIds',jsonb_build_array('10000000-0000-4000-8000-000000000002'),
  'roles',jsonb_build_array('finance_approver'),'isInternalStaff',true,
  'requestId','pgtap-1401-finance',
  'expiresAt',(clock_timestamp() + interval '5 minutes')::text
)::text, true);
select set_config('app.authorization_signature', encode(extensions.hmac(
  current_setting('app.authorization_context'),
  (select secret from private.authorization_secrets where active
   order by created_at desc limit 1),
  'sha256'),'hex'), true);

set local role clockwork_runtime;
set local search_path = public, extensions;

-- `commission_accrual` is not in the allowlist the guard used to carry, and
-- `commissions:accrue` is a command `commission_accruals_insert_role_guard`
-- (000900) invites a finance approver to run. Before 001401 this raised 42501.
select lives_ok($$
  insert into audit_events (
    account_id, aggregate_type, aggregate_id, aggregate_version,
    event_type, event_version, actor, occurred_at, request_id
  ) values (
    '10000000-0000-4000-8000-000000000002','commission_accrual',
    'b1401000-0000-4000-8000-000000000011',1,'core.commissions.accrue',1,
    '{"kind":"user","id":"20000000-0000-4000-8000-000000000001"}',
    clock_timestamp(),'pgtap-1401-accrual'
  )
$$, 'a finance approver can audit a commission accrual');

-- THE REFUSED SET, in full: an audit row a finance approver attributes to
-- somebody else. This is the conjunct the guard was actually protecting and it
-- is unchanged.
select throws_ok($$
  insert into audit_events (
    account_id, aggregate_type, aggregate_id, aggregate_version,
    event_type, event_version, actor, occurred_at, request_id
  ) values (
    '10000000-0000-4000-8000-000000000002','invoice',
    'b1401000-0000-4000-8000-000000000012',1,'core.invoices.create',1,
    '{"kind":"user","id":"20000000-0000-4000-8000-000000000006"}',
    clock_timestamp(),'pgtap-1401-forged'
  )
$$, '42501', null,
  'a finance approver cannot audit under another user''s name');

-- =========================================================================
-- 2. The account-less report-export audit trail.
-- =========================================================================
-- A report export has no account, so `audit_events_insert`
-- (`app_is_internal() or app_has_account(account_id)`) could admit nothing:
-- `app_has_account(null)` is NULL. `reports:create` was dead for every internal
-- caller, not only a finance-approver-only one.
-- The account-less report-export audit trail is NOT admitted on the tenant
-- lane, and must not be. `report_exports` carries no account, so no row policy
-- here can scope it; admitting it through the finance guard would let an
-- account-less row ride a lane meant for a finance approver's own aggregates.
-- `reports` now runs on the INTERNAL pool instead (database-finance.ts), which
-- is the same treatment `commitments`, `price_books` and the internal account
-- commands already get, and `mutateReport` already refuses a non-staff caller
-- in code before the transaction opens.
select throws_ok($$
  insert into audit_events (
    account_id, aggregate_type, aggregate_id, aggregate_version,
    event_type, event_version, actor, occurred_at, request_id
  ) values (
    null,'report_export',
    'b1401000-0000-4000-8000-000000000001',1,'core.reports.create',1,
    '{"kind":"user","id":"20000000-0000-4000-8000-000000000001"}',
    clock_timestamp(),'pgtap-1401-report'
  )
$$, '42501', null,
  'an account-less report export is refused on the tenant lane');

-- Keyed to the persisted `report_exports` row and not to a role: the same
-- caller cannot audit somebody else's export.
select throws_ok($$
  insert into audit_events (
    account_id, aggregate_type, aggregate_id, aggregate_version,
    event_type, event_version, actor, occurred_at, request_id
  ) values (
    null,'report_export','b1401000-0000-4000-8000-000000000002',1,
    'core.reports.create',1,
    '{"kind":"user","id":"20000000-0000-4000-8000-000000000001"}',
    clock_timestamp(),'pgtap-1401-report-foreign'
  )
$$, '42501', null,
  'a caller cannot audit a report export another user requested');

-- The arm added here is exactly one command wide. A `quote` audit row with no
-- account is still refused: `audit_events_insert` needs an account this caller
-- holds and nothing else admits it.
--
-- Deliberately NOT asserted with an `invoice` aggregate, which was the first
-- draft of this test and which passes for a reason worth recording: the
-- permissive `audit_events_finance_insert` (001000) carries no account
-- predicate at all, so an account-less audit row for any of its seven finance
-- aggregates has always been admissible from a finance approver. That is not
-- something 001401 changed and not something this arm widened.
select throws_ok($$
  insert into audit_events (
    account_id, aggregate_type, aggregate_id, aggregate_version,
    event_type, event_version, actor, occurred_at, request_id
  ) values (
    null,'quote','b1401000-0000-4000-8000-000000000013',1,
    'core.quotes.create',1,
    '{"kind":"user","id":"20000000-0000-4000-8000-000000000001"}',
    clock_timestamp(),'pgtap-1401-accountless-quote'
  )
$$, '42501', null,
  'an account-less audit row for any other aggregate is still refused');

-- =========================================================================
-- 3. Collections: the queue is readable, the assignment is not transferable.
-- =========================================================================
reset role;
insert into core_collection_cases (
  id, invoice_id, account_id, owner_user_id, aging_bucket, next_action_at,
  status
) values (
  'b1401000-0000-4000-8000-000000000021',
  '90000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000006','first_threshold',
  clock_timestamp(),'open'
);

select set_config('app.authorization_context', jsonb_build_object(
  'userId','20000000-0000-4000-8000-000000000001',
  'accountIds',jsonb_build_array(),
  'roles',jsonb_build_array('finance_approver'),'isInternalStaff',true,
  'requestId','pgtap-1401-collections',
  'expiresAt',(clock_timestamp() + interval '5 minutes')::text
)::text, true);
select set_config('app.authorization_signature', encode(extensions.hmac(
  current_setting('app.authorization_context'),
  (select secret from private.authorization_secrets where active
   order by created_at desc limit 1),
  'sha256'),'hex'), true);
set local role clockwork_runtime;
set local search_path = public, extensions;

-- Before 001401 the second approver could not see this row, so
-- `invoices:evaluate_dunning` took its insert branch and hit
-- `core_collection_cases_invoice_id_key`.
select is((select count(*)::integer from core_collection_cases
  where id = 'b1401000-0000-4000-8000-000000000021'), 1,
  'a second finance approver can read a case another approver opened');

select lives_ok($$
  update core_collection_cases
  set aging_bucket = 'second_threshold', status = 'escalated'
  where id = 'b1401000-0000-4000-8000-000000000021'
$$, 'a second finance approver can advance the case');

-- Reading and advancing is not taking. `core_protect_collection_case_identity`
-- (001000) is what stops the transfer, and it is untouched.
select throws_ok($$
  update core_collection_cases
  set owner_user_id = '20000000-0000-4000-8000-000000000001'
  where id = 'b1401000-0000-4000-8000-000000000021'
$$, '55000', null,
  'a second finance approver cannot take ownership of the case');

-- Opening one still pins the opener as owner, which is the assertion 950 keeps.
select throws_ok($$
  insert into core_collection_cases (
    id, invoice_id, account_id, owner_user_id, aging_bucket, next_action_at,
    status
  ) values (
    'b1401000-0000-4000-8000-000000000022',
    '90000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000004',
    '20000000-0000-4000-8000-000000000006','current',clock_timestamp(),'open'
  )
$$, '42501', null,
  'a finance approver still cannot open a case owned by somebody else');

-- =========================================================================
-- 4. The signer accessor a commercial artifact needs.
-- =========================================================================
reset role;
select set_config('app.authorization_context', jsonb_build_object(
  'userId','20000000-0000-4000-8000-000000000001',
  'accountIds',jsonb_build_array('10000000-0000-4000-8000-000000000001'),
  'roles',jsonb_build_array('owner'),'isInternalStaff',false,
  'requestId','pgtap-1401-signer',
  'expiresAt',(clock_timestamp() + interval '5 minutes')::text
)::text, true);
select set_config('app.authorization_signature', encode(extensions.hmac(
  current_setting('app.authorization_context'),
  (select secret from private.authorization_secrets where active
   order by created_at desc limit 1),
  'sha256'),'hex'), true);
set local role clockwork_runtime;
set local search_path = public, extensions;

-- `commerce_users_read` is `app_is_current_user(id)`, so this caller cannot see
-- the signer's ROW. The accessor returns the one field an order form prints,
-- because the caller holds an account that signer signed an order on.
select is(
  core_commercial_signer('20000000-0000-4000-8000-000000000002'::uuid),
  'Dana Direct',
  'an account party resolves the name of a signer on its own order');
select is((select count(*)::integer from commerce_users
  where id = '20000000-0000-4000-8000-000000000002'), 0,
  'and still cannot read that user''s directory row');

reset role;
select set_config('app.authorization_context', jsonb_build_object(
  'userId','20000000-0000-4000-8000-000000000005',
  'accountIds',jsonb_build_array('10000000-0000-4000-8000-000000000005'),
  'roles',jsonb_build_array('partner_admin'),'isInternalStaff',false,
  'requestId','pgtap-1401-signer-stranger',
  'expiresAt',(clock_timestamp() + interval '5 minutes')::text
)::text, true);
select set_config('app.authorization_signature', encode(extensions.hmac(
  current_setting('app.authorization_context'),
  (select secret from private.authorization_secrets where active
   order by created_at desc limit 1),
  'sha256'),'hex'), true);
set local role clockwork_runtime;
set local search_path = public, extensions;

-- THE REFUSED SET of the accessor: everyone with no order or agreement in
-- common with the candidate. The artifact builders raise
-- COMMERCIAL_ARTIFACT_SIGNER_NOT_FOUND on this exactly as they did before.
select is(
  core_commercial_signer('20000000-0000-4000-8000-000000000002'::uuid),
  null,
  'a party with no order or agreement in common resolves no name');

select * from finish();
rollback;
