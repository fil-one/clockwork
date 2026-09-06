-- PAYG invoices have a retained usage source, not a term order. Preserve the
-- one-row-per-invoice grain and existing invoker RLS, including invoices with
-- no payment, credit or collection activity. Term columns remain unchanged.
create or replace view public.core_billing_collections with (security_invoker = true) as
select
  invoice.id                                          as invoice_id,
  invoice.order_id,
  invoice.account_id,
  ordered.partner_account_id,
  case when invoice.billing_source='payg' then
    (payg.source_snapshot->'customer'->>'accountId')::uuid
    else ordered.invoicing_account_id end              as invoicing_account_id,
  case when invoice.billing_source='payg' then 'direct'
    else ordered.sourcing end                          as channel,
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
    'collectionCaseId', collection_case.id,
    'billingSource', invoice.billing_source,
    'paygEnrollmentId', payg.enrollment_id,
    'paygEffectKey', payg.effect_key,
    'paygSourceHash', payg.source_hash
  )                                                   as source_record_ids
from public.invoices invoice
left join public.orders ordered on ordered.id = invoice.order_id
left join public.core_payg_invoice_sources payg
  on payg.invoice_id = invoice.id and invoice.billing_source='payg'
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
  'One row per order or PAYG invoice with billing, collections, cash, credits, refunds, disputes and source identity. PAYG invoicing identity comes from its immutable source; no term order is invented. Invoker RLS preserves account scope.';

-- CREATE OR REPLACE preserves prior ACLs; restate the intended readership.
grant select on public.core_billing_collections to clockwork_service, clockwork_runtime;
