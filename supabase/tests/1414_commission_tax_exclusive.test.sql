begin;
select plan(15);
set local search_path = public, extensions;

-- COMMISSION ON A TAXED INVOICE, PAID IN TWO INSTALMENTS.
--
-- The defect 001414 fixes: `validate_commission_source_truth` (000930:200,218)
-- derived every accrued figure from `payments.amount_minor`, which settles
-- against `invoices.amount_minor` -- and 001392 deliberately made that column
-- GROSS. Spec line 150 says the commission is on attributed NET collected
-- revenue. The whole of 000930 contains no reference to `tax_minor`.
--
-- Every number below is arithmetic on a fixture, checked by hand before it was
-- written here. No rate in this file is a claim about any jurisdiction: the
-- 21 per cent is chosen because it is the Spanish rate the seed already carries
-- and because the overpayment it produces is easy to read.
--
-- The fixture is the seeded referral order 80000000-...-0002: quote total
-- 120000 USD, partner Northwind (10000000-...-0002) at 1200 bps commission and
-- 1000 bps holdback, invoiced to Harbor Analytics (10000000-...-0004).
--
--   net     120000
--   tax      25200   (21% of 120000)
--   gross   145200   which is what the customer is billed and what pays
--
--   instalment 1  100000 -> base 100000 * 120000 / 145200 = 82644.628... -> 82645
--   instalment 2   45200 -> base  45200 * 120000 / 145200 = 37355.371... -> 37355
--                                                            ------
--                                                            120000
--
-- The two bases sum to the net EXACTLY: no minor unit is invented and none is
-- lost by splitting the payment. Commission is 12% of each base -- 9917 and
-- 4483, summing to 14400, which is 12% of 120000.
--
-- What the unfixed trigger required instead: 12000 and 5424, summing to 17424.
-- That is 3024 too much, and 3024 / 14400 is exactly 21 per cent -- the VAT
-- rate, paid to the partner out of money that was never ours.

-- ---------------------------------------------------------------------------
-- The rounding helper, on its own
-- ---------------------------------------------------------------------------

select has_function(
  'public', 'core_divide_round_half_away', array['numeric','numeric'],
  'the apportionment rounds through one stated function rather than an inline expression'
);

-- Half away from zero, symmetric across the sign. Rounding the magnitude and
-- reapplying the sign is what makes a clawback the exact mirror of the accrual
-- it reverses; half-to-even or truncation would let a full refund leave a
-- residue behind.
select is(
  array[
    core_divide_round_half_away(5, 2),
    core_divide_round_half_away(-5, 2),
    core_divide_round_half_away(3, 2),
    core_divide_round_half_away(-3, 2),
    core_divide_round_half_away(1, 3),
    core_divide_round_half_away(0, 7)
  ],
  array[3::bigint, -3::bigint, 2::bigint, -2::bigint, 0::bigint, 0::bigint],
  'the helper rounds half away from zero and is symmetric in the sign'
);

-- ---------------------------------------------------------------------------
-- A taxed referral invoice, paid in two instalments
-- ---------------------------------------------------------------------------

insert into invoices (
  id, order_id, account_id, stripe_invoice_id, currency,
  amount_minor, tax_minor, tax_treatment, po_number, status
) values (
  '90000000-0000-4000-8000-000000000414',
  '80000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000004',
  'in_fixture_1414', 'USD', 145200, 25200, 'standard', 'PO-REF-002', 'open'
);

select is(
  (select amount_minor - tax_minor from invoices
     where id = '90000000-0000-4000-8000-000000000414'),
  120000::bigint,
  'the taxed invoice bills the quote net plus tax, so its net is still the quote total'
);

insert into payments (
  id, invoice_id, order_id, stripe_payment_intent_id, currency,
  amount_minor, status, received_at
) values (
  '91000000-0000-4000-8000-000000000414',
  '90000000-0000-4000-8000-000000000414',
  '80000000-0000-4000-8000-000000000002',
  'pi_fixture_1414_a', 'USD', 100000, 'succeeded', '2026-08-01T16:00:00Z'
), (
  '91000000-0000-4000-8000-000000000415',
  '90000000-0000-4000-8000-000000000414',
  '80000000-0000-4000-8000-000000000002',
  'pi_fixture_1414_b', 'USD', 45200, 'succeeded', '2026-08-02T16:00:00Z'
);

-- THE REGRESSION GUARD. These are the exact figures the trigger required
-- before 001414 -- the payment taken whole as the revenue base. Against the
-- unfixed function this insert succeeds; that is what makes this assertion
-- evidence rather than decoration.
select throws_ok(
  $$insert into commission_accruals (
      id, partner_account_id, invoice_id, source_type, source_id,
      rate_bps, holdback_bps, currency,
      net_collected_revenue_minor, amount_minor, holdback_minor, period, status
    ) values (
      '92000000-0000-4000-8000-000000000410',
      '10000000-0000-4000-8000-000000000002',
      '90000000-0000-4000-8000-000000000414',
      'payment', '91000000-0000-4000-8000-000000000414',
      1200, 1000, 'USD', 100000, 12000, 1200, '2026-Q3', 'accrued')$$,
  '23514',
  'commission values must derive from source money, policy, and UTC quarter',
  'the gross payment is refused as a commission base on a taxed invoice'
);

select lives_ok(
  $$insert into commission_accruals (
      id, partner_account_id, invoice_id, source_type, source_id,
      rate_bps, holdback_bps, currency,
      net_collected_revenue_minor, amount_minor, holdback_minor, period, status
    ) values (
      '92000000-0000-4000-8000-000000000414',
      '10000000-0000-4000-8000-000000000002',
      '90000000-0000-4000-8000-000000000414',
      'payment', '91000000-0000-4000-8000-000000000414',
      1200, 1000, 'USD', 82645, 9917, 992, '2026-Q3', 'accrued')$$,
  'the first instalment accrues on its tax-exclusive share, 82645 of 100000'
);

select lives_ok(
  $$insert into commission_accruals (
      id, partner_account_id, invoice_id, source_type, source_id,
      rate_bps, holdback_bps, currency,
      net_collected_revenue_minor, amount_minor, holdback_minor, period, status
    ) values (
      '92000000-0000-4000-8000-000000000415',
      '10000000-0000-4000-8000-000000000002',
      '90000000-0000-4000-8000-000000000414',
      'payment', '91000000-0000-4000-8000-000000000415',
      1200, 1000, 'USD', 37355, 4483, 448, '2026-Q3', 'accrued')$$,
  'the second instalment accrues on its own tax-exclusive share, 37355 of 45200'
);

-- THE PARTIAL-PAYMENT CASE, WHICH IS WHY THE SHARE IS OF THE PAYMENT AND NOT
-- OF THE INVOICE. Apportioning the invoice's whole net to the first instalment
-- would have accrued 120000 on 100000 of cash.
select is(
  (select sum(net_collected_revenue_minor)::bigint from commission_accruals
     where invoice_id = '90000000-0000-4000-8000-000000000414'),
  120000::bigint,
  'the two instalment bases sum to the invoice net exactly, inventing and losing nothing'
);

select is(
  (select sum(amount_minor)::bigint from commission_accruals
     where invoice_id = '90000000-0000-4000-8000-000000000414'),
  14400::bigint,
  'the commission on a fully collected taxed invoice is 12% of its net, not of its gross'
);

select isnt(
  (select sum(amount_minor)::bigint from commission_accruals
     where invoice_id = '90000000-0000-4000-8000-000000000414'),
  17424::bigint,
  'and it is not the 17424 the gross base produced, which overpaid by exactly the VAT rate'
);

-- ---------------------------------------------------------------------------
-- The clawback reverses the same base
-- ---------------------------------------------------------------------------

insert into refunds (
  id, payment_id, order_id, stripe_refund_id, currency,
  amount_minor, reason_code, status
) values (
  '94000000-0000-4000-8000-000000000414',
  '91000000-0000-4000-8000-000000000414',
  '80000000-0000-4000-8000-000000000002',
  're_fixture_1414', 'USD', 100000, 'duplicate', 'succeeded'
);

select throws_ok(
  $$insert into commission_accruals (
      id, partner_account_id, invoice_id, source_type, source_id,
      adjustment_source_id, rate_bps, holdback_bps, currency,
      net_collected_revenue_minor, amount_minor, holdback_minor, period, status
    ) values (
      '92000000-0000-4000-8000-000000000416',
      '10000000-0000-4000-8000-000000000002',
      '90000000-0000-4000-8000-000000000414',
      'refund', '94000000-0000-4000-8000-000000000414',
      '92000000-0000-4000-8000-000000000414',
      1200, 1000, 'USD', -100000, -12000, -1200, '2026-Q3', 'accrued')$$,
  '23514',
  'commission values must derive from source money, policy, and UTC quarter',
  'a clawback on the gross refund is refused for the same reason the accrual was'
);

select lives_ok(
  $$insert into commission_accruals (
      id, partner_account_id, invoice_id, source_type, source_id,
      adjustment_source_id, rate_bps, holdback_bps, currency,
      net_collected_revenue_minor, amount_minor, holdback_minor, period, status
    ) values (
      '92000000-0000-4000-8000-000000000417',
      '10000000-0000-4000-8000-000000000002',
      '90000000-0000-4000-8000-000000000414',
      'refund', '94000000-0000-4000-8000-000000000414',
      '92000000-0000-4000-8000-000000000414',
      1200, 1000, 'USD', -82645, -9917, -992, '2026-Q3', 'accrued')$$,
  'refunding an instalment in full claws back exactly what it accrued'
);

select is(
  (select (sum(net_collected_revenue_minor) + sum(amount_minor) + sum(holdback_minor))::bigint
     from commission_accruals
     where invoice_id = '90000000-0000-4000-8000-000000000414'
       and source_id in ('91000000-0000-4000-8000-000000000414',
                         '94000000-0000-4000-8000-000000000414')),
  0::bigint,
  'the accrual and its clawback cancel to zero in every column, with no rounding residue'
);

-- ---------------------------------------------------------------------------
-- An untaxed invoice is untouched: the ratio is 1 and nothing moves
-- ---------------------------------------------------------------------------

insert into invoices (
  id, order_id, account_id, stripe_invoice_id, currency,
  amount_minor, tax_minor, tax_treatment, po_number, status
) values (
  '90000000-0000-4000-8000-000000000418',
  '80000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000004',
  'in_fixture_1414_untaxed', 'USD', 120000, 0, 'not_determined', 'PO-REF-002', 'open'
);
insert into payments (
  id, invoice_id, order_id, stripe_payment_intent_id, currency,
  amount_minor, status, received_at
) values (
  '91000000-0000-4000-8000-000000000418',
  '90000000-0000-4000-8000-000000000418',
  '80000000-0000-4000-8000-000000000002',
  'pi_fixture_1414_c', 'USD', 45200, 'succeeded', '2026-08-03T16:00:00Z'
);

select lives_ok(
  $$insert into commission_accruals (
      id, partner_account_id, invoice_id, source_type, source_id,
      rate_bps, holdback_bps, currency,
      net_collected_revenue_minor, amount_minor, holdback_minor, period, status
    ) values (
      '92000000-0000-4000-8000-000000000418',
      '10000000-0000-4000-8000-000000000002',
      '90000000-0000-4000-8000-000000000418',
      'payment', '91000000-0000-4000-8000-000000000418',
      1200, 1000, 'USD', 45200, 5424, 542, '2026-Q3', 'accrued')$$,
  'a payment against an untaxed invoice still accrues on the whole payment'
);

-- The seeded accrual is the proof that no persisted history has been restated:
-- it was written under 000930 against a zero-tax invoice, and 001414's rule
-- reproduces it unchanged.
select is(
  (select core_divide_round_half_away(
            p.amount_minor::numeric * (i.amount_minor - i.tax_minor)::numeric,
            i.amount_minor::numeric)
     from commission_accruals a
     join payments p on p.id = a.source_id
     join invoices i on i.id = a.invoice_id
     where a.id = '93500000-0000-4000-8000-000000000001'),
  (select net_collected_revenue_minor from commission_accruals
     where id = '93500000-0000-4000-8000-000000000001'),
  'the accrual the seed already carries is exactly what the new rule requires of it'
);

-- The reconciliation stated against the ROW rather than against a literal: the
-- collected accruals on a fully paid taxed invoice come to the invoice's own
-- net. A literal here would also be asserting what this file's own arithmetic
-- happens to be, and would say nothing if both were wrong together.
select is(
  (select sum(a.net_collected_revenue_minor)::bigint
     from commission_accruals a
     where a.invoice_id = '90000000-0000-4000-8000-000000000414'
       and a.source_type = 'payment'),
  (select i.amount_minor - i.tax_minor from invoices i
     where i.id = '90000000-0000-4000-8000-000000000414'),
  'the collected accruals reconcile to the taxed invoice''s own net, read from the row'
);

select * from finish();
rollback;
