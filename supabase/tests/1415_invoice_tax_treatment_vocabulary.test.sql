begin;
select plan(12);
set local search_path = public, extensions;

-- The invoice header now speaks the determination engine's whole vocabulary,
-- and the amount invariant that came with 001392 is unchanged by the widening.
--
-- Fixture: the seeded direct order 80000000-...-0001, quote total 180000 USD,
-- PO-DEMO-001 — the same one 1392 uses, so the two files pin the same row
-- against the same identity.
--
-- Deliberately no `set session_replication_role = replica`: the projection
-- trigger and the two CHECKs are the subject, and replica mode silences the
-- first of them.

-- ---------------------------------------------------------------------------
-- The four treatments the engine reaches that the header could not record
-- ---------------------------------------------------------------------------

-- `zero_rated` is in scope at 0% with input tax recoverable; `exempt` is in
-- scope at nothing with input tax lost. Writing the first as the second is the
-- same zero on the bill and a different number in the accounts.
select lives_ok(
  $$insert into invoices (id, order_id, account_id, currency, amount_minor,
                          tax_minor, tax_treatment, po_number, status)
    values ('90000000-0000-4000-8000-000000000151',
            '80000000-0000-4000-8000-000000000001',
            '10000000-0000-4000-8000-000000000001',
            'USD', 180000, 0, 'zero_rated', 'PO-DEMO-001', 'draft')$$,
  'a zero-rated supply is recordable, and is not the same claim as an exempt one'
);

-- `out_of_scope` must not appear in a VAT return at all, which is precisely
-- what it cannot say while sharing a value with `exempt`, which must.
select lives_ok(
  $$insert into invoices (id, order_id, account_id, currency, amount_minor,
                          tax_minor, tax_treatment, po_number, status)
    values ('90000000-0000-4000-8000-000000000152',
            '80000000-0000-4000-8000-000000000001',
            '10000000-0000-4000-8000-000000000001',
            'USD', 180000, 0, 'out_of_scope', 'PO-DEMO-001', 'draft')$$,
  'a supply outside the territory entirely is recordable as such'
);

-- The one that is not merely a reporting distinction. A run of supplies in a
-- jurisdiction we hold no registration in is what a threshold breach is counted
-- from (001410, 001411). Recorded as `exempt` the count is unavailable and the
-- threshold is crossed with nothing to see.
select lives_ok(
  $$insert into invoices (id, order_id, account_id, currency, amount_minor,
                          tax_minor, tax_treatment, po_number, status)
    values ('90000000-0000-4000-8000-000000000153',
            '80000000-0000-4000-8000-000000000001',
            '10000000-0000-4000-8000-000000000001',
            'USD', 180000, 0, 'not_registered', 'PO-DEMO-001', 'draft')$$,
  'a supply in a jurisdiction we hold no registration in is recordable, which is what a threshold breach is counted from'
);

select is(
  (select array_agg(distinct tax_treatment order by tax_treatment)
     from invoices
     where id in ('90000000-0000-4000-8000-000000000151',
                  '90000000-0000-4000-8000-000000000152',
                  '90000000-0000-4000-8000-000000000153')),
  array['not_registered','out_of_scope','zero_rated'],
  'the three are stored as three distinct values and not collapsed into one'
);

-- ---------------------------------------------------------------------------
-- The vocabulary is still closed
-- ---------------------------------------------------------------------------

select throws_ok(
  $$insert into invoices (id, order_id, account_id, currency, amount_minor,
                          tax_minor, tax_treatment, po_number, status)
    values ('90000000-0000-4000-8000-000000000154',
            '80000000-0000-4000-8000-000000000001',
            '10000000-0000-4000-8000-000000000001',
            'USD', 180000, 0, 'reduced_rate', 'PO-DEMO-001', 'draft')$$,
  '23514',
  'new row for relation "invoices" violates check constraint "invoices_tax_treatment_check"',
  'widening the vocabulary did not open it: a value the engine never returns is still refused'
);

-- `not_determined` is retained for history and means "nobody asked". Losing it
-- in the widening would have made every pre-determination row indistinguishable
-- from a determined zero.
select lives_ok(
  $$insert into invoices (id, order_id, account_id, currency, amount_minor,
                          tax_minor, tax_treatment, po_number, status)
    values ('90000000-0000-4000-8000-000000000155',
            '80000000-0000-4000-8000-000000000001',
            '10000000-0000-4000-8000-000000000001',
            'USD', 180000, 0, 'not_determined', 'PO-DEMO-001', 'draft')$$,
  'not_determined survives the widening, so history keeps saying nobody asked'
);
select ok(
  (select count(*) from invoices where tax_treatment = 'not_determined') > 0,
  'and the rows that already carried it are still there'
);

-- ---------------------------------------------------------------------------
-- ONLY STANDARD ADMITS A NON-ZERO AMOUNT, across all six
-- ---------------------------------------------------------------------------

select lives_ok(
  $$insert into invoices (id, order_id, account_id, currency, amount_minor,
                          tax_minor, tax_treatment, po_number, status)
    values ('90000000-0000-4000-8000-000000000156',
            '80000000-0000-4000-8000-000000000001',
            '10000000-0000-4000-8000-000000000001',
            'USD', 195750, 15750, 'standard', 'PO-DEMO-001', 'draft')$$,
  'standard is the one treatment that admits an amount, and still does'
);

-- REVERSE CHARGE IS THE ONE WORTH CHECKING, because unlike the other four it is
-- a supply that genuinely IS taxed -- by the customer, under their own regime.
-- Our document carries the notation and no figure. A merchant charging here
-- charges tax the buyer will also self-account for, so the invariant holds for
-- a reason about the transaction and not about the fixture.
select throws_ok(
  $$insert into invoices (id, order_id, account_id, currency, amount_minor,
                          tax_minor, tax_treatment, po_number, status)
    values ('90000000-0000-4000-8000-000000000157',
            '80000000-0000-4000-8000-000000000001',
            '10000000-0000-4000-8000-000000000001',
            'USD', 195750, 15750, 'reverse_charge', 'PO-DEMO-001', 'draft')$$,
  '23514',
  'new row for relation "invoices" violates check constraint "invoices_tax_amount_check"',
  'a reverse-charged supply still cannot carry an amount: the customer assesses it, we do not charge it'
);

select throws_ok(
  $$insert into invoices (id, order_id, account_id, currency, amount_minor,
                          tax_minor, tax_treatment, po_number, status)
    values ('90000000-0000-4000-8000-000000000158',
            '80000000-0000-4000-8000-000000000001',
            '10000000-0000-4000-8000-000000000001',
            'USD', 195750, 15750, 'zero_rated', 'PO-DEMO-001', 'draft')$$,
  '23514',
  'new row for relation "invoices" violates check constraint "invoices_tax_amount_check"',
  'a zero rate is a rate of zero, and the widening did not let an amount in behind it'
);

select throws_ok(
  $$insert into invoices (id, order_id, account_id, currency, amount_minor,
                          tax_minor, tax_treatment, po_number, status)
    values ('90000000-0000-4000-8000-000000000159',
            '80000000-0000-4000-8000-000000000001',
            '10000000-0000-4000-8000-000000000001',
            'USD', 195750, 15750, 'out_of_scope', 'PO-DEMO-001', 'draft')$$,
  '23514',
  'new row for relation "invoices" violates check constraint "invoices_tax_amount_check"',
  'nothing is charged where no authority has ruled'
);

-- The most dangerous of the four to leave open: charging tax in a jurisdiction
-- we hold no registration in is collecting money we have no authority to
-- collect.
select throws_ok(
  $$insert into invoices (id, order_id, account_id, currency, amount_minor,
                          tax_minor, tax_treatment, po_number, status)
    values ('90000000-0000-4000-8000-000000000160',
            '80000000-0000-4000-8000-000000000001',
            '10000000-0000-4000-8000-000000000001',
            'USD', 195750, 15750, 'not_registered', 'PO-DEMO-001', 'draft')$$,
  '23514',
  'new row for relation "invoices" violates check constraint "invoices_tax_amount_check"',
  'an unregistered merchant cannot charge the rate it would have charged'
);

select * from finish();
rollback;
