create or replace function public.app_has_role(candidate text)
returns boolean
language sql stable
set search_path = public
as $$
  select current_user = 'clockwork_service'
    or (
      app_context_is_valid()
      and coalesce(app_context_claims()->'roles', '[]'::jsonb) ? candidate
    )
$$;

grant execute on function public.app_has_role(text)
  to clockwork_runtime, clockwork_service;

-- Finance approvers operate across customer accounts, but signed runtime
-- claims deliberately do not make them the service role. Give that narrow
-- role the supporting reads and durable append permissions required by the
-- collections domain transaction; all other tenant policies remain intact.
create policy invoices_finance_read on public.invoices
for select to clockwork_runtime
using (app_has_role('finance_approver'));
create policy payments_finance_read on public.payments
for select to clockwork_runtime
using (app_has_role('finance_approver'));
create policy entitlements_finance_read on public.entitlements
for select to clockwork_runtime
using (app_has_role('finance_approver'));
create policy core_billing_policies_finance_read on public.core_billing_policies
for select to clockwork_runtime
using (app_has_role('finance_approver'));

create policy core_collection_cases_finance_read on public.core_collection_cases
for select to clockwork_runtime
using (app_has_role('finance_approver'));
create policy core_collection_cases_finance_insert on public.core_collection_cases
for insert to clockwork_runtime
with check (app_has_role('finance_approver'));
create policy core_collection_cases_finance_update on public.core_collection_cases
for update to clockwork_runtime
using (app_has_role('finance_approver'))
with check (app_has_role('finance_approver'));
create policy core_collection_actions_finance_read on public.core_collection_actions
for select to clockwork_runtime
using (app_has_role('finance_approver'));
create policy core_collection_actions_finance_insert on public.core_collection_actions
for insert to clockwork_runtime
with check (app_has_role('finance_approver'));

create policy audit_events_finance_read on public.audit_events
for select to clockwork_runtime
using (app_has_role('finance_approver'));
create policy audit_events_finance_insert on public.audit_events
for insert to clockwork_runtime
with check (app_has_role('finance_approver'));
create policy outbox_messages_finance_insert on public.outbox_messages
for insert to clockwork_runtime
with check (app_has_role('finance_approver'));

drop policy if exists credit_notes_scope on public.credit_notes;
create policy credit_notes_read on public.credit_notes
for select to clockwork_runtime
using (
  app_has_role('finance_approver') or exists (
    select 1 from public.invoices invoice
    where invoice.id = invoice_id and app_has_account(invoice.account_id)
  )
);
create policy credit_notes_finance_insert on public.credit_notes
for insert to clockwork_runtime
with check (app_has_role('finance_approver'));
create policy credit_notes_finance_update on public.credit_notes
for update to clockwork_runtime
using (app_has_role('finance_approver'))
with check (app_has_role('finance_approver'));
create policy credit_notes_service on public.credit_notes
for all to clockwork_service using (true) with check (true);

drop policy if exists refunds_scope on public.refunds;
create policy refunds_read on public.refunds
for select to clockwork_runtime
using (
  app_has_role('finance_approver') or exists (
    select 1
    from public.payments payment
    join public.invoices invoice on invoice.id = payment.invoice_id
    where payment.id = payment_id and app_has_account(invoice.account_id)
  )
);
create policy refunds_finance_insert on public.refunds
for insert to clockwork_runtime
with check (app_has_role('finance_approver'));
create policy refunds_service on public.refunds
for all to clockwork_service using (true) with check (true);

drop policy if exists dispute_cases_scope on public.dispute_cases;
create policy dispute_cases_read on public.dispute_cases
for select to clockwork_runtime
using (
  app_has_role('finance_approver') or exists (
    select 1
    from public.payments payment
    join public.invoices invoice on invoice.id = payment.invoice_id
    where payment.id = payment_id and app_has_account(invoice.account_id)
  )
);
create policy dispute_cases_finance_insert on public.dispute_cases
for insert to clockwork_runtime
with check (app_has_role('finance_approver'));
create policy dispute_cases_service on public.dispute_cases
for all to clockwork_service using (true) with check (true);

drop trigger if exists credit_notes_immutable on public.credit_notes;
drop trigger if exists refunds_immutable on public.refunds;

create or replace function public.protect_financial_adjustment()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = format('%s cannot be deleted', tg_table_name);
  end if;
  if tg_table_name = 'credit_notes' then
    if old.invoice_id is distinct from new.invoice_id
      or old.order_id is distinct from new.order_id
      or old.stripe_credit_note_id is distinct from new.stripe_credit_note_id
      or old.currency is distinct from new.currency
      or old.amount_minor is distinct from new.amount_minor
      or old.reason_code is distinct from new.reason_code
      or old.approved_by is distinct from new.approved_by
      or old.created_at is distinct from new.created_at
      or old.version is distinct from new.version
    then
      raise exception using errcode = '55000', message = 'credit note financial facts are immutable';
    end if;
    if new.status is distinct from old.status
      and not (old.status = 'issued' and new.status = 'void')
    then
      raise exception using errcode = '23514', message = 'invalid credit note status transition';
    end if;
  elsif tg_table_name = 'refunds' then
    if old.payment_id is distinct from new.payment_id
      or old.order_id is distinct from new.order_id
      or old.stripe_refund_id is distinct from new.stripe_refund_id
      or old.currency is distinct from new.currency
      or old.amount_minor is distinct from new.amount_minor
      or old.reason_code is distinct from new.reason_code
      or old.created_at is distinct from new.created_at
      or old.version is distinct from new.version
    then
      raise exception using errcode = '55000', message = 'refund financial facts are immutable';
    end if;
    if new.status is distinct from old.status
      and not (old.status = 'pending' and new.status in ('succeeded','failed'))
    then
      raise exception using errcode = '23514', message = 'invalid refund status transition';
    end if;
  end if;
  return new;
end
$$;

create trigger credit_notes_controlled_update
before update or delete on public.credit_notes
for each row execute function public.protect_financial_adjustment();
create trigger refunds_controlled_update
before update or delete on public.refunds
for each row execute function public.protect_financial_adjustment();

create or replace function public.validate_financial_adjustment_amount()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  source_amount bigint;
  prior_amount bigint;
begin
  if new.amount_minor <= 0 then
    raise exception using errcode = '23514', message = 'financial adjustment amount must be positive';
  end if;
  if tg_table_name = 'credit_notes' then
    select amount_minor into source_amount
    from public.invoices where id = new.invoice_id for update;
    select coalesce(sum(amount_minor), 0) into prior_amount
    from public.credit_notes
    where invoice_id = new.invoice_id and status = 'issued';
  elsif tg_table_name = 'refunds' then
    select amount_minor into source_amount
    from public.payments where id = new.payment_id for update;
    select coalesce(sum(amount_minor), 0) into prior_amount
    from public.refunds
    where payment_id = new.payment_id and status in ('pending','succeeded');
  else
    select amount_minor into source_amount
    from public.payments where id = new.payment_id for update;
    select coalesce(sum(amount_minor), 0) into prior_amount
    from public.dispute_cases
    where payment_id = new.payment_id and status <> 'won';
  end if;
  if source_amount is null or prior_amount + new.amount_minor > source_amount then
    raise exception using errcode = '23514', message = 'financial adjustment exceeds its persisted source amount';
  end if;
  return new;
end
$$;

create trigger credit_notes_amount_guard
before insert on public.credit_notes
for each row execute function public.validate_financial_adjustment_amount();
create trigger refunds_amount_guard
before insert on public.refunds
for each row execute function public.validate_financial_adjustment_amount();
create trigger dispute_cases_amount_guard
before insert on public.dispute_cases
for each row execute function public.validate_financial_adjustment_amount();
