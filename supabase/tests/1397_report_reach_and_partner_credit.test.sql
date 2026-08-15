begin;
select plan(26);
set local search_path = public, extensions;

-- Two findings, both about a thing that was true in one place and false in
-- another.
--
-- 1. REACH. The three §17 views 001396 added were granted to nobody but the
--    service role and named in no refusal list, so a non-internal caller
--    holding `report:read` -- an `owner` on a partner account is one -- passed
--    `report()`'s account-scope check and reached a view its role has no
--    `select` on: `42501 permission denied for view core_commission_settlement`.
--    001397 decides each of the three and this file pins the SQL half.
--
-- 2. PARTNER CREDIT. `accounts:set_partner_credit` wrote the account aggregate
--    limit and not the approved limit on the commercial profile.
--    `core_validate_finance_chain` requires the two to be EQUAL for a partner
--    account, and the trigger is on the PROFILE -- so the divergent write
--    succeeded and the next statement to touch the profile failed. On a partner
--    that statement is `core_reserve_order_acceptance` incrementing
--    `current_exposure_minor`, which runs on every accepted order.
--
-- The fixture is the demo seed throughout. The partner-credit section uses a
-- SEEDED partner with an existing commercial profile (Cobalt Reseller, account
-- 6): a freshly created account has no profile, which is the one state in which
-- this invariant cannot be broken and the one the original test used.

-- ---------------------------------------------------------------------------
-- 1. Report reach: the grants
-- ---------------------------------------------------------------------------

select ok(
  has_table_privilege('clockwork_runtime', 'public.core_arr_mrr', 'select'),
  'ARR and MRR is tenant-reachable: it reads only core_revenue_forecast, which 000905 already granted'
);
select ok(
  has_table_privilege('clockwork_runtime', 'public.core_billing_collections', 'select'),
  'billing and collections is tenant-reachable: every relation it reads has a SELECT policy for the account party'
);
select ok(
  not has_table_privilege('clockwork_runtime', 'public.core_commission_settlement', 'select'),
  'commission and settlement is internal: ungranted to the tenant role'
);
select ok(
  has_table_privilege('clockwork_service', 'public.core_arr_mrr', 'select')
    and has_table_privilege('clockwork_service', 'public.core_billing_collections', 'select')
    and has_table_privilege('clockwork_service', 'public.core_commission_settlement', 'select'),
  'and the internal service pool still reads all three'
);

-- No §17 view is reachable without a role at all. `security_invoker` decides
-- which rows a caller sees; it does not decide whether an anonymous session can
-- open the view in the first place.
select is(
  (select count(*)::bigint
   from information_schema.role_table_grants
   where table_schema = 'public'
     and table_name in (
       'core_revenue_forecast','core_capacity_planning','core_renewal_churn_exposure',
       'core_partner_performance','core_funnel_cycle_time','core_margin_poc_cost',
       'core_three_way_tie_out','core_weekly_scorecard','core_arr_mrr',
       'core_billing_collections','core_commission_settlement')
     and grantee in ('public','anon','authenticated')
     and privilege_type = 'SELECT'),
  0::bigint,
  'no report in the §17 catalogue is selectable by public, anon or authenticated'
);

-- Every report is in exactly one of the two states, with nothing in between.
-- The three added in 001396 were in neither, which is the finding.
select is(
  (select array_agg(relation order by relation)
   from (values
     ('core_arr_mrr'),('core_billing_collections'),('core_capacity_planning'),
     ('core_commission_settlement'),('core_funnel_cycle_time'),('core_margin_poc_cost'),
     ('core_partner_performance'),('core_renewal_churn_exposure'),('core_revenue_forecast'),
     ('core_three_way_tie_out'),('core_weekly_scorecard')
   ) as catalogue(relation)
   where has_table_privilege('clockwork_runtime', 'public.' || relation, 'select')),
  array[
    'core_arr_mrr','core_billing_collections','core_funnel_cycle_time',
    'core_margin_poc_cost','core_partner_performance','core_renewal_churn_exposure',
    'core_revenue_forecast'
  ],
  'exactly seven of the eleven §17 reports are tenant-reachable, and these are they'
);

-- What an internal operator reads, kept in transaction-local settings so the
-- tenant read below is compared against the operator's own answer rather than
-- against a literal. The reports are worth reading only if the two agree, and
-- a literal would also be asserting what the seed happens to hold today.
--
-- The due date is set here rather than inherited: an aging bucket that depends
-- on when the suite runs is not an assertion.
update invoices set due_at = now() - interval '40 days'
where id = '90000000-0000-4000-8000-000000000001';

select set_config('clockwork.probe_billing_row', (
  select (paid_minor, collected_minor, credited_minor, refunded_minor,
          disputed_minor, open_dispute_count, aging_bucket, credit_limit_minor)::text
  from core_billing_collections
  where invoice_id = '90000000-0000-4000-8000-000000000001'), true);
select set_config('clockwork.probe_arr_row', (
  select (mrr_minor, arr_minor, revenue_basis)::text from core_arr_mrr
  where order_id = '80000000-0000-4000-8000-000000000001'), true);
select set_config('clockwork.probe_partner_accruals', (
  select count(*)::text from commission_accruals
  where partner_account_id = '10000000-0000-4000-8000-000000000002'), true);

select is(
  current_setting('clockwork.probe_billing_row'),
  '(0,180000,0,0,180000,1,31_60,' || (
    select approved_credit_limit_minor::text
    from core_account_commercial_profiles
    where account_id = '10000000-0000-4000-8000-000000000001') || ')',
  'the internal read of the seeded overdue invoice: cash arrived, the projection says unpaid, and the whole amount is disputed'
);
select is(
  current_setting('clockwork.probe_arr_row'),
  '(15000,180000,gross)',
  'the internal read of the direct order run rate'
);
select ok(
  (select count(*)::bigint from core_commission_settlement
   where partner_account_id = '10000000-0000-4000-8000-000000000002')
    = current_setting('clockwork.probe_partner_accruals')::bigint
    and current_setting('clockwork.probe_partner_accruals')::bigint > 0,
  'and the internal read of the referral partner settlement: one row per accrual, none of them lost'
);

-- ---------------------------------------------------------------------------
-- 1b. Report reach: what a tenant actually gets
-- ---------------------------------------------------------------------------
-- A temporary grant on the internal report, rolled back with everything else in
-- this file, so the empty page it would return can be measured rather than
-- argued about.
grant select on public.core_commission_settlement to clockwork_runtime;

-- An owner on the seeded direct account.
select set_config('app.authorization_context', jsonb_build_object(
  'userId','20000000-0000-4000-8000-000000000002',
  'accountIds',jsonb_build_array('10000000-0000-4000-8000-000000000001'),
  'roles',jsonb_build_array('owner'),'isInternalStaff',false,
  'requestId','pgtap-1397-direct-owner',
  'expiresAt',(clock_timestamp() + interval '5 minutes')::text
)::text, true);
select set_config('app.authorization_signature', encode(extensions.hmac(
  current_setting('app.authorization_context'),
  (select secret from private.authorization_secrets where active
   order by created_at desc limit 1),
  'sha256'),'hex'), true);
set local role clockwork_runtime;

select is(
  (select (paid_minor, collected_minor, credited_minor, refunded_minor,
           disputed_minor, open_dispute_count, aging_bucket, credit_limit_minor)::text
   from core_billing_collections
   where invoice_id = '90000000-0000-4000-8000-000000000001'),
  current_setting('clockwork.probe_billing_row'),
  'the account party reads its own invoice column-for-column as the operator does'
);
select is(
  (select (mrr_minor, arr_minor, revenue_basis)::text from core_arr_mrr
   where order_id = '80000000-0000-4000-8000-000000000001'),
  current_setting('clockwork.probe_arr_row'),
  'and the same run rate for its own order'
);
select is(
  (select count(*)::bigint from core_billing_collections
   where account_id <> '10000000-0000-4000-8000-000000000001'),
  0::bigint,
  'and nobody else''s invoices: the rows are scoped by the invoker''s RLS, not by the filter'
);

reset role;

-- The same probe as a partner. This is the case that decides commission and
-- settlement.
select set_config('app.authorization_context', jsonb_build_object(
  'userId','20000000-0000-4000-8000-000000000003',
  'accountIds',jsonb_build_array('10000000-0000-4000-8000-000000000002'),
  'roles',jsonb_build_array('owner'),'isInternalStaff',false,
  'requestId','pgtap-1397-partner-owner',
  'expiresAt',(clock_timestamp() + interval '5 minutes')::text
)::text, true);
select set_config('app.authorization_signature', encode(extensions.hmac(
  current_setting('app.authorization_context'),
  (select secret from private.authorization_secrets where active
   order by created_at desc limit 1),
  'sha256'),'hex'), true);
set local role clockwork_runtime;

select is(
  (select count(*)::bigint from commission_accruals
   where partner_account_id = '10000000-0000-4000-8000-000000000002'),
  current_setting('clockwork.probe_partner_accruals')::bigint,
  'the referral partner can read every one of its own commission accruals'
);
select is(
  (select count(*)::bigint from invoices
   where id = '90000000-0000-4000-8000-000000000002'),
  0::bigint,
  'and cannot read the invoice it was earned on, because a referral is invoiced to the end client'
);
select is(
  (select count(*)::bigint from core_commission_settlement
   where partner_account_id = '10000000-0000-4000-8000-000000000002'),
  0::bigint,
  'so a granted commission report returns the partner an EMPTY page about itself -- which is why it is internal and refused instead'
);

reset role;
revoke select on public.core_commission_settlement from clockwork_runtime;

-- The second reason, independent of the first: the marketplace fee column sums
-- a table whose only policy is app_is_internal(), so a tenant reads 0 for it
-- whatever the fee was.
select is(
  (select count(*)::bigint from pg_policies
   where tablename = 'core_marketplace_financial_entries'
     and qual = 'app_is_internal()'),
  1::bigint,
  'marketplace financial entries are internal-only, so a tenant-read marketplace fee would always be zero'
);

-- ---------------------------------------------------------------------------
-- 2. The partner credit invariant
-- ---------------------------------------------------------------------------

select is(
  (select (a.aggregate_credit_limit_minor, p.approved_credit_limit_minor)::text
   from accounts a
   join core_account_commercial_profiles p on p.account_id = a.id
   where a.id = '10000000-0000-4000-8000-000000000006'),
  '(3000000,3000000)',
  'the seeded partner starts with the two limits equal, which is what seed.sql means by "credit limits remain exactly the account limits above"'
);

-- The write the first implementation of `set_partner_credit` made, on its own.
-- It succeeds: the constraint trigger is on the profile, not on `accounts`.
update accounts set aggregate_credit_limit_minor = 6000000
where id = '10000000-0000-4000-8000-000000000006';
select is(
  (select aggregate_credit_limit_minor from accounts
   where id = '10000000-0000-4000-8000-000000000006'),
  6000000::bigint,
  'moving the account aggregate limit alone is accepted, and leaves the invariant broken behind it'
);

-- ...and the next statement to touch the profile is the one that fails. This is
-- verbatim the statement `core_reserve_order_acceptance` issues for the
-- invoicing account and again for the partner account of every accepted order
-- (001000_commercial_database_integrity.sql).
select throws_ok($$
  update core_account_commercial_profiles
  set current_exposure_minor = current_exposure_minor + 168000
  where account_id = '10000000-0000-4000-8000-000000000006'
$$, '23514', 'partner credit limit must match the account aggregate limit',
  'so every subsequent order acceptance for that partner rolls back');

-- Not a hypothetical statement: the acceptance function contains it.
select ok(
  pg_get_functiondef('public.core_reserve_order_acceptance(uuid,integer,uuid,text)'::regprocedure)
    like '%current_exposure_minor = current_exposure_minor + quote_record.total_minor%',
  'core_reserve_order_acceptance updates the commercial profile exposure, which is what fires the trigger'
);

-- Writing both sides, which is what the repaired verb does: the account row
-- first, the profile second, in one transaction. The trigger reads `accounts`,
-- so by the time it runs the two agree.
update core_account_commercial_profiles set approved_credit_limit_minor = 6000000
where account_id = '10000000-0000-4000-8000-000000000006';
select lives_ok($$
  update core_account_commercial_profiles
  set current_exposure_minor = current_exposure_minor + 168000
  where account_id = '10000000-0000-4000-8000-000000000006'
$$, 'with both sides written, order acceptance can reserve exposure again');

-- And the divergence is refused in the other direction too, immediately,
-- because that write is on the trigger''s own table.
select throws_ok($$
  update core_account_commercial_profiles
  set approved_credit_limit_minor = 4000000
  where account_id = '10000000-0000-4000-8000-000000000006'
$$, '23514', 'partner credit limit must match the account aggregate limit',
  'moving the approved limit alone is refused on the spot');

-- Lowering the limit BELOW current exposure is not refused. A reduced limit
-- that the partner has already exceeded is a real commercial position, and what
-- it does is make `core_reserve_order_acceptance` reject the next order -- not
-- make the profile unwritable.
update accounts set aggregate_credit_limit_minor = 1000
where id = '10000000-0000-4000-8000-000000000006';
select lives_ok($$
  update core_account_commercial_profiles
  set approved_credit_limit_minor = 1000
  where account_id = '10000000-0000-4000-8000-000000000006'
$$, 'a limit below current exposure is allowed: over-limit is a state, not an error');
select ok(
  (select current_exposure_minor > approved_credit_limit_minor
   from core_account_commercial_profiles
   where account_id = '10000000-0000-4000-8000-000000000006'),
  'and the partner is now over its limit, which is what will reject its next order'
);

-- Why the original test passed. The trigger checks accounts holding the
-- `partner` role, and a freshly created direct_client account has neither the
-- role nor a commercial profile, so nothing it does can break this.
select lives_ok($$
  update core_account_commercial_profiles
  set approved_credit_limit_minor = 999999
  where account_id = '10000000-0000-4000-8000-000000000001'
$$, 'a non-partner account is outside the invariant entirely, which is the state the original test measured');
select is(
  (select relationship_roles::text from accounts
   where id = '10000000-0000-4000-8000-000000000001'),
  '{direct_client}',
  'because that account holds no partner role'
);

select * from finish();
rollback;
