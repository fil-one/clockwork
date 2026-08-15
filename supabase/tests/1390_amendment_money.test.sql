begin;
select plan(18);
set local search_path = public, extensions;

-- An accepted amendment now lands as money, not as a header. These pin the
-- arithmetic that ties the three tables together, on the seeded direct order
-- (2026-01-01 to 2026-12-31, USD, one line at 15000 a unit over twelve months).
--
-- The worked amendment: one more unit for the whole term is a 180000 minor
-- full-period delta, taken daily from 2026-07-01. 183 of the term's 364 days
-- remain, so 180000 x 183 / 364 = 90494.505..., which rounds away from zero to
-- 90495 minor billable. That is the number the invoice adds and the number
-- deriveInvoice re-derives, so it is the number the supersession must carry.

select has_trigger(
  'public', 'core_amendment_financial_terms',
  'core_amendment_financial_terms_money',
  'amendment financial terms are checked against the order they prorate'
);
select has_trigger(
  'public', 'core_amendment_line_supersessions',
  'core_amendment_line_supersessions_money',
  'an amendment supersession is checked against the delta line it bills'
);

insert into amendments (id, order_id, effective_on, kind, proration_method, document_id)
values
  ('82000000-0000-4000-8000-000000000002','80000000-0000-4000-8000-000000000001',
   '2026-07-01','upgrade','daily','40000000-0000-4000-8000-000000000005'),
  ('82000000-0000-4000-8000-000000000003','80000000-0000-4000-8000-000000000001',
   '2027-06-01','upgrade','daily','40000000-0000-4000-8000-000000000005'),
  ('82000000-0000-4000-8000-000000000004','80000000-0000-4000-8000-000000000001',
   '2026-07-01','upgrade','daily','40000000-0000-4000-8000-000000000005'),
  ('82000000-0000-4000-8000-000000000005','80000000-0000-4000-8000-000000000001',
   '2026-07-01','downgrade','daily','40000000-0000-4000-8000-000000000005');

-- The period is the order's term. A shorter one rescales every delta hanging
-- off it without changing a single stored amount.
select throws_ok(
  $$insert into core_amendment_financial_terms (
      amendment_id, contractual_time_zone, proration_convention,
      period_starts_on, period_ends_on, billable_numerator,
      billable_denominator, currency, forecast_delta_minor, monthly_delta_minor
    ) values (
      '82000000-0000-4000-8000-000000000002', 'UTC', 'actual_actual',
      '2026-07-01', '2026-12-31', 183, 364, 'USD', 90495, 15000
    )$$,
  '23514',
  'amendment financial terms must span the order service period',
  'an amendment cannot be prorated over a period that is not the order term'
);

select throws_ok(
  $$insert into core_amendment_financial_terms (
      amendment_id, contractual_time_zone, proration_convention,
      period_starts_on, period_ends_on, billable_numerator,
      billable_denominator, currency, forecast_delta_minor, monthly_delta_minor
    ) values (
      '82000000-0000-4000-8000-000000000002', 'UTC', 'actual_actual',
      '2026-01-01', '2026-12-31', 183, 364, 'EUR', 90495, 15000
    )$$,
  '23514',
  'amendment financial terms must be denominated in the order currency',
  'an amendment cannot move an order in a currency the order is not priced in'
);

select throws_ok(
  $$insert into core_amendment_financial_terms (
      amendment_id, contractual_time_zone, proration_convention,
      period_starts_on, period_ends_on, billable_numerator,
      billable_denominator, currency, forecast_delta_minor, monthly_delta_minor
    ) values (
      '82000000-0000-4000-8000-000000000003', 'UTC', 'actual_actual',
      '2026-01-01', '2026-12-31', 183, 364, 'USD', 90495, 15000
    )$$,
  '23514',
  'amendment takes effect outside the period it is prorated over',
  'an amendment effective after the term cannot be prorated across it'
);

-- 82...0004 never gets financial terms, so the money behind its supersession
-- is not derivable and the supersession is refused rather than stored.
update order_lines
   set superseded_by_amendment_id = '82000000-0000-4000-8000-000000000004'
 where id = '81000000-0000-4000-8000-000000000001';
insert into amendment_lines (amendment_id, order_line_id, sku, quantity_delta, price_delta_minor)
values ('82000000-0000-4000-8000-000000000004',
        '81000000-0000-4000-8000-000000000001', 'LOCKED-STORAGE-TB', 1, 180000);
select throws_ok(
  $$insert into core_amendment_line_supersessions (
      amendment_id, superseded_order_line_id, replacement_snapshot,
      effective_on, net_quantity_delta, net_revenue_delta_minor
    ) values (
      '82000000-0000-4000-8000-000000000004',
      '81000000-0000-4000-8000-000000000001', '{}'::jsonb,
      '2026-07-01', 1, 90495
    )$$,
  '23514',
  'amendment supersession requires the amendment financial terms',
  'a supersession without the proration it was billed at is not derivable'
);

select lives_ok(
  $$insert into core_amendment_financial_terms (
      amendment_id, contractual_time_zone, proration_convention,
      period_starts_on, period_ends_on, billable_numerator,
      billable_denominator, currency, forecast_delta_minor, monthly_delta_minor
    ) values (
      '82000000-0000-4000-8000-000000000002', 'UTC', 'actual_actual',
      '2026-01-01', '2026-12-31', 183, 364, 'USD', 90495, 15000
    )$$,
  'an amendment records the period, fraction and forecast it was prorated by'
);

-- The order is now signed for 180000 quoted plus 90495 amended. Before this,
-- `q.total_minor = new.amount_minor` (000920:65) admitted only the first
-- number, so an invoice that billed the upgrade could not be persisted at all.
--
-- 001393 moved the amendment sum onto the invoice row as
-- `amendment_delta_minor`, so the writer now states the delta it billed and the
-- trigger checks that statement against the live sum at INSERT. The refusal
-- below is therefore the sum check by name rather than the general identity;
-- the bare quote total is still exactly as unbillable.
select throws_ok(
  $$insert into invoices (id, order_id, account_id, currency, amount_minor, po_number, status)
    values ('90000000-0000-4000-8000-000000000091',
            '80000000-0000-4000-8000-000000000001',
            '10000000-0000-4000-8000-000000000001',
            'USD', 180000, 'PO-DEMO-001', 'draft')$$,
  '23514',
  'invoice amendment delta must equal the net forecast delta of its order amendments',
  'an amended order can no longer be billed at the bare quote total'
);

select lives_ok(
  $$insert into invoices (id, order_id, account_id, currency, amount_minor,
                          amendment_delta_minor, po_number, status)
    values ('90000000-0000-4000-8000-000000000092',
            '80000000-0000-4000-8000-000000000001',
            '10000000-0000-4000-8000-000000000001',
            'USD', 270495, 90495, 'PO-DEMO-001', 'draft')$$,
  'an invoice bills the quote total plus the amendment the customer signed'
);

select throws_ok(
  $$insert into core_amendment_line_supersessions (
      amendment_id, superseded_order_line_id, replacement_snapshot,
      effective_on, net_quantity_delta, net_revenue_delta_minor
    ) values (
      '82000000-0000-4000-8000-000000000002',
      '81000000-0000-4000-8000-000000000001', '{}'::jsonb,
      '2026-07-01', 1, 90495
    )$$,
  '23514',
  'amendment supersession requires its amendment delta line',
  'a supersession cannot bill revenue no delta line asked for'
);

insert into amendment_lines (amendment_id, order_line_id, sku, quantity_delta, price_delta_minor)
values ('82000000-0000-4000-8000-000000000002',
        '81000000-0000-4000-8000-000000000001', 'LOCKED-STORAGE-TB', 1, 180000);

-- The order line still names 82...0004 from the probe above.
select throws_ok(
  $$insert into core_amendment_line_supersessions (
      amendment_id, superseded_order_line_id, replacement_snapshot,
      effective_on, net_quantity_delta, net_revenue_delta_minor
    ) values (
      '82000000-0000-4000-8000-000000000002',
      '81000000-0000-4000-8000-000000000001', '{}'::jsonb,
      '2026-07-01', 1, 90495
    )$$,
  '23514',
  'superseded order line must name the amendment that superseded it',
  'a superseded line that still reads as current cannot carry a supersession'
);

update order_lines
   set superseded_by_amendment_id = '82000000-0000-4000-8000-000000000002'
 where id = '81000000-0000-4000-8000-000000000001';

select throws_ok(
  $$insert into core_amendment_line_supersessions (
      amendment_id, superseded_order_line_id, replacement_snapshot,
      effective_on, net_quantity_delta, net_revenue_delta_minor
    ) values (
      '82000000-0000-4000-8000-000000000002',
      '81000000-0000-4000-8000-000000000001', '{}'::jsonb,
      '2026-07-01', 2, 90495
    )$$,
  '23514',
  'amendment supersession quantity must equal its delta line',
  'a supersession cannot commit a quantity the amendment did not change'
);

-- 90494 is the truncation. The stored fraction rounds away from zero, so the
-- one minor unit between the two is a real disagreement, not a preference.
select throws_ok(
  $$insert into core_amendment_line_supersessions (
      amendment_id, superseded_order_line_id, replacement_snapshot,
      effective_on, net_quantity_delta, net_revenue_delta_minor
    ) values (
      '82000000-0000-4000-8000-000000000002',
      '81000000-0000-4000-8000-000000000001', '{}'::jsonb,
      '2026-07-01', 1, 90494
    )$$,
  '23514',
  'amendment supersession revenue must equal its prorated delta line',
  'billable revenue that is not the delta line taken through the fraction is refused'
);

select lives_ok(
  $$insert into core_amendment_line_supersessions (
      amendment_id, superseded_order_line_id, replacement_snapshot,
      effective_on, net_quantity_delta, net_revenue_delta_minor
    ) values (
      '82000000-0000-4000-8000-000000000002',
      '81000000-0000-4000-8000-000000000001', '{}'::jsonb,
      '2026-07-01', 1, 90495
    )$$,
  'an upgrade supersession stores the prorated revenue the invoice bills'
);

select is(
  (select net_revenue_delta_minor from core_amendment_line_supersessions
    where amendment_id = '82000000-0000-4000-8000-000000000002'),
  90495::bigint,
  'the derivation reads back exactly the minor units the amendment added'
);

-- A downgrade is negative in both columns. Nothing here clamps it.
insert into amendment_lines (amendment_id, order_line_id, sku, quantity_delta, price_delta_minor)
values ('82000000-0000-4000-8000-000000000005',
        '81000000-0000-4000-8000-000000000001', 'LOCKED-STORAGE-TB', -1, -180000);
insert into core_amendment_financial_terms (
  amendment_id, contractual_time_zone, proration_convention,
  period_starts_on, period_ends_on, billable_numerator,
  billable_denominator, currency, forecast_delta_minor, monthly_delta_minor
) values (
  '82000000-0000-4000-8000-000000000005', 'UTC', 'actual_actual',
  '2026-01-01', '2026-12-31', 183, 364, 'USD', -90495, -15000
);
update order_lines
   set superseded_by_amendment_id = '82000000-0000-4000-8000-000000000005'
 where id = '81000000-0000-4000-8000-000000000001';

select throws_ok(
  $$insert into core_amendment_line_supersessions (
      amendment_id, superseded_order_line_id, replacement_snapshot,
      effective_on, net_quantity_delta, net_revenue_delta_minor
    ) values (
      '82000000-0000-4000-8000-000000000005',
      '81000000-0000-4000-8000-000000000001', '{}'::jsonb,
      '2026-07-01', -1, 0
    )$$,
  '23514',
  'amendment supersession revenue must equal its prorated delta line',
  'a downgrade clamped to zero is refused: the credit is the whole point'
);

select lives_ok(
  $$insert into core_amendment_line_supersessions (
      amendment_id, superseded_order_line_id, replacement_snapshot,
      effective_on, net_quantity_delta, net_revenue_delta_minor
    ) values (
      '82000000-0000-4000-8000-000000000005',
      '81000000-0000-4000-8000-000000000001', '{}'::jsonb,
      '2026-07-01', -1, -90495
    )$$,
  'a downgrade supersession stores the credit it owes, signed'
);

select is(
  (select sum(net_revenue_delta_minor)::bigint
     from core_amendment_line_supersessions
    where superseded_order_line_id = '81000000-0000-4000-8000-000000000001'),
  0::bigint,
  'an upgrade and the downgrade that reverses it net to nothing on the line'
);

select * from finish();
rollback;
