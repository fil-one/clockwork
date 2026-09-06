-- Negative period corrections credit retained PAYG invoices. They retain their
-- net/tax split and use the same durable Stripe adjustment path as term credit notes.
alter table public.credit_notes alter column order_id drop not null;
alter table public.refunds alter column order_id drop not null;
alter table public.dispute_cases alter column order_id drop not null;
alter table public.core_stripe_adjustment_operations alter column order_id drop not null;
create table public.core_payg_credit_sources (
  credit_note_id uuid primary key references public.credit_notes(id),
  effect_key text not null references public.core_payg_pending_invoice_effects(idempotency_key),
  invoice_id uuid not null references public.invoices(id),
  allocation_index integer not null check (allocation_index > 0),
  net_minor bigint not null check (net_minor > 0),
  tax_minor bigint not null check (tax_minor >= 0),
  amount_minor bigint not null check (amount_minor = net_minor + tax_minor),
  source_snapshot jsonb not null check (jsonb_typeof(source_snapshot) = 'object'),
  source_hash text not null check (source_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  unique(effect_key, allocation_index),
  unique(effect_key, invoice_id)
);
alter table public.core_payg_credit_sources enable row level security;
alter table public.core_payg_credit_sources force row level security;
revoke all on public.core_payg_credit_sources from public,anon,authenticated,clockwork_runtime;
grant select,insert on public.core_payg_credit_sources to clockwork_service;
create policy core_payg_credit_sources_service on public.core_payg_credit_sources for all to clockwork_service
  using (public.app_is_internal()) with check (public.app_is_internal());
create trigger core_payg_credit_sources_immutable before update or delete on public.core_payg_credit_sources
  for each row execute function public.guard_payg_retained_history();

-- Acquire the enrollment mutex before the existing invoice amount guard. This
-- also serializes competing corrections which span different period invoices.
create function public.lock_payg_credit_enrollment() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  perform 1 from public.core_payg_enrollments enrollment
    join public.core_payg_invoice_sources source on source.enrollment_id=enrollment.id
    where source.invoice_id=new.invoice_id for update of enrollment;
  return new;
end $$;
revoke all on function public.lock_payg_credit_enrollment() from public;
create trigger a_payg_credit_enrollment_lock before insert on public.credit_notes
  for each row execute function public.lock_payg_credit_enrollment();

create function public.validate_payg_credit_source() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,private,extensions as $$
declare
  credit public.credit_notes%rowtype;
  invoice public.invoices%rowtype;
  invoice_source public.core_payg_invoice_sources%rowtype;
  effect public.core_payg_pending_invoice_effects%rowtype;
  revision public.core_payg_period_revisions%rowtype;
  prior_total bigint;
  prior_net bigint;
  prior_tax bigint;
  original_net bigint;
  expected_tax bigint;
  allocated_net bigint;
  expected_source jsonb;
begin
  select * into credit from public.credit_notes where id=new.credit_note_id;
  select * into invoice from public.invoices where id=new.invoice_id for update;
  select * into invoice_source from public.core_payg_invoice_sources where invoice_id=new.invoice_id;
  select * into effect from public.core_payg_pending_invoice_effects where idempotency_key=new.effect_key for update;
  select * into revision from public.core_payg_period_revisions rated where rated.enrollment_id=effect.enrollment_id
    and rated.month=effect.payload->>'month' and rated.revision=(effect.payload->>'revision')::integer;
  select (previous.snapshot#>>'{rating,total,minor}')::bigint into prior_total
    from public.core_payg_period_revisions previous where previous.enrollment_id=revision.enrollment_id
      and previous.month=revision.month and previous.revision=revision.revision-1;
  if credit.id is null or invoice.id is null or invoice.billing_source <> 'payg' or invoice_source.invoice_id is null
    or credit.invoice_id is distinct from new.invoice_id or credit.order_id is not null
    or credit.currency is distinct from invoice.currency or credit.amount_minor is distinct from new.amount_minor
    or effect.enrollment_id is distinct from invoice_source.enrollment_id
    or effect.payload->>'kind' is distinct from 'credit_adjustment'
    or effect.payload->>'idempotencyKey' is distinct from new.effect_key
    or effect.payload->>'accountId' is distinct from invoice.account_id::text
    or effect.payload#>>'{amount,currency}' is distinct from invoice.currency
    or effect.payload->>'month' is distinct from invoice_source.source_snapshot#>>'{effect,month}'
    or effect.payload->>'originalInvoiceKey' is distinct from invoice_source.source_snapshot#>>'{effect,originalInvoiceKey}'
    or revision.snapshot#>'{rating,policy}' is distinct from invoice_source.source_snapshot#>'{rating,policy}'
    or revision.snapshot#>'{rating,binding}' is distinct from invoice_source.source_snapshot#>'{rating,binding}'
    or effect.payload->>'ratingEvidenceHash' is distinct from revision.snapshot#>>'{rating,evidenceHash}'
    or prior_total is null or prior_total <= (revision.snapshot#>>'{rating,total,minor}')::bigint
    or (effect.payload#>>'{amount,minor}')::bigint is distinct from prior_total-(revision.snapshot#>>'{rating,total,minor}')::bigint
    or not exists (select 1 from public.commerce_users staff join public.memberships membership on membership.user_id=staff.id
      where staff.id=credit.approved_by and staff.is_internal_staff and staff.mfa_enrolled and membership.role='finance_approver')
  then raise exception using errcode='23514',message='PAYG credit must allocate its retained negative correction to an authorized invoice'; end if;
  select coalesce(sum(net_minor),0),coalesce(sum(tax_minor),0) into prior_net,prior_tax
    from public.core_payg_credit_sources where invoice_id=new.invoice_id;
  original_net := invoice.amount_minor-invoice.tax_minor;
  if original_net <= 0 or prior_net+new.net_minor > original_net then
    raise exception using errcode='23514',message='PAYG credit net exceeds the remaining invoiced net';
  end if;
  expected_tax := floor(((prior_net+new.net_minor)::numeric*invoice.tax_minor*2+original_net)/(original_net::numeric*2))::bigint-prior_tax;
  if expected_tax is distinct from new.tax_minor or prior_tax+new.tax_minor > invoice.tax_minor then
    raise exception using errcode='23514',message='PAYG credit tax must equal the cumulative share of its original invoice tax';
  end if;
  select coalesce(sum(net_minor),0) into allocated_net from public.core_payg_credit_sources where effect_key=new.effect_key;
  if allocated_net+new.net_minor > (effect.payload#>>'{amount,minor}')::bigint then
    raise exception using errcode='23514',message='PAYG credit allocation exceeds its correction effect';
  end if;
  expected_source := jsonb_build_object('effect',effect.payload,'invoiceSourceHash',invoice_source.source_hash,
    'netMinor',new.net_minor::text,'taxMinor',new.tax_minor::text,'amountMinor',new.amount_minor::text);
  if new.source_snapshot is distinct from expected_source or new.source_hash is distinct from
    encode(extensions.digest(convert_to(private.canonical_jsonb_text(expected_source),'UTF8'),'sha256'),'hex') then
    raise exception using errcode='23514',message='PAYG credit immutable source or canonical hash mismatch';
  end if;
  return new;
end $$;
revoke all on function public.validate_payg_credit_source() from public;
create trigger core_payg_credit_sources_validate before insert on public.core_payg_credit_sources
  for each row execute function public.validate_payg_credit_source();

create function public.require_payg_credit_source() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if exists (select 1 from public.invoices where id=new.invoice_id and billing_source='payg')
    and not exists (select 1 from public.core_payg_credit_sources where credit_note_id=new.id and invoice_id=new.invoice_id) then
    raise exception using errcode='23514',message='PAYG credit requires its immutable correction allocation';
  end if;
  return new;
end $$;
revoke all on function public.require_payg_credit_source() from public;
create constraint trigger credit_notes_payg_source_required after insert on public.credit_notes
  deferrable initially deferred for each row execute function public.require_payg_credit_source();
create function public.require_complete_payg_credit_allocation() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if (select sum(net_minor) from public.core_payg_credit_sources where effect_key=new.effect_key)
    is distinct from (select (payload#>>'{amount,minor}')::bigint from public.core_payg_pending_invoice_effects where idempotency_key=new.effect_key) then
    raise exception using errcode='23514',message='PAYG negative correction must be allocated completely in one transaction';
  end if;
  return new;
end $$;
revoke all on function public.require_complete_payg_credit_allocation() from public;
create constraint trigger core_payg_credit_complete after insert on public.core_payg_credit_sources
  deferrable initially deferred for each row execute function public.require_complete_payg_credit_allocation();

create or replace function public.validate_financial_adjustment_amount()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  source_amount bigint;
  source_order_id uuid;
  source_currency text;
  prior_amount bigint;
begin
  if new.amount_minor <= 0 then
    raise exception using errcode = '23514', message = 'financial adjustment amount must be positive';
  end if;
  if tg_table_name = 'credit_notes' then
    select amount_minor, order_id, currency
    into source_amount, source_order_id, source_currency
    from public.invoices where id = new.invoice_id for update;
    if source_amount is null
      or new.order_id is distinct from source_order_id
      or new.currency <> source_currency
    then
      raise exception using errcode = '23514', message = 'credit note must match its persisted invoice order and currency';
    end if;
    select coalesce(sum(amount_minor), 0) into prior_amount
    from public.credit_notes
    where invoice_id = new.invoice_id
      and status in ('approved','pending','issued');
  elsif tg_table_name = 'refunds' then
    select amount_minor, order_id, currency
    into source_amount, source_order_id, source_currency
    from public.payments where id = new.payment_id for update;
    if source_amount is null
      or new.order_id is distinct from source_order_id
      or new.currency <> source_currency
    then
      raise exception using errcode = '23514', message = 'refund must match its persisted payment order and currency';
    end if;
    select coalesce(sum(amount_minor), 0) into prior_amount
    from public.refunds
    where payment_id = new.payment_id
      and status in ('approved','pending','succeeded');
  else
    select amount_minor, order_id, currency
    into source_amount, source_order_id, source_currency
    from public.payments where id = new.payment_id for update;
    if source_amount is null
      or new.order_id is distinct from source_order_id
      or new.currency <> source_currency
    then
      raise exception using errcode = '23514', message = 'dispute must match its persisted payment order and currency';
    end if;
    select coalesce(sum(amount_minor), 0) into prior_amount
    from public.dispute_cases
    where payment_id = new.payment_id and status <> 'won';
  end if;
  if new.amount_minor > source_amount
    or prior_amount + new.amount_minor > source_amount
  then
    raise exception using errcode = '23514', message = 'financial adjustment exceeds its persisted source amount';
  end if;
  return new;
end
$$;

-- Shared mutex for a PAYG credit operation, reached only after the retained
-- allocation exists. Neither a null order nor a caller-provided invoice is proof.
create function public.core_lock_payg_adjustment(candidate uuid,candidate_kind text) returns uuid
language plpgsql security definer set search_path=pg_catalog,public as $$
declare target_invoice uuid; target_enrollment uuid;
begin
  if candidate_kind='credit_note' then
    select invoice.id,source.enrollment_id into target_invoice,target_enrollment
      from public.core_payg_credit_sources allocation
      join public.credit_notes credit on credit.id=allocation.credit_note_id
      join public.invoices invoice on invoice.id=allocation.invoice_id
      join public.core_payg_invoice_sources source on source.invoice_id=invoice.id
      where allocation.credit_note_id=candidate and credit.invoice_id=invoice.id
        and invoice.billing_source='payg' and credit.order_id is null
        and credit.amount_minor=allocation.amount_minor and credit.currency=invoice.currency;
  elsif candidate_kind='refund' then
    select invoice.id,source.enrollment_id into target_invoice,target_enrollment
      from public.refunds refund join public.payments payment on payment.id=refund.payment_id
      join public.invoices invoice on invoice.id=payment.invoice_id
      join public.core_payg_invoice_sources source on source.invoice_id=invoice.id
      where refund.id=candidate and invoice.billing_source='payg' and refund.order_id is null
        and payment.order_id is null and refund.currency=payment.currency and payment.currency=invoice.currency;
  end if;
  if target_invoice is null then return null; end if;
  perform 1 from public.core_payg_enrollments where id=target_enrollment for update;
  perform 1 from public.invoices where id=target_invoice for update;
  return target_invoice;
end $$;
revoke all on function public.core_lock_payg_adjustment(uuid,text) from public;

create or replace function public.core_validate_stripe_adjustment_operation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  canonical_order_id uuid;
  canonical_source_id uuid;
  canonical_currency text;
  canonical_provider_source_id text;
  canonical_amount bigint;
  canonical_individual_cap bigint;
  canonical_aggregate_cap bigint;
  canonical_reason text;
  canonical_command_version integer;
  canonical_adjustment_status text;
  already_reserved bigint;
  payg_invoice_id uuid;
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'Stripe adjustment operations cannot be deleted';
  end if;

  if tg_op = 'UPDATE' then
    if old.adjustment_id is distinct from new.adjustment_id
      or old.kind is distinct from new.kind
      or old.order_id is distinct from new.order_id
      or old.source_id is distinct from new.source_id
      or old.source_currency is distinct from new.source_currency
      or old.provider_invoice_id is distinct from new.provider_invoice_id
      or old.provider_payment_intent_id is distinct from new.provider_payment_intent_id
      or old.amount_minor is distinct from new.amount_minor
      or old.individual_cap_minor is distinct from new.individual_cap_minor
      or old.aggregate_cap_minor is distinct from new.aggregate_cap_minor
      or old.provider_reason is distinct from new.provider_reason
      or old.internal_reason_code is distinct from new.internal_reason_code
      or old.provider_idempotency_key is distinct from new.provider_idempotency_key
      or old.command_version is distinct from new.command_version
      or old.created_at is distinct from new.created_at
    then
      raise exception using errcode = '55000', message = 'Stripe adjustment command facts are immutable';
    end if;
    if new.state is distinct from old.state
      and not (
        old.state = 'approved' and new.state = 'submitting'
        or old.state = 'submitting' and new.state in ('retrying','provider_accepted','rejected')
        or old.state = 'retrying' and new.state in ('submitting','rejected')
      )
    then
      raise exception using errcode = '23514', message = 'invalid Stripe adjustment operation transition';
    end if;
    if new.state is not distinct from old.state and (
      old.lease_token is distinct from new.lease_token
      or old.lease_until is distinct from new.lease_until
      or old.provider_object_id is distinct from new.provider_object_id
      or old.provider_status is distinct from new.provider_status
      or old.last_error_code is distinct from new.last_error_code
    ) then
      raise exception using errcode = '55000', message = 'Stripe adjustment execution facts require a valid state transition';
    end if;
    if old.provider_object_id is not null and (
      old.provider_object_id is distinct from new.provider_object_id
      or old.provider_status is distinct from new.provider_status
    ) then
      raise exception using errcode = '55000', message = 'accepted Stripe provider identity is immutable';
    end if;
  end if;

  -- The order lock is the cross-source aggregate mutex. Credit notes and
  -- refunds for different source rows on the same order/currency cannot race
  -- one another past the aggregate ceiling.
  if new.order_id is null then
    payg_invoice_id := public.core_lock_payg_adjustment(new.adjustment_id,new.kind);
    if payg_invoice_id is null then
      raise exception using errcode='23514',message='PAYG Stripe adjustment requires its retained credit allocation';
    end if;
  else
    perform 1 from public.orders source_order where source_order.id=new.order_id for update;
    if not found then raise exception using errcode='23503',message='Stripe adjustment order does not exist'; end if;
  end if;

  if new.kind = 'credit_note' then
    select adjustment.order_id, adjustment.invoice_id, adjustment.currency,
      source_invoice.stripe_invoice_id, adjustment.amount_minor,
      source_invoice.amount_minor, source_invoice.amount_minor,
      adjustment.reason_code, adjustment.version, adjustment.status
    into canonical_order_id, canonical_source_id, canonical_currency,
      canonical_provider_source_id, canonical_amount,
      canonical_individual_cap, canonical_aggregate_cap,
      canonical_reason, canonical_command_version, canonical_adjustment_status
    from public.credit_notes adjustment
    join public.invoices source_invoice on source_invoice.id = adjustment.invoice_id
    where adjustment.id = new.adjustment_id
    for update of adjustment, source_invoice;
    if new.provider_invoice_id is distinct from canonical_provider_source_id
      or new.provider_payment_intent_id is not null
      or new.provider_reason not in (
        'duplicate','fraudulent','order_change','product_unsatisfactory'
      )
    then
      raise exception using errcode = '23514', message = 'credit note provider binding is not authoritative';
    end if;
  else
    select adjustment.order_id, adjustment.payment_id, adjustment.currency,
      source_payment.stripe_payment_intent_id, adjustment.amount_minor,
      source_payment.amount_minor, source_invoice.amount_minor,
      adjustment.reason_code, adjustment.version, adjustment.status
    into canonical_order_id, canonical_source_id, canonical_currency,
      canonical_provider_source_id, canonical_amount,
      canonical_individual_cap, canonical_aggregate_cap,
      canonical_reason, canonical_command_version, canonical_adjustment_status
    from public.refunds adjustment
    join public.payments source_payment on source_payment.id = adjustment.payment_id
    join public.invoices source_invoice on source_invoice.id = source_payment.invoice_id
    where adjustment.id = new.adjustment_id
    for update of adjustment, source_payment, source_invoice;
    if new.provider_payment_intent_id is distinct from canonical_provider_source_id
      or new.provider_invoice_id is not null
      or new.provider_reason not in (
        'duplicate','fraudulent','requested_by_customer'
      )
    then
      raise exception using errcode = '23514', message = 'refund provider binding is not authoritative';
    end if;
  end if;

  if canonical_source_id is null
    or canonical_provider_source_id is null
    or new.order_id is distinct from canonical_order_id
    or new.source_id is distinct from canonical_source_id
    or new.source_currency is distinct from canonical_currency
    or new.amount_minor is distinct from canonical_amount
    or new.individual_cap_minor is distinct from canonical_individual_cap
    or new.aggregate_cap_minor is distinct from canonical_aggregate_cap
    or new.internal_reason_code is distinct from canonical_reason
    or new.command_version is distinct from canonical_command_version
  then
    raise exception using errcode = '23514', message = 'Stripe adjustment operation must match persisted source, order, currency, amount, caps, and reason';
  end if;
  if tg_op = 'INSERT' and canonical_adjustment_status <> 'approved' then
    raise exception using errcode = '23514', message = 'Stripe adjustment operation requires an approved local adjustment';
  end if;

  if new.state in ('approved','submitting','retrying','provider_accepted') then
    select coalesce(sum(operation.amount_minor), 0)
    into already_reserved
    from public.core_stripe_adjustment_operations operation
    where ((new.order_id is not null and operation.order_id = new.order_id)
      or (new.order_id is null and operation.order_id is null and (
        (operation.kind='credit_note' and operation.source_id=payg_invoice_id)
        or (operation.kind='refund' and exists(select 1 from public.payments payment where payment.id=operation.source_id and payment.invoice_id=payg_invoice_id)))))
      and operation.source_currency = new.source_currency
      and operation.adjustment_id <> new.adjustment_id
      and operation.state in ('approved','submitting','retrying','provider_accepted');
    if already_reserved + new.amount_minor > new.aggregate_cap_minor then
      raise exception using errcode = '23514', message = 'Stripe adjustment aggregate ceiling exceeded';
    end if;
  end if;
  return new;
end
$$;

create or replace function public.core_create_stripe_adjustment_operation(
  candidate_adjustment_id uuid,
  candidate_kind text,
  candidate_provider_reason text,
  candidate_internal_reason_code text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text := current_setting('role', true);
  existing_operation public.core_stripe_adjustment_operations%rowtype;
  created_operation public.core_stripe_adjustment_operations%rowtype;
  adjustment_order_id uuid;
  adjustment_source_id uuid;
  adjustment_currency text;
  adjustment_amount bigint;
  adjustment_reason text;
  adjustment_version integer;
  adjustment_status text;
  provider_source_id text;
  individual_cap bigint;
  aggregate_cap bigint;
  adjustment_approver uuid;
  payg_invoice_id uuid;
begin
  if caller_role = 'clockwork_runtime' and not (
    public.app_context_is_valid()
    and public.app_has_role('finance_approver')
  ) then
    raise exception using errcode = '42501', message = 'finance approval is required to create a Stripe adjustment operation';
  end if;
  if candidate_kind not in ('credit_note','refund') then
    raise exception using errcode = '23514', message = 'Stripe adjustment kind is invalid';
  end if;

  select * into existing_operation
  from public.core_stripe_adjustment_operations operation
  where operation.adjustment_id = candidate_adjustment_id
  for update;
  if found then
    if existing_operation.kind is distinct from candidate_kind
      or existing_operation.provider_reason is distinct from candidate_provider_reason
      or existing_operation.internal_reason_code is distinct from candidate_internal_reason_code
    then
      raise exception using errcode = '23505', message = 'Stripe adjustment replay conflicts with the durable operation';
    end if;
    return existing_operation.adjustment_id;
  end if;

  -- Resolve only the immutable order identity first, then take the aggregate
  -- mutex before any source lock. Direct service validation uses the same lock
  -- order, preventing a source/order deadlock under mixed concurrent callers.
  if candidate_kind = 'credit_note' then
    select adjustment.order_id into adjustment_order_id
    from public.credit_notes adjustment
    where adjustment.id = candidate_adjustment_id;
  else
    select adjustment.order_id into adjustment_order_id
    from public.refunds adjustment
    where adjustment.id = candidate_adjustment_id;
  end if;
  if adjustment_order_id is null then
    payg_invoice_id := public.core_lock_payg_adjustment(candidate_adjustment_id,candidate_kind);
    if payg_invoice_id is null then
      raise exception using errcode='23514',message='Stripe adjustment source is missing its persisted provider binding';
    end if;
  else
    perform 1 from public.orders source_order where source_order.id=adjustment_order_id for update;
  end if;

  if candidate_kind = 'credit_note' then
    select adjustment.order_id, adjustment.invoice_id, adjustment.currency,
      adjustment.amount_minor, adjustment.reason_code, adjustment.version,
      adjustment.status, adjustment.approved_by,
      source_invoice.stripe_invoice_id, source_invoice.amount_minor,
      source_invoice.amount_minor
    into adjustment_order_id, adjustment_source_id, adjustment_currency,
      adjustment_amount, adjustment_reason, adjustment_version,
      adjustment_status, adjustment_approver,
      provider_source_id, individual_cap, aggregate_cap
    from public.credit_notes adjustment
    join public.invoices source_invoice on source_invoice.id = adjustment.invoice_id
    where adjustment.id = candidate_adjustment_id
    for update of adjustment, source_invoice;
    if caller_role = 'clockwork_runtime'
      and adjustment_approver is distinct from public.app_current_user_id()
    then
      raise exception using errcode = '42501', message = 'finance user must own the approved credit note';
    end if;
  else
    select adjustment.order_id, adjustment.payment_id, adjustment.currency,
      adjustment.amount_minor, adjustment.reason_code, adjustment.version,
      adjustment.status, source_payment.stripe_payment_intent_id,
      source_payment.amount_minor, source_invoice.amount_minor
    into adjustment_order_id, adjustment_source_id, adjustment_currency,
      adjustment_amount, adjustment_reason, adjustment_version,
      adjustment_status, provider_source_id, individual_cap, aggregate_cap
    from public.refunds adjustment
    join public.payments source_payment on source_payment.id = adjustment.payment_id
    join public.invoices source_invoice on source_invoice.id = source_payment.invoice_id
    where adjustment.id = candidate_adjustment_id
    for update of adjustment, source_payment, source_invoice;
  end if;

  if adjustment_source_id is null or provider_source_id is null then
    raise exception using errcode = '23514', message = 'Stripe adjustment source is missing its persisted provider binding';
  end if;
  if adjustment_status <> 'approved' then
    raise exception using errcode = '23514', message = 'Stripe adjustment operation requires an approved local adjustment';
  end if;
  if candidate_internal_reason_code is distinct from adjustment_reason then
    raise exception using errcode = '23514', message = 'Stripe adjustment internal reason must match the approved adjustment';
  end if;

  insert into public.core_stripe_adjustment_operations(
    adjustment_id,kind,order_id,source_id,source_currency,
    provider_invoice_id,provider_payment_intent_id,amount_minor,
    individual_cap_minor,aggregate_cap_minor,provider_reason,
    internal_reason_code,provider_idempotency_key,command_version
  ) values (
    candidate_adjustment_id,candidate_kind,adjustment_order_id,
    adjustment_source_id,adjustment_currency,
    case when candidate_kind = 'credit_note' then provider_source_id end,
    case when candidate_kind = 'refund' then provider_source_id end,
    adjustment_amount,individual_cap,aggregate_cap,candidate_provider_reason,
    adjustment_reason,'stripe-adjustment:' || candidate_adjustment_id::text,
    adjustment_version
  )
  returning * into created_operation;
  return created_operation.adjustment_id;
end
$$;

create or replace function validate_commerce_chain() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_table_name = 'quote_lines' then
    if not exists (
      select 1 from quotes q join rate_cards r on r.id = new.rate_card_id
      where q.id = new.quote_id and q.price_book_id = r.price_book_id and r.sku = new.sku
    ) then raise exception using errcode = '23514', message = 'quote line must use the quote price book and rate-card SKU'; end if;
  elsif tg_table_name = 'orders' then
    if not exists (
      select 1 from quotes q join agreements a on a.id = new.agreement_id
      where q.id = new.quote_id and q.status = 'accepted' and a.status = 'active'
        and a.effective_on <= new.service_starts_on
        and (
          (new.sourcing in ('direct', 'marketplace') and new.partner_account_id is null
            and new.account_id = new.invoicing_account_id and q.account_id = new.account_id
            and q.partner_account_id is null and q.end_client_account_id is null
            and a.account_id = new.account_id)
          or
          (new.sourcing = 'referral' and new.partner_account_id is not null
            and new.account_id = new.invoicing_account_id and q.account_id = new.account_id
            and q.partner_account_id = new.partner_account_id and a.account_id = new.account_id)
          or
          (new.sourcing in ('resale', 'distributor') and new.partner_account_id is not null
            and new.account_id <> new.partner_account_id and new.invoicing_account_id = new.partner_account_id
            and q.account_id = new.account_id and q.end_client_account_id = new.account_id
            and q.partner_account_id = new.partner_account_id and a.account_id = new.partner_account_id)
        )
    ) then raise exception using errcode = '23514', message = 'order quote/agreement/account merchant-of-record chain is inconsistent'; end if;
  elsif tg_table_name = 'order_lines' then
    if not exists (
      select 1 from orders o join quote_lines ql on ql.id = new.quote_line_id
      where o.id = new.order_id and ql.quote_id = o.quote_id and ql.sku = new.sku
        and ql.quantity = new.quantity and ql.unit_price_minor = new.unit_price_minor
        and ql.overage_rate_minor = new.overage_rate_minor
        and (new.superseded_by_amendment_id is null or exists (
          select 1 from amendments a where a.id = new.superseded_by_amendment_id and a.order_id = new.order_id
        ))
    ) then raise exception using errcode = '23514', message = 'order line must be copied from its order quote'; end if;
  elsif tg_table_name = 'commitment_ledgers' then
    if not exists (select 1 from order_lines ol where ol.id = new.order_line_id and ol.order_id = new.order_id)
    then raise exception using errcode = '23514', message = 'operational record order line must belong to its order'; end if;
  elsif tg_table_name = 'entitlements' then
    if not exists (select 1 from order_lines ol where ol.id = new.order_line_id and ol.order_id = new.order_id)
    then raise exception using errcode = '23514', message = 'operational record order line must belong to its order'; end if;
    if not exists (
      select 1 from orders o join organizations org on org.id = new.organization_id
      where o.id = new.order_id and org.account_id = o.account_id
    ) then raise exception using errcode = '23514', message = 'entitlement organization must belong to the service account'; end if;
  elsif tg_table_name = 'invoices' then
    if new.billing_source = 'payg' then return new; end if;
    if not exists (
      select 1 from orders o join quotes q on q.id = o.quote_id
      where o.id = new.order_id and o.invoicing_account_id = new.account_id and q.currency = new.currency
        and new.po_number is not distinct from o.po_number
    ) then raise exception using errcode = '23514', message = 'invoice account/currency must match the order merchant of record'; end if;
  elsif tg_table_name in ('payments', 'credit_notes') then
    if not exists (
      select 1 from invoices i where i.id = new.invoice_id and i.order_id is not distinct from new.order_id and i.currency = new.currency
    ) then raise exception using errcode = '23514', message = 'invoice adjustment must match its invoice order and currency'; end if;
  elsif tg_table_name in ('refunds', 'dispute_cases') then
    if not exists (
      select 1 from payments p where p.id = new.payment_id and p.order_id is not distinct from new.order_id and p.currency = new.currency
    ) then raise exception using errcode = '23514', message = 'payment adjustment must match its payment order and currency'; end if;
  elsif tg_table_name = 'inbound_notices' then
    if not exists (select 1 from orders o where o.id = new.order_id and o.account_id = new.account_id)
    then raise exception using errcode = '23514', message = 'notice account must match its order'; end if;
  elsif tg_table_name = 'terminations' then
    if new.order_id is not null and not exists (
      select 1 from orders o where o.id = new.order_id and o.account_id = new.account_id
    ) then raise exception using errcode = '23514', message = 'termination account must match its order'; end if;
  elsif tg_table_name = 'amendment_lines' then
    if new.order_line_id is not null and not exists (
      select 1 from amendments a join order_lines ol on ol.id = new.order_line_id
      where a.id = new.amendment_id and a.order_id = ol.order_id
    ) then raise exception using errcode = '23514', message = 'amendment line must belong to the amended order'; end if;
  elsif tg_table_name = 'commitment_entries' then
    if not exists (
      select 1
      from commitment_ledgers l
      join usage_events u on u.id = new.usage_event_id
      join entitlements e on e.id = u.entitlement_id
      where l.id = new.ledger_id and l.order_id = e.order_id and l.order_line_id = e.order_line_id
    ) then raise exception using errcode = '23514', message = 'usage event must belong to the commitment ledger order line'; end if;
  elsif tg_table_name = 'commission_accruals' then
    if not exists (
      select 1 from invoices i join orders o on o.id = i.order_id
      where i.id = new.invoice_id and o.sourcing = 'referral'
        and o.partner_account_id = new.partner_account_id and i.currency = new.currency
    ) then raise exception using errcode = '23514', message = 'commission must belong to an attributed referral invoice'; end if;
  elsif tg_table_name = 'novations' then
    if not exists (
      select 1 from orders source_order join orders new_order on new_order.id = new.new_order_id
      join agreements new_agreement on new_agreement.id = new.new_agreement_id
      where source_order.id = new.source_order_id and source_order.account_id = new.account_id
        and source_order.partner_account_id = new.former_partner_account_id
        and new_order.account_id = new.account_id and new_agreement.account_id = new.account_id
    ) then raise exception using errcode = '23514', message = 'novation must preserve the end-client artifact chain'; end if;
  end if;
  return new;
end $$;

create function public.lock_payg_payment_adjustment_enrollment() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  perform 1 from public.core_payg_enrollments enrollment
    join public.core_payg_invoice_sources source on source.enrollment_id=enrollment.id
    join public.payments payment on payment.invoice_id=source.invoice_id
    where payment.id=new.payment_id for update of enrollment;
  return new;
end $$;
revoke all on function public.lock_payg_payment_adjustment_enrollment() from public;
create trigger a_payg_refund_enrollment_lock before insert on public.refunds
  for each row execute function public.lock_payg_payment_adjustment_enrollment();
create trigger a_payg_dispute_enrollment_lock before insert on public.dispute_cases
  for each row execute function public.lock_payg_payment_adjustment_enrollment();
