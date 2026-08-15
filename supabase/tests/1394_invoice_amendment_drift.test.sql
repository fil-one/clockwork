begin;
select plan(9);
set local search_path = public, extensions;

-- P0-49, residual A. 001393 claimed a post-invoice amendment reached finance as
-- a derivation variance. It did not: the variance was saturated by a
-- gross-versus-net comparison before any amendment existed, so "not zero" said
-- nothing. This is the signal that does say something, and every assertion below
-- is written so that it FAILS if the amendment it is about is removed.
--
-- Fixture: seeded direct order 80000000-...-0001 (USD, 2026-01-01 to 2026-12-31,
-- quote total 180000, PO-DEMO-001) and its invoice 90000000-...-0001 at 180000
-- with no tax and amendment_delta_minor 0. The seeded amendment 82000000-...-0001
-- predates 001390 and carries no financial terms.

select has_view(
  'public', 'core_invoice_amendment_drift',
  'finance can read what an invoice billed against what has since been accepted'
);

-- Zero, not null, before anything is amended. A detection signal that cannot
-- report "nothing has happened" cannot report that something has.
select is(
  (select unbilled_amendment_delta_minor from core_invoice_amendment_drift
    where invoice_id = '90000000-0000-4000-8000-000000000001'),
  0::bigint,
  'an invoice whose order has accepted nothing priced since reports zero drift'
);
select is(
  (select count(*)::bigint from core_invoice_amendment_drift
    where order_id in (
      '80000000-0000-4000-8000-000000000001',
      '80000000-0000-4000-8000-000000000002',
      '80000000-0000-4000-8000-000000000003',
      '80000000-0000-4000-8000-000000000004',
      '80000000-0000-4000-8000-000000000006'
    )
      and unbilled_amendment_delta_minor <> 0),
  0::bigint,
  'no seeded invoice carries unbilled amendment value'
);

-- An amendment carrying no financial terms is not drift. There is no fraction to
-- price its delta lines through, so there is no amount owed to be missing from
-- the bill; `amendment_lines` alone states a full-period contractual delta. This
-- is the same treatment the 001393 insert check gives it, and it is what stops
-- the seeded pre-001390 amendment reading as a permanent alarm.
insert into amendments (id, order_id, effective_on, kind, proration_method, document_id)
values ('82000000-0000-4000-8000-0000000000a1','80000000-0000-4000-8000-000000000001',
        '2026-07-01','upgrade','daily','40000000-0000-4000-8000-000000000005');
select is(
  (select unbilled_amendment_delta_minor from core_invoice_amendment_drift
    where invoice_id = '90000000-0000-4000-8000-000000000001'),
  0::bigint,
  'an amendment with no priced terms is not unbilled value'
);

-- Now one that is worth money, accepted after the invoice was written. This is
-- the case 001393 left undetectable.
insert into core_amendment_financial_terms (
  amendment_id, contractual_time_zone, proration_convention,
  period_starts_on, period_ends_on, billable_numerator,
  billable_denominator, currency, forecast_delta_minor, monthly_delta_minor
) values (
  '82000000-0000-4000-8000-0000000000a1', 'UTC', 'actual_actual',
  '2026-01-01', '2026-12-31', 183, 364, 'USD', 90495, 15000
);
select is(
  (select unbilled_amendment_delta_minor from core_invoice_amendment_drift
    where invoice_id = '90000000-0000-4000-8000-000000000001'),
  90495::bigint,
  'an upgrade accepted after the bill shows as exactly its own forecast delta'
);
select is(
  (select billed_amendment_delta_minor from core_invoice_amendment_drift
    where invoice_id = '90000000-0000-4000-8000-000000000001'),
  0::bigint,
  'and the amount the invoice actually billed is untouched by it'
);

-- Signed. A downgrade accepted after the bill is money owed BACK, and clamping
-- it at zero would hide the credit note.
insert into amendments (id, order_id, effective_on, kind, proration_method, document_id)
values ('82000000-0000-4000-8000-0000000000a2','80000000-0000-4000-8000-000000000001',
        '2026-07-01','downgrade','daily','40000000-0000-4000-8000-000000000005');
insert into core_amendment_financial_terms (
  amendment_id, contractual_time_zone, proration_convention,
  period_starts_on, period_ends_on, billable_numerator,
  billable_denominator, currency, forecast_delta_minor, monthly_delta_minor
) values (
  '82000000-0000-4000-8000-0000000000a2', 'UTC', 'actual_actual',
  '2026-01-01', '2026-12-31', 183, 364, 'USD', -120495, -20000
);
select is(
  (select unbilled_amendment_delta_minor from core_invoice_amendment_drift
    where invoice_id = '90000000-0000-4000-8000-000000000001'),
  -30000::bigint,
  'a net negative post-invoice amendment reports negative, not zero'
);

-- An invoice written NOW against that same order bills the amendments and
-- therefore reports no drift of its own, while the older invoice keeps its own.
-- The two rows disagreeing is the whole point: drift is per bill, not per order.
insert into invoices (
  id, order_id, account_id, currency, amount_minor, amendment_delta_minor,
  tax_minor, tax_treatment, po_number, status
) values (
  '9b000000-0000-4000-8000-000000000001',
  '80000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'USD', 150000, -30000, 0, 'standard', 'PO-DEMO-001', 'draft'
);
select is(
  (select unbilled_amendment_delta_minor from core_invoice_amendment_drift
    where invoice_id = '9b000000-0000-4000-8000-000000000001'),
  0::bigint,
  'an invoice written after the amendments bills them and reports no drift'
);
select is(
  (select unbilled_amendment_delta_minor from core_invoice_amendment_drift
    where invoice_id = '90000000-0000-4000-8000-000000000001'),
  -30000::bigint,
  'and the earlier bill still reports the value it never carried'
);

select * from finish();
rollback;
