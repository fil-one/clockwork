-- Serialize every reversal of one payment accrual at the row that all of the
-- reversals share. The repository's read-before-write guard remains useful
-- feedback, but only this trigger sees every writer and closes the concurrent
-- write race. Credit-note voids are deliberately not refused: their positive
-- entry restores headroom under the original accrual.
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
  collected_before_minor bigint;
  accrued_before_minor bigint;
  original_source_minor bigint;
  taxable_share_minor bigint;
  outstanding_clawback_minor bigint;
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

  if invoice_gross_minor is null or invoice_gross_minor <= 0 then
    raise exception using errcode = '23514', message = 'commission source invoice carries no positive amount to apportion';
  end if;
  if invoice_tax_minor is null or invoice_tax_minor < 0 or invoice_tax_minor > invoice_gross_minor then
    raise exception using errcode = '23514', message = 'commission source invoice tax is not a share of its amount';
  end if;

  if new.source_type = 'payment' then
    if new.adjustment_source_id is not null
      or persisted_rate_bps is null
      or persisted_holdback_bps is null
      or new.rate_bps <> persisted_rate_bps
      or new.holdback_bps <> persisted_holdback_bps
    then
      raise exception using errcode = '23514', message = 'commission policy must match persisted referral partner policy';
    end if;
    select coalesce(sum(paid.amount_minor), 0), coalesce(sum(prior.net_collected_revenue_minor), 0)
      into collected_before_minor, accrued_before_minor
    from public.commission_accruals prior
    join public.payments paid on paid.id = prior.source_id
    where prior.invoice_id = source_invoice_id
      and prior.partner_account_id = referral_partner_id
      and prior.source_type = 'payment';
    expected_net_minor := public.core_divide_round_half_away(
      (collected_before_minor + source_amount_minor)::numeric
        * (invoice_gross_minor - invoice_tax_minor)::numeric,
      invoice_gross_minor::numeric
    ) - accrued_before_minor;
  elsif new.source_type = 'credit_note_void' then
    select * into original
    from public.commission_accruals a
    where a.id = new.adjustment_source_id
      and a.source_type = 'credit_note'
      and a.source_id = new.source_id
      and a.invoice_id = source_invoice_id
      and a.partner_account_id = referral_partner_id;
    if original.id is null
      or new.rate_bps <> original.rate_bps
      or new.holdback_bps <> original.holdback_bps
    then
      raise exception using errcode = '23514', message = 'credit-note void must reverse its exact persisted commission clawback';
    end if;
    expected_net_minor := -original.net_collected_revenue_minor;
  else
    -- Every clawback of this payment accrual takes the same row lock. A second
    -- writer therefore cannot validate its ceiling until the first commits or
    -- rolls back, and the following aggregate observes that outcome.
    select * into original
    from public.commission_accruals a
    where a.id = new.adjustment_source_id
      and a.source_type = 'payment'
      and a.invoice_id = source_invoice_id
      and a.partner_account_id = referral_partner_id
    for no key update;
    if original.id is null
      or (source_payment_id is not null and original.source_id <> source_payment_id)
      or new.rate_bps <> original.rate_bps
      or new.holdback_bps <> original.holdback_bps
    then
      raise exception using errcode = '23514', message = 'commission clawback must use its persisted payment accrual policy';
    end if;
    select paid.amount_minor into original_source_minor
    from public.payments paid where paid.id = original.source_id;
    if original_source_minor is null or original_source_minor <= 0 then
      raise exception using errcode = '23514', message = 'commission clawback has no persisted payment to apportion against';
    end if;
    taxable_share_minor := public.core_divide_round_half_away(
      source_amount_minor::numeric * original.net_collected_revenue_minor::numeric,
      original_source_minor::numeric
    );

    -- Negative adjustment rows consume the original base. A credit-note void
    -- is a positive child of its clawback and restores exactly that headroom.
    select coalesce(-sum(entry.net_collected_revenue_minor), 0)
      into outstanding_clawback_minor
    from (
      select clawback.net_collected_revenue_minor
      from public.commission_accruals clawback
      where clawback.adjustment_source_id = original.id
        and clawback.source_type in ('credit_note', 'refund', 'dispute')
      union all
      select voided.net_collected_revenue_minor
      from public.commission_accruals voided
      join public.commission_accruals clawback
        on clawback.id = voided.adjustment_source_id
      where clawback.adjustment_source_id = original.id
        and clawback.source_type = 'credit_note'
        and voided.source_type = 'credit_note_void'
    ) entry;
    if outstanding_clawback_minor + taxable_share_minor > original.net_collected_revenue_minor then
      raise exception using errcode = '23514', message = 'commission clawbacks must not exceed the accrual they reverse';
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

comment on function public.validate_commission_source_truth() is
  'Validates persisted commission source truth and serializes all clawbacks of one payment accrual so their outstanding tax-exclusive base, net of signed credit-note voids, never exceeds that accrual.';
