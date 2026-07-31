alter table public.invoices
  alter column stripe_invoice_id drop not null,
  add column accounting_posting_id text,
  add column stripe_last_occurred_at timestamptz,
  add column stripe_last_event_id text;

-- Local invoices are immutable commercial truth before provider issuance.
update public.invoices
set stripe_invoice_id = null
where status = 'draft';

alter table public.payments
  add column stripe_last_occurred_at timestamptz,
  add column stripe_last_event_id text;

alter table public.invoices
  add constraint invoices_accounting_posting_id_unique
    unique (accounting_posting_id),
  add constraint invoices_provider_binding_check
    check (
      (status = 'draft' and stripe_invoice_id is null)
      or (status <> 'draft' and stripe_invoice_id is not null)
    ),
  add constraint invoices_stripe_watermark_check
    check (
      (stripe_last_occurred_at is null) = (stripe_last_event_id is null)
    );

alter table public.payments
  add constraint payments_stripe_watermark_check
    check (
      (stripe_last_occurred_at is null) = (stripe_last_event_id is null)
    );

comment on column public.invoices.stripe_invoice_id is
  'Provider invoice identity; null only while the persisted invoice is a local draft.';
comment on column public.invoices.accounting_posting_id is
  'Provider accounting posting bound atomically by the invoice issuance workflow.';
comment on column public.invoices.stripe_last_occurred_at is
  'Signed Stripe event watermark used with stripe_last_event_id to reject regressions.';
comment on column public.payments.stripe_last_occurred_at is
  'Signed Stripe event watermark used with stripe_last_event_id to reject regressions.';

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
  elsif tg_table_name = 'payments' then
    if not exists (
      select 1
      from public.invoices i
      where i.id = new.invoice_id
        and i.order_id = new.order_id
        and i.currency = new.currency
        and i.amount_minor = new.amount_minor
    ) then
      raise exception using
        errcode = '23514',
        message = 'Stripe payment must match its local invoice, order, currency, and amount';
    end if;
  end if;
  return new;
end;
$$;

create trigger invoices_projection_truth
before insert or update on public.invoices
for each row execute function public.validate_invoice_payment_projection_truth();

create trigger payments_projection_truth
before insert or update on public.payments
for each row execute function public.validate_invoice_payment_projection_truth();

-- Customer-facing runtime paths may read payment truth but only the verified
-- provider projection (clockwork_service) may create or advance it.
revoke insert, update, delete on public.payments from clockwork_runtime;
