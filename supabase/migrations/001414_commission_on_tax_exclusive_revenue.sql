-- COMMISSION IS ACCRUED ON GROSS, AND THIS MIGRATION IS WHY.
--
-- Spec line 150 says a referral commission is a percentage of "attributed net
-- collected revenue". Verified in the tree before writing:
--
--   * `validate_commission_source_truth` sets `expected_net_minor` from the
--     source event's own amount, and for a payment that is
--     `payments.amount_minor`, which settles against `invoices.amount_minor`.
--     Introduced at 000930:200 and CARRIED FORWARD UNCHANGED by the current
--     definition at 001000:3066-3212, which is the one this migration replaces.
--     000930 is not the live version: 001000 added the `credit_note_void`
--     branch and the sign rules that go with it, and a fix written against
--     000930 alone would silently drop that branch.
--   * 001392:11-15 DELIBERATELY made `invoices.amount_minor` the GROSS -- "the
--     amount owed, so it becomes gross once tax applies" -- and put the tax in
--     `invoices.tax_minor` alongside it.
--   * Neither 000930 nor 001000 contains the string `tax_minor`. The validator
--     that decides every accrued figure has never heard of the column.
--
-- So `expected_commission_minor` is a percentage of a tax-inclusive figure. In
-- a 21 per cent VAT jurisdiction the partner is overpaid by 21 per cent of its
-- commission, on our money, with the database's own truth trigger asserting the
-- wrong number is the right one. Nobody has noticed because no invoice has yet
-- carried non-zero tax; the tax wiring in this same round is what changes that,
-- which is why this migration lands first and stands alone.
--
-- THE BASE IS A SHARE OF THE PAYMENT, NOT OF THE INVOICE. A part-paid invoice
-- accrues on the cash that arrived, so the tax-exclusive figure has to be
-- apportioned out of THAT payment:
--
--   base = source_amount * (invoice.amount_minor - invoice.tax_minor)
--                        / invoice.amount_minor
--
-- Taking the invoice's whole net instead would accrue the full commission on
-- the first instalment of a two-instalment invoice.
--
-- THE SAME BASE IS USED ON ALL FIVE SOURCE TYPES, which is the part that is
-- easy to get half right. A payment accrues on it, a credit note, refund and
-- lost dispute claw back the negative of it, and a credit-note void reverses
-- the clawback. Fixing only the payment branch would leave every clawback
-- reversing more than its accrual ever created, which turns a partner
-- overpayment into a partner debt and is not the smaller mistake.
--
-- Every invoice written before this round carries tax_minor = 0, so the ratio
-- is exactly 1 and every existing accrual keeps the figure it has. This is not
-- a re-statement of history; it is the rule history already satisfies.

-- Half away from zero on exact integers, which is what
-- packages/domain/src/core/decimal.ts `divideRound` does in its default
-- `half_up` mode: it rounds the MAGNITUDE and reapplies the sign, so a clawback
-- is the exact mirror of the accrual it reverses instead of drifting toward
-- zero. `div` and `mod` on numeric are exact, so no intermediate quotient is
-- ever rounded before the comparison that decides the rounding.
create or replace function public.core_divide_round_half_away(
  numerator numeric,
  denominator numeric
)
returns bigint
language sql
immutable
set search_path = public
as $$
  select case
    when denominator is null or denominator <= 0 then null
    else (
      sign(numerator) * (
        div(abs(numerator), denominator)
        + case
            when mod(abs(numerator), denominator) * 2 >= denominator then 1
            else 0
          end
      )
    )::bigint
  end
$$;

revoke all on function public.core_divide_round_half_away(numeric, numeric) from public;
grant execute on function public.core_divide_round_half_away(numeric, numeric)
  to clockwork_runtime, clockwork_service;

comment on function public.core_divide_round_half_away(numeric, numeric) is
  'Integer division rounded half away from zero, matching divideRound''s half_up mode in packages/domain/src/core/decimal.ts. Exact: div and mod on numeric never round, so the half comparison is on the true remainder.';

create or replace function public.validate_commission_source_truth()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  source_invoice_id uuid;
  source_order_id uuid;
  source_payment_id uuid;
  source_currency text;
  source_amount_minor bigint;
  source_occurred_at timestamptz;
  referral_partner_id uuid;
  persisted_rate_bps integer;
  persisted_holdback_bps integer;
  invoice_gross_minor bigint;
  invoice_tax_minor bigint;
  taxable_share_minor bigint;
  original public.commission_accruals%rowtype;
  expected_net_minor bigint;
  expected_commission_minor bigint;
  expected_holdback_minor bigint;
  expected_period text;
begin
  if new.source_type = 'payment' then
    select p.invoice_id, p.order_id, p.id, p.currency, p.amount_minor, p.received_at
      into source_invoice_id, source_order_id, source_payment_id,
           source_currency, source_amount_minor, source_occurred_at
    from public.payments p
    where p.id = new.source_id and p.status = 'succeeded' and p.received_at is not null;
  elsif new.source_type = 'credit_note' then
    select c.invoice_id, c.order_id, c.currency, c.amount_minor, c.created_at
      into source_invoice_id, source_order_id, source_currency,
           source_amount_minor, source_occurred_at
    from public.credit_notes c
    where c.id = new.source_id and c.status = 'issued';
  elsif new.source_type = 'credit_note_void' then
    select c.invoice_id, c.order_id, c.currency, c.amount_minor, c.stripe_last_occurred_at
      into source_invoice_id, source_order_id, source_currency,
           source_amount_minor, source_occurred_at
    from public.credit_notes c
    where c.id = new.source_id and c.status = 'void'
      and c.stripe_last_occurred_at is not null
      and exists (
        select 1 from public.webhook_events event_record
        where event_record.provider = 'stripe'
          and event_record.provider_event_id = c.stripe_last_event_id
          and event_record.event_type = 'credit_note.voided'
          and event_record.signature_verified_at is not null
          and event_record.occurred_at = c.stripe_last_occurred_at
      );
  elsif new.source_type = 'refund' then
    select p.invoice_id, r.order_id, p.id, r.currency, r.amount_minor, r.created_at
      into source_invoice_id, source_order_id, source_payment_id,
           source_currency, source_amount_minor, source_occurred_at
    from public.refunds r
    join public.payments p on p.id = r.payment_id
    where r.id = new.source_id and r.status = 'succeeded'
      and p.order_id = r.order_id and p.currency = r.currency
      and r.amount_minor <= p.amount_minor;
  else
    select p.invoice_id, d.order_id, p.id, d.currency, d.amount_minor, d.updated_at
      into source_invoice_id, source_order_id, source_payment_id,
           source_currency, source_amount_minor, source_occurred_at
    from public.dispute_cases d
    join public.payments p on p.id = d.payment_id
    where d.id = new.source_id and d.status = 'lost'
      and p.order_id = d.order_id and p.currency = d.currency
      and d.amount_minor <= p.amount_minor;
  end if;

  if source_invoice_id is null or source_amount_minor is null or source_amount_minor <= 0 then
    raise exception using errcode = '23514', message = 'commission source is not an eligible persisted financial event';
  end if;

  -- The invoice's own gross and tax join the read. They are the two figures
  -- 000930 never asked for and 001000 carried forward without asking for
  -- either, and the whole defect is in their absence.
  select o.partner_account_id, a.commission_rate_bps, a.commission_holdback_bps,
         i.amount_minor, i.tax_minor
    into referral_partner_id, persisted_rate_bps, persisted_holdback_bps,
         invoice_gross_minor, invoice_tax_minor
  from public.invoices i
  join public.orders o on o.id = i.order_id
  join public.accounts a on a.id = o.partner_account_id
  where i.id = source_invoice_id
    and o.id = source_order_id
    and o.sourcing = 'referral'
    and a.partner_agreement_type = 'referral'
    and i.currency = source_currency
    and source_amount_minor <= i.amount_minor;

  if referral_partner_id is null
    or new.invoice_id <> source_invoice_id
    or new.partner_account_id <> referral_partner_id
    or new.currency <> source_currency
  then
    raise exception using errcode = '23514', message = 'commission source must match its persisted referral invoice and partner';
  end if;

  -- The clause above already guarantees gross >= source amount > 0. These
  -- guards are here so a future relaxation of it fails loudly rather than
  -- dividing by zero, or inflating the base above the cash collected, inside a
  -- security-definer trigger.
  if invoice_gross_minor is null or invoice_gross_minor <= 0 then
    raise exception using errcode = '23514', message = 'commission source invoice carries no positive amount to apportion';
  end if;
  if invoice_tax_minor is null or invoice_tax_minor < 0 or invoice_tax_minor > invoice_gross_minor then
    raise exception using errcode = '23514', message = 'commission source invoice tax is not a share of its amount';
  end if;

  taxable_share_minor := public.core_divide_round_half_away(
    source_amount_minor::numeric * (invoice_gross_minor - invoice_tax_minor)::numeric,
    invoice_gross_minor::numeric
  );

  if new.source_type = 'payment' then
    if new.adjustment_source_id is not null
      or persisted_rate_bps is null
      or persisted_holdback_bps is null
      or new.rate_bps <> persisted_rate_bps
      or new.holdback_bps <> persisted_holdback_bps
    then
      raise exception using errcode = '23514', message = 'commission policy must match persisted referral partner policy';
    end if;
    expected_net_minor := taxable_share_minor;
  elsif new.source_type = 'credit_note_void' then
    select * into original
    from public.commission_accruals a
    where a.id = new.adjustment_source_id
      and a.source_type = 'credit_note'
      and a.source_id = new.source_id
      and a.invoice_id = source_invoice_id
      and a.partner_account_id = referral_partner_id;
    -- The exactness check moves onto the tax-exclusive base with everything
    -- else. The clawback it reverses was written on that base, so comparing it
    -- against the credit note's gross would refuse every void on a taxed
    -- invoice -- a control blocking a legitimate operation, which is the same
    -- severity of defect as the overpayment this migration exists to stop.
    if original.id is null
      or new.rate_bps <> original.rate_bps
      or new.holdback_bps <> original.holdback_bps
      or original.net_collected_revenue_minor <> -taxable_share_minor
    then
      raise exception using errcode = '23514', message = 'credit-note void must reverse its exact persisted commission clawback';
    end if;
    expected_net_minor := taxable_share_minor;
  else
    select * into original
    from public.commission_accruals a
    where a.id = new.adjustment_source_id
      and a.source_type = 'payment'
      and a.invoice_id = source_invoice_id
      and a.partner_account_id = referral_partner_id;
    if original.id is null
      or (source_payment_id is not null and original.source_id <> source_payment_id)
      or new.rate_bps <> original.rate_bps
      or new.holdback_bps <> original.holdback_bps
    then
      raise exception using errcode = '23514', message = 'commission clawback must use its persisted payment accrual policy';
    end if;
    expected_net_minor := -taxable_share_minor;
  end if;

  expected_commission_minor := public.core_divide_round_half_away(
    expected_net_minor::numeric * new.rate_bps::numeric, 10000
  );
  expected_holdback_minor := public.core_divide_round_half_away(
    expected_commission_minor::numeric * new.holdback_bps::numeric, 10000
  );
  expected_period := extract(year from source_occurred_at at time zone 'UTC')::integer::text
    || '-Q' || extract(quarter from source_occurred_at at time zone 'UTC')::integer::text;

  if new.net_collected_revenue_minor <> expected_net_minor
    or new.amount_minor <> expected_commission_minor
    or new.holdback_minor <> expected_holdback_minor
    or new.period <> expected_period
    or new.status <> 'accrued'
  then
    raise exception using errcode = '23514', message = 'commission values must derive from source money, policy, and UTC quarter';
  end if;
  return new;
end;
$$;

revoke all on function public.validate_commission_source_truth() from public;

comment on column public.commission_accruals.net_collected_revenue_minor is
  'The TAX-EXCLUSIVE share of the cash this accrual is attributed to: source amount * (invoice.amount_minor - invoice.tax_minor) / invoice.amount_minor, rounded half away from zero. Apportioned out of the source event rather than taken from the invoice, so a part-paid invoice accrues on what actually arrived. Signed: negative on a clawback.';
