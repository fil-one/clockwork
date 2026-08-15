begin;
select plan(39);
set local search_path = public, extensions;

-- P0-42. The three §17 reports 001396 adds. Every assertion below is written so
-- that it fails if the row it is about is removed from the fixture, and none of
-- them reads a clock the test does not set: the aging assertions move the due
-- date themselves rather than depending on when the suite runs.
--
-- Fixture is the seed: seven accepted orders (direct, referral, resale,
-- distributor, white-label resale, marketplace, direct), their seven invoices,
-- two succeeded payments, one open dispute, one referral commission accrual of
-- 14400 on 120000 collected at 1200bps with 1000bps held back.

select has_view('public', 'core_arr_mrr', 'ARR and MRR has a report');
select has_view('public', 'core_billing_collections', 'billing and collections has a report');
select has_view('public', 'core_commission_settlement', 'commission and settlement has a report');

-- ---------------------------------------------------------------------------
-- ARR and MRR
-- ---------------------------------------------------------------------------

-- One row per contract, not one per month of it. core_revenue_forecast holds
-- twelve committed rows for each of these orders; an ARR report that returned
-- them would state twelve times the run rate.
select is(
  (select count(*)::bigint from core_arr_mrr),
  7::bigint,
  'one row per committed order, not one per forecast month'
);
select is(
  (select count(distinct order_id)::bigint from core_revenue_forecast
    where forecast_stage = 'committed_backlog'),
  7::bigint,
  'and that is every committed order the forecast knows about'
);

select is(
  (select mrr_minor from core_arr_mrr
    where order_id = '80000000-0000-4000-8000-000000000001'),
  15000::bigint,
  'a direct order states its monthly contracted value'
);
select is(
  (select arr_minor from core_arr_mrr
    where order_id = '80000000-0000-4000-8000-000000000001'),
  180000::bigint,
  'and twelve times it as ARR'
);
select is(
  (select revenue_basis from core_arr_mrr
    where order_id = '80000000-0000-4000-8000-000000000001'),
  'gross',
  'direct revenue is stated gross'
);

-- The resale contract is the one that can be wrong quietly. Its transfer price
-- is 168000 and the price the partner charges its own client is 216000; an ARR
-- taken off the resale total would read 18000 a month instead of 14000.
select is(
  (select revenue_basis from core_arr_mrr
    where order_id = '80000000-0000-4000-8000-000000000003'),
  'transfer_price',
  'resale revenue is stated on the transfer price'
);
select is(
  (select mrr_minor from core_arr_mrr
    where order_id = '80000000-0000-4000-8000-000000000003'),
  14000::bigint,
  'and it is the transfer price, not the partner resale price, that is recognised'
);
select is(
  (select partner_resale_total_minor from quotes
    where id = '70000000-0000-4000-8000-000000000003'),
  216000::bigint,
  'the resale price the previous assertion must not have used is really on the quote'
);

-- §17 states ARR as CONTRACTED value. An issued quote nobody has accepted is
-- pipeline in the forecast and must not appear here.
insert into quotes (
  id, account_id, price_book_id, series_id, revision, status, currency,
  total_minor, margin_floor_result, expires_at, created_by
) values (
  '7f000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000001',
  '7f100000-0000-4000-8000-000000000001', 1, 'issued', 'USD',
  240000, 'pass', '2027-01-01T00:00:00Z',
  '20000000-0000-4000-8000-000000000002'
);
select is(
  (select count(*)::bigint from core_revenue_forecast
    where quote_id = '7f000000-0000-4000-8000-000000000001'
      and forecast_stage = 'pipeline'),
  1::bigint,
  'an issued quote with no order is pipeline in the forecast'
);
select is(
  (select count(*)::bigint from core_arr_mrr
    where quote_id = '7f000000-0000-4000-8000-000000000001'),
  0::bigint,
  'and contributes nothing to contracted ARR'
);

-- The run rate is the rate now, so an amendment priced across the whole term
-- has to move it. This is what makes core_arr_mrr a projection of the forecast
-- rather than a second arithmetic that agrees with it by coincidence: the
-- amendment is folded in by core_revenue_forecast and read back out here.
insert into amendments (id, order_id, effective_on, kind, proration_method, document_id)
values ('8f000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001',
        '2026-01-01','upgrade','daily','40000000-0000-4000-8000-000000000005');
insert into core_amendment_financial_terms (
  amendment_id, contractual_time_zone, proration_convention,
  period_starts_on, period_ends_on, billable_numerator,
  billable_denominator, currency, forecast_delta_minor, monthly_delta_minor
) values (
  '8f000000-0000-4000-8000-000000000001', 'UTC', 'actual_actual',
  '2026-01-01', '2026-12-31', 364, 364, 'USD', 30000, 2500
);
select is(
  (select mrr_minor from core_arr_mrr
    where order_id = '80000000-0000-4000-8000-000000000001'),
  17500::bigint,
  'an upgrade priced across the term raises the run rate by its monthly delta'
);
select is(
  (select arr_minor from core_arr_mrr
    where order_id = '80000000-0000-4000-8000-000000000001'),
  210000::bigint,
  'and ARR with it'
);

-- ---------------------------------------------------------------------------
-- Billing and collections
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::bigint from core_billing_collections),
  (select count(*)::bigint from invoices),
  'every invoice reports, including the ones nothing has happened to'
);
select is(
  (select outstanding_minor from core_billing_collections
    where invoice_id = '90000000-0000-4000-8000-000000000002'),
  0::bigint,
  'a settled invoice owes nothing'
);
select is(
  (select aging_bucket from core_billing_collections
    where invoice_id = '90000000-0000-4000-8000-000000000002'),
  'not_collectible',
  'and is not aged into a bucket that would then be summed as exposure'
);

-- The projection on the invoice row and the payments themselves are both
-- reported because they can disagree: the overdue invoice has a full payment
-- against it that is under dispute, so Stripe never marked it paid.
select is(
  (select paid_minor from core_billing_collections
    where invoice_id = '90000000-0000-4000-8000-000000000001'),
  0::bigint,
  'a disputed payment leaves the invoice projection unpaid'
);
select is(
  (select collected_minor from core_billing_collections
    where invoice_id = '90000000-0000-4000-8000-000000000001'),
  180000::bigint,
  'while the cash that actually arrived is still reported against it'
);

-- Aging, measured against a due date this test sets, so the answer does not
-- depend on the day the suite runs.
update invoices set due_at = now() + interval '1 day'
  where id = '90000000-0000-4000-8000-000000000003';
select is(
  (select aging_bucket from core_billing_collections
    where invoice_id = '90000000-0000-4000-8000-000000000003'),
  'current',
  'an open invoice not yet due is current'
);
update invoices set due_at = now() - interval '45 days'
  where id = '90000000-0000-4000-8000-000000000003';
select is(
  (select aging_bucket from core_billing_collections
    where invoice_id = '90000000-0000-4000-8000-000000000003'),
  '31_60',
  'forty-five days past due lands in 31_60'
);
update invoices set due_at = now() - interval '100 days'
  where id = '90000000-0000-4000-8000-000000000003';
select is(
  (select aging_bucket from core_billing_collections
    where invoice_id = '90000000-0000-4000-8000-000000000003'),
  '90_plus',
  'and a hundred days past due in 90_plus'
);

insert into credit_notes (
  id, invoice_id, order_id, stripe_credit_note_id, currency, amount_minor,
  reason_code, approved_by, status
) values (
  '9c000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000002',
  '80000000-0000-4000-8000-000000000002','cn_test_1396','USD',5000,
  'service_credit','20000000-0000-4000-8000-000000000001','issued'
);
select is(
  (select credited_minor from core_billing_collections
    where invoice_id = '90000000-0000-4000-8000-000000000002'),
  5000::bigint,
  'an issued credit note shows against the invoice it credits'
);
insert into refunds (
  id, payment_id, order_id, stripe_refund_id, currency, amount_minor,
  reason_code, status
) values (
  '9d000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002',
  '80000000-0000-4000-8000-000000000002','re_test_1396','USD',3000,
  'goodwill','succeeded'
);
select is(
  (select refunded_minor from core_billing_collections
    where invoice_id = '90000000-0000-4000-8000-000000000002'),
  3000::bigint,
  'a succeeded refund shows against the invoice its payment settled'
);

select is(
  (select open_dispute_count from core_billing_collections
    where invoice_id = '90000000-0000-4000-8000-000000000001'),
  1,
  'an unresolved dispute is open exposure'
);
update dispute_cases set status = 'won'
  where id = '92000000-0000-4000-8000-000000000001';
select is(
  (select disputed_minor from core_billing_collections
    where invoice_id = '90000000-0000-4000-8000-000000000001'),
  0::bigint,
  'and a dispute that has been decided is not'
);

insert into core_collection_cases (
  id, invoice_id, account_id, owner_user_id, aging_bucket, next_action_at, status
) values (
  '9e000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000001',
  '90_plus', now() + interval '1 day', 'escalated'
);
select is(
  (select dunning_owner_id from core_billing_collections
    where invoice_id = '90000000-0000-4000-8000-000000000003'),
  '20000000-0000-4000-8000-000000000001'::uuid,
  'the dunning owner is the collection case owner, not a guess'
);

-- The draft invoice nothing has been done to. A collections report that drops
-- these is the one that hides the bill nobody has sent.
select is(
  (select credited_minor + refunded_minor + disputed_minor + collected_minor
    from core_billing_collections
    where invoice_id = '90000000-0000-4000-8000-000000000007'),
  0::bigint,
  'an invoice with no activity reports zeros rather than absent'
);

-- ---------------------------------------------------------------------------
-- Commission and settlement
-- ---------------------------------------------------------------------------

select is(
  (select payable_minor from core_commission_settlement
    where accrual_id = '93500000-0000-4000-8000-000000000001'),
  12960::bigint,
  'commission payable is the accrual net of its holdback'
);
select is(
  (select settlement_stage from core_commission_settlement
    where accrual_id = '93500000-0000-4000-8000-000000000001'),
  'accrued',
  'an accrual on no statement is stated as accrued'
);

-- The clawback the credit note above obliges. It is a second, negative accrual
-- pointing at the payment accrual it reverses, and it must stay visible: net
-- the two and the statement shows 12420 payable with nothing saying 600 was
-- taken back.
insert into commission_accruals (
  id, partner_account_id, invoice_id, source_type, source_id,
  adjustment_source_id, rate_bps, holdback_bps, currency,
  net_collected_revenue_minor, amount_minor, holdback_minor, period, status
) values (
  '9f000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002',
  '90000000-0000-4000-8000-000000000002','credit_note',
  '9c000000-0000-4000-8000-000000000001','93500000-0000-4000-8000-000000000001',
  1200, 1000, 'USD', -5000, -600, -60,
  extract(year from now() at time zone 'UTC')::integer::text || '-Q'
    || extract(quarter from now() at time zone 'UTC')::integer::text,
  'accrued'
);
select is(
  (select count(*)::bigint from core_commission_settlement
    where invoice_id = '90000000-0000-4000-8000-000000000002'),
  2::bigint,
  'a clawback is its own row rather than netted into the accrual it reverses'
);
select is(
  (select clawback_minor from core_commission_settlement
    where accrual_id = '9f000000-0000-4000-8000-000000000001'),
  600::bigint,
  'and reports what was taken back as its own magnitude'
);
select is(
  (select payable_minor from core_commission_settlement
    where accrual_id = '9f000000-0000-4000-8000-000000000001'),
  -540::bigint,
  'while the amount owed on it stays signed'
);

insert into core_commission_statements (
  id, partner_account_id, period_starts_on, period_ends_on, currency,
  gross_accrued_minor, clawback_minor, holdback_minor, payable_minor, status
) values (
  '9a100000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002',
  '2026-07-01','2026-09-30','USD',14400,0,1440,12960,'draft'
);
insert into core_commission_statement_lines (
  id, statement_id, accrual_id, source_type, source_id,
  net_collected_revenue_minor, commission_minor, holdback_minor
) values (
  '9a200000-0000-4000-8000-000000000001','9a100000-0000-4000-8000-000000000001',
  '93500000-0000-4000-8000-000000000001','payment',
  '91000000-0000-4000-8000-000000000002',120000,14400,1440
);
select is(
  (select settlement_stage from core_commission_settlement
    where accrual_id = '93500000-0000-4000-8000-000000000001'),
  'stated',
  'an accrual on a statement is stated'
);

update core_commission_statements set status = 'issued'
  where id = '9a100000-0000-4000-8000-000000000001';
update core_commission_statements set status = 'approved'
  where id = '9a100000-0000-4000-8000-000000000001';
update core_commission_statements set status = 'exported'
  where id = '9a100000-0000-4000-8000-000000000001';
-- An export in flight is not a settlement. `settlement_stage` has to separate
-- the two, because it is what a partner-payment queue would read.
insert into core_commission_settlement_exports (
  id, statement_id, export_key, format, status
) values (
  '9a300000-0000-4000-8000-000000000001','9a100000-0000-4000-8000-000000000001',
  'test-1396-export','qbo_bill','pending'
);
update core_commission_settlement_exports set status = 'generated'
  where id = '9a300000-0000-4000-8000-000000000001';
select is(
  (select settlement_stage from core_commission_settlement
    where accrual_id = '93500000-0000-4000-8000-000000000001'),
  'exporting',
  'a generated but undelivered export is not yet a settlement'
);
update core_commission_settlement_exports set status = 'delivered'
  where id = '9a300000-0000-4000-8000-000000000001';
select is(
  (select settlement_stage from core_commission_settlement
    where accrual_id = '93500000-0000-4000-8000-000000000001'),
  'settled',
  'and a delivered export settles the accrual'
);

-- ---------------------------------------------------------------------------
-- Reach
-- ---------------------------------------------------------------------------
-- The internal service pool reads all three. Which of them the TENANT pool may
-- also read is 001397's decision and is asserted in
-- 1397_report_reach_and_partner_credit.test.sql: this file used to claim the
-- tenant role could read none of the three, and that was the finding rather
-- than the contract. Granted to nobody but the service role and named in no
-- refusal list, a non-internal caller holding `report:read` reached them and
-- got `42501 permission denied for view core_commission_settlement` -- a raw
-- PostgreSQL error, not a typed refusal. 001397 grants ARR/MRR and billing and
-- collections to `clockwork_runtime` and keeps commission and settlement
-- internal on both sides at once.
select ok(
  has_table_privilege('clockwork_service', 'public.core_billing_collections', 'select')
    and has_table_privilege('clockwork_service', 'public.core_commission_settlement', 'select')
    and has_table_privilege('clockwork_service', 'public.core_arr_mrr', 'select'),
  'the internal service role can read all three reports'
);
select ok(
  not has_table_privilege('clockwork_runtime', 'public.core_commission_settlement', 'select'),
  'and the tenant role cannot reach commission and settlement, the one of the three that is internal'
);

select * from finish();
rollback;
