begin;
select plan(40);
set local search_path = public, extensions;

-- Existence of all thirty-three rules in one assertion. The enforcement proofs
-- below are what matter; this only catches a constraint dropped by name.
select bag_eq(
  $$select conname::text
      from pg_constraint
     where contype = 'c'
       and conname = any (array[
         'commission_accruals_currency_check',
         'cost_records_currency_check',
         'credit_notes_currency_check',
         'dispute_cases_currency_check',
         'invoices_currency_check',
         'payments_currency_check',
         'pocs_currency_check',
         'price_books_currency_check',
         'quotes_currency_check',
         'refunds_currency_check',
         'key_terms_liability_cap_currency_check',
         'memberships_approval_limit_currency_check',
         'core_accounting_exports_currency_check',
         'core_amendment_financial_terms_currency_check',
         'core_commission_statements_currency_check',
         'core_invoice_end_client_allocations_currency_check',
         'core_marketplace_events_currency_check',
         'core_marketplace_financial_entries_currency_check',
         'core_marketplace_reconciliations_currency_check',
         'core_stripe_adjustment_operations_source_currency_check',
         'core_three_way_tie_outs_currency_check',
         'invoices_amount_nonnegative_check',
         'payments_amount_nonnegative_check',
         'credit_notes_amount_nonnegative_check',
         'refunds_amount_nonnegative_check',
         'dispute_cases_amount_nonnegative_check',
         'order_lines_price_nonnegative_check',
         'quote_lines_line_total_nonnegative_check',
         'rate_cards_floor_price_nonnegative_check',
         'quotes_partner_resale_total_nonnegative_check',
         'pocs_cost_nonnegative_check',
         'key_terms_liability_cap_nonnegative_check',
         'memberships_approval_limit_nonnegative_check'
       ])$$,
  $$select unnest(array[
      'commission_accruals_currency_check',
      'cost_records_currency_check',
      'credit_notes_currency_check',
      'dispute_cases_currency_check',
      'invoices_currency_check',
      'payments_currency_check',
      'pocs_currency_check',
      'price_books_currency_check',
      'quotes_currency_check',
      'refunds_currency_check',
      'key_terms_liability_cap_currency_check',
      'memberships_approval_limit_currency_check',
      'core_accounting_exports_currency_check',
      'core_amendment_financial_terms_currency_check',
      'core_commission_statements_currency_check',
      'core_invoice_end_client_allocations_currency_check',
      'core_marketplace_events_currency_check',
      'core_marketplace_financial_entries_currency_check',
      'core_marketplace_reconciliations_currency_check',
      'core_stripe_adjustment_operations_source_currency_check',
      'core_three_way_tie_outs_currency_check',
      'invoices_amount_nonnegative_check',
      'payments_amount_nonnegative_check',
      'credit_notes_amount_nonnegative_check',
      'refunds_amount_nonnegative_check',
      'dispute_cases_amount_nonnegative_check',
      'order_lines_price_nonnegative_check',
      'quote_lines_line_total_nonnegative_check',
      'rate_cards_floor_price_nonnegative_check',
      'quotes_partner_resale_total_nonnegative_check',
      'pocs_cost_nonnegative_check',
      'key_terms_liability_cap_nonnegative_check',
      'memberships_approval_limit_nonnegative_check'
    ]::text[])$$,
  'every currency and money-sign rule this migration declares is on the table'
);

-- The commission sign rule is directional and predates this migration. A
-- blanket >= 0 on commission money would have replaced or contradicted it and
-- broken clawbacks, so its survival is asserted, not assumed.
select ok(
  exists (
    select 1 from pg_constraint
     where contype = 'c' and conname = 'commission_accruals_sign_check'
  ),
  'the directional commission sign rule is left intact'
);

-- Enforcement on the ordinary write path, as the service role writes. Each
-- assertion matches the constraint by name in the error message, because the
-- pre-existing triggers on these tables raise 23514 too and an errcode alone
-- would not say which rule rejected the row.
set local role clockwork_service;

select throws_ok(
  $$insert into price_books (name, currency, effective_from, status)
    values ('lowercase probe', 'usd', '2026-01-01', 'draft')$$,
  '23514',
  'new row for relation "price_books" violates check constraint "price_books_currency_check"',
  'the root of the currency chain rejects a code outside the vocabulary'
);

select throws_ok(
  $$insert into cost_records (entitlement_id, period, currency, amount_minor, source)
    values ('83000000-0000-4000-8000-000000000001', '2099-01', 'usd', 100, 'probe')$$,
  '23514',
  'new row for relation "cost_records" violates check constraint "cost_records_currency_check"',
  'a cost record cannot be denominated in an unknown currency'
);

select throws_ok(
  $$update pocs set currency = 'usd'$$,
  '23514',
  'new row for relation "pocs" violates check constraint "pocs_currency_check"',
  'a POC cannot be repriced into an unknown currency'
);

select throws_ok(
  $$update pocs set cost_minor = -1$$,
  '23514',
  'new row for relation "pocs" violates check constraint "pocs_cost_nonnegative_check"',
  'a POC cost is stored positive and negated by the margin read'
);

select throws_ok(
  $$update memberships set approval_limit_minor = -1$$,
  '23514',
  'new row for relation "memberships" violates check constraint "memberships_approval_limit_nonnegative_check"',
  'an approval limit cannot be negative'
);

select throws_ok(
  $$update memberships set approval_limit_currency = 'usd'$$,
  '23514',
  'new row for relation "memberships" violates check constraint "memberships_approval_limit_currency_check"',
  'an approval limit is denominated in a currency the schema knows'
);

-- dispute_cases had no UPDATE guard of any kind: this statement succeeded
-- before the migration.
select throws_ok(
  $$update dispute_cases set amount_minor = -1$$,
  '23514',
  'new row for relation "dispute_cases" violates check constraint "dispute_cases_amount_nonnegative_check"',
  'a disputed amount cannot be rewritten negative'
);

select throws_ok(
  $$update dispute_cases set currency = 'usd'$$,
  '23514',
  'new row for relation "dispute_cases" violates check constraint "dispute_cases_currency_check"',
  'a disputed amount cannot be rewritten into an unknown currency'
);

insert into price_books (id, name, currency, effective_from, status, version) values
('c6000000-0000-4000-8000-000000001370', 'Constraint probe', 'USD', '2026-01-01', 'draft', 91370);

select throws_ok(
  $$insert into rate_cards (
      price_book_id, sku, approved_claim, region, unit,
      unit_price_minor, floor_price_minor, overage_rate_minor,
      minimum_quantity, egress_treatment, commit_type,
      stripe_tax_code, qbo_income_account
    ) values (
      'c6000000-0000-4000-8000-000000001370', 'PROBE-SKU',
      'Fictional probe claim', 'us-east-2', 'TB-month',
      1, -1, 1, 1, 'metered', 'term_drawdown', 'txcd_demo', '4000-Storage'
    )$$,
  '23514',
  'new row for relation "rate_cards" violates check constraint "rate_cards_floor_price_nonnegative_check"',
  'the half of the rate card price rule that was missing now holds'
);

-- The remaining tables intercept a bad write in a BEFORE ROW trigger, which
-- Postgres evaluates before any CHECK, and those triggers raise 23514 as well.
-- Proving the constraints through them would prove only that the trigger still
-- works. Replication role replica suspends the triggers and leaves CHECK
-- constraints in force, which is the same escape hatch 1300 uses at :671.
-- It is superuser-only, so the service role is dropped first.
reset role;
set local session_replication_role = replica;

select throws_ok(
  $$insert into invoices (order_id, account_id, stripe_invoice_id, currency, amount_minor, status)
    values ('80000000-0000-4000-8000-000000000001',
            '10000000-0000-4000-8000-000000000001', 'in_probe', 'usd', 1, 'open')$$,
  '23514',
  'new row for relation "invoices" violates check constraint "invoices_currency_check"',
  'an invoice currency survives the loss of its projection trigger'
);

select throws_ok(
  $$insert into invoices (order_id, account_id, stripe_invoice_id, currency, amount_minor, status)
    values ('80000000-0000-4000-8000-000000000001',
            '10000000-0000-4000-8000-000000000001', 'in_probe', 'USD', -1, 'open')$$,
  '23514',
  'new row for relation "invoices" violates check constraint "invoices_amount_nonnegative_check"',
  'an invoice total survives the loss of its projection trigger'
);

select throws_ok(
  $$insert into payments (invoice_id, order_id, stripe_payment_intent_id, currency, amount_minor, status)
    values ('90000000-0000-4000-8000-000000000001',
            '80000000-0000-4000-8000-000000000001', 'pi_probe', 'usd', 1, 'succeeded')$$,
  '23514',
  'new row for relation "payments" violates check constraint "payments_currency_check"',
  'a payment currency survives the loss of its projection trigger'
);

select throws_ok(
  $$insert into payments (invoice_id, order_id, stripe_payment_intent_id, currency, amount_minor, status)
    values ('90000000-0000-4000-8000-000000000001',
            '80000000-0000-4000-8000-000000000001', 'pi_probe', 'USD', -1, 'succeeded')$$,
  '23514',
  'new row for relation "payments" violates check constraint "payments_amount_nonnegative_check"',
  'a payment amount survives the loss of its projection trigger'
);

select throws_ok(
  $$insert into refunds (payment_id, order_id, stripe_refund_id, currency, amount_minor, reason_code, status)
    values ('91000000-0000-4000-8000-000000000001',
            '80000000-0000-4000-8000-000000000001', 're_probe', 'usd', 1, 'duplicate', 'approved')$$,
  '23514',
  'new row for relation "refunds" violates check constraint "refunds_currency_check"',
  'a refund currency survives the loss of the adjustment amount guard'
);

select throws_ok(
  $$insert into refunds (payment_id, order_id, stripe_refund_id, currency, amount_minor, reason_code, status)
    values ('91000000-0000-4000-8000-000000000001',
            '80000000-0000-4000-8000-000000000001', 're_probe', 'USD', -1, 'duplicate', 'approved')$$,
  '23514',
  'new row for relation "refunds" violates check constraint "refunds_amount_nonnegative_check"',
  'a refund amount survives the loss of the adjustment amount guard'
);

select throws_ok(
  $$insert into credit_notes (invoice_id, order_id, stripe_credit_note_id, currency, amount_minor, reason_code, approved_by, status)
    values ('90000000-0000-4000-8000-000000000001',
            '80000000-0000-4000-8000-000000000001', 'cn_probe', 'usd', 1, 'goodwill',
            '20000000-0000-4000-8000-000000000001', 'issued')$$,
  '23514',
  'new row for relation "credit_notes" violates check constraint "credit_notes_currency_check"',
  'a credit note currency survives the loss of the adjustment amount guard'
);

select throws_ok(
  $$insert into credit_notes (invoice_id, order_id, stripe_credit_note_id, currency, amount_minor, reason_code, approved_by, status)
    values ('90000000-0000-4000-8000-000000000001',
            '80000000-0000-4000-8000-000000000001', 'cn_probe', 'USD', -1, 'goodwill',
            '20000000-0000-4000-8000-000000000001', 'issued')$$,
  '23514',
  'new row for relation "credit_notes" violates check constraint "credit_notes_amount_nonnegative_check"',
  'a credit note amount survives the loss of the adjustment amount guard'
);

-- Only the currency of a commission accrual is new here; the source-truth
-- trigger otherwise pins it to the row it accrues from.
select throws_ok(
  $$insert into commission_accruals (
      partner_account_id, invoice_id, source_type, source_id, rate_bps, holdback_bps,
      currency, net_collected_revenue_minor, amount_minor, holdback_minor, period, status
    ) values (
      '10000000-0000-4000-8000-000000000002', '90000000-0000-4000-8000-000000000001',
      'payment', '40000000-0000-4000-8000-000000000001', 100, 0,
      'usd', 100, 10, 0, '2026-01', 'accrued'
    )$$,
  '23514',
  'new row for relation "commission_accruals" violates check constraint "commission_accruals_currency_check"',
  'a commission accrual currency survives the loss of the source truth trigger'
);

select throws_ok(
  $$insert into quotes (
      account_id, price_book_id, series_id, revision, status, currency,
      total_minor, margin_floor_result, expires_at, created_by
    ) values (
      '10000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001',
      gen_random_uuid(), 1, 'draft', 'usd', 100, 'pass', '2027-01-01',
      '20000000-0000-4000-8000-000000000002'
    )$$,
  '23514',
  'new row for relation "quotes" violates check constraint "quotes_currency_check"',
  'a quote cannot be priced in a currency no price book can carry'
);

select throws_ok(
  $$insert into quotes (
      account_id, price_book_id, series_id, revision, status, currency,
      total_minor, partner_resale_total_minor, margin_floor_result, expires_at, created_by
    ) values (
      '10000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001',
      gen_random_uuid(), 1, 'draft', 'USD', 100, -1, 'pass', '2027-01-01',
      '20000000-0000-4000-8000-000000000002'
    )$$,
  '23514',
  'new row for relation "quotes" violates check constraint "quotes_partner_resale_total_nonnegative_check"',
  'a resale total is guarded like the quote total beside it'
);

select throws_ok(
  $$insert into quote_lines (quote_id, rate_card_id, sku, quantity, term_months,
                             unit_price_minor, overage_rate_minor, line_total_minor)
    values ('70000000-0000-4000-8000-000000000001',
            '61000000-0000-4000-8000-000000000001', 'LOCKED-STORAGE-TB', 1, 12, 1, 1, -1)$$,
  '23514',
  'new row for relation "quote_lines" violates check constraint "quote_lines_line_total_nonnegative_check"',
  'the half of the quote line value rule that was missing now holds'
);

select throws_ok(
  $$insert into order_lines (order_id, quote_line_id, sku, quantity,
                             unit_price_minor, overage_rate_minor)
    values ('80000000-0000-4000-8000-000000000001', gen_random_uuid(),
            'LOCKED-STORAGE-TB', 1, -1, 1)$$,
  '23514',
  'new row for relation "order_lines" violates check constraint "order_lines_price_nonnegative_check"',
  'an order line price is guarded without relying on the chain equality'
);

select throws_ok(
  $$insert into order_lines (order_id, quote_line_id, sku, quantity,
                             unit_price_minor, overage_rate_minor)
    values ('80000000-0000-4000-8000-000000000001', gen_random_uuid(),
            'LOCKED-STORAGE-TB', 1, 1, -1)$$,
  '23514',
  'new row for relation "order_lines" violates check constraint "order_lines_price_nonnegative_check"',
  'an order line overage rate is guarded without relying on the chain equality'
);

-- key_terms is immutable after insert, so insert is the only path a violating
-- value can arrive by and the only path that can prove the rule.
select throws_ok(
  $$insert into key_terms (agreement_id, liability_cap_minor, liability_cap_currency,
                           breach_notice_hours, audit_rights, retention_liability_rule)
    values (gen_random_uuid(), -1, 'USD', 72, 'Annual evidence review',
            'liable_through_retention')$$,
  '23514',
  'new row for relation "key_terms" violates check constraint "key_terms_liability_cap_nonnegative_check"',
  'a liability cap cannot be negative'
);

select throws_ok(
  $$insert into key_terms (agreement_id, liability_cap_minor, liability_cap_currency,
                           breach_notice_hours, audit_rights, retention_liability_rule)
    values (gen_random_uuid(), 1, 'usd', 72, 'Annual evidence review',
            'liable_through_retention')$$,
  '23514',
  'new row for relation "key_terms" violates check constraint "key_terms_liability_cap_currency_check"',
  'a liability cap is denominated in a currency the schema knows'
);

-- The nine core_* tables. Each carries its own trigger set and several carry
-- other CHECKs on the same row, so every probe below satisfies the rest of the
-- table's rules and differs from a legal row only in the currency code. The
-- constraint is named in the expected message for the same reason as above.
select throws_ok(
  $$insert into core_accounting_exports (
      export_type, period_starts_on, period_ends_on, currency,
      idempotency_key, status, total_debit_minor, total_credit_minor
    ) values (
      'ar_issuance', '2099-01-01', '2099-01-31', 'usd',
      'currency-vocabulary-probe', 'pending', 100, 100
    )$$,
  '23514',
  'new row for relation "core_accounting_exports" violates check constraint "core_accounting_exports_currency_check"',
  'a balanced accounting export still cannot be denominated outside the vocabulary'
);

select throws_ok(
  $$insert into core_amendment_financial_terms (
      amendment_id, contractual_time_zone, proration_convention,
      period_starts_on, period_ends_on, billable_numerator,
      billable_denominator, currency, forecast_delta_minor, monthly_delta_minor
    ) values (
      gen_random_uuid(), 'UTC', 'actual_actual',
      '2099-01-01', '2099-01-31', 1, 1, 'usd', 0, 0
    )$$,
  '23514',
  'new row for relation "core_amendment_financial_terms" violates check constraint "core_amendment_financial_terms_currency_check"',
  'an amendment financial term is denominated in a currency the schema knows'
);

select throws_ok(
  $$insert into core_commission_statements (
      partner_account_id, period_starts_on, period_ends_on, currency,
      gross_accrued_minor, clawback_minor, holdback_minor, payable_minor, status
    ) values (
      '10000000-0000-4000-8000-000000000002', '2099-01-01', '2099-01-31',
      'usd', 0, 0, 0, 0, 'draft'
    )$$,
  '23514',
  'new row for relation "core_commission_statements" violates check constraint "core_commission_statements_currency_check"',
  'a commission statement cannot be stated in an unknown currency'
);

select throws_ok(
  $$insert into core_invoice_end_client_allocations (
      invoice_id, order_id, end_client_account_id, currency,
      subtotal_minor, tax_minor, total_minor, stripe_invoice_line_ids
    ) values (
      gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'usd',
      100, 0, 100, '{}'
    )$$,
  '23514',
  'new row for relation "core_invoice_end_client_allocations" violates check constraint "core_invoice_end_client_allocations_currency_check"',
  'an end-client allocation inherits the invoice vocabulary it is cut from'
);

select throws_ok(
  $$insert into core_marketplace_events (
      provider, provider_event_id, event_type, provider_account_reference,
      occurred_at, currency, gross_minor, fee_minor, tax_minor, net_minor,
      payload_hash, normalized_payload
    ) values (
      'aws', 'currency-vocabulary-probe', 'settlement', 'probe-buyer',
      '2099-01-01T00:00:00Z', 'usd', 100, 10, 0, 90, repeat('e', 64), '{}'
    )$$,
  '23514',
  'new row for relation "core_marketplace_events" violates check constraint "core_marketplace_events_currency_check"',
  'a provider settlement cannot land a currency code the platform cannot price'
);

-- The nullable half of the same rule. core_marketplace_events_check already
-- pairs currency with the four money columns, so a wholly non-financial event
-- is the legal null case and the vocabulary must not reject it.
select lives_ok(
  $$insert into core_marketplace_events (
      provider, provider_event_id, event_type, provider_account_reference,
      occurred_at, payload_hash, normalized_payload
    ) values (
      'aws', 'currency-vocabulary-null-probe', 'entitlement', 'probe-buyer',
      '2099-01-01T00:00:00Z', repeat('f', 64), '{}'
    )$$,
  'a non-financial marketplace event still carries no currency at all'
);

select throws_ok(
  $$insert into core_marketplace_financial_entries (
      marketplace_event_id, entry_type, provider_line_reference,
      currency, amount_minor
    ) values (
      gen_random_uuid(), 'fee', 'probe-line', 'usd', 100
    )$$,
  '23514',
  'new row for relation "core_marketplace_financial_entries" violates check constraint "core_marketplace_financial_entries_currency_check"',
  'a marketplace financial entry is denominated in a currency the schema knows'
);

select throws_ok(
  $$insert into core_marketplace_reconciliations (
      provider, period_starts_on, period_ends_on, currency,
      provider_gross_minor, platform_gross_minor, provider_fees_minor,
      platform_fees_minor, variance_minor, status
    ) values (
      'aws', '2099-01-01', '2099-01-31', 'usd', 0, 0, 0, 0, 0, 'matched'
    )$$,
  '23514',
  'new row for relation "core_marketplace_reconciliations" violates check constraint "core_marketplace_reconciliations_currency_check"',
  'a reconciliation cannot compare two sides in an unknown currency'
);

-- The one column of the nine that is not called `currency`. Its value is copied
-- from credit_notes.currency or refunds.currency by
-- core_create_stripe_adjustment_operation, both now constrained above; this
-- pins the copy destination as well as the source.
select throws_ok(
  $$insert into core_stripe_adjustment_operations (
      adjustment_id, kind, order_id, source_id, source_currency,
      provider_invoice_id, amount_minor, individual_cap_minor,
      aggregate_cap_minor, provider_reason, internal_reason_code,
      provider_idempotency_key
    ) values (
      gen_random_uuid(), 'credit_note', gen_random_uuid(), gen_random_uuid(),
      'usd', 'in_probe', 1, 1, 1, 'duplicate', 'duplicate',
      'stripe-adjustment-currency-probe'
    )$$,
  '23514',
  'new row for relation "core_stripe_adjustment_operations" violates check constraint "core_stripe_adjustment_operations_source_currency_check"',
  'a Stripe adjustment operation cannot record a source currency the adjustment could not have held'
);

select throws_ok(
  $$insert into core_three_way_tie_outs (
      period_starts_on, period_ends_on, currency, platform_revenue_minor,
      stripe_revenue_minor, qbo_revenue_minor, stripe_variance_minor,
      qbo_variance_minor, status
    ) values (
      '2099-01-01', '2099-01-31', 'usd', 0, 0, 0, 0, 0, 'matched'
    )$$,
  '23514',
  'new row for relation "core_three_way_tie_outs" violates check constraint "core_three_way_tie_outs_currency_check"',
  'a three-way tie-out cannot reconcile three systems in an unknown currency'
);

-- Three columns left deliberately open. These assertions pin the decisions so a
-- later reader does not close them by reflex.
--
-- An amendment line carries a delta, not an amount: a downgrade is required to
-- reduce quantity (packages/domain/src/core/amendments/index.ts:156), and the
-- rule that would be correct keys on amendments.kind, which no CHECK can reach.
select lives_ok(
  $$insert into amendment_lines (amendment_id, order_line_id, sku,
                                 quantity_delta, price_delta_minor)
    values ('82000000-0000-4000-8000-000000000001',
            '81000000-0000-4000-8000-000000000002', 'LOCKED-STORAGE-TB', -1, -7500)$$,
  'a downgrade amendment line still carries a negative delta'
);

-- Commission money is directional, not non-negative: an adjustment accrual is
-- what a clawback is made of.
select lives_ok(
  $$insert into commission_accruals (
      partner_account_id, invoice_id, source_type, source_id, adjustment_source_id,
      rate_bps, holdback_bps, currency, net_collected_revenue_minor, amount_minor,
      holdback_minor, period, status
    ) values (
      '10000000-0000-4000-8000-000000000002', '90000000-0000-4000-8000-000000000001',
      'refund', gen_random_uuid(), gen_random_uuid(), 100, 0,
      'USD', -100, -10, 0, '2026-01', 'accrued'
    )$$,
  'a commission clawback still accrues a negative amount'
);

-- A cost record is subtracted from booked revenue, so a negative row reads as a
-- provider rebate. Its sign is a semantic question this migration does not settle.
select lives_ok(
  $$insert into cost_records (entitlement_id, period, currency, amount_minor, source)
    values ('83000000-0000-4000-8000-000000000001', '2099-02', 'USD', -100, 'probe')$$,
  'a provider rebate still records as a negative realized cost'
);

set local session_replication_role = origin;

select * from finish();
rollback;
