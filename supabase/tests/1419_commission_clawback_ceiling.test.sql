-- The commission reversal ceiling is enforced by the database, including
-- writers that bypass the repository's advisory pre-check.
begin;
select plan(8);
set local search_path = public, extensions;

insert into invoices (
  id, order_id, account_id, stripe_invoice_id, currency,
  amount_minor, tax_minor, tax_treatment, po_number, status
) values
  (
    '90000000-0000-4000-8000-000000001419',
    '80000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000004',
    'in_fixture_1419_a', 'USD', 120000, 0, 'standard', 'PO-REF-002', 'open'
  ),
  (
    '90000000-0000-4000-8000-000000001429',
    '80000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000004',
    'in_fixture_1419_b', 'USD', 120000, 0, 'standard', 'PO-REF-002', 'open'
  );

insert into payments (
  id, invoice_id, order_id, stripe_payment_intent_id, currency,
  amount_minor, status, received_at
) values
  (
    '91000000-0000-4000-8000-000000001419',
    '90000000-0000-4000-8000-000000001419',
    '80000000-0000-4000-8000-000000000002',
    'pi_fixture_1419_a', 'USD', 120000, 'succeeded', '2026-08-01T16:00:00Z'
  ),
  (
    '91000000-0000-4000-8000-000000001429',
    '90000000-0000-4000-8000-000000001429',
    '80000000-0000-4000-8000-000000000002',
    'pi_fixture_1419_b', 'USD', 120000, 'succeeded', '2026-08-01T16:00:00Z'
  );

insert into commission_accruals (
  id, partner_account_id, invoice_id, source_type, source_id,
  rate_bps, holdback_bps, currency,
  net_collected_revenue_minor, amount_minor, holdback_minor, period, status
) values
  (
    '92000000-0000-4000-8000-000000001419',
    '10000000-0000-4000-8000-000000000002',
    '90000000-0000-4000-8000-000000001419',
    'payment', '91000000-0000-4000-8000-000000001419',
    1200, 1000, 'USD', 120000, 14400, 1440, '2026-Q3', 'accrued'
  ),
  (
    '92000000-0000-4000-8000-000000001429',
    '10000000-0000-4000-8000-000000000002',
    '90000000-0000-4000-8000-000000001429',
    'payment', '91000000-0000-4000-8000-000000001429',
    1200, 1000, 'USD', 120000, 14400, 1440, '2026-Q3', 'accrued'
  );

insert into credit_notes (
  id, invoice_id, order_id, stripe_credit_note_id, currency, amount_minor,
  reason_code, approved_by, status, created_at
) values (
  '93000000-0000-4000-8000-000000001419',
  '90000000-0000-4000-8000-000000001419',
  '80000000-0000-4000-8000-000000000002',
  'cn_fixture_1419', 'USD', 70000, 'commercial_correction',
  '20000000-0000-4000-8000-000000000001', 'issued', '2026-08-02T16:00:00Z'
);

select lives_ok(
  $$insert into commission_accruals (
      id, partner_account_id, invoice_id, source_type, source_id,
      adjustment_source_id, rate_bps, holdback_bps, currency,
      net_collected_revenue_minor, amount_minor, holdback_minor, period, status
    ) values (
      '92000000-0000-4000-8000-000000001420',
      '10000000-0000-4000-8000-000000000002',
      '90000000-0000-4000-8000-000000001419',
      'credit_note', '93000000-0000-4000-8000-000000001419',
      '92000000-0000-4000-8000-000000001419',
      1200, 1000, 'USD', -70000, -8400, -840, '2026-Q3', 'accrued')$$,
  'a partial clawback below the payment accrual succeeds'
);

insert into refunds (
  id, payment_id, order_id, stripe_refund_id, currency,
  amount_minor, reason_code, status, created_at
) values (
  '94000000-0000-4000-8000-000000001419',
  '91000000-0000-4000-8000-000000001419',
  '80000000-0000-4000-8000-000000000002',
  're_fixture_1419_over', 'USD', 60000, 'customer_request', 'succeeded',
  '2026-08-03T16:00:00Z'
);

select throws_ok(
  $$insert into commission_accruals (
      id, partner_account_id, invoice_id, source_type, source_id,
      adjustment_source_id, rate_bps, holdback_bps, currency,
      net_collected_revenue_minor, amount_minor, holdback_minor, period, status
    ) values (
      '92000000-0000-4000-8000-000000001421',
      '10000000-0000-4000-8000-000000000002',
      '90000000-0000-4000-8000-000000001419',
      'refund', '94000000-0000-4000-8000-000000001419',
      '92000000-0000-4000-8000-000000001419',
      1200, 1000, 'USD', -60000, -7200, -720, '2026-Q3', 'accrued')$$,
  '23514',
  'commission clawbacks must not exceed the accrual they reverse',
  'cumulative reversals above the original tax-exclusive base are refused'
);

select is(
  (select -sum(net_collected_revenue_minor)::bigint
     from commission_accruals
    where adjustment_source_id = '92000000-0000-4000-8000-000000001419'
      and source_type in ('credit_note', 'refund', 'dispute')),
  70000::bigint,
  'the refused insert leaves only the committed clawback outstanding'
);

insert into webhook_events (
  provider, provider_event_id, event_type, signature_verified_at,
  payload_hash, payload, occurred_at, locked_until
) values (
  'stripe', 'evt_fixture_1419_void', 'credit_note.voided',
  '2026-08-04T16:00:00Z', repeat('a', 64), '{}'::jsonb,
  '2026-08-04T16:00:00Z', '2026-08-04T16:00:00Z'
);
set local role clockwork_service;
update credit_notes
set status = 'void',
    stripe_last_event_id = 'evt_fixture_1419_void',
    stripe_last_occurred_at = '2026-08-04T16:00:00Z',
    version = version + 1
where id = '93000000-0000-4000-8000-000000001419';
reset role;

select lives_ok(
  $$insert into commission_accruals (
      id, partner_account_id, invoice_id, source_type, source_id,
      adjustment_source_id, rate_bps, holdback_bps, currency,
      net_collected_revenue_minor, amount_minor, holdback_minor, period, status
    ) values (
      '92000000-0000-4000-8000-000000001422',
      '10000000-0000-4000-8000-000000000002',
      '90000000-0000-4000-8000-000000001419',
      'credit_note_void', '93000000-0000-4000-8000-000000001419',
      '92000000-0000-4000-8000-000000001420',
      1200, 1000, 'USD', 70000, 8400, 840, '2026-Q3', 'accrued')$$,
  'voiding the credit-note clawback restores its headroom'
);

select lives_ok(
  $$insert into commission_accruals (
      id, partner_account_id, invoice_id, source_type, source_id,
      adjustment_source_id, rate_bps, holdback_bps, currency,
      net_collected_revenue_minor, amount_minor, holdback_minor, period, status
    ) values (
      '92000000-0000-4000-8000-000000001421',
      '10000000-0000-4000-8000-000000000002',
      '90000000-0000-4000-8000-000000001419',
      'refund', '94000000-0000-4000-8000-000000001419',
      '92000000-0000-4000-8000-000000001419',
      1200, 1000, 'USD', -60000, -7200, -720, '2026-Q3', 'accrued')$$,
  'the same refund fits after the void restores headroom'
);

insert into refunds (
  id, payment_id, order_id, stripe_refund_id, currency,
  amount_minor, reason_code, status, created_at
) values (
  '94000000-0000-4000-8000-000000001429',
  '91000000-0000-4000-8000-000000001429',
  '80000000-0000-4000-8000-000000000002',
  're_fixture_1419_exact', 'USD', 120000, 'customer_request', 'succeeded',
  '2026-08-05T16:00:00Z'
);
select lives_ok(
  $$insert into commission_accruals (
      id, partner_account_id, invoice_id, source_type, source_id,
      adjustment_source_id, rate_bps, holdback_bps, currency,
      net_collected_revenue_minor, amount_minor, holdback_minor, period, status
    ) values (
      '92000000-0000-4000-8000-000000001430',
      '10000000-0000-4000-8000-000000000002',
      '90000000-0000-4000-8000-000000001429',
      'refund', '94000000-0000-4000-8000-000000001429',
      '92000000-0000-4000-8000-000000001429',
      1200, 1000, 'USD', -120000, -14400, -1440, '2026-Q3', 'accrued')$$,
  'an exact-ceiling reversal succeeds'
);

select ok(
  position('for no key update' in lower(pg_get_functiondef(
    'public.validate_commission_source_truth()'::regprocedure
  ))) > 0,
  'the original payment accrual is row-locked before the ceiling read'
);
select ok(
  position('commission clawbacks must not exceed the accrual they reverse'
    in pg_get_functiondef(
      'public.validate_commission_source_truth()'::regprocedure
    )) > 0,
  'the live trigger carries the stable ceiling refusal'
);

select * from finish();
rollback;
