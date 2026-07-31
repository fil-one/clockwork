-- Core-finance migration range is 000100-000199. Companion tables extend the
-- foundation without rewriting its canonical commercial artifact tables.

create table core_account_commercial_profiles (
  account_id uuid primary key references accounts(id),
  legal_entity_fingerprint text not null unique check (legal_entity_fingerprint ~ '^[a-f0-9]{64}$'),
  billing_model text not null default 'auto_charge' check (billing_model in ('prepay','auto_charge','net_terms')),
  payment_terms_days integer,
  credit_status text not null default 'not_requested' check (credit_status in ('not_requested','pending','approved','declined','suspended')),
  approved_credit_limit_minor bigint not null default 0 check (approved_credit_limit_minor >= 0),
  current_exposure_minor bigint not null default 0 check (current_exposure_minor >= 0),
  new_service_blocked boolean not null default false,
  block_reason text,
  collections_owner_id uuid references commerce_users(id),
  contractual_time_zone text not null default 'UTC',
  locale text not null default 'en-US',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), row_version integer not null default 1,
  constraint core_account_terms_check check (
    (billing_model = 'net_terms' and payment_terms_days between 1 and 365)
    or (billing_model <> 'net_terms' and payment_terms_days is null)
  ),
  constraint core_account_block_reason_check check (not new_service_blocked or nullif(block_reason, '') is not null)
);
create index core_account_credit_queue_idx on core_account_commercial_profiles(credit_status, new_service_blocked);

create table core_account_relationship_roles (
  account_id uuid not null references accounts(id),
  role text not null check (role in ('direct_client','partner','end_client')),
  source text not null default 'self_declared',
  effective_from date not null default current_date,
  effective_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), row_version integer not null default 1,
  primary key(account_id, role),
  check (effective_to is null or effective_to >= effective_from)
);

create table core_account_contacts (
  id uuid primary key default gen_random_uuid(), account_id uuid not null references accounts(id),
  kind text not null check (kind in ('billing','accounts_payable','remit_to','tax','procurement','commercial','technical')),
  name text not null, title text, email text not null, phone text,
  is_primary boolean not null default false, receives_invoices boolean not null default false, active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), row_version integer not null default 1
);
create index core_account_contacts_account_idx on core_account_contacts(account_id, kind, active);
create unique index core_account_contacts_primary_unique on core_account_contacts(account_id, kind) where is_primary and active;

create table core_account_tax_identifiers (
  id uuid primary key default gen_random_uuid(), account_id uuid not null references accounts(id),
  jurisdiction text not null, type text not null, normalized_value text not null,
  validation_status text not null default 'pending' check (validation_status in ('pending','valid','invalid','expired')),
  verification_reference text, reverse_charge_eligible boolean not null default false, validated_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), row_version integer not null default 1,
  unique(jurisdiction, type, normalized_value),
  check ((validation_status = 'valid') = (validated_at is not null))
);
create index core_tax_identifier_account_idx on core_account_tax_identifiers(account_id);

create table core_procurement_certificates (
  id uuid primary key default gen_random_uuid(), account_id uuid not null references accounts(id),
  kind text not null, jurisdiction text, certificate_number text, document_id uuid not null references documents(id),
  valid_from date, expires_on date, status text not null default 'pending' check (status in ('pending','valid','expired','revoked')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), row_version integer not null default 1,
  check (expires_on is null or valid_from is null or expires_on >= valid_from)
);
create index core_procurement_cert_expiry_idx on core_procurement_certificates(account_id, status, expires_on);

create table core_price_book_activation_events (
  id uuid primary key default gen_random_uuid(), price_book_id uuid not null references price_books(id),
  action text not null check (action in ('activate','retire','schedule','cancel_schedule')),
  previous_status text, resulting_status text not null, effective_at timestamptz not null,
  actor_user_id uuid not null references commerce_users(id), reason text not null, request_id text not null,
  created_at timestamptz not null default now()
);
create index core_price_activation_timeline_idx on core_price_book_activation_events(price_book_id, effective_at);

create table core_partner_transfer_tiers (
  id uuid primary key default gen_random_uuid(), rate_card_id uuid not null references rate_cards(id),
  agreement_type text not null, tier text not null, transfer_price_minor bigint not null, floor_price_minor bigint not null,
  effective_from date not null, effective_to date, created_at timestamptz not null default now(),
  unique(rate_card_id, agreement_type, tier, effective_from),
  check (transfer_price_minor >= floor_price_minor and floor_price_minor >= 0),
  check (effective_to is null or effective_to >= effective_from)
);

create table core_quote_commercial_profiles (
  quote_id uuid primary key references quotes(id),
  channel_shape text not null check (channel_shape in ('direct','referral','resale','distributor','marketplace')),
  merchant_of_record text not null check (merchant_of_record in ('fil_one','partner','marketplace')),
  pricing_authority text not null check (pricing_authority in ('fil_one','partner','marketplace')),
  billing_account_id uuid not null references accounts(id), distributor_account_id uuid references accounts(id), marketplace_provider text,
  transfer_total_minor bigint, partner_resale_total_minor bigint,
  white_label_metadata jsonb not null default '{}', pricing_inputs jsonb not null, pricing_calculated_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (transfer_total_minor is null or transfer_total_minor >= 0),
  check (partner_resale_total_minor is null or partner_resale_total_minor >= 0),
  check ((channel_shape = 'marketplace') = (marketplace_provider is not null))
);
create index core_quote_channel_idx on core_quote_commercial_profiles(channel_shape, merchant_of_record);

create table core_quote_snapshots (
  id uuid primary key default gen_random_uuid(), quote_id uuid not null unique references quotes(id), revision integer not null check (revision > 0),
  snapshot jsonb not null, snapshot_hash text not null unique check (snapshot_hash ~ '^[a-f0-9]{64}$'),
  issued_at timestamptz not null, created_by uuid not null references commerce_users(id), created_at timestamptz not null default now()
);

create table core_pricing_exception_decisions (
  id uuid primary key default gen_random_uuid(), quote_id uuid not null references quotes(id),
  floor_total_minor bigint not null check (floor_total_minor >= 0), quoted_total_minor bigint not null check (quoted_total_minor >= 0),
  modeled_margin_bps integer not null, impact_minor bigint not null check (impact_minor >= 0), reason text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected','withdrawn')),
  assigned_to uuid not null references commerce_users(id), decided_by uuid references commerce_users(id), decided_at timestamptz, decision_reason text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), row_version integer not null default 1,
  check ((status = 'pending' and decided_by is null and decided_at is null) or (status <> 'pending' and decided_by is not null and decided_at is not null))
);
create unique index core_pricing_exception_open_unique on core_pricing_exception_decisions(quote_id) where status = 'pending';
create index core_pricing_exception_queue_idx on core_pricing_exception_decisions(status, created_at);

create table core_order_commercial_profiles (
  order_id uuid primary key references orders(id), merchant_of_record text not null check (merchant_of_record in ('fil_one','partner','marketplace')),
  billing_shape text not null check (billing_shape in ('direct','referral','resale','distributor','marketplace')),
  provisioning_idempotency_key text not null unique, governing_agreement_version integer not null check (governing_agreement_version > 0),
  deal_registration_id uuid references deal_registrations(id), distributor_account_id uuid references accounts(id),
  co_term_parent_order_id uuid references orders(id), invoice_grouping_key text, contractual_time_zone text not null default 'UTC',
  accepted_at timestamptz not null, created_at timestamptz not null default now(),
  check (co_term_parent_order_id is null or co_term_parent_order_id <> order_id)
);
create index core_order_mor_idx on core_order_commercial_profiles(merchant_of_record, billing_shape);
create index core_order_registration_idx on core_order_commercial_profiles(deal_registration_id);

create table core_order_line_snapshots (
  id uuid primary key default gen_random_uuid(), order_line_id uuid not null unique references order_lines(id), snapshot jsonb not null,
  snapshot_hash text not null unique check (snapshot_hash ~ '^[a-f0-9]{64}$'), created_at timestamptz not null default now()
);

create table core_amendment_financial_terms (
  amendment_id uuid primary key references amendments(id), contractual_time_zone text not null,
  proration_convention text not null check (proration_convention in ('actual_actual','actual_365','thirty_360','none')),
  period_starts_on date not null, period_ends_on date not null, billable_numerator integer not null, billable_denominator integer not null,
  currency text not null, forecast_delta_minor bigint not null, monthly_delta_minor bigint not null, created_at timestamptz not null default now(),
  check (period_ends_on >= period_starts_on),
  check (billable_numerator >= 0 and billable_denominator > 0 and billable_numerator <= billable_denominator)
);

create table core_amendment_line_supersessions (
  id uuid primary key default gen_random_uuid(), amendment_id uuid not null references amendments(id),
  superseded_order_line_id uuid not null references order_lines(id), replacement_snapshot jsonb not null, effective_on date not null,
  net_quantity_delta numeric(38,18) not null, net_revenue_delta_minor bigint not null, created_at timestamptz not null default now(),
  unique(amendment_id, superseded_order_line_id)
);

create table core_commitment_periods (
  id uuid primary key default gen_random_uuid(), ledger_id uuid not null references commitment_ledgers(id), sequence integer not null check (sequence > 0),
  starts_at timestamptz not null, ends_at timestamptz not null, contractual_time_zone text not null,
  allowance_quantity numeric(38,18) not null check (allowance_quantity >= 0), consumed_quantity numeric(38,18) not null default 0 check (consumed_quantity >= 0),
  overage_quantity numeric(38,18) not null default 0 check (overage_quantity >= 0), contracted_overage_rate_minor bigint not null check (contracted_overage_rate_minor >= 0),
  status text not null default 'open' check (status in ('open','closed','reopened')), closed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), row_version integer not null default 1,
  unique(ledger_id, sequence), unique(ledger_id, starts_at, ends_at), check (ends_at > starts_at),
  check ((status = 'closed') = (closed_at is not null))
);
create index core_commitment_period_open_idx on core_commitment_periods(status, ends_at);

create table core_commitment_ledger_corrections (
  id uuid primary key default gen_random_uuid(), ledger_id uuid not null references commitment_ledgers(id),
  period_id uuid references core_commitment_periods(id), reverses_entry_id uuid references commitment_entries(id),
  quantity_delta numeric(38,18) not null, overage_delta numeric(38,18) not null, reason_code text not null, source_reference text not null,
  recorded_by uuid not null references commerce_users(id), recorded_at timestamptz not null, created_at timestamptz not null default now(),
  unique(ledger_id, source_reference)
);
create index core_ledger_correction_period_idx on core_commitment_ledger_corrections(period_id);

create table core_usage_reconciliations (
  id uuid primary key default gen_random_uuid(), entitlement_id uuid not null references entitlements(id),
  period_starts_at timestamptz not null, period_ends_at timestamptz not null, source_system text not null,
  source_quantity numeric(38,18) not null, ledger_quantity numeric(38,18) not null, variance_quantity numeric(38,18) not null,
  status text not null check (status in ('matched','variance','resolved')), resolution text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), row_version integer not null default 1,
  unique(entitlement_id, period_starts_at, period_ends_at, source_system), check (period_ends_at > period_starts_at),
  check (variance_quantity = source_quantity - ledger_quantity)
);
create index core_usage_reconciliation_queue_idx on core_usage_reconciliations(status);

create table core_billing_policies (
  account_id uuid primary key references accounts(id),
  collection_method text not null check (collection_method in ('prepay','auto_charge','net_terms')),
  payment_rail text not null check (payment_rail in ('card','ach_debit','wire','sepa_credit','bacs','marketplace')),
  terms_days integer, consolidate_partner_invoices boolean not null default false, dunning_policy_version text not null,
  require_po boolean not null default false, require_vendor_setup boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), row_version integer not null default 1,
  check ((collection_method = 'net_terms' and terms_days between 1 and 365) or (collection_method <> 'net_terms' and terms_days is null))
);

create table core_invoice_end_client_allocations (
  id uuid primary key default gen_random_uuid(), invoice_id uuid not null references invoices(id), order_id uuid not null references orders(id),
  end_client_account_id uuid not null references accounts(id), currency text not null,
  subtotal_minor bigint not null check (subtotal_minor >= 0), tax_minor bigint not null check (tax_minor >= 0), total_minor bigint not null,
  stripe_invoice_line_ids text[] not null, created_at timestamptz not null default now(),
  unique(invoice_id, order_id, end_client_account_id), check (total_minor = subtotal_minor + tax_minor)
);
create index core_invoice_end_client_idx on core_invoice_end_client_allocations(end_client_account_id);

create table core_collection_cases (
  id uuid primary key default gen_random_uuid(), invoice_id uuid not null unique references invoices(id), account_id uuid not null references accounts(id),
  owner_user_id uuid not null references commerce_users(id), aging_bucket text not null, next_action_at timestamptz not null,
  status text not null check (status in ('open','promised','escalated','resolved','written_off')),
  new_service_blocked boolean not null default false,
  running_service_decision text not null default 'continue' check (running_service_decision in ('continue','human_review','suspend_write')),
  maximum_retention_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), row_version integer not null default 1
);
create index core_collection_queue_idx on core_collection_cases(status, next_action_at);

create table core_collection_actions (
  id uuid primary key default gen_random_uuid(), collection_case_id uuid not null references core_collection_cases(id),
  action text not null, actor_user_id uuid not null references commerce_users(id), outcome text not null,
  metadata jsonb not null default '{}', occurred_at timestamptz not null, created_at timestamptz not null default now()
);
create index core_collection_action_timeline_idx on core_collection_actions(collection_case_id, occurred_at);

create table core_partner_hierarchy_edges (
  id uuid primary key default gen_random_uuid(), distributor_account_id uuid not null references accounts(id),
  reseller_account_id uuid not null references accounts(id), effective_from date not null, effective_to date,
  status text not null check (status in ('pending','active','ended')), settlement_responsibility text not null check (settlement_responsibility in ('distributor','reseller')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), row_version integer not null default 1,
  check (distributor_account_id <> reseller_account_id), check (effective_to is null or effective_to >= effective_from)
);
create unique index core_partner_hierarchy_active_reseller_unique on core_partner_hierarchy_edges(reseller_account_id) where status = 'active';
create index core_partner_hierarchy_distributor_idx on core_partner_hierarchy_edges(distributor_account_id, status);

create table core_deal_registration_attributions (
  registration_id uuid primary key references deal_registrations(id), attribution text not null check (attribution in ('sourced','influenced','none')),
  influence_bps integer not null check (influence_bps between 0 and 10000), decision_basis text not null,
  decided_by uuid not null references commerce_users(id), decided_at timestamptz not null, created_at timestamptz not null default now(),
  check ((attribution = 'sourced' and influence_bps = 10000) or (attribution = 'none' and influence_bps = 0) or attribution = 'influenced')
);

create table core_deal_registration_exclusions (
  id uuid primary key default gen_random_uuid(), registration_id uuid not null references deal_registrations(id),
  kind text not null check (kind in ('house_account','prior_deal','duplicate_entity','restricted_party','territory')),
  matched_account_id uuid references accounts(id), evidence jsonb not null,
  status text not null check (status in ('detected','confirmed','cleared')), resolved_by uuid references commerce_users(id), resolved_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), row_version integer not null default 1,
  check ((status = 'detected' and resolved_at is null and resolved_by is null) or (status <> 'detected' and resolved_at is not null and resolved_by is not null))
);
create index core_deal_exclusion_queue_idx on core_deal_registration_exclusions(status, created_at);

create table core_deal_registration_disputes (
  id uuid primary key default gen_random_uuid(), registration_id uuid not null references deal_registrations(id),
  challenger_partner_account_id uuid not null references accounts(id), owner_user_id uuid not null references commerce_users(id),
  reason text not null, evidence jsonb not null default '{}', status text not null check (status in ('open','under_review','upheld','overturned','dismissed')),
  tiebreak text, decided_by uuid references commerce_users(id), decided_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), row_version integer not null default 1,
  check ((status in ('open','under_review') and decided_at is null and decided_by is null) or (status not in ('open','under_review') and decided_at is not null and decided_by is not null and nullif(tiebreak, '') is not null))
);
create unique index core_deal_dispute_open_unique on core_deal_registration_disputes(registration_id) where status in ('open','under_review');
create index core_deal_dispute_queue_idx on core_deal_registration_disputes(status, created_at);

create table core_commission_statements (
  id uuid primary key default gen_random_uuid(), partner_account_id uuid not null references accounts(id),
  period_starts_on date not null, period_ends_on date not null, currency text not null,
  gross_accrued_minor bigint not null, clawback_minor bigint not null check (clawback_minor >= 0), holdback_minor bigint not null check (holdback_minor >= 0),
  payable_minor bigint not null, status text not null check (status in ('draft','issued','approved','exported','paid','void')),
  document_id uuid references documents(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), row_version integer not null default 1,
  unique(partner_account_id, period_starts_on, period_ends_on, currency), check (period_ends_on >= period_starts_on),
  check (payable_minor = gross_accrued_minor - clawback_minor - holdback_minor)
);
create index core_commission_statement_queue_idx on core_commission_statements(status);

create table core_commission_statement_lines (
  id uuid primary key default gen_random_uuid(), statement_id uuid not null references core_commission_statements(id),
  accrual_id uuid not null unique references commission_accruals(id), source_type text not null check (source_type in ('payment','credit_note','refund','dispute')),
  source_id uuid not null, net_collected_revenue_minor bigint not null, commission_minor bigint not null, holdback_minor bigint not null,
  created_at timestamptz not null default now()
);
create index core_commission_statement_line_idx on core_commission_statement_lines(statement_id);

create table core_commission_settlement_exports (
  id uuid primary key default gen_random_uuid(), statement_id uuid not null references core_commission_statements(id), export_key text not null unique,
  format text not null check (format in ('qbo_bill','csv')), status text not null check (status in ('pending','generated','delivered','failed')),
  document_id uuid references documents(id), provider_reference text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), row_version integer not null default 1
);
create index core_commission_settlement_queue_idx on core_commission_settlement_exports(status);

create table core_marketplace_events (
  id uuid primary key default gen_random_uuid(), provider text not null check (provider in ('aws','azure','google')),
  provider_event_id text not null, event_type text not null check (event_type in ('order','entitlement','metering','fee','invoice','settlement','refund')),
  provider_account_reference text not null, account_id uuid references accounts(id), order_id uuid references orders(id), entitlement_id uuid references entitlements(id),
  occurred_at timestamptz not null, currency text, gross_minor bigint, fee_minor bigint, tax_minor bigint, net_minor bigint, quantity numeric(38,18),
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'), normalized_payload jsonb not null,
  processing_status text not null default 'pending' check (processing_status in ('pending','processed','failed','ignored')),
  processed_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), row_version integer not null default 1,
  unique(provider, provider_event_id),
  check (quantity is null or quantity >= 0),
  check ((currency is null and gross_minor is null and fee_minor is null and tax_minor is null and net_minor is null)
    or (currency is not null and gross_minor is not null and fee_minor is not null and tax_minor is not null and net_minor = gross_minor - fee_minor - tax_minor)),
  check ((processing_status = 'processed') = (processed_at is not null))
);
create index core_marketplace_event_queue_idx on core_marketplace_events(provider, processing_status, occurred_at);

create table core_marketplace_financial_entries (
  id uuid primary key default gen_random_uuid(), marketplace_event_id uuid not null references core_marketplace_events(id),
  entry_type text not null check (entry_type in ('order','entitlement','metering','fee','invoice','settlement','refund','tax')),
  provider_line_reference text not null, currency text not null, amount_minor bigint not null,
  service_period_starts_on date, service_period_ends_on date, metadata jsonb not null default '{}', created_at timestamptz not null default now(),
  unique(marketplace_event_id, provider_line_reference, entry_type),
  check (service_period_ends_on is null or service_period_starts_on is null or service_period_ends_on >= service_period_starts_on)
);

create table core_marketplace_reconciliations (
  id uuid primary key default gen_random_uuid(), provider text not null check (provider in ('aws','azure','google')),
  period_starts_on date not null, period_ends_on date not null, currency text not null,
  provider_gross_minor bigint not null, platform_gross_minor bigint not null, provider_fees_minor bigint not null, platform_fees_minor bigint not null,
  variance_minor bigint not null, status text not null check (status in ('matched','variance','resolved')), resolution text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), row_version integer not null default 1,
  unique(provider, period_starts_on, period_ends_on, currency), check (period_ends_on >= period_starts_on),
  check (variance_minor = (provider_gross_minor - provider_fees_minor) - (platform_gross_minor - platform_fees_minor))
);
create index core_marketplace_reconciliation_queue_idx on core_marketplace_reconciliations(status);

create table core_accounting_exports (
  id uuid primary key default gen_random_uuid(),
  export_type text not null check (export_type in ('ar_issuance','payout_summary','deferred_revenue','commission_bill','tax_liability','cost_summary')),
  period_starts_on date not null, period_ends_on date not null, currency text not null, adapter text not null default 'qbo_neutral',
  idempotency_key text not null unique, status text not null check (status in ('pending','generated','delivered','failed','void')),
  total_debit_minor bigint not null check (total_debit_minor >= 0), total_credit_minor bigint not null check (total_credit_minor >= 0),
  provider_reference text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), row_version integer not null default 1,
  check (period_ends_on >= period_starts_on), check (total_debit_minor = total_credit_minor)
);
create index core_accounting_export_queue_idx on core_accounting_exports(status, created_at);

create table core_accounting_export_entries (
  id uuid primary key default gen_random_uuid(), export_id uuid not null references core_accounting_exports(id),
  source_type text not null, source_id uuid not null, account_code text not null, description text not null,
  debit_minor bigint not null default 0, credit_minor bigint not null default 0,
  service_period_starts_on date, service_period_ends_on date, dimensions jsonb not null default '{}', created_at timestamptz not null default now(),
  unique(export_id, source_type, source_id, account_code),
  check (debit_minor >= 0 and credit_minor >= 0 and ((debit_minor = 0) <> (credit_minor = 0))),
  check (service_period_ends_on is null or service_period_starts_on is null or service_period_ends_on >= service_period_starts_on)
);

create table core_three_way_tie_outs (
  id uuid primary key default gen_random_uuid(), period_starts_on date not null, period_ends_on date not null, currency text not null,
  platform_revenue_minor bigint not null, stripe_revenue_minor bigint not null, qbo_revenue_minor bigint not null,
  stripe_variance_minor bigint not null, qbo_variance_minor bigint not null,
  status text not null check (status in ('matched','variance','resolved')), variances jsonb not null default '[]',
  reviewed_by uuid references commerce_users(id), reviewed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), row_version integer not null default 1,
  unique(period_starts_on, period_ends_on, currency), check (period_ends_on >= period_starts_on),
  check (stripe_variance_minor = platform_revenue_minor - stripe_revenue_minor),
  check (qbo_variance_minor = platform_revenue_minor - qbo_revenue_minor)
);
create index core_three_way_tie_out_queue_idx on core_three_way_tie_outs(status);

-- Cross-object guards make companion records prove the same artifact chain as
-- their foundation parents. These run as deferred constraints so a transaction
-- may append the complete artifact atomically.
create or replace function core_validate_finance_chain() returns trigger
language plpgsql set search_path = public as $$
declare parent_order orders%rowtype;
declare parent_quote quotes%rowtype;
begin
  if tg_table_name = 'core_account_commercial_profiles' then
    if exists (
      select 1 from accounts a where a.id = new.account_id and 'partner' = any(a.relationship_roles)
        and a.aggregate_credit_limit_minor <> new.approved_credit_limit_minor
    ) then raise exception using errcode = '23514', message = 'partner credit limit must match the account aggregate limit'; end if;
  elsif tg_table_name = 'core_account_relationship_roles' then
    if not exists (select 1 from accounts a where a.id = new.account_id and new.role = any(a.relationship_roles)) then
      raise exception using errcode = '23514', message = 'normalized relationship role must match the account role set';
    end if;
  elsif tg_table_name = 'core_quote_commercial_profiles' then
    select * into parent_quote from quotes where id = new.quote_id;
    if not found or new.billing_account_id not in (parent_quote.account_id, coalesce(parent_quote.partner_account_id, parent_quote.account_id)) then
      raise exception using errcode = '23514', message = 'quote commercial billing party is outside the quote chain';
    end if;
    if (new.channel_shape = 'direct' and (parent_quote.partner_account_id is not null or new.merchant_of_record <> 'fil_one' or new.pricing_authority <> 'fil_one'))
      or (new.channel_shape = 'referral' and (parent_quote.partner_account_id is null or new.merchant_of_record <> 'fil_one' or new.billing_account_id <> parent_quote.account_id))
      or (new.channel_shape in ('resale','distributor') and (parent_quote.partner_account_id is null or parent_quote.end_client_account_id is null or new.merchant_of_record <> 'partner' or new.pricing_authority <> 'partner' or new.billing_account_id <> parent_quote.partner_account_id))
      or (new.channel_shape = 'marketplace' and new.merchant_of_record <> 'marketplace')
    then raise exception using errcode = '23514', message = 'quote channel, pricing authority, and merchant of record are inconsistent'; end if;
  elsif tg_table_name = 'core_quote_snapshots' then
    if not exists (select 1 from quotes q where q.id = new.quote_id and q.revision = new.revision and q.status <> 'draft') then
      raise exception using errcode = '23514', message = 'quote snapshot must pin an issued quote revision';
    end if;
  elsif tg_table_name = 'core_order_commercial_profiles' then
    select * into parent_order from orders where id = new.order_id;
    if not found or not exists (select 1 from agreements a where a.id = parent_order.agreement_id and a.version = new.governing_agreement_version) then
      raise exception using errcode = '23514', message = 'order must pin the governing agreement version';
    end if;
    if (new.billing_shape in ('direct','referral') and new.merchant_of_record <> 'fil_one')
      or (new.billing_shape in ('resale','distributor') and new.merchant_of_record <> 'partner')
      or (new.billing_shape = 'marketplace' and new.merchant_of_record <> 'marketplace')
      or (new.billing_shape = 'direct' and parent_order.sourcing <> 'direct')
      or (new.billing_shape = 'referral' and parent_order.sourcing <> 'referral')
      or (new.billing_shape in ('resale','distributor') and parent_order.sourcing <> 'resale')
    then raise exception using errcode = '23514', message = 'order billing shape and merchant of record are inconsistent'; end if;
    if new.co_term_parent_order_id is not null and not exists (
      select 1 from orders parent where parent.id = new.co_term_parent_order_id
        and (parent.invoicing_account_id = parent_order.invoicing_account_id or parent.partner_account_id = parent_order.partner_account_id)
    ) then raise exception using errcode = '23514', message = 'co-termination parent must share the invoicing chain'; end if;
    if new.deal_registration_id is not null and not exists (
      select 1 from deal_registrations r where r.id = new.deal_registration_id
        and r.partner_account_id = parent_order.partner_account_id and r.end_client_account_id = parent_order.account_id
        and r.status in ('approved','converted')
    ) then raise exception using errcode = '23514', message = 'order deal registration must match its partner and end client'; end if;
  elsif tg_table_name = 'core_order_line_snapshots' then
    if not exists (select 1 from order_lines ol join orders o on o.id = ol.order_id where ol.id = new.order_line_id and o.status <> 'submitted') then
      raise exception using errcode = '23514', message = 'order line snapshot requires an accepted order';
    end if;
  elsif tg_table_name = 'core_amendment_line_supersessions' then
    if not exists (
      select 1 from amendments a join order_lines ol on ol.id = new.superseded_order_line_id
      where a.id = new.amendment_id and a.order_id = ol.order_id and new.effective_on = a.effective_on
    ) then raise exception using errcode = '23514', message = 'supersession must target a line on the amended order at its effective date'; end if;
  elsif tg_table_name = 'core_commitment_periods' then
    if exists (
      select 1 from core_commitment_periods period where period.ledger_id = new.ledger_id and period.id <> new.id
      and tstzrange(period.starts_at, period.ends_at, '[)') && tstzrange(new.starts_at, new.ends_at, '[)')
    ) then raise exception using errcode = '23P01', message = 'commitment periods cannot overlap'; end if;
  elsif tg_table_name = 'core_commitment_ledger_corrections' then
    if new.period_id is not null and not exists (select 1 from core_commitment_periods p where p.id = new.period_id and p.ledger_id = new.ledger_id) then
      raise exception using errcode = '23514', message = 'ledger correction period must belong to its ledger';
    end if;
    if new.reverses_entry_id is not null and not exists (select 1 from commitment_entries e where e.id = new.reverses_entry_id and e.ledger_id = new.ledger_id) then
      raise exception using errcode = '23514', message = 'ledger correction entry must belong to its ledger';
    end if;
  elsif tg_table_name = 'core_invoice_end_client_allocations' then
    if not exists (
      select 1 from invoices i join orders o on o.id = new.order_id
      where i.id = new.invoice_id and i.account_id = o.invoicing_account_id and o.account_id = new.end_client_account_id and i.currency = new.currency
    ) then raise exception using errcode = '23514', message = 'invoice allocation must preserve invoice, order, and end-client chain'; end if;
  elsif tg_table_name = 'core_deal_registration_attributions' then
    if not exists (select 1 from deal_registrations r where r.id = new.registration_id and r.status in ('approved','converted')) then
      raise exception using errcode = '23514', message = 'attribution requires an approved registration';
    end if;
  elsif tg_table_name = 'core_partner_hierarchy_edges' then
    if not exists (
      select 1 from accounts distributor join accounts reseller on reseller.id = new.reseller_account_id
      where distributor.id = new.distributor_account_id and 'partner' = any(distributor.relationship_roles)
        and 'partner' = any(reseller.relationship_roles) and reseller.parent_partner_id = distributor.id
    ) then raise exception using errcode = '23514', message = 'partner hierarchy must match the account distributor parent'; end if;
    if new.status = 'active' and exists (
      select 1 from core_partner_hierarchy_edges reverse_edge where reverse_edge.status = 'active'
        and reverse_edge.distributor_account_id = new.reseller_account_id and reverse_edge.reseller_account_id = new.distributor_account_id
        and reverse_edge.id <> new.id
    ) then raise exception using errcode = '23514', message = 'partner hierarchy cannot contain a cycle'; end if;
  elsif tg_table_name = 'core_commission_statement_lines' then
    if not exists (
      select 1 from core_commission_statements s join commission_accruals a on a.id = new.accrual_id
      where s.id = new.statement_id and s.partner_account_id = a.partner_account_id and s.currency = a.currency
    ) then raise exception using errcode = '23514', message = 'commission statement line must match its partner and currency'; end if;
  elsif tg_table_name = 'core_marketplace_events' then
    if new.order_id is not null and new.account_id is not null and not exists (
      select 1 from orders o where o.id = new.order_id and (o.account_id = new.account_id or o.invoicing_account_id = new.account_id)
    ) then raise exception using errcode = '23514', message = 'marketplace event order must belong to its account'; end if;
    if new.entitlement_id is not null and not exists (
      select 1 from entitlements e where e.id = new.entitlement_id and (new.order_id is null or e.order_id = new.order_id)
    ) then raise exception using errcode = '23514', message = 'marketplace entitlement must belong to its order'; end if;
  end if;
  return new;
end $$;

create or replace function core_validate_financial_rollup() returns trigger
language plpgsql set search_path = public as $$
declare export_record core_accounting_exports%rowtype;
declare statement_record core_commission_statements%rowtype;
declare invoice_record invoices%rowtype;
declare summed_debits bigint;
declare summed_credits bigint;
declare summed_total bigint;
declare summed_gross bigint;
declare summed_holdback bigint;
begin
  if tg_table_name = 'core_accounting_exports' then
    export_record := new;
  elsif tg_table_name = 'core_accounting_export_entries' then
    select * into export_record from core_accounting_exports where id = new.export_id;
  elsif tg_table_name = 'core_invoice_end_client_allocations' then
    select * into invoice_record from invoices where id = new.invoice_id;
    select coalesce(sum(a.total_minor), 0) into summed_total
      from core_invoice_end_client_allocations a where a.invoice_id = new.invoice_id;
    if summed_total <> invoice_record.amount_minor then
      raise exception using errcode = '23514', message = 'invoice end-client allocations must tie to the invoice total';
    end if;
    return new;
  elsif tg_table_name = 'core_commission_statements' then
    statement_record := new;
  elsif tg_table_name = 'core_commission_statement_lines' then
    select * into statement_record from core_commission_statements where id = new.statement_id;
  end if;

  if export_record.id is not null and export_record.status in ('generated','delivered') then
    select coalesce(sum(e.debit_minor), 0), coalesce(sum(e.credit_minor), 0)
      into summed_debits, summed_credits from core_accounting_export_entries e where e.export_id = export_record.id;
    if summed_debits <> export_record.total_debit_minor or summed_credits <> export_record.total_credit_minor then
      raise exception using errcode = '23514', message = 'accounting export entries must tie to header totals';
    end if;
  end if;

  if statement_record.id is not null and statement_record.status in ('issued','approved','exported','paid') then
    select coalesce(sum(l.commission_minor), 0), coalesce(sum(l.holdback_minor), 0)
      into summed_gross, summed_holdback from core_commission_statement_lines l where l.statement_id = statement_record.id;
    if summed_gross <> statement_record.gross_accrued_minor or summed_holdback <> statement_record.holdback_minor then
      raise exception using errcode = '23514', message = 'commission statement lines must tie to header totals';
    end if;
  end if;
  return new;
end $$;

create constraint trigger core_accounting_exports_rollup
after insert or update on core_accounting_exports deferrable initially deferred
for each row execute function core_validate_financial_rollup();
create constraint trigger core_accounting_export_entries_rollup
after insert or update on core_accounting_export_entries deferrable initially deferred
for each row execute function core_validate_financial_rollup();
create constraint trigger core_invoice_allocations_rollup
after insert or update on core_invoice_end_client_allocations deferrable initially deferred
for each row execute function core_validate_financial_rollup();
create constraint trigger core_commission_statements_rollup
after insert or update on core_commission_statements deferrable initially deferred
for each row execute function core_validate_financial_rollup();
create constraint trigger core_commission_statement_lines_rollup
after insert or update on core_commission_statement_lines deferrable initially deferred
for each row execute function core_validate_financial_rollup();

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'core_account_commercial_profiles','core_account_relationship_roles','core_quote_commercial_profiles','core_quote_snapshots',
    'core_order_commercial_profiles','core_order_line_snapshots',
    'core_amendment_line_supersessions','core_commitment_periods','core_commitment_ledger_corrections',
    'core_invoice_end_client_allocations','core_partner_hierarchy_edges','core_deal_registration_attributions',
    'core_commission_statement_lines','core_marketplace_events'
  ] loop
    execute format(
      'create constraint trigger %I after insert or update on %I deferrable initially immediate for each row execute function core_validate_finance_chain()',
      table_name || '_chain', table_name
    );
  end loop;
end $$;

-- Append-only evidence and financial facts are corrected with new rows.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'core_price_book_activation_events','core_partner_transfer_tiers',
    'core_quote_commercial_profiles','core_quote_snapshots','core_order_commercial_profiles','core_order_line_snapshots',
    'core_amendment_financial_terms','core_amendment_line_supersessions','core_commitment_ledger_corrections',
    'core_invoice_end_client_allocations','core_collection_actions','core_deal_registration_attributions',
    'core_commission_statement_lines','core_marketplace_financial_entries','core_accounting_export_entries'
  ] loop
    execute format('create trigger %I before update or delete on %I for each row execute function deny_immutable_mutation()', table_name || '_immutable', table_name);
  end loop;
end $$;

-- Mutable operational records use the foundation optimistic-version trigger.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'core_account_commercial_profiles','core_account_relationship_roles','core_account_contacts','core_account_tax_identifiers','core_procurement_certificates',
    'core_pricing_exception_decisions','core_commitment_periods','core_usage_reconciliations','core_billing_policies',
    'core_collection_cases','core_partner_hierarchy_edges','core_deal_registration_exclusions','core_deal_registration_disputes',
    'core_commission_statements','core_commission_settlement_exports','core_marketplace_events','core_marketplace_reconciliations',
    'core_accounting_exports','core_three_way_tie_outs'
  ] loop
    execute format('create trigger %I before update on %I for each row execute function touch_versioned_row()', table_name || '_version', table_name);
  end loop;
end $$;

-- RLS helpers preserve resale isolation: an end client cannot see the partner's
-- commercial artifact merely because it receives the provisioned service.
create or replace function core_can_access_order(candidate uuid) returns boolean
language sql stable set search_path = public as $$
  select exists (
    select 1 from orders o where o.id = candidate and (
      app_is_internal() or app_has_account(o.invoicing_account_id) or app_has_account(o.partner_account_id)
      or (o.sourcing <> 'resale' and app_has_account(o.account_id))
    )
  )
$$;

create or replace function core_can_access_quote(candidate uuid) returns boolean
language sql stable set search_path = public as $$
  select exists (
    select 1 from quotes q where q.id = candidate and (app_is_internal() or app_has_account(q.account_id) or app_has_account(q.partner_account_id))
  )
$$;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'core_account_commercial_profiles','core_account_relationship_roles','core_account_contacts','core_account_tax_identifiers',
    'core_procurement_certificates','core_price_book_activation_events','core_partner_transfer_tiers','core_quote_commercial_profiles',
    'core_quote_snapshots','core_pricing_exception_decisions','core_order_commercial_profiles','core_order_line_snapshots',
    'core_amendment_financial_terms','core_amendment_line_supersessions','core_commitment_periods','core_commitment_ledger_corrections',
    'core_usage_reconciliations','core_billing_policies','core_invoice_end_client_allocations','core_collection_cases','core_collection_actions',
    'core_partner_hierarchy_edges','core_deal_registration_attributions','core_deal_registration_exclusions','core_deal_registration_disputes',
    'core_commission_statements','core_commission_statement_lines','core_commission_settlement_exports','core_marketplace_events',
    'core_marketplace_financial_entries','core_marketplace_reconciliations','core_accounting_exports','core_accounting_export_entries','core_three_way_tie_outs'
  ] loop
    execute format('alter table %I enable row level security', table_name);
    execute format('alter table %I force row level security', table_name);
  end loop;
end $$;

create policy core_account_commercial_read on core_account_commercial_profiles for select using (app_has_account(account_id));
create policy core_account_commercial_write on core_account_commercial_profiles for all using (app_is_internal()) with check (app_is_internal());
create policy core_account_roles_read on core_account_relationship_roles for select using (app_has_account(account_id));
create policy core_account_roles_write on core_account_relationship_roles for all using (app_is_internal()) with check (app_is_internal());
create policy core_account_contacts_scope on core_account_contacts for all using (app_has_account(account_id)) with check (app_has_account(account_id));
create policy core_tax_identifiers_read on core_account_tax_identifiers for select using (app_has_account(account_id));
create policy core_tax_identifiers_write on core_account_tax_identifiers for all using (app_is_internal()) with check (app_is_internal());
create policy core_procurement_certificates_read on core_procurement_certificates for select using (app_has_account(account_id));
create policy core_procurement_certificates_write on core_procurement_certificates for all using (app_is_internal()) with check (app_is_internal());
create policy core_price_activation_read on core_price_book_activation_events for select using (app_is_internal() or exists (select 1 from price_books p where p.id = price_book_id and p.status = 'active'));
create policy core_price_activation_write on core_price_book_activation_events for all using (app_is_internal()) with check (app_is_internal());
create policy core_transfer_tiers_read on core_partner_transfer_tiers for select using (app_is_internal() or exists (select 1 from rate_cards r join price_books p on p.id = r.price_book_id where r.id = rate_card_id and p.status = 'active'));
create policy core_transfer_tiers_write on core_partner_transfer_tiers for all using (app_is_internal()) with check (app_is_internal());
create policy core_quote_commercial_scope on core_quote_commercial_profiles for all using (core_can_access_quote(quote_id)) with check (core_can_access_quote(quote_id));
create policy core_quote_snapshot_scope on core_quote_snapshots for all using (core_can_access_quote(quote_id)) with check (core_can_access_quote(quote_id));
create policy core_pricing_exception_scope on core_pricing_exception_decisions for select using (app_is_internal() or core_can_access_quote(quote_id));
create policy core_pricing_exception_write on core_pricing_exception_decisions for all using (app_is_internal()) with check (app_is_internal());
create policy core_order_commercial_scope on core_order_commercial_profiles for all using (core_can_access_order(order_id)) with check (core_can_access_order(order_id));
create policy core_order_line_snapshot_scope on core_order_line_snapshots for all using (exists (select 1 from order_lines ol where ol.id = order_line_id and core_can_access_order(ol.order_id))) with check (exists (select 1 from order_lines ol where ol.id = order_line_id and core_can_access_order(ol.order_id)));
create policy core_amendment_financial_scope on core_amendment_financial_terms for all using (exists (select 1 from amendments a where a.id = amendment_id and core_can_access_order(a.order_id))) with check (exists (select 1 from amendments a where a.id = amendment_id and core_can_access_order(a.order_id)));
create policy core_amendment_supersession_scope on core_amendment_line_supersessions for all using (exists (select 1 from amendments a where a.id = amendment_id and core_can_access_order(a.order_id))) with check (exists (select 1 from amendments a where a.id = amendment_id and core_can_access_order(a.order_id)));
create policy core_commitment_period_read on core_commitment_periods for select using (exists (select 1 from commitment_ledgers l where l.id = ledger_id and core_can_access_order(l.order_id)));
create policy core_commitment_period_write on core_commitment_periods for all using (app_is_internal()) with check (app_is_internal());
create policy core_commitment_correction_read on core_commitment_ledger_corrections for select using (exists (select 1 from commitment_ledgers l where l.id = ledger_id and core_can_access_order(l.order_id)));
create policy core_commitment_correction_write on core_commitment_ledger_corrections for all using (app_is_internal()) with check (app_is_internal());
create policy core_usage_reconciliation_read on core_usage_reconciliations for select using (exists (select 1 from entitlements e where e.id = entitlement_id and core_can_access_order(e.order_id)));
create policy core_usage_reconciliation_write on core_usage_reconciliations for all using (app_is_internal()) with check (app_is_internal());
create policy core_billing_policy_read on core_billing_policies for select using (app_has_account(account_id));
create policy core_billing_policy_write on core_billing_policies for all using (app_is_internal()) with check (app_is_internal());
create policy core_invoice_allocation_read on core_invoice_end_client_allocations for select using (exists (select 1 from invoices i where i.id = invoice_id and app_has_account(i.account_id)));
create policy core_invoice_allocation_write on core_invoice_end_client_allocations for all using (app_is_internal()) with check (app_is_internal());
create policy core_collection_case_scope on core_collection_cases for select using (app_is_internal() or app_has_account(account_id));
create policy core_collection_case_write on core_collection_cases for all using (app_is_internal()) with check (app_is_internal());
create policy core_collection_action_scope on core_collection_actions for select using (app_is_internal() or exists (select 1 from core_collection_cases c where c.id = collection_case_id and app_has_account(c.account_id)));
create policy core_collection_action_write on core_collection_actions for all using (app_is_internal()) with check (app_is_internal());
create policy core_partner_hierarchy_scope on core_partner_hierarchy_edges for select using (app_is_internal() or app_has_account(distributor_account_id) or app_has_account(reseller_account_id));
create policy core_partner_hierarchy_write on core_partner_hierarchy_edges for all using (app_is_internal()) with check (app_is_internal());
create policy core_registration_attribution_scope on core_deal_registration_attributions for select using (app_is_internal() or exists (select 1 from deal_registrations r where r.id = registration_id and app_has_account(r.partner_account_id)));
create policy core_registration_attribution_write on core_deal_registration_attributions for all using (app_is_internal()) with check (app_is_internal());
create policy core_registration_exclusion_scope on core_deal_registration_exclusions for select using (app_is_internal() or exists (select 1 from deal_registrations r where r.id = registration_id and app_has_account(r.partner_account_id)));
create policy core_registration_exclusion_write on core_deal_registration_exclusions for all using (app_is_internal()) with check (app_is_internal());
create policy core_registration_dispute_scope on core_deal_registration_disputes for select using (app_is_internal() or app_has_account(challenger_partner_account_id) or exists (select 1 from deal_registrations r where r.id = registration_id and app_has_account(r.partner_account_id)));
create policy core_registration_dispute_write on core_deal_registration_disputes for all using (app_is_internal()) with check (app_is_internal());
create policy core_commission_statement_scope on core_commission_statements for select using (app_is_internal() or app_has_account(partner_account_id));
create policy core_commission_statement_write on core_commission_statements for all using (app_is_internal()) with check (app_is_internal());
create policy core_commission_line_scope on core_commission_statement_lines for select using (app_is_internal() or exists (select 1 from core_commission_statements s where s.id = statement_id and app_has_account(s.partner_account_id)));
create policy core_commission_line_write on core_commission_statement_lines for all using (app_is_internal()) with check (app_is_internal());
create policy core_commission_export_scope on core_commission_settlement_exports for select using (app_is_internal() or exists (select 1 from core_commission_statements s where s.id = statement_id and app_has_account(s.partner_account_id)));
create policy core_commission_export_write on core_commission_settlement_exports for all using (app_is_internal()) with check (app_is_internal());
create policy core_marketplace_events_internal on core_marketplace_events for all using (app_is_internal()) with check (app_is_internal());
create policy core_marketplace_entries_internal on core_marketplace_financial_entries for all using (app_is_internal()) with check (app_is_internal());
create policy core_marketplace_reconciliation_internal on core_marketplace_reconciliations for all using (app_is_internal()) with check (app_is_internal());
create policy core_accounting_exports_internal on core_accounting_exports for all using (app_is_internal()) with check (app_is_internal());
create policy core_accounting_entries_internal on core_accounting_export_entries for all using (app_is_internal()) with check (app_is_internal());
create policy core_tie_outs_internal on core_three_way_tie_outs for all using (app_is_internal()) with check (app_is_internal());

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'core_account_commercial_profiles','core_account_relationship_roles','core_account_contacts','core_account_tax_identifiers',
    'core_procurement_certificates','core_price_book_activation_events','core_partner_transfer_tiers','core_quote_commercial_profiles',
    'core_quote_snapshots','core_pricing_exception_decisions','core_order_commercial_profiles','core_order_line_snapshots',
    'core_amendment_financial_terms','core_amendment_line_supersessions','core_commitment_periods','core_commitment_ledger_corrections',
    'core_usage_reconciliations','core_billing_policies','core_invoice_end_client_allocations','core_collection_cases','core_collection_actions',
    'core_partner_hierarchy_edges','core_deal_registration_attributions','core_deal_registration_exclusions','core_deal_registration_disputes',
    'core_commission_statements','core_commission_statement_lines','core_commission_settlement_exports','core_marketplace_events',
    'core_marketplace_financial_entries','core_marketplace_reconciliations','core_accounting_exports','core_accounting_export_entries','core_three_way_tie_outs'
  ] loop
    execute format('grant select, insert, update, delete on %I to clockwork_runtime, clockwork_service', table_name);
  end loop;
end $$;
grant usage, select on all sequences in schema public to clockwork_runtime, clockwork_service;
revoke insert, update, delete on core_account_commercial_profiles, core_account_relationship_roles,
  core_account_tax_identifiers, core_procurement_certificates,
  core_price_book_activation_events, core_partner_transfer_tiers,
  core_pricing_exception_decisions, core_collection_cases, core_collection_actions, core_partner_hierarchy_edges,
  core_deal_registration_attributions, core_deal_registration_exclusions, core_deal_registration_disputes,
  core_commission_statements, core_commission_statement_lines, core_commission_settlement_exports,
  core_commitment_periods, core_commitment_ledger_corrections, core_usage_reconciliations,
  core_billing_policies, core_invoice_end_client_allocations,
  core_marketplace_events, core_marketplace_financial_entries, core_marketplace_reconciliations,
  core_accounting_exports, core_accounting_export_entries, core_three_way_tie_outs from clockwork_runtime;

-- §17 reports are security-invoker views and are granted only to the internal
-- service role. Amounts are minor units and retain their ISO currency.
create view core_revenue_forecast with (security_invoker = true) as
with booked as (
  select
    o.id as order_id, q.id as quote_id, o.account_id, o.partner_account_id, q.currency,
    coalesce(cp.merchant_of_record, case when o.sourcing = 'resale' then 'partner' else 'fil_one' end) as merchant_of_record,
    o.sourcing as channel, month::date as forecast_month, 'committed_backlog'::text as forecast_stage,
    round(q.total_minor::numeric / greatest(1, coalesce((select max(ql.term_months) from quote_lines ql where ql.quote_id = q.id), 1)))::bigint
      + coalesce((select sum(aft.monthly_delta_minor) from amendments a join core_amendment_financial_terms aft on aft.amendment_id = a.id
        where a.order_id = o.id and date_trunc('month', a.effective_on)::date <= month::date), 0) as forecast_revenue_minor,
    o.service_starts_on, o.service_ends_on, o.notice_on
  from orders o
  join quotes q on q.id = o.quote_id
  left join core_order_commercial_profiles cp on cp.order_id = o.id
  cross join lateral generate_series(
    date_trunc('month', o.service_starts_on)::date,
    date_trunc('month', coalesce(o.service_ends_on, o.service_starts_on))::date,
    interval '1 month'
  ) month
  where o.status in ('accepted','provisioning','active','amended')
), pipeline as (
  select
    null::uuid as order_id, q.id as quote_id, q.account_id, q.partner_account_id, q.currency,
    coalesce(qcp.merchant_of_record, 'fil_one') as merchant_of_record,
    coalesce(qcp.channel_shape, case when q.partner_account_id is null then 'direct' else 'referral' end) as channel,
    date_trunc('month', q.created_at)::date as forecast_month, 'pipeline'::text as forecast_stage,
    q.total_minor as forecast_revenue_minor, null::date as service_starts_on, null::date as service_ends_on, null::date as notice_on
  from quotes q left join core_quote_commercial_profiles qcp on qcp.quote_id = q.id
  where q.status = 'issued' and not exists (select 1 from orders o where o.quote_id = q.id)
), forecast as (
  select * from booked union all select * from pipeline
)
select forecast.*,
  forecast_revenue_minor as mrr_minor,
  forecast_revenue_minor * 12 as arr_minor,
  case when merchant_of_record = 'partner' then 'transfer_price' else 'gross' end as revenue_basis,
  jsonb_build_object('orderId', order_id, 'quoteId', quote_id) as source_record_ids
from forecast;

create view core_capacity_planning with (security_invoker = true) as
with usage_by_month as (
  select entitlement_id, date_trunc('month', measured_at)::date as capacity_month, sum(quantity) as actual_quantity
  from usage_events group by entitlement_id, date_trunc('month', measured_at)::date
)
select
  coalesce(u.capacity_month, date_trunc('month', coalesce(e.activated_at, e.created_at))::date) as capacity_month,
  e.region, e.sku, sum(e.committed_quantity) as committed_quantity,
  sum(case when e.status = 'active' then e.committed_quantity else 0 end) as provisioned_quantity,
  sum(coalesce(u.actual_quantity, 0)) as actual_quantity,
  count(distinct e.organization_id) as organization_count,
  count(distinct e.order_id) as order_count,
  jsonb_build_object(
    'entitlementIds', array_agg(distinct e.id order by e.id),
    'orderIds', array_remove(array_agg(distinct e.order_id order by e.order_id), null),
    'organizationIds', array_agg(distinct e.organization_id order by e.organization_id)
  ) as source_record_ids
from entitlements e left join usage_by_month u on u.entitlement_id = e.id
group by coalesce(u.capacity_month, date_trunc('month', coalesce(e.activated_at, e.created_at))::date), e.region, e.sku;

create view core_renewal_churn_exposure with (security_invoker = true) as
select
  o.id as order_id, o.account_id, o.partner_account_id, o.sourcing as segment, q.currency,
  q.total_minor as revenue_at_risk_minor, o.service_ends_on, o.notice_on,
  case
    when o.service_ends_on is null then 'no_term'
    when o.service_ends_on < current_date then 'past_due'
    when o.service_ends_on <= current_date + 30 then '0_30'
    when o.service_ends_on <= current_date + 90 then '31_90'
    when o.service_ends_on <= current_date + 180 then '91_180'
    else '180_plus'
  end as exposure_window,
  exists (select 1 from inbound_notices n where n.order_id = o.id and n.type in ('non_renewal','termination')) as has_nonrenewal_notice,
  (select count(*) from invoices i where i.order_id = o.id and i.status = 'open' and i.due_at < now()) as overdue_invoice_count,
  (select max(u.measured_at) from entitlements e join usage_events u on u.entitlement_id = e.id where e.order_id = o.id) as last_usage_at,
  (select max(a.occurred_at) from audit_events a where a.aggregate_type = 'order' and a.aggregate_id = o.id) as last_touch_at
from orders o join quotes q on q.id = o.quote_id
where o.status in ('accepted','provisioning','active','amended') and o.service_ends_on is not null;

create view core_partner_performance with (security_invoker = true) as
with bookings as (
  select
    o.partner_account_id, count(distinct o.id) as bookings, count(distinct o.account_id) as end_client_count,
    sum(q.total_minor) as booked_revenue_minor, min(q.currency) as currency,
    count(*) filter (where o.status in ('active','amended','completed')) as active_or_completed_orders,
    count(*) filter (where o.status = 'completed') as completed_orders,
    sum(coalesce((select sum(c.amount_minor) from cost_records c join entitlements e on e.id = c.entitlement_id where e.order_id = o.id), 0)) as realized_cost_minor
  from orders o join quotes q on q.id = o.quote_id where o.partner_account_id is not null group by o.partner_account_id, q.currency
), registrations as (
  select partner_account_id, count(*) as registrations,
    count(*) filter (where status = 'converted') as converted_registrations
  from deal_registrations group by partner_account_id
)
select
  a.id as partner_account_id, a.legal_name, a.partner_agreement_type,
  coalesce(b.bookings, 0) as bookings, coalesce(b.end_client_count, 0) as end_client_count,
  coalesce(r.registrations, 0) as registrations, coalesce(r.converted_registrations, 0) as converted_registrations,
  case when coalesce(r.registrations, 0) = 0 then 0 else round(10000.0 * r.converted_registrations / r.registrations)::integer end as registration_to_close_bps,
  case when coalesce(b.active_or_completed_orders, 0) = 0 then 0 else round(10000.0 * b.completed_orders / b.active_or_completed_orders)::integer end as renewal_completion_bps,
  b.currency, coalesce(b.booked_revenue_minor, 0) as booked_revenue_minor,
  coalesce(b.realized_cost_minor, 0) as realized_cost_minor,
  coalesce(b.booked_revenue_minor, 0) - coalesce(b.realized_cost_minor, 0) as margin_minor,
  case when b.realized_cost_minor is null or b.realized_cost_minor = 0 then 'modeled' else 'realized' end as margin_basis
from accounts a left join bookings b on b.partner_account_id = a.id left join registrations r on r.partner_account_id = a.id
where 'partner' = any(a.relationship_roles);

create view core_funnel_cycle_time with (security_invoker = true) as
select
  q.id as quote_id, q.account_id, q.partner_account_id, q.created_at as quote_created_at,
  o.id as order_id, o.created_at as order_created_at,
  provisioned.provisioned_at, i.id as invoice_id, i.created_at as invoice_created_at,
  paid.received_at as cash_received_at,
  extract(epoch from (o.created_at - q.created_at))::bigint as quote_to_order_seconds,
  extract(epoch from (provisioned.provisioned_at - o.created_at))::bigint as order_to_provisioned_seconds,
  extract(epoch from (i.created_at - provisioned.provisioned_at))::bigint as provisioned_to_invoice_seconds,
  extract(epoch from (paid.received_at - i.created_at))::bigint as invoice_to_cash_seconds
from quotes q
left join orders o on o.quote_id = q.id
left join lateral (select min(e.activated_at) as provisioned_at from entitlements e where e.order_id = o.id) provisioned on true
left join lateral (select i0.* from invoices i0 where i0.order_id = o.id order by i0.created_at limit 1) i on true
left join lateral (select min(p.received_at) as received_at from payments p where p.invoice_id = i.id and p.status = 'succeeded') paid on true;

create view core_margin_poc_cost with (security_invoker = true) as
select
  'order'::text as record_type, o.id as record_id, o.account_id, o.partner_account_id, q.currency,
  coalesce((select sum(i.amount_minor) from invoices i where i.order_id = o.id and i.status in ('open','paid')), q.total_minor) as revenue_minor,
  coalesce((select sum(c.amount_minor) from cost_records c join entitlements e on e.id = c.entitlement_id where e.order_id = o.id), 0) as cost_minor,
  coalesce((select sum(i.amount_minor) from invoices i where i.order_id = o.id and i.status in ('open','paid')), q.total_minor)
    - coalesce((select sum(c.amount_minor) from cost_records c join entitlements e on e.id = c.entitlement_id where e.order_id = o.id), 0) as margin_minor,
  case when exists (select 1 from cost_records c join entitlements e on e.id = c.entitlement_id where e.order_id = o.id) then 'realized' else 'modeled' end as margin_basis,
  exists (select 1 from core_pricing_exception_decisions pe where pe.quote_id = q.id and pe.status = 'approved') as floor_exception,
  null::integer as engineering_minutes
from orders o join quotes q on q.id = o.quote_id
union all
select
  'poc'::text, p.id, p.account_id, p.partner_account_id, p.currency, 0::bigint, p.cost_minor, -p.cost_minor,
  'realized'::text, false, p.engineering_minutes
from pocs p;

create view core_three_way_tie_out with (security_invoker = true) as
select
  id, period_starts_on, period_ends_on, currency,
  platform_revenue_minor, stripe_revenue_minor, qbo_revenue_minor,
  stripe_variance_minor, qbo_variance_minor,
  (stripe_variance_minor = 0 and qbo_variance_minor = 0) as mathematically_tied,
  status, variances, reviewed_by, reviewed_at, created_at, updated_at, row_version
from core_three_way_tie_outs;

create view core_weekly_scorecard with (security_invoker = true) as
with currencies as (select distinct currency from price_books)
select
  date_trunc('week', now())::date as week_start, currencies.currency,
  (select count(*) from quotes where created_at >= date_trunc('week', now()) and currency = currencies.currency) as quotes_created,
  (select count(*) from orders o join quotes q on q.id = o.quote_id where o.created_at >= date_trunc('week', now()) and q.currency = currencies.currency) as orders_accepted,
  (select coalesce(sum(forecast_revenue_minor), 0) from core_revenue_forecast where forecast_month = date_trunc('month', now())::date and forecast_stage = 'committed_backlog' and currency = currencies.currency) as current_month_forecast_minor,
  (select count(*) from core_renewal_churn_exposure where exposure_window in ('past_due','0_30','31_90')) as renewals_inside_90_days,
  (select count(*) from core_collection_cases where status in ('open','promised','escalated')) as open_collection_cases,
  (select count(*) from core_pricing_exception_decisions where status = 'pending') as open_pricing_exceptions,
  (select count(*) from pocs where status = 'active') as active_pocs,
  (select coalesce(sum(cost_minor), 0) from core_margin_poc_cost where record_type = 'poc' and currency = currencies.currency) as cumulative_poc_cost_minor,
  jsonb_build_object(
    'quoteIds', (select coalesce(jsonb_agg(q.id order by q.id), '[]'::jsonb) from quotes q where q.created_at >= date_trunc('week', now()) and q.currency = currencies.currency),
    'orderIds', (select coalesce(jsonb_agg(o.id order by o.id), '[]'::jsonb) from orders o join quotes q on q.id = o.quote_id where o.created_at >= date_trunc('week', now()) and q.currency = currencies.currency),
    'renewalOrderIds', (select coalesce(jsonb_agg(order_id order by order_id), '[]'::jsonb) from core_renewal_churn_exposure where exposure_window in ('past_due','0_30','31_90')),
    'collectionCaseIds', (select coalesce(jsonb_agg(id order by id), '[]'::jsonb) from core_collection_cases where status in ('open','promised','escalated')),
    'pricingExceptionIds', (select coalesce(jsonb_agg(id order by id), '[]'::jsonb) from core_pricing_exception_decisions where status = 'pending'),
    'pocIds', (select coalesce(jsonb_agg(id order by id), '[]'::jsonb) from pocs where status = 'active' and currency = currencies.currency)
  ) as source_record_ids
from currencies;

revoke all on core_revenue_forecast, core_capacity_planning, core_renewal_churn_exposure,
  core_partner_performance, core_funnel_cycle_time, core_margin_poc_cost,
  core_three_way_tie_out, core_weekly_scorecard from public, anon, authenticated, clockwork_runtime;
grant select on core_revenue_forecast, core_capacity_planning, core_renewal_churn_exposure,
  core_partner_performance, core_funnel_cycle_time, core_margin_poc_cost,
  core_three_way_tie_out, core_weekly_scorecard to clockwork_service;
