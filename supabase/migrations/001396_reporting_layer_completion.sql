-- P0-42. Spec §17 names ten reports. Eight shipped as security-invoker views in
-- 000100_core_finance.sql:697-863 and are served through
-- `CoreFinanceRepository.readInternalReport`. Three §17 rows had no view:
--
--   * ARR and MRR. The backlog entry said it had "no report function". It has
--     one -- `recurringRevenue()` in packages/domain/src/core/reports -- and
--     `core_revenue_forecast` already emits `mrr_minor`, `arr_minor` and
--     `revenue_basis` per forecast month. What was missing was the report: a
--     row per contract stating the run rate, rather than a row per month of it.
--     `core_arr_mrr` is therefore a projection OF `core_revenue_forecast` and
--     computes no money of its own. §17 requires ARR to be "consistent
--     everywhere"; reading the same view is the only way to make that true by
--     construction rather than by two implementations agreeing today.
--
--   * Billing and collections. Nothing anywhere: no view, no function, no
--     report key. `core_billing_collections` is one row per invoice carrying
--     issuance, aging, payment, credit, refund, dispute, the dunning owner, the
--     billed account's credit exposure and cash timing -- the nine things §17
--     lists, in that order.
--
--   * Commission and settlement. Also nothing. `core_commission_settlement` is
--     one row per accrual carrying the collected-revenue basis, holdback,
--     clawback, statement, distributor allocation, marketplace fee and
--     settlement-export status, each tied back to the invoice and payment it
--     came from.
--
-- All three are REPORTS. A view adds no column, no constraint and no lock, so
-- nothing here can refuse a write: the set of inputs these refuse is empty.
--
-- Grants copy 000100 exactly -- revoked from the tenant role, selectable by
-- `clockwork_service` -- so a report reaches a caller only through the internal
-- transaction the repository opens for it.
set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- ARR and MRR
-- ---------------------------------------------------------------------------
-- One row per committed order, at the run rate in force now. `distinct on`
-- picks the forecast month at or before the current month that is closest to
-- it, and for an order whose service has not started yet the earliest month it
-- has -- so a contract signed for next quarter states the rate it will bill at
-- rather than nothing. Amendments are already folded into
-- `forecast_revenue_minor`, so a later month legitimately differs from an
-- earlier one and picking the current one is what makes this a run rate.
--
-- Pipeline quotes are excluded: §17 states ARR as CONTRACTED recurring value,
-- and `core_revenue_forecast` keeps its unaccepted quotes under
-- `forecast_stage = 'pipeline'` for the forecast to separate them.
create view public.core_arr_mrr with (security_invoker = true) as
select distinct on (forecast.order_id, forecast.currency)
  forecast.order_id,
  forecast.quote_id,
  forecast.account_id,
  forecast.partner_account_id,
  forecast.currency,
  forecast.channel,
  forecast.merchant_of_record,
  -- Gross for direct/referral, transfer price where the partner is merchant of
  -- record. Taken from the forecast rather than restated, so the two reports
  -- cannot disagree about which basis a contract is on.
  forecast.revenue_basis,
  forecast.forecast_month as run_rate_month,
  -- Cast because the forecast's amendment fold sums bigints into a numeric.
  -- Money in minor units is a bigint everywhere else in this schema and a
  -- report is the wrong place to start being the exception.
  forecast.mrr_minor::bigint as mrr_minor,
  forecast.arr_minor::bigint as arr_minor,
  forecast.service_starts_on,
  forecast.service_ends_on,
  forecast.notice_on,
  -- §17: "methodology versioned". This names the rule the two amounts above
  -- were produced under, and changes when that rule does -- not when a number
  -- moves.
  'merchant_of_record.v1'::text as methodology_version,
  forecast.source_record_ids
from public.core_revenue_forecast forecast
where forecast.forecast_stage = 'committed_backlog'
  and forecast.order_id is not null
order by
  forecast.order_id,
  forecast.currency,
  (forecast.forecast_month <= date_trunc('month', now())::date) desc,
  abs(forecast.forecast_month - date_trunc('month', now())::date) asc,
  forecast.forecast_month asc;

comment on view public.core_arr_mrr is
  'Spec §17 ARR and MRR: contracted recurring value per committed order at the run rate in force now, on the merchant-of-record basis (gross for direct/referral, transfer price for partner-of-record resale and distributor). A projection of core_revenue_forecast - it computes no money of its own, so ARR here and revenue forecast there cannot disagree.';

-- ---------------------------------------------------------------------------
-- Billing and collections
-- ---------------------------------------------------------------------------
-- One row per invoice. Every aggregate is a lateral so an invoice with no
-- payment, no credit note, no refund and no dispute still reports a row reading
-- zero: a collections report that omits the invoices nothing has happened to is
-- the one that hides the problem.
create view public.core_billing_collections with (security_invoker = true) as
select
  invoice.id                                          as invoice_id,
  invoice.order_id,
  invoice.account_id,
  ordered.partner_account_id,
  ordered.invoicing_account_id,
  ordered.sourcing                                    as channel,
  invoice.currency,
  invoice.status                                      as invoice_status,
  invoice.po_number,
  invoice.created_at                                  as issued_at,
  invoice.due_at,
  invoice.paid_at,
  invoice.amount_minor,
  invoice.tax_minor,
  invoice.amount_paid_minor                           as paid_minor,
  invoice.amount_remaining_minor                      as outstanding_minor,
  -- Cash actually received against this invoice, summed from the payments
  -- themselves. `paid_minor` above is the projection Stripe's webhook maintains
  -- on the invoice row; a difference between the two is a tie-out finding, so
  -- both are reported rather than one of them assumed.
  cash.collected_minor,
  credits.credited_minor,
  credits.credit_note_count,
  refunded.refunded_minor,
  refunded.refund_count,
  disputed.disputed_minor,
  disputed.open_dispute_count,
  -- Aging is stated against the due date, and only for an invoice that can
  -- still be collected. A paid, voided or written-off invoice is not aged into
  -- a bucket that would then be summed as exposure.
  case
    when invoice.status in ('draft', 'paid', 'void', 'uncollectible') then 'not_collectible'
    when invoice.due_at is null then 'no_due_date'
    when invoice.due_at >= now() then 'current'
    when invoice.due_at >= now() - interval '30 days' then '1_30'
    when invoice.due_at >= now() - interval '60 days' then '31_60'
    when invoice.due_at >= now() - interval '90 days' then '61_90'
    else '90_plus'
  end                                                 as aging_bucket,
  case
    when invoice.due_at is null or invoice.due_at >= now() then 0
    else (current_date - invoice.due_at::date)
  end                                                 as days_overdue,
  cash.first_payment_at,
  cash.last_payment_at,
  extract(epoch from (cash.first_payment_at - invoice.created_at))::bigint
                                                      as issued_to_first_cash_seconds,
  extract(epoch from (cash.last_payment_at - invoice.created_at))::bigint
                                                      as issued_to_last_cash_seconds,
  collection_case.id                                  as collection_case_id,
  collection_case.status                              as collection_status,
  collection_case.owner_user_id                       as dunning_owner_id,
  collection_case.next_action_at                      as dunning_next_action_at,
  collection_case.running_service_decision,
  policy.collection_method,
  policy.payment_rail,
  policy.terms_days,
  policy.dunning_policy_version,
  -- Credit exposure of the account that owes this invoice. Where the partner is
  -- merchant of record that account IS the partner, which is what §17 means by
  -- partner credit exposure.
  commercial.credit_status,
  commercial.approved_credit_limit_minor              as credit_limit_minor,
  commercial.current_exposure_minor                   as credit_exposure_minor,
  commercial.new_service_blocked,
  jsonb_build_object(
    'invoiceId', invoice.id,
    'orderId', invoice.order_id,
    'accountId', invoice.account_id,
    'partnerAccountId', ordered.partner_account_id,
    'paymentIds', cash.payment_ids,
    'creditNoteIds', credits.credit_note_ids,
    'refundIds', refunded.refund_ids,
    'disputeCaseIds', disputed.dispute_case_ids,
    'collectionCaseId', collection_case.id
  )                                                   as source_record_ids
from public.invoices invoice
join public.orders ordered on ordered.id = invoice.order_id
left join lateral (
  select
    coalesce(sum(payment.amount_minor), 0)::bigint as collected_minor,
    min(payment.received_at) as first_payment_at,
    max(payment.received_at) as last_payment_at,
    coalesce(jsonb_agg(payment.id order by payment.id), '[]'::jsonb) as payment_ids
  from public.payments payment
  where payment.invoice_id = invoice.id and payment.status = 'succeeded'
) cash on true
left join lateral (
  select
    coalesce(sum(credit_note.amount_minor), 0)::bigint as credited_minor,
    count(*)::integer as credit_note_count,
    coalesce(jsonb_agg(credit_note.id order by credit_note.id), '[]'::jsonb) as credit_note_ids
  from public.credit_notes credit_note
  where credit_note.invoice_id = invoice.id and credit_note.status = 'issued'
) credits on true
left join lateral (
  select
    coalesce(sum(refund.amount_minor), 0)::bigint as refunded_minor,
    count(*)::integer as refund_count,
    coalesce(jsonb_agg(refund.id order by refund.id), '[]'::jsonb) as refund_ids
  from public.refunds refund
  join public.payments refunded_payment on refunded_payment.id = refund.payment_id
  where refunded_payment.invoice_id = invoice.id and refund.status = 'succeeded'
) refunded on true
left join lateral (
  select
    coalesce(sum(dispute.amount_minor), 0)::bigint as disputed_minor,
    count(*)::integer as open_dispute_count,
    coalesce(jsonb_agg(dispute.id order by dispute.id), '[]'::jsonb) as dispute_case_ids
  from public.dispute_cases dispute
  join public.payments disputed_payment on disputed_payment.id = dispute.payment_id
  where disputed_payment.invoice_id = invoice.id
    and dispute.status in ('needs_response', 'under_review')
) disputed on true
left join public.core_collection_cases collection_case
  on collection_case.invoice_id = invoice.id
left join public.core_billing_policies policy
  on policy.account_id = invoice.account_id
left join public.core_account_commercial_profiles commercial
  on commercial.account_id = invoice.account_id;

comment on view public.core_billing_collections is
  'Spec §17 billing and collections: one row per invoice with issuance, aging, payment, credit, refund, dispute, dunning owner, billed-account credit exposure and cash timing. An invoice nothing has happened to still reports a row, reading zero.';

-- ---------------------------------------------------------------------------
-- Commission and settlement
-- ---------------------------------------------------------------------------
-- One row per accrual, which is the grain the money is written at:
-- `commission_accruals` holds a positive accrual per collected payment and a
-- negative adjustment per credit note, refund or dispute, each pointing at the
-- accrual it reverses (`commission_accruals_sign_check`). Netting them here
-- would lose the clawback §17 asks to see, so the sign is reported instead.
create view public.core_commission_settlement with (security_invoker = true) as
select
  accrual.id                                          as accrual_id,
  accrual.partner_account_id,
  partner.legal_name                                  as partner_legal_name,
  partner.partner_agreement_type,
  accrual.invoice_id,
  invoice.order_id,
  invoice.account_id                                  as invoiced_account_id,
  ordered.account_id                                  as end_client_account_id,
  ordered.sourcing                                    as channel,
  order_profile.distributor_account_id,
  accrual.source_type,
  accrual.source_id,
  accrual.adjustment_source_id,
  accrual.currency,
  accrual.period,
  accrual.rate_bps,
  accrual.holdback_bps,
  accrual.net_collected_revenue_minor,
  accrual.amount_minor                                as gross_commission_minor,
  accrual.holdback_minor,
  -- A clawback is an adjustment accrual, and it is negative by construction.
  -- Reported as its own non-negative magnitude so a statement can show what was
  -- taken back without re-deriving the sign rule.
  (accrual.adjustment_source_id is not null and accrual.amount_minor < 0)
                                                      as is_clawback,
  greatest(-accrual.amount_minor, 0)::bigint          as clawback_minor,
  (accrual.amount_minor - accrual.holdback_minor)::bigint
                                                      as payable_minor,
  accrual.status                                      as accrual_status,
  accrual.statement_document_id,
  statement.id                                        as statement_id,
  statement.status                                    as statement_status,
  statement.period_starts_on                          as statement_period_starts_on,
  statement.period_ends_on                            as statement_period_ends_on,
  statement.payable_minor                             as statement_payable_minor,
  settlement.id                                       as settlement_export_id,
  settlement.status                                   as settlement_export_status,
  settlement.format                                   as settlement_export_format,
  settlement.provider_reference                       as settlement_provider_reference,
  marketplace.marketplace_fee_minor,
  case
    when settlement.status = 'delivered' then 'settled'
    when settlement.id is not null then 'exporting'
    when statement.id is not null then 'stated'
    else 'accrued'
  end                                                 as settlement_stage,
  jsonb_build_object(
    'accrualId', accrual.id,
    'invoiceId', accrual.invoice_id,
    'orderId', invoice.order_id,
    'partnerAccountId', accrual.partner_account_id,
    'sourceId', accrual.source_id,
    'adjustmentSourceId', accrual.adjustment_source_id,
    'statementId', statement.id,
    'settlementExportId', settlement.id
  )                                                   as source_record_ids
from public.commission_accruals accrual
join public.accounts partner on partner.id = accrual.partner_account_id
join public.invoices invoice on invoice.id = accrual.invoice_id
join public.orders ordered on ordered.id = invoice.order_id
left join public.core_order_commercial_profiles order_profile
  on order_profile.order_id = ordered.id
left join public.core_commission_statement_lines statement_line
  on statement_line.accrual_id = accrual.id
left join public.core_commission_statements statement
  on statement.id = statement_line.statement_id
-- At most one, and a plain join says so: a retried export goes back to
-- `pending` in place rather than inserting a second row
-- (`core_commission_settlement_statement_unique`).
left join public.core_commission_settlement_exports settlement
  on settlement.statement_id = statement.id
left join lateral (
  select coalesce(sum(entry.amount_minor), 0)::bigint as marketplace_fee_minor
  from public.core_marketplace_financial_entries entry
  join public.core_marketplace_events event on event.id = entry.marketplace_event_id
  where event.order_id = ordered.id and entry.entry_type = 'fee'
) marketplace on true;

comment on view public.core_commission_settlement is
  'Spec §17 commission and settlement: one row per commission accrual with the collected-revenue basis, holdback, clawback, statement, distributor allocation, marketplace fee and settlement-export status, each tied to the invoice and payment it came from. Adjustments keep their sign rather than being netted, so a clawback stays visible.';

revoke all on public.core_arr_mrr, public.core_billing_collections,
  public.core_commission_settlement
  from public, anon, authenticated, clockwork_runtime;
grant select on public.core_arr_mrr, public.core_billing_collections,
  public.core_commission_settlement
  to clockwork_service;

reset lock_timeout;
