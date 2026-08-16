-- TWO RESIDUALS FROM 001414, BOTH FOUND BY DRIVING THE DATABASE.
--
-- ===========================================================================
-- 1. A FALSE REFUSAL, AND WHERE THE RULE ACTUALLY BELONGS.
-- ===========================================================================
--
-- 001414 raises `commission source invoice tax is not a share of its amount`
-- when `invoices.tax_minor < 0`. Nothing forbids a negative tax_minor:
-- 001392:44 states the column is "deliberately signed". Reproduced against this
-- database before writing — an invoice with `tax_minor = -1000` inserts, and
-- the payment accrual against it then raises 23514, so the partner earns
-- nothing on a bill the customer paid in full.
--
-- THE BEHAVIOUR, decided rather than asserted away:
--
--   * `invoices_amount_nonnegative_check` (000001) already holds
--     `amount_minor >= 0`, and `mutateInvoice` refuses a net below zero with
--     "Amended order owes a credit rather than an invoice". An invoice in this
--     schema is therefore never a credit, and a credit IS a credit note with
--     its own table.
--   * Tax is a rate applied to a net, and every rate is non-negative
--     (`core_tax_rates_rate_ppm_check`). On a non-negative net the tax is
--     non-negative and cannot exceed the gross it is included in.
--   * So a negative `tax_minor` on this table describes no supply that can
--     exist. 001392's signed-ness was written for a table that might hold a
--     credit; this one does not.
--
-- The rule moves to the INVOICE, where the malformed row is created, instead of
-- living on the accrual, where it blocks a legitimate operation downstream of
-- one. After this migration the commission validator's guard is unreachable
-- from any invoice the database will accept — it stays, inside a
-- security-definer function, as the thing that fails loudly if this constraint
-- is ever relaxed.
--
-- Written for a populated table (ADR-0009): every invoice this repository has
-- ever written carries `tax_minor = 0` or a determined non-negative figure, so
-- the check is added NOT VALID and validated in its own statement.
set lock_timeout = '5s';

alter table public.invoices
  drop constraint if exists invoices_tax_share_check;
alter table public.invoices
  add constraint invoices_tax_share_check
  check (tax_minor >= 0 and tax_minor <= amount_minor)
  not valid;
alter table public.invoices validate constraint invoices_tax_share_check;

comment on column public.invoices.tax_minor is
  'Tax in minor units included in amount_minor; the net is amount_minor - tax_minor. Between zero and the amount inclusive: this table never holds a credit (a credit is a credit note), every rate is non-negative, and a figure outside that range describes no supply. Zero unless tax_treatment is standard.';

reset lock_timeout;

-- ===========================================================================
-- 2. AN APPORTIONMENT THAT COULD INVENT A MINOR UNIT.
-- ===========================================================================
--
-- 001414 apportions each payment independently:
--
--     base = round(payment * net / gross)
--
-- Worked by hand on a two-instalment bill: net 100000, gross 120000, paid
-- 30015 then 89985.
--
--     30015 * 100000 / 120000 = 25012.5  -> 25013
--     89985 * 100000 / 120000 = 74987.5  -> 74988
--                                           ------
--                                           100001
--
-- One minor unit more net than the invoice has, and at 1200 bps a commission of
-- 12001 against 12000 for the same invoice paid once. Always in the partner's
-- favour and bounded by instalments-1 units, which is small — and three
-- assertions in referral-commissions.integration.test.ts claim EXACT
-- reconciliation as a general invariant when it holds only for the fixture that
-- happens to divide evenly.
--
-- Making the assertions true rather than weakening them: the base is
-- apportioned CUMULATIVELY, the way `applyRounding` in the determination engine
-- apportions per-invoice rounding and the way the engine's treatment buckets
-- apportion a line's net across authorities.
--
--     base = round((collected_before + this_payment) * net / gross)
--            - base_already_accrued
--
-- The rounded running total is what is rounded, and each accrual takes the
-- difference between successive rounded totals. On the case above:
--
--     first : round(30015 * 100000/120000) - 0     = 25013
--     second: round(120000 * 100000/120000) - 25013 = 100000 - 25013 = 74987
--                                                     ------
--                                                     100000
--
-- and 1200 bps of those is 3002 + 8998 = 12000, the same as the invoice paid
-- once. No minor unit is invented and none is lost, for any split.
--
-- CLAWBACKS MIRROR THE ACCRUAL THEY REVERSE, which is the other half and the
-- half that is easy to leave out. A clawback that re-derived its base from the
-- invoice ratio would come back 74988 against an accrual of 74987 and turn a
-- partner overpayment into a partner debt of one unit. So:
--
--   * a credit note, refund or lost dispute takes its share OF THE ACCRUAL IT
--     ADJUSTS: -round(source * accrual_base / accrual_source_amount). A full
--     refund of a payment reverses that payment's accrual exactly, whatever
--     rounding produced it;
--   * a credit-note void reverses THE PERSISTED CLAWBACK, by reading it rather
--     than recomputing it. 001414 already required the two to agree exactly;
--     reading it is the same rule with nothing left to disagree with.
--
-- Every invoice written before the tax wiring carries tax_minor = 0, so the
-- ratio is 1, every base equals its source amount and every figure already
-- accrued is unchanged by this migration.
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

  -- The clause above already guarantees gross >= source amount > 0, and
  -- `invoices_tax_share_check` (this migration) holds 0 <= tax <= gross on
  -- every invoice the database will accept. These guards are what fails loudly
  -- if either is ever relaxed, rather than dividing by zero or apportioning a
  -- base larger than the cash collected inside a security-definer trigger.
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
    -- The cash already attributed to this invoice, and the base already
    -- accrued on it. The difference between successive rounded totals is this
    -- accrual's base, so the bases sum to the invoice's net exactly however the
    -- instalments fall.
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
    -- Read, not recomputed. A void reverses the clawback that was written,
    -- whatever rounding produced it.
    expected_net_minor := -original.net_collected_revenue_minor;
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
    -- A share OF THE ACCRUAL BEING REVERSED, not of the invoice. A full refund
    -- of a payment therefore reverses that payment's accrual exactly, and a
    -- partial one takes its proportion of it.
    select paid.amount_minor into original_source_minor
    from public.payments paid where paid.id = original.source_id;
    if original_source_minor is null or original_source_minor <= 0 then
      raise exception using errcode = '23514', message = 'commission clawback has no persisted payment to apportion against';
    end if;
    taxable_share_minor := public.core_divide_round_half_away(
      source_amount_minor::numeric * original.net_collected_revenue_minor::numeric,
      original_source_minor::numeric
    );
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
  'The TAX-EXCLUSIVE share of the cash this accrual is attributed to, apportioned CUMULATIVELY: round((collected before + this payment) * net / gross) minus the base already accrued on the invoice. The bases therefore sum to the invoice net exactly however the instalments fall, and a clawback mirrors the accrual it reverses rather than re-deriving from the invoice. Signed: negative on a clawback.';
