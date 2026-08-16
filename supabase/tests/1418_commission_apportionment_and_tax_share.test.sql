-- The two residuals from 001414: a refusal that blocked a legitimate accrual,
-- and an apportionment that could invent a minor unit.
begin;
select plan(11);
set local search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. THE FALSE REFUSAL, FIXED WHERE THE MALFORMED ROW IS MADE
-- ---------------------------------------------------------------------------
--
-- Before 001418 this insert SUCCEEDED — 001392 called tax_minor "deliberately
-- signed" and no constraint said otherwise — and the payment accrual against
-- the resulting invoice then raised 23514, so the partner earned nothing on a
-- bill the customer had paid. The rule now lives on the invoice, where the row
-- is created, and the accrual is never asked to refuse one.
select throws_ok(
  $$insert into invoices (
      id, order_id, account_id, stripe_invoice_id, currency,
      amount_minor, tax_minor, tax_treatment, po_number, status
    ) values (
      '90000000-0000-4000-8000-000000001418',
      '80000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000004',
      'in_fixture_1418_negative', 'USD', 119000, -1000, 'standard',
      'PO-REF-002', 'open')$$,
  '23514',
  null,
  'an invoice whose tax is negative is refused where it used to be accepted'
);
select throws_ok(
  $$insert into invoices (
      id, order_id, account_id, stripe_invoice_id, currency,
      amount_minor, tax_minor, tax_treatment, po_number, status
    ) values (
      '90000000-0000-4000-8000-000000001419',
      '80000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000004',
      'in_fixture_1418_over', 'USD', 120000, 130000, 'standard',
      'PO-REF-002', 'open')$$,
  '23514',
  null,
  'a tax larger than the amount it is included in is refused'
);
select is(
  (select count(*)::int from pg_constraint
    where conrelid = 'public.invoices'::regclass
      and conname = 'invoices_tax_share_check'
      and convalidated),
  1,
  'the share rule is a validated constraint on the table, not a check in one writer'
);

-- ---------------------------------------------------------------------------
-- 2. CUMULATIVE APPORTIONMENT
-- ---------------------------------------------------------------------------
--
-- The referral order's quote is 120000, so the net is fixed there. At 20% the
-- tax is 24000 and the gross is 144000; the ratio is 5/6. Paid 36003 then
-- 107997, both of which land exactly on a half:
--
--   independently   36003 * 5/6 = 30002.5 -> 30003
--                  107997 * 5/6 = 89997.5 -> 89998   sum 120001
--   cumulatively   round( 36003 * 5/6)          = 30003
--                  round(144000 * 5/6) - 30003  = 89997   sum 120000
--
-- Every figure below was worked by hand before it was written here.
insert into invoices (
  id, order_id, account_id, stripe_invoice_id, currency,
  amount_minor, tax_minor, tax_treatment, po_number, status
) values (
  '90000000-0000-4000-8000-000000001420',
  '80000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000004',
  'in_fixture_1418', 'USD', 144000, 24000, 'standard', 'PO-REF-002', 'open'
);
insert into payments (
  id, invoice_id, order_id, stripe_payment_intent_id, currency,
  amount_minor, status, received_at
) values (
  '91000000-0000-4000-8000-000000001420',
  '90000000-0000-4000-8000-000000001420',
  '80000000-0000-4000-8000-000000000002',
  'pi_fixture_1418_a', 'USD', 36003, 'succeeded', '2026-08-01T16:00:00Z'
), (
  '91000000-0000-4000-8000-000000001421',
  '90000000-0000-4000-8000-000000001420',
  '80000000-0000-4000-8000-000000000002',
  'pi_fixture_1418_b', 'USD', 107997, 'succeeded', '2026-08-02T16:00:00Z'
);

select lives_ok(
  $$insert into commission_accruals (
      id, partner_account_id, invoice_id, source_type, source_id,
      rate_bps, holdback_bps, currency,
      net_collected_revenue_minor, amount_minor, holdback_minor, period, status
    ) values (
      '92000000-0000-4000-8000-000000001420',
      '10000000-0000-4000-8000-000000000002',
      '90000000-0000-4000-8000-000000001420',
      'payment', '91000000-0000-4000-8000-000000001420',
      1200, 1000, 'USD', 30003, 3600, 360, '2026-Q3', 'accrued')$$,
  'the first instalment accrues 30003, its rounded share of the net'
);

-- THE REGRESSION GUARD. 89998 is what the independent apportionment produced
-- and what 001414 required; against the unfixed trigger this insert succeeds,
-- which is what makes the assertion evidence rather than decoration.
select throws_ok(
  $$insert into commission_accruals (
      id, partner_account_id, invoice_id, source_type, source_id,
      rate_bps, holdback_bps, currency,
      net_collected_revenue_minor, amount_minor, holdback_minor, period, status
    ) values (
      '92000000-0000-4000-8000-000000001421',
      '10000000-0000-4000-8000-000000000002',
      '90000000-0000-4000-8000-000000001420',
      'payment', '91000000-0000-4000-8000-000000001421',
      1200, 1000, 'USD', 89998, 10800, 1080, '2026-Q3', 'accrued')$$,
  '23514',
  'commission values must derive from source money, policy, and UTC quarter',
  'the independently rounded share, one unit too many, is refused'
);

select lives_ok(
  $$insert into commission_accruals (
      id, partner_account_id, invoice_id, source_type, source_id,
      rate_bps, holdback_bps, currency,
      net_collected_revenue_minor, amount_minor, holdback_minor, period, status
    ) values (
      '92000000-0000-4000-8000-000000001421',
      '10000000-0000-4000-8000-000000000002',
      '90000000-0000-4000-8000-000000001420',
      'payment', '91000000-0000-4000-8000-000000001421',
      1200, 1000, 'USD', 89997, 10800, 1080, '2026-Q3', 'accrued')$$,
  'the second instalment takes the difference between successive rounded totals'
);

select is(
  (select sum(net_collected_revenue_minor)::bigint from commission_accruals
     where invoice_id = '90000000-0000-4000-8000-000000001420'),
  120000::bigint,
  'the bases sum to the invoice net exactly on a split that does not divide evenly'
);
select is(
  (select sum(amount_minor)::bigint from commission_accruals
     where invoice_id = '90000000-0000-4000-8000-000000001420'),
  14400::bigint,
  'and the commission is 12% of the net, the same as the invoice paid once'
);

-- ---------------------------------------------------------------------------
-- 3. A CLAWBACK MIRRORS THE ACCRUAL IT REVERSES
-- ---------------------------------------------------------------------------
--
-- A full refund of the first instalment must reverse 30003 exactly. Re-deriving
-- it from the invoice ratio gives 30003 here too — but only because this
-- payment's share rounds the same way; the rule is the mirror, and the mirror
-- is what makes a full refund leave nothing behind whatever the rounding did.
insert into refunds (
  id, payment_id, order_id, stripe_refund_id, currency,
  amount_minor, reason_code, status
) values (
  '94000000-0000-4000-8000-000000001420',
  '91000000-0000-4000-8000-000000001420',
  '80000000-0000-4000-8000-000000000002',
  're_fixture_1418', 'USD', 36003, 'duplicate', 'succeeded'
);

select throws_ok(
  $$insert into commission_accruals (
      id, partner_account_id, invoice_id, source_type, source_id,
      adjustment_source_id, rate_bps, holdback_bps, currency,
      net_collected_revenue_minor, amount_minor, holdback_minor, period, status
    ) values (
      '92000000-0000-4000-8000-000000001422',
      '10000000-0000-4000-8000-000000000002',
      '90000000-0000-4000-8000-000000001420',
      'refund', '94000000-0000-4000-8000-000000001420',
      '92000000-0000-4000-8000-000000001420',
      1200, 1000, 'USD', -36003, -4320, -432, '2026-Q3', 'accrued')$$,
  '23514',
  'commission values must derive from source money, policy, and UTC quarter',
  'a clawback of the gross cash is refused, as it was before'
);
select lives_ok(
  $$insert into commission_accruals (
      id, partner_account_id, invoice_id, source_type, source_id,
      adjustment_source_id, rate_bps, holdback_bps, currency,
      net_collected_revenue_minor, amount_minor, holdback_minor, period, status
    ) values (
      '92000000-0000-4000-8000-000000001422',
      '10000000-0000-4000-8000-000000000002',
      '90000000-0000-4000-8000-000000001420',
      'refund', '94000000-0000-4000-8000-000000001420',
      '92000000-0000-4000-8000-000000001420',
      1200, 1000, 'USD', -30003, -3600, -360, '2026-Q3', 'accrued')$$,
  'a full refund reverses the accrual it adjusts exactly'
);
select is(
  (select sum(net_collected_revenue_minor)::bigint from commission_accruals
     where invoice_id = '90000000-0000-4000-8000-000000001420'
       and source_id in ('91000000-0000-4000-8000-000000001420',
                         '94000000-0000-4000-8000-000000001420')),
  0::bigint,
  'the accrual and its full reversal leave nothing behind'
);

select * from finish();
rollback;
