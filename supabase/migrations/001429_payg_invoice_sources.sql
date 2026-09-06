-- A PAYG period is an explicit invoice source, never a fabricated term order.
alter table public.invoices add column billing_source text not null default 'order';
alter table public.invoices add column payg_effect_key text references public.core_payg_pending_invoice_effects(idempotency_key);
alter table public.invoices alter column order_id drop not null;
alter table public.payments alter column order_id drop not null;
alter table public.invoices add constraint invoices_billing_source_check check (
  (billing_source = 'order' and order_id is not null and payg_effect_key is null)
  or (billing_source = 'payg' and order_id is null and payg_effect_key is not null)
);
create unique index core_payg_one_effect_per_revision on public.core_payg_pending_invoice_effects(enrollment_id, (payload->>'month'), (payload->>'revision'));
create unique index invoices_payg_effect_unique on public.invoices(payg_effect_key) where payg_effect_key is not null;

create table public.core_payg_invoice_sources (
  invoice_id uuid primary key references public.invoices(id),
  enrollment_id uuid not null references public.core_payg_enrollments(id),
  effect_key text not null unique references public.core_payg_pending_invoice_effects(idempotency_key),
  source_snapshot jsonb not null check (jsonb_typeof(source_snapshot) = 'object'),
  source_hash text not null check (source_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now()
);
alter table public.core_payg_invoice_sources enable row level security;
alter table public.core_payg_invoice_sources force row level security;
revoke all on public.core_payg_invoice_sources from public, anon, authenticated, clockwork_runtime;
grant select, insert on public.core_payg_invoice_sources to clockwork_service;
create policy core_payg_invoice_sources_service on public.core_payg_invoice_sources for all to clockwork_service
using (public.app_is_internal()) with check (public.app_is_internal());
create trigger core_payg_invoice_sources_immutable before update or delete on public.core_payg_invoice_sources
for each row execute function public.guard_payg_retained_history();

create function public.validate_payg_invoice_source_truth() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, private, extensions as $$
declare
  effect public.core_payg_pending_invoice_effects%rowtype;
  enrollment public.core_payg_enrollments%rowtype;
  revision public.core_payg_period_revisions%rowtype;
  prior_total bigint;
  expected_net bigint;
begin
  if new.billing_source <> 'payg' then return new; end if;
  select * into effect from public.core_payg_pending_invoice_effects where idempotency_key = new.payg_effect_key;
  select * into enrollment from public.core_payg_enrollments where id = effect.enrollment_id;
  select * into revision from public.core_payg_period_revisions rated where rated.enrollment_id = effect.enrollment_id
    and rated.month = effect.payload->>'month' and rated.revision = (effect.payload->>'revision')::integer;
  if effect.idempotency_key is null or enrollment.id is null or revision.enrollment_id is null
    or effect.payload->>'idempotencyKey' is distinct from new.payg_effect_key
    or effect.payload->>'enrollmentId' is distinct from enrollment.id::text
    or effect.payload->>'accountId' is distinct from new.account_id::text
    or enrollment.account_id is distinct from new.account_id
    or enrollment.snapshot->>'billingAuthority' is distinct from 'clockwork'
    or nullif(trim(enrollment.snapshot->>'cutoverEvidenceId'), '') is null
    or effect.payload->>'kind' not in ('invoice', 'debit_adjustment')
    or effect.payload->>'kind' is null
    or effect.payload#>>'{amount,currency}' is distinct from new.currency
    or (effect.payload#>>'{amount,minor}')::bigint is distinct from new.amount_minor - new.tax_minor
    or new.amount_minor - new.tax_minor <= 0
    or revision.snapshot#>>'{rating,period,month}' is distinct from revision.month
    or revision.snapshot#>>'{rating,total,currency}' is distinct from new.currency
    or effect.payload->>'ratingEvidenceHash' is distinct from revision.snapshot#>>'{rating,evidenceHash}'
    or revision.snapshot#>'{rating,policy}' is distinct from enrollment.snapshot->'policy'
    or revision.snapshot#>'{rating,binding}' is distinct from enrollment.snapshot->'binding'
    or new.order_id is not null or new.amendment_delta_minor <> 0 or new.po_number is not null
  then raise exception using errcode='23514', message='PAYG invoice must match its retained authorized billing effect'; end if;
  if effect.payload->>'kind' = 'invoice' then
    if revision.revision <> 1 or effect.payload->>'originalInvoiceKey' is distinct from effect.idempotency_key then
      raise exception using errcode='23514', message='PAYG original invoice must bind the first rated revision';
    end if;
    expected_net := (revision.snapshot#>>'{rating,total,minor}')::bigint;
  else
    select (snapshot#>>'{rating,total,minor}')::bigint into prior_total
      from public.core_payg_period_revisions previous where previous.enrollment_id = revision.enrollment_id
      and previous.month = revision.month and previous.revision = revision.revision - 1;
    expected_net := (revision.snapshot#>>'{rating,total,minor}')::bigint - prior_total;
    if not exists (select 1 from public.core_payg_pending_invoice_effects original
      where original.idempotency_key = effect.payload->>'originalInvoiceKey'
        and original.enrollment_id = effect.enrollment_id and original.payload->>'kind' = 'invoice'
        and original.payload->>'month' = revision.month) then
      raise exception using errcode='23514', message='PAYG correction must bind its original period invoice effect';
    end if;
  end if;
  if expected_net is null or expected_net <= 0 or expected_net is distinct from new.amount_minor - new.tax_minor then
    raise exception using errcode='23514', message='PAYG invoice net must equal its rated revision or positive correction delta';
  end if;
  return new;
end $$;
revoke all on function public.validate_payg_invoice_source_truth() from public;
create trigger invoices_payg_source_truth before insert or update on public.invoices
for each row execute function public.validate_payg_invoice_source_truth();

create or replace function public.validate_invoice_payment_projection_truth()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_table_name = 'invoices' then
    if new.billing_source = 'order' then
    if not exists (
      select 1
      from public.orders o
      join public.quotes q on q.id = o.quote_id
      where o.id = new.order_id
        and o.immutable_at is not null
        and q.status = 'accepted'
        and o.invoicing_account_id = new.account_id
        and q.currency = new.currency
        and q.total_minor + new.amendment_delta_minor
              = new.amount_minor - new.tax_minor
        and o.po_number is not distinct from new.po_number
    ) then
      raise exception using
        errcode = '23514',
        message = 'invoice must derive account, currency, amount, and PO from its accepted order and quote';
    end if;
    -- Only at insert is the live sum the truth about what this invoice bills.
    -- An amendment carrying no financial terms contributes nothing to it and is
    -- refused at the writer rather than here: the seeded demo predates 001390
    -- and carries one.
    if tg_op = 'INSERT' and new.amendment_delta_minor is distinct from coalesce((
      select sum(terms.forecast_delta_minor)
      from public.amendments amendment
      join public.core_amendment_financial_terms terms
        on terms.amendment_id = amendment.id
      where amendment.order_id = new.order_id
    ), 0) then
      raise exception using
        errcode = '23514',
        message = 'invoice amendment delta must equal the net forecast delta of its order amendments';
    end if;
    end if;
    if tg_op = 'UPDATE' and (
      old.billing_source is distinct from new.billing_source
      or old.payg_effect_key is distinct from new.payg_effect_key
      or old.order_id is distinct from new.order_id
      or old.account_id is distinct from new.account_id
      or old.currency is distinct from new.currency
      or old.amount_minor is distinct from new.amount_minor
      or old.amendment_delta_minor is distinct from new.amendment_delta_minor
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
        and i.order_id is not distinct from new.order_id
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
      select 1 from payments p where p.id = new.payment_id and p.order_id = new.order_id and p.currency = new.currency
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

-- Keep materialized presentation and the determined tax question/answer with
-- the exact period revision. A new tax rule or customer address never rewrites it.
create function public.validate_payg_invoice_snapshot() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, private, extensions as $$
declare
  invoice public.invoices%rowtype;
  effect public.core_payg_pending_invoice_effects%rowtype;
  enrollment public.core_payg_enrollments%rowtype;
  revision public.core_payg_period_revisions%rowtype;
  supplier public.core_legal_entities%rowtype;
  customer public.accounts%rowtype;
  tax jsonb;
  detail jsonb;
  expected_hash text;
  line_sum bigint;
  weakest integer;
begin
  select * into invoice from public.invoices where id = new.invoice_id for share;
  select * into effect from public.core_payg_pending_invoice_effects where idempotency_key = new.effect_key;
  select * into enrollment from public.core_payg_enrollments where id = new.enrollment_id;
  select * into revision from public.core_payg_period_revisions rated where rated.enrollment_id = new.enrollment_id
    and rated.month = effect.payload->>'month' and rated.revision = (effect.payload->>'revision')::integer;
  if invoice.id is null or invoice.billing_source <> 'payg'
    or invoice.payg_effect_key is distinct from new.effect_key
    or effect.enrollment_id is distinct from new.enrollment_id
    or new.source_snapshot->'effect' is distinct from effect.payload
    or new.source_snapshot->'rating' is distinct from revision.snapshot->'rating'
    or new.source_snapshot->>'stripeCustomerId' is distinct from enrollment.snapshot->>'stripeCustomerId'
    or nullif(trim(new.source_snapshot->>'stripeCustomerId'), '') is null
  then raise exception using errcode='23514', message='PAYG invoice snapshot must bind its immutable rating and billing identity'; end if;

  tax := new.source_snapshot->'taxDetermination';
  detail := tax->'detail';
  select * into supplier from public.core_legal_entities where id::text = enrollment.snapshot->>'supplierLegalEntityId';
  select * into customer from public.accounts where id = enrollment.account_id;
  if supplier.id is null or supplier.merchant_role <> 'our_entity' or customer.id is null
    or new.source_snapshot#>>'{supplier,legalEntityId}' is distinct from supplier.id::text
    or new.source_snapshot#>>'{supplier,legalName}' is distinct from supplier.legal_name
    or new.source_snapshot#>'{supplier,registeredAddress}' is distinct from supplier.registered_address
    or new.source_snapshot#>>'{supplier,establishedCountry}' is distinct from supplier.established_country
    or new.source_snapshot#>>'{supplier,invoiceHeaderText}' is distinct from supplier.invoice_header_text
    or new.source_snapshot#>>'{supplier,invoiceFooterText}' is distinct from supplier.invoice_footer_text
    or new.source_snapshot#>>'{customer,accountId}' is distinct from customer.id::text
    or new.source_snapshot#>>'{customer,legalName}' is distinct from customer.legal_name
    or new.source_snapshot#>'{customer,registeredAddress}' is distinct from customer.registered_address
    or new.source_snapshot#>>'{customer,country}' is distinct from customer.country
    or new.source_snapshot#>>'{customer,invoiceDeliveryEmail}' is distinct from customer.invoice_delivery_email
    or detail->>'supplierLegalEntityId' is distinct from supplier.id::text
    or detail->>'customerAccountId' is distinct from customer.id::text
    or tax->>'currency' is distinct from invoice.currency
    or (tax->>'netMinor')::bigint is distinct from invoice.amount_minor - invoice.tax_minor
    or (tax->>'taxMinor')::bigint is distinct from invoice.tax_minor
    or tax->>'treatment' is distinct from invoice.tax_treatment
    or detail->>'confidence' is distinct from 'determined'
    or detail->'reviewReasons' is distinct from '[]'::jsonb
    or nullif(trim(detail->>'determinationId'), '') is null
    or nullif(trim(detail->>'taxPointDate'), '') is null
    or jsonb_typeof(detail->'determinationInput') is distinct from 'object'
    or jsonb_typeof(detail->'lines') is distinct from 'array'
    or jsonb_array_length(detail->'lines') = 0
  then raise exception using errcode='23514', message='PAYG invoice snapshot must retain its supplier, customer, and determined tax'; end if;

  if detail#>>'{determinationInput,currency}' is distinct from invoice.currency
    or detail#>>'{determinationInput,supplier,legalEntityId}' is distinct from supplier.id::text
    or detail#>>'{determinationInput,customer,accountId}' is distinct from customer.id::text
    or detail#>>'{determinationInput,paygSource,enrollmentId}' is distinct from enrollment.id::text
    or detail#>>'{determinationInput,paygSource,effectKey}' is distinct from new.effect_key
    or (detail->'determinationInput') ? 'orderId'
    or jsonb_typeof(detail#>'{determinationInput,lines}') is distinct from 'array'
    or (select sum((line->>'netMinor')::bigint) from jsonb_array_elements(detail#>'{determinationInput,lines}') line)
      is distinct from invoice.amount_minor - invoice.tax_minor
  then raise exception using errcode='23514', message='PAYG tax question must describe the billed source and net'; end if;
  expected_hash := encode(extensions.digest(convert_to(private.canonical_jsonb_text(detail->'determinationInput'), 'UTF8'), 'sha256'), 'hex');
  if detail->>'determinationInputHash' is distinct from expected_hash then
    raise exception using errcode='23514', message='PAYG tax determination canonical input hash mismatch';
  end if;
  select sum((line->>'taxMinor')::bigint) into line_sum from jsonb_array_elements(detail->'lines') line;
  if line_sum is distinct from invoice.tax_minor
    or (select count(*) <> count(distinct (line->>'lineId',line->>'jurisdiction')) from jsonb_array_elements(detail->'lines') line)
    or tax->>'treatment' is distinct from (select case when count(distinct line->>'treatment') = 1 then min(line->>'treatment') else 'standard' end from jsonb_array_elements(detail->'lines') line)
    or exists (
    select 1 from jsonb_array_elements(detail->'lines') line
    left join public.core_tax_rule_books book on book.id::text = line->>'ruleBookId'
    where book.id is null or book.version is distinct from (line->>'ruleBookVersion')::integer
      or nullif(trim(line->>'lineId'), '') is null
      or nullif(trim(line->>'jurisdiction'), '') is null
      or nullif(trim(line->>'taxCode'), '') is null
      or nullif(trim(line->>'legalBasis'), '') is null
      or line->>'taxMinor' is null or line->>'taxableMinor' is null or line->>'ratePpm' is null
      or not exists (select 1 from jsonb_array_elements(detail#>'{determinationInput,lines}') input_line
        where input_line->>'lineId' = line->>'lineId' and input_line->>'taxCode' = line->>'taxCode'
          and (input_line->>'netMinor')::bigint = (line->>'taxableMinor')::bigint)
      or not exists (select 1 from jsonb_array_elements(detail#>'{determinationInput,ruleBooks}') input_book
        where input_book->>'id' = line->>'ruleBookId' and (input_book->>'version')::integer = (line->>'ruleBookVersion')::integer)
      or (line->>'taxMinor')::bigint < 0 or (line->>'taxableMinor')::bigint < 0
      or (line->>'ratePpm')::bigint < 0
      or line->>'treatment' is null
      or line->>'treatment' not in ('standard','reverse_charge','zero_rated','exempt','out_of_scope','not_registered')
      or (line->>'treatment' <> 'standard' and ((line->>'taxMinor')::bigint <> 0 or (line->>'ratePpm')::bigint <> 0))
  ) then raise exception using errcode='23514', message='PAYG tax lines must match invoice tax and pinned rule books'; end if;
  if exists (select 1 from jsonb_array_elements(detail#>'{determinationInput,ruleBooks}') input_book
    left join public.core_tax_rule_books book on book.id::text = input_book->>'id'
    where book.id is null or book.version is distinct from (input_book->>'version')::integer) then
    raise exception using errcode='23514', message='PAYG tax question must pin existing rule book versions';
  end if;
  select min(case book.input_provenance when 'unverified' then 0 when 'repository_fixture' then 1 else 2 end)
    into weakest from public.core_tax_rule_books book
    where book.id::text in (select jsonb_array_elements(detail#>'{determinationInput,ruleBooks}')->>'id');
  if weakest is null or detail->>'inputProvenance' is distinct from (array['unverified','repository_fixture','live_signed'])[weakest + 1] then
    raise exception using errcode='23514', message='PAYG tax provenance must match retained rule books';
  end if;
  expected_hash := encode(extensions.digest(convert_to(private.canonical_jsonb_text(new.source_snapshot), 'UTF8'), 'sha256'), 'hex');
  if new.source_hash is distinct from expected_hash then
    raise exception using errcode='23514', message='PAYG invoice canonical source hash mismatch';
  end if;
  return new;
end $$;
revoke all on function public.validate_payg_invoice_snapshot() from public;
create trigger core_payg_invoice_sources_validate before insert on public.core_payg_invoice_sources
for each row execute function public.validate_payg_invoice_snapshot();

create function public.require_payg_invoice_snapshot() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if new.billing_source = 'payg' and not exists (
    select 1 from public.core_payg_invoice_sources source
    where source.invoice_id = new.id and source.effect_key = new.payg_effect_key
  ) then raise exception using errcode='23514', message='PAYG invoice requires its immutable tax and document source'; end if;
  return new;
end $$;
revoke all on function public.require_payg_invoice_snapshot() from public;
create constraint trigger invoices_payg_snapshot_required after insert or update on public.invoices
  deferrable initially deferred for each row execute function public.require_payg_invoice_snapshot();

-- Customers can derive their own invoice from retained facts; no tenant writer
-- can supply or replace those facts. Projection returns only display fields.
grant select on public.core_payg_invoice_sources to clockwork_runtime;
create policy core_payg_invoice_sources_customer_read on public.core_payg_invoice_sources
for select to clockwork_runtime using (exists (
  select 1 from public.invoices invoice where invoice.id = invoice_id
    and public.app_has_account(invoice.account_id)
));
