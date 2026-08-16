begin;
select plan(17);
set local search_path = public, extensions;

-- An invoice now carries the tax it charges and the determination that produced
-- it. Every tax figure below is a fixture: this file pins the arithmetic and the
-- refusals, never a rate. What a jurisdiction actually charges is EXT-TAX-01.
--
-- The seeded direct order (80000000-...-0001, USD, 2026-01-01 to 2026-12-31,
-- one line, quote total 180000 minor, PO-DEMO-001) is the same fixture 1390
-- uses. amount_minor is the amount owed and is therefore gross; the net the
-- quote-and-amendment identity is checked against is amount_minor - tax_minor.
--
-- Deliberately no `set session_replication_role = replica`: the projection
-- trigger is the subject here and replica mode would silence it.

select has_column(
  'public', 'invoices', 'tax_minor',
  'an invoice records the tax it charges'
);
select has_column(
  'public', 'invoices', 'tax_treatment',
  'an invoice records how the supply was treated'
);
select col_not_null(
  'public', 'invoices', 'tax_minor',
  'every invoice states a tax amount, even when that amount is zero'
);
select col_not_null(
  'public', 'invoices', 'tax_treatment',
  'every invoice states how it was treated'
);

-- Every row written before this migration was written without asking anybody,
-- and says so. 'not_determined' is not a synonym for zero-rated, which is the
-- distinction the seeded rows would have lost had the column defaulted to
-- 'standard' at zero.
select ok(
  (select count(*) from invoices) > 0
    and not exists (
      select 1 from invoices where tax_treatment <> 'not_determined'
    ),
  'invoices written before any determination existed record that none was made'
);

-- 001415 widened this vocabulary to the six values the determination engine
-- actually returns, `zero_rated` among them, so the refusal is now pinned with
-- a value that is outside the engine's vocabulary rather than merely outside
-- 001392's. The assertion is the same one: the column is a closed vocabulary
-- and not free text. 1415 covers which six are admitted and why.
select throws_ok(
  $$insert into invoices (id, order_id, account_id, currency, amount_minor,
                          tax_minor, tax_treatment, po_number, status)
    values ('90000000-0000-4000-8000-000000000191',
            '80000000-0000-4000-8000-000000000001',
            '10000000-0000-4000-8000-000000000001',
            'USD', 180000, 0, 'reduced_rate', 'PO-DEMO-001', 'draft')$$,
  '23514',
  null,
  'a treatment outside the vocabulary the provider answers in is refused'
);

-- A reverse-charged supply is billed net by definition. A rate against one is
-- not a small mistake: it is the merchant charging tax the buyer will also
-- self-account for.
select throws_ok(
  $$insert into invoices (id, order_id, account_id, currency, amount_minor,
                          tax_minor, tax_treatment, po_number, status)
    values ('90000000-0000-4000-8000-000000000192',
            '80000000-0000-4000-8000-000000000001',
            '10000000-0000-4000-8000-000000000001',
            'USD', 195750, 15750, 'reverse_charge', 'PO-DEMO-001', 'draft')$$,
  '23514',
  null,
  'tax cannot be charged against a reverse-charged supply'
);

-- The column default cannot be used to smuggle a figure in behind it.
select throws_ok(
  $$insert into invoices (id, order_id, account_id, currency, amount_minor,
                          tax_minor, po_number, status)
    values ('90000000-0000-4000-8000-000000000193',
            '80000000-0000-4000-8000-000000000001',
            '10000000-0000-4000-8000-000000000001',
            'USD', 195750, 15750, 'PO-DEMO-001', 'draft')$$,
  '23514',
  null,
  'an amount with no determination behind it is refused'
);

-- A determined zero. Distinguishable from the seeded rows above, which is the
-- entire reason 'not_determined' exists as a separate value.
select lives_ok(
  $$insert into invoices (id, order_id, account_id, currency, amount_minor,
                          tax_minor, tax_treatment, po_number, status)
    values ('90000000-0000-4000-8000-000000000194',
            '80000000-0000-4000-8000-000000000001',
            '10000000-0000-4000-8000-000000000001',
            'USD', 180000, 0, 'standard', 'PO-DEMO-001', 'draft')$$,
  'a supply determined to carry no tax bills at the quote total'
);

-- Re-treating a persisted bill is re-pricing it. The net is untouched here, so
-- the derivation clause passes and the immutability clause is what refuses.
select throws_ok(
  $$update invoices set tax_treatment = 'exempt'
     where id = '90000000-0000-4000-8000-000000000194'$$,
  '23514',
  'persisted invoice commercial truth is immutable',
  'the treatment a bill was issued under cannot be changed after the fact'
);

select lives_ok(
  $$insert into invoices (id, order_id, account_id, currency, amount_minor,
                          tax_minor, tax_treatment, po_number, status)
    values ('90000000-0000-4000-8000-000000000195',
            '80000000-0000-4000-8000-000000000001',
            '10000000-0000-4000-8000-000000000001',
            'USD', 195750, 15750, 'standard', 'PO-DEMO-001', 'draft')$$,
  'a taxed invoice bills the quote total plus the tax determined on it'
);

select is(
  (select amount_minor - tax_minor from invoices
    where id = '90000000-0000-4000-8000-000000000195'),
  180000::bigint,
  'the net of a taxed invoice is still exactly what the quote said'
);

-- Before this migration the identity was against amount_minor, so a taxed
-- invoice was only persistable by understating the net by the tax.
select throws_ok(
  $$insert into invoices (id, order_id, account_id, currency, amount_minor,
                          tax_minor, tax_treatment, po_number, status)
    values ('90000000-0000-4000-8000-000000000196',
            '80000000-0000-4000-8000-000000000001',
            '10000000-0000-4000-8000-000000000001',
            'USD', 180000, 15750, 'standard', 'PO-DEMO-001', 'draft')$$,
  '23514',
  'invoice must derive account, currency, amount, and PO from its accepted order and quote',
  'tax cannot be taken out of the net the customer agreed to pay'
);

select throws_ok(
  $$update invoices set tax_minor = 0, tax_treatment = 'exempt'
     where id = '90000000-0000-4000-8000-000000000195'$$,
  '23514',
  'invoice must derive account, currency, amount, and PO from its accepted order and quote',
  'dropping the tax off a persisted bill silently raises its net and is refused'
);

-- P0-49 regression guard. 001390 made the identity quote total plus the order's
-- accepted amendment deltas; rewriting the function for tax must carry that
-- sum forward or an amended order becomes unbillable again.
--
-- The worked amendment is 1390's: one more unit for the term is a 180000 minor
-- full-period delta from 2026-07-01, 183 of 364 days remaining, 90495 billable.
insert into amendments (id, order_id, effective_on, kind, proration_method, document_id)
values ('82000000-0000-4000-8000-000000000012',
        '80000000-0000-4000-8000-000000000001',
        '2026-07-01','upgrade','daily','40000000-0000-4000-8000-000000000005');
insert into core_amendment_financial_terms (
  amendment_id, contractual_time_zone, proration_convention,
  period_starts_on, period_ends_on, billable_numerator,
  billable_denominator, currency, forecast_delta_minor, monthly_delta_minor
) values (
  '82000000-0000-4000-8000-000000000012', 'UTC', 'actual_actual',
  '2026-01-01', '2026-12-31', 183, 364, 'USD', 90495, 15000
);

select throws_ok(
  $$insert into invoices (id, order_id, account_id, currency, amount_minor,
                          tax_minor, tax_treatment, po_number, status)
    values ('90000000-0000-4000-8000-000000000197',
            '80000000-0000-4000-8000-000000000001',
            '10000000-0000-4000-8000-000000000001',
            'USD', 203662, 23167, 'standard', 'PO-DEMO-001', 'draft')$$,
  '23514',
  'invoice must derive account, currency, amount, and PO from its accepted order and quote',
  'an amended order is still not billable at the bare quote total plus tax'
);

-- 001393 moved the amendment sum onto the row as `amendment_delta_minor`, so
-- the writer states the delta it billed instead of the trigger re-summing it on
-- every later UPDATE. The net identity is unchanged: 180000 quoted + 90495
-- amended is still what 294157 gross less 23662 tax has to come to.
select lives_ok(
  $$insert into invoices (id, order_id, account_id, currency, amount_minor,
                          amendment_delta_minor, tax_minor, tax_treatment,
                          po_number, status)
    values ('90000000-0000-4000-8000-000000000198',
            '80000000-0000-4000-8000-000000000001',
            '10000000-0000-4000-8000-000000000001',
            'USD', 294157, 90495, 23662, 'standard', 'PO-DEMO-001', 'draft')$$,
  'an amended order bills the quote total, the amendment and the tax on both'
);

select is(
  (select amount_minor - tax_minor from invoices
    where id = '90000000-0000-4000-8000-000000000198'),
  270495::bigint,
  'the amendment the customer signed is still inside the taxed net'
);

select * from finish();
rollback;
