-- `invoices` carried a currency and one amount, so there was nowhere for a tax
-- figure to land and every invoice this system has ever written billed the
-- customer net. The three tax_minor columns that already existed
-- (core_invoice_end_client_allocations:000100:197,
-- core_invoice_document_snapshots:001300:174, core_marketplace_events:000100:289)
-- were fed a literal zero by the only writer that reaches them
-- (core-dispatch.ts), which is a stored claim that no tax was due rather than a
-- record that none was calculated. The row the customer is billed from now
-- carries both the amount and the determination that produced it.
--
-- amount_minor stays the amount owed, so it becomes gross once tax applies and
-- every downstream reader — amount_remaining_minor (001340), the payments
-- projection, dunning, collections — keeps meaning what it meant. The net is
-- amount_minor - tax_minor, and that is the figure the quote-and-amendment
-- identity below is checked against.
--
-- Written for a populated table (ADR-0009): both columns take a constant
-- default so neither rewrites the heap, the checks are added NOT VALID and
-- validated in a separate statement under a bounded lock wait, and each DDL
-- statement commits on its own so a timed-out run resumes rather than restarts.
set lock_timeout = '5s';

alter table public.invoices
  add column if not exists tax_minor bigint not null default 0;

alter table public.invoices
  add column if not exists tax_treatment text not null default 'not_determined';

-- 'not_determined' is what every row written before this migration carries and
-- is deliberately not a synonym for zero-rated: it records that nobody asked.
-- The writer refuses to create an invoice with it, so it can only ever describe
-- history, and a reconciliation can tell an untaxed bill from an unassessed one.
alter table public.invoices
  drop constraint if exists invoices_tax_treatment_check;
alter table public.invoices
  add constraint invoices_tax_treatment_check
  check (tax_treatment in ('not_determined','standard','reverse_charge','exempt'))
  not valid;
alter table public.invoices validate constraint invoices_tax_treatment_check;

-- A reverse-charged or exempt supply is billed net by definition, and an
-- unassessed one has no figure at all. Only a standard supply may carry an
-- amount, and that amount is deliberately signed: a negative line total
-- produces a negative tax and 001370 already records why no CHECK on this
-- table can say more about sign than that.
alter table public.invoices
  drop constraint if exists invoices_tax_amount_check;
alter table public.invoices
  add constraint invoices_tax_amount_check
  check (tax_treatment = 'standard' or tax_minor = 0)
  not valid;
alter table public.invoices validate constraint invoices_tax_amount_check;

comment on column public.invoices.tax_minor is
  'Tax in minor units included in amount_minor; the net is amount_minor - tax_minor. Signed, and zero unless tax_treatment is standard.';
comment on column public.invoices.tax_treatment is
  'How the merchant of record treated this supply, as answered by the tax provider. not_determined marks a row written before any determination existed and is refused by the writer.';

-- The projection trigger's quote-and-amendment identity was written against
-- amount_minor when amount_minor was necessarily the net. It is now the gross,
-- so the identity moves to the net and nothing else about it changes: the
-- amendment sum added at 001390 is carried forward unchanged, and dropping it
-- here would re-break P0-49 exactly as 001390 describes. tax_minor and
-- tax_treatment join the immutable set for the same reason amount_minor is in
-- it — a persisted bill is not re-priced in place.
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
            ), 0) = new.amount_minor - new.tax_minor
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
      or old.tax_minor is distinct from new.tax_minor
      or old.tax_treatment is distinct from new.tax_treatment
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
