-- A part-paid invoice carries its settled and outstanding amounts on the row
-- the collections and dunning paths already read. Emitted by drizzle-kit and
-- copied unchanged so the Drizzle snapshot and this migration stay in parity.
ALTER TABLE "invoices" ADD COLUMN "amount_paid_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "amount_remaining_minor" bigint GENERATED ALWAYS AS (greatest(amount_minor - amount_paid_minor, 0::bigint)) STORED NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_amount_paid_check" CHECK ("invoices"."amount_paid_minor" >= 0);

-- Reconstruct settled money from the persisted payment truth already projected
-- from signed Stripe events; a paid invoice is settled in full by definition.
update public.invoices invoice
set amount_paid_minor = greatest(
  coalesce((
    select sum(payment.amount_minor)
    from public.payments payment
    where payment.invoice_id = invoice.id and payment.status = 'succeeded'
  ), 0),
  case when invoice.status = 'paid' then invoice.amount_minor else 0 end
);

comment on column public.invoices.amount_paid_minor is
  'Settled minor units, monotone under the invoice Stripe watermark; provider invoice totals win over a payments sum.';
comment on column public.invoices.amount_remaining_minor is
  'Outstanding minor units derived from the persisted total and settled amount; an overpayment floors it at zero.';

-- A payment settles some part of its invoice. Currency, invoice, and order
-- binding stay exact; the amount is no longer required to equal the total, so
-- an underpayment, an installment, and an overpayment all persist as truth.
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
        and q.total_minor = new.amount_minor
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
