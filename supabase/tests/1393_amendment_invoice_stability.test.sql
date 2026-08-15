begin;
select plan(15);
set local search_path = public, extensions;

-- P0-49. An invoice's amount identity has to be true for the life of the row,
-- not only at the instant it is written. 001390 made it depend on a live sum
-- over `core_amendment_financial_terms`, and `invoices_projection_truth` fires
-- BEFORE INSERT OR UPDATE, so the first amendment accepted after an invoice
-- existed made every subsequent UPDATE of that invoice fail — including the
-- settlement writes that record the customer's payment.
--
-- Fixture: the seeded direct order 80000000-...-0001 (USD, 2026-01-01 to
-- 2026-12-31, quote total 180000 minor, PO-DEMO-001) and its invoice
-- 90000000-...-0001 at 180000 with no tax. The seeded amendment
-- 82000000-...-0001 is effective 2026-07-01 and carries no financial terms,
-- which is why the seed predates 001390 and contributes nothing to the sum.
--
-- Deliberately no `set session_replication_role = replica`: the projection
-- trigger is the subject here.

select has_column(
  'public', 'invoices', 'amendment_delta_minor',
  'an invoice records the amendment delta it billed'
);
select col_not_null(
  'public', 'invoices', 'amendment_delta_minor',
  'every invoice states an amendment delta, even when that delta is zero'
);

-- Backfill. The delta a row already at rest in fact applied is the slack
-- between the net it billed and its quote total, because that identity is what
-- the trigger required of it when it was written. Rows written before any
-- amendment carried money land on zero; a row already bricked by a post-invoice
-- amendment is restored to satisfying its own constraint.
select col_default_is(
  'public', 'invoices', 'amendment_delta_minor', '0',
  'an invoice bills no amendment unless its writer says otherwise'
);
select ok(
  not exists (
    select 1 from invoices i
      join orders o on o.id = i.order_id
      join quotes q on q.id = o.quote_id
     where q.total_minor + i.amendment_delta_minor
             <> i.amount_minor - i.tax_minor
  ),
  'every persisted invoice already satisfies the stable identity'
);

-- The regression itself. An amendment lands on an order that is already
-- invoiced, which nothing on the write path forbids, and then the money writers
-- run: issuance binds the provider identifier and opens the invoice
-- (workflows/core.ts), and the verified Stripe settlement projection records
-- what was paid (system/providers.ts). Both must succeed.
insert into core_amendment_financial_terms (
  amendment_id, contractual_time_zone, proration_convention,
  period_starts_on, period_ends_on, billable_numerator,
  billable_denominator, currency, forecast_delta_minor, monthly_delta_minor
) values (
  '82000000-0000-4000-8000-000000000001', 'UTC', 'actual_actual',
  '2026-01-01', '2026-12-31', 183, 364, 'USD', 90495, 15000
);

select lives_ok(
  $$update invoices
       set stripe_invoice_id = 'in_post_amendment_1393',
           status = 'open',
           updated_at = now()
     where id = '90000000-0000-4000-8000-000000000001'$$,
  'issuance can still bind a provider invoice after a later amendment lands'
);
select lives_ok(
  $$update invoices
       set amount_paid_minor = 50000,
           stripe_last_occurred_at = now(),
           stripe_last_event_id = 'evt_post_amendment_1393',
           updated_at = now()
     where id = '90000000-0000-4000-8000-000000000001'$$,
  'a customer payment can still be recorded after a later amendment lands'
);
select is(
  (select amount_remaining_minor from invoices
    where id = '90000000-0000-4000-8000-000000000001'),
  130000::bigint,
  'the settled amount reaches amount_remaining_minor instead of staying at the full bill'
);
-- The invoice is not re-priced by an amendment accepted after it was issued.
-- The difference is reported by `core_invoice_amendment_drift` (001394) as
-- `unbilled_amendment_delta_minor`, which is the accepted amendment sum less
-- the frozen `amendment_delta_minor` this row billed — exact, signed, and zero
-- when nothing has moved. It is NOT deriveInvoice's INVOICE_TOTAL_VARIANCE:
-- that note is saturated by a basis mismatch of its own and 001394 records why
-- nothing should be built on it. Settling the difference still needs a credit
-- note or a supplementary invoice, and no writer issues either; 001393 records
-- why that is named rather than invented here.
select is(
  (select amount_minor from invoices
    where id = '90000000-0000-4000-8000-000000000001'),
  180000::bigint,
  'the issued amount is unchanged by an amendment accepted after it'
);

-- The stored figure is the constraint's subject, so it is immutable like the
-- amount it explains. Editing it is how you would launder a different bill past
-- the identity.
-- Moving it alone breaks the identity first; moving it together with the amount
-- it explains keeps the identity true and is caught as what it is.
select throws_ok(
  $$update invoices set amendment_delta_minor = 90495
     where id = '90000000-0000-4000-8000-000000000001'$$,
  '23514',
  'invoice must derive account, currency, amount, and PO from its accepted order and quote',
  'the billed amendment delta cannot be edited away from the amount it explains'
);
select throws_ok(
  $$update invoices
       set amendment_delta_minor = 90495,
           amount_minor = 270495
     where id = '90000000-0000-4000-8000-000000000001'$$,
  '23514',
  'persisted invoice commercial truth is immutable',
  'a persisted bill cannot be re-priced in place to match a later amendment'
);

-- What 001390 got right is kept exactly where it means something. At INSERT the
-- live sum IS the truth about what this invoice bills, so a writer that states a
-- delta the database does not agree with cannot persist a bill, in either
-- direction.
select throws_ok(
  $$insert into invoices (
      id, order_id, account_id, currency, amount_minor, amendment_delta_minor,
      tax_minor, tax_treatment, po_number, status
    ) values (
      '9a000000-0000-4000-8000-000000000001',
      '80000000-0000-4000-8000-000000000005',
      '10000000-0000-4000-8000-000000000001',
      'USD', 144000, 0, 0, 'standard', null, 'draft'
    )$$,
  '23514',
  'invoice must derive account, currency, amount, and PO from its accepted order and quote',
  'an invoice on another account is still refused'
);

-- Order 80000000-...-0006 is seeded with quote total 156000 and an invoice of
-- its own, so a second bill for it is refused on the amount identity before any
-- amendment is involved. The pair below uses the amended order instead: its
-- invoice already exists, so the delta arithmetic is checked through the update
-- path above and through this insert refusal.
select throws_ok(
  $$insert into invoices (
      id, order_id, account_id, currency, amount_minor, amendment_delta_minor,
      tax_minor, tax_treatment, po_number, status
    ) values (
      '9a000000-0000-4000-8000-000000000002',
      '80000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      'USD', 180000, 0, 0, 'standard', 'PO-DEMO-001', 'draft'
    )$$,
  '23514',
  'invoice amendment delta must equal the net forecast delta of its order amendments',
  'an invoice that ignores an accepted amendment cannot be written'
);
select throws_ok(
  $$insert into invoices (
      id, order_id, account_id, currency, amount_minor, amendment_delta_minor,
      tax_minor, tax_treatment, po_number, status
    ) values (
      '9a000000-0000-4000-8000-000000000003',
      '80000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      'USD', 280000, 100000, 0, 'standard', 'PO-DEMO-001', 'draft'
    )$$,
  '23514',
  'invoice amendment delta must equal the net forecast delta of its order amendments',
  'an invoice that overstates the amendment it bills cannot be written either'
);

-- The delta is signed. A downgrade lowers the bill exactly as an upgrade raises
-- it, and nothing on this path clamps it at zero.
insert into amendments (id, order_id, effective_on, kind, proration_method, document_id)
values ('82000000-0000-4000-8000-00000000009d','80000000-0000-4000-8000-000000000001',
        '2026-07-01','downgrade','daily','40000000-0000-4000-8000-000000000005');
insert into core_amendment_financial_terms (
  amendment_id, contractual_time_zone, proration_convention,
  period_starts_on, period_ends_on, billable_numerator,
  billable_denominator, currency, forecast_delta_minor, monthly_delta_minor
) values (
  '82000000-0000-4000-8000-00000000009d', 'UTC', 'actual_actual',
  '2026-01-01', '2026-12-31', 183, 364, 'USD', -120495, -20000
);
select lives_ok(
  $$insert into invoices (
      id, order_id, account_id, currency, amount_minor, amendment_delta_minor,
      tax_minor, tax_treatment, po_number, status
    ) values (
      '9a000000-0000-4000-8000-000000000004',
      '80000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      'USD', 150000, -30000, 0, 'standard', 'PO-DEMO-001', 'draft'
    )$$,
  'an invoice may bill a net negative amendment delta'
);
-- And that row is stable too: it was written against a sum of 90495 + -120495,
-- and it keeps settling after further amendments move that sum.
insert into amendments (id, order_id, effective_on, kind, proration_method, document_id)
values ('82000000-0000-4000-8000-00000000009e','80000000-0000-4000-8000-000000000001',
        '2026-07-01','upgrade','daily','40000000-0000-4000-8000-000000000005');
insert into core_amendment_financial_terms (
  amendment_id, contractual_time_zone, proration_convention,
  period_starts_on, period_ends_on, billable_numerator,
  billable_denominator, currency, forecast_delta_minor, monthly_delta_minor
) values (
  '82000000-0000-4000-8000-00000000009e', 'UTC', 'actual_actual',
  '2026-01-01', '2026-12-31', 183, 364, 'USD', 45000, 7000
);
select lives_ok(
  $$update invoices
       set stripe_invoice_id = 'in_signed_delta_1393',
           status = 'open',
           updated_at = now()
     where id = '9a000000-0000-4000-8000-000000000004'$$,
  'the negative-delta invoice settles after a further amendment moves the sum'
);

select * from finish();
rollback;
