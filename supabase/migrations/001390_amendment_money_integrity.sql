-- An accepted amendment used to reach rest as a header and nothing else: the
-- `amendments` row, the order flipped to `amended`, and no delta line, no
-- financial terms and no supersession. The write path is fixed
-- (packages/db/src/repositories/core/database-finance.ts), and these two
-- constraint triggers stop the shape coming back through any other door.
--
-- What they pin is the arithmetic between the three tables, because that is
-- what makes the money re-derivable rather than merely present:
--
--   * `core_amendment_financial_terms` states the period the amendment was
--     prorated over and the billable fraction it was prorated by. That period
--     is the parent order's service window; anything else silently rescales
--     every delta hanging off it.
--   * `amendment_lines.price_delta_minor` carries the FULL-PERIOD delta —
--     the unprorated contractual figure, signed, negative for a downgrade.
--   * `core_amendment_line_supersessions.net_revenue_delta_minor` carries the
--     BILLABLE delta, which the invoice adds and `deriveInvoice` re-derives.
--     It must be exactly the full-period delta taken through the stored
--     fraction, half away from zero, matching `divideRound`
--     (packages/domain/src/core/decimal.ts:29). Division loses information, so
--     storing the unprorated figure and the fraction beside the prorated one
--     is what keeps the billed number checkable against the signed document.
--
-- Neither trigger constrains sign. A downgrade's delta is negative in both
-- columns and 001370 already recorded why no CHECK can say more than that.
--
-- Written for a populated table: no table is rewritten, scanned or reindexed
-- here. `create constraint trigger` takes SHARE ROW EXCLUSIVE on its table for
-- the duration of the catalog write only, and the wait for that lock is bounded
-- below. Each statement commits on its own and every create is preceded by a
-- `drop ... if exists`, so a run that times out resumes rather than restarts.
-- ADR-0009 records the convention.
set lock_timeout = '5s';

create or replace function public.validate_amendment_financial_terms()
returns trigger
language plpgsql
set search_path = public as $$
declare
  parent_amendment public.amendments%rowtype;
  parent_order public.orders%rowtype;
  parent_quote public.quotes%rowtype;
begin
  select * into parent_amendment from public.amendments
   where id = new.amendment_id;
  if not found then
    raise exception using errcode = '23514',
      message = 'amendment financial terms require their amendment';
  end if;
  select * into parent_order from public.orders
   where id = parent_amendment.order_id;
  select * into parent_quote from public.quotes
   where id = parent_order.quote_id;
  if parent_order.service_ends_on is null then
    raise exception using errcode = '23514',
      message = 'amendment financial terms require a terminated order';
  end if;
  if new.period_starts_on is distinct from parent_order.service_starts_on
    or new.period_ends_on is distinct from parent_order.service_ends_on
  then
    raise exception using errcode = '23514',
      message = 'amendment financial terms must span the order service period';
  end if;
  if parent_amendment.effective_on < new.period_starts_on
    or parent_amendment.effective_on > new.period_ends_on
  then
    raise exception using errcode = '23514',
      message = 'amendment takes effect outside the period it is prorated over';
  end if;
  if new.currency is distinct from parent_quote.currency then
    raise exception using errcode = '23514',
      message = 'amendment financial terms must be denominated in the order currency';
  end if;
  return new;
end $$;

drop trigger if exists core_amendment_financial_terms_money
  on public.core_amendment_financial_terms;

create constraint trigger core_amendment_financial_terms_money
  after insert on public.core_amendment_financial_terms
  deferrable initially immediate
  for each row execute function public.validate_amendment_financial_terms();

create or replace function public.validate_amendment_supersession_money()
returns trigger
language plpgsql
set search_path = public as $$
declare
  terms public.core_amendment_financial_terms%rowtype;
  delta_line public.amendment_lines%rowtype;
  scaled numeric;
  expected bigint;
begin
  select * into terms from public.core_amendment_financial_terms
   where amendment_id = new.amendment_id;
  if not found then
    raise exception using errcode = '23514',
      message = 'amendment supersession requires the amendment financial terms';
  end if;
  select * into delta_line from public.amendment_lines
   where amendment_id = new.amendment_id
     and order_line_id = new.superseded_order_line_id;
  if not found then
    raise exception using errcode = '23514',
      message = 'amendment supersession requires its amendment delta line';
  end if;
  if delta_line.quantity_delta is distinct from new.net_quantity_delta then
    raise exception using errcode = '23514',
      message = 'amendment supersession quantity must equal its delta line';
  end if;
  if not exists (
    select 1 from public.order_lines line
     where line.id = new.superseded_order_line_id
       and line.superseded_by_amendment_id = new.amendment_id
  ) then
    raise exception using errcode = '23514',
      message = 'superseded order line must name the amendment that superseded it';
  end if;
  -- Half away from zero on the magnitude, so a downgrade rounds the same
  -- distance from zero as the upgrade that reverses it.
  scaled := abs(delta_line.price_delta_minor::numeric)
    * terms.billable_numerator::numeric;
  expected := (
    sign(delta_line.price_delta_minor::numeric) * (
      div(scaled, terms.billable_denominator::numeric)
      + case
          when mod(scaled, terms.billable_denominator::numeric) * 2
            >= terms.billable_denominator::numeric then 1
          else 0
        end
    )
  )::bigint;
  if new.net_revenue_delta_minor is distinct from expected then
    raise exception using errcode = '23514',
      message = 'amendment supersession revenue must equal its prorated delta line';
  end if;
  return new;
end $$;

drop trigger if exists core_amendment_line_supersessions_money
  on public.core_amendment_line_supersessions;

create constraint trigger core_amendment_line_supersessions_money
  after insert on public.core_amendment_line_supersessions
  deferrable initially immediate
  for each row execute function public.validate_amendment_supersession_money();

-- The same defect was written into the database itself. `q.total_minor =
-- new.amount_minor` (000920:65, carried forward at 001340:41) made an invoice
-- that bills an amendment impossible to persist: the customer signs an upgrade
-- and the only invoice the constraint admits is the untouched quote. This is
-- not a relaxation — the equality is replaced by the one that is true. An
-- invoice bills its quote total plus the net forecast delta of every amendment
-- accepted on its order at the moment it is written, which is exactly what the
-- writer computes and what deriveInvoice re-derives. Every other clause is
-- unchanged, the amount stays immutable once persisted, and the amendment sum
-- is signed, so a downgrade lowers the invoice as an upgrade raises it.
--
-- An amendment carrying no financial terms contributes nothing to the sum. It
-- is refused at the writer, which will not bill past money it cannot derive,
-- rather than here: the seeded demo predates this migration and carries one.
create or replace function public.validate_invoice_payment_projection_truth()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_table_name = 'invoices' then
    if not exists (
      select 1
      from public.orders o
      join public.quotes q on q.id = o.quote_id
      where o.id = new.order_id
        and o.immutable_at is not null
        and q.status = 'accepted'
        and o.invoicing_account_id = new.account_id
        and q.currency = new.currency
        and q.total_minor + coalesce((
              select sum(terms.forecast_delta_minor)
              from public.amendments amendment
              join public.core_amendment_financial_terms terms
                on terms.amendment_id = amendment.id
              where amendment.order_id = o.id
            ), 0) = new.amount_minor
        and o.po_number is not distinct from new.po_number
    ) then
      raise exception using
        errcode = '23514',
        message = 'invoice must derive account, currency, amount, and PO from its accepted order and quote';
    end if;
    if tg_op = 'UPDATE' and (
      old.order_id is distinct from new.order_id
      or old.account_id is distinct from new.account_id
      or old.currency is distinct from new.currency
      or old.amount_minor is distinct from new.amount_minor
      or old.po_number is distinct from new.po_number
    ) then
      raise exception using
        errcode = '23514',
        message = 'persisted invoice commercial truth is immutable';
    end if;
    if tg_op = 'UPDATE' and new.amount_paid_minor < old.amount_paid_minor then
      raise exception using
        errcode = '23514',
        message = 'settled invoice amount cannot decrease';
    end if;
  elsif tg_table_name = 'payments' then
    if new.amount_minor <= 0 then
      raise exception using
        errcode = '23514',
        message = 'Stripe payment amount must be positive';
    end if;
    if not exists (
      select 1
      from public.invoices i
      where i.id = new.invoice_id
        and i.order_id = new.order_id
        and i.currency = new.currency
    ) then
      raise exception using
        errcode = '23514',
        message = 'Stripe payment must match its local invoice, order, and currency';
    end if;
  end if;
  return new;
end;
$$;

reset lock_timeout;
