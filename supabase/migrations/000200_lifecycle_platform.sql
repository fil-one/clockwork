-- Lifecycle production persistence. All tenant tables are RLS protected and
-- evidence/event ledgers are append-only.

-- The foundation trigger used an ELSIF expression that referenced membership
-- fields while handling an organization row. Dynamic trigger records resolve
-- those fields before boolean short-circuiting, blocking every legitimate
-- organization metadata update (including the provider tenant binding).
create or replace function protect_identity_link() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_table_name = 'organizations' then
    if new.account_id is distinct from old.account_id then
      raise exception using errcode = '55000', message = 'organization account ownership is immutable';
    end if;
  elsif tg_table_name = 'memberships' then
    if new.organization_id is distinct from old.organization_id
      or new.user_id is distinct from old.user_id then
      raise exception using errcode = '55000', message = 'membership identity is immutable; replace the membership';
    end if;
  end if;
  return new;
end $$;

create table lifecycle_partner_domains (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id),
  domain text not null,
  verification_token_hash text not null check (verification_token_hash ~ '^[a-f0-9]{64}$'),
  verified_at timestamptz not null,
  brand_name text not null,
  logo_url text,
  primary_color text not null check (primary_color ~ '^#[0-9a-fA-F]{6}$'),
  communication_owner text not null check (communication_owner in ('fil_one','partner')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version integer not null default 1
);
create unique index lifecycle_partner_domain_unique on lifecycle_partner_domains(domain);
create index lifecycle_partner_domain_account_idx on lifecycle_partner_domains(account_id);

create table lifecycle_agreement_template_texts (
  template_id uuid primary key references agreement_templates(id),
  exact_text text not null,
  exact_text_hash text not null unique check (exact_text_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  constraint lifecycle_agreement_template_bytes_hash_check check (
    encode(extensions.digest(convert_to(exact_text, 'UTF8'), 'sha256'), 'hex') = exact_text_hash
  )
);

create table lifecycle_agreement_drafts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id),
  template_id uuid references agreement_templates(id),
  customer_paper_document_id uuid references documents(id),
  paper text not null check (paper in ('ours','theirs')),
  execution_mode text not null check (execution_mode in ('click_through','counter_signed')),
  negotiation_status text not null check (negotiation_status in ('standard','uploaded','redlining','counsel_review','agreed','rejected')),
  jurisdiction text not null,
  key_terms jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft','executed','void')),
  created_by uuid not null references commerce_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version integer not null default 1,
  constraint lifecycle_agreement_draft_source_check check (
    (paper = 'ours' and template_id is not null and customer_paper_document_id is null)
    or (paper = 'theirs' and template_id is null and customer_paper_document_id is not null)
  )
);
create index lifecycle_agreement_draft_account_idx on lifecycle_agreement_drafts(account_id, status);

create table lifecycle_click_acceptances (
  id uuid primary key default gen_random_uuid(),
  agreement_id uuid not null unique references agreements(id),
  account_id uuid not null references accounts(id),
  template_id uuid not null references agreement_templates(id),
  user_id uuid not null references commerce_users(id),
  exact_text_hash text not null check (exact_text_hash ~ '^[a-f0-9]{64}$'),
  evidence_hash text not null unique check (evidence_hash ~ '^[a-f0-9]{64}$'),
  evidence jsonb not null,
  accepted_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table lifecycle_signature_envelopes (
  id uuid primary key default gen_random_uuid(),
  agreement_draft_id uuid not null references lifecycle_agreement_drafts(id),
  account_id uuid not null references accounts(id),
  provider_envelope_id text not null unique,
  document_id uuid not null references documents(id),
  signer_email text not null,
  signing_mode text not null check (signing_mode in ('redirect','embedded')),
  return_url text not null,
  state text not null check (state in ('created','sent','viewed','completed','declined','expired','voided')),
  provider_sequence integer not null default 0 check (provider_sequence >= 0),
  provider_event_ids text[] not null default '{}',
  signed_pdf_document_id uuid references documents(id),
  completion_certificate_document_id uuid references documents(id),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version integer not null default 1,
  constraint lifecycle_envelope_completion_check check (
    state <> 'completed' or
    (signed_pdf_document_id is not null and completion_certificate_document_id is not null and completed_at is not null)
  )
);
create index lifecycle_envelope_draft_idx on lifecycle_signature_envelopes(agreement_draft_id);

create table lifecycle_pass_through_acceptances (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id),
  organization_id uuid not null references organizations(id),
  template_id uuid not null references agreement_templates(id),
  template_version text not null,
  exact_text_hash text not null check (exact_text_hash ~ '^[a-f0-9]{64}$'),
  user_id uuid not null references commerce_users(id),
  accepted_at timestamptz not null,
  accepted_ip text not null,
  ui_context text not null,
  evidence_hash text not null unique check (evidence_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now()
);
create unique index lifecycle_pass_through_version_unique
  on lifecycle_pass_through_acceptances(organization_id, template_id, template_version, user_id);

create table lifecycle_poc_evidence (
  id uuid primary key default gen_random_uuid(),
  poc_id uuid not null references pocs(id),
  kind text not null check (kind in ('success_snapshot','quote_acceptance')),
  source_id text not null,
  payload jsonb not null,
  evidence_hash text not null check (evidence_hash ~ '^[a-f0-9]{64}$'),
  recorded_at timestamptz not null,
  created_at timestamptz not null default now()
);
create unique index lifecycle_poc_evidence_source_unique
  on lifecycle_poc_evidence(poc_id, kind, source_id);

create table lifecycle_provisioning_attempts (
  id uuid primary key default gen_random_uuid(),
  command_id text not null unique,
  account_id uuid not null references accounts(id),
  order_id uuid references orders(id),
  poc_id uuid references pocs(id),
  organization_id uuid not null references organizations(id),
  operation text not null check (operation in ('provision','upgrade_poc','sandbox','teardown')),
  state text not null check (state in ('pending','in_flight','retry_scheduled','dead_letter','confirmed')),
  attempt jsonb not null,
  provider_operation_id text,
  last_provider_occurred_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version integer not null default 1,
  constraint lifecycle_provisioning_scope_check check (
    (poc_id is not null and order_id is null and operation = 'sandbox')
    or (order_id is not null and poc_id is null and operation <> 'sandbox')
  )
);
create index lifecycle_provisioning_state_idx on lifecycle_provisioning_attempts(state, updated_at);

create table lifecycle_renewal_actions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  account_id uuid not null references accounts(id),
  action text not null check (action in ('renew','change_term','request_change','decline')),
  actor_user_id uuid not null references commerce_users(id),
  evidence_document_id uuid references documents(id),
  payload jsonb not null,
  evidence_hash text not null unique check (evidence_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  constraint lifecycle_renewal_decline_evidence_check check (
    action <> 'decline' or evidence_document_id is not null
  )
);
create index lifecycle_renewal_action_order_idx on lifecycle_renewal_actions(order_id, created_at);

create table lifecycle_offboarding_plans (
  termination_id uuid primary key references terminations(id),
  account_id uuid not null references accounts(id),
  organization_id uuid not null references organizations(id),
  requested_by uuid not null references commerce_users(id),
  reason text not null check (reason in ('customer_request','non_renewal','partner_request','partner_default','material_breach')),
  plan jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version integer not null default 1
);
create index lifecycle_offboarding_account_idx on lifecycle_offboarding_plans(account_id);

create table lifecycle_migration_runs (
  id uuid primary key default gen_random_uuid(),
  execution_mode text not null check (execution_mode in ('discovery','rehearsal','execute')),
  source_snapshot_hash text not null check (source_snapshot_hash ~ '^[a-f0-9]{64}$'),
  source_kind text not null check (source_kind in ('fixture','real_snapshot')),
  requester_id uuid not null references commerce_users(id),
  checkpoint jsonb not null,
  status text not null check (status in ('discovery','accounts','orders','complete','failed')),
  batch_size integer not null check (batch_size between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version integer not null default 1
);
create unique index lifecycle_migration_snapshot_mode_unique
  on lifecycle_migration_runs(source_snapshot_hash, execution_mode);
create index lifecycle_migration_status_idx on lifecycle_migration_runs(status, updated_at);

create table lifecycle_migration_matches (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references lifecycle_migration_runs(id),
  legacy_account_id text not null,
  disposition text not null check (disposition in ('create','attach','skip')),
  account_id uuid references accounts(id),
  reason text not null,
  evidence_document_id uuid not null references documents(id),
  decided_by uuid not null references commerce_users(id),
  decided_at timestamptz not null,
  evidence_hash text not null check (evidence_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  constraint lifecycle_migration_attach_scope_check check (
    (disposition = 'attach' and account_id is not null)
    or (disposition <> 'attach' and account_id is null)
  )
);
create unique index lifecycle_migration_match_unique
  on lifecycle_migration_matches(run_id, legacy_account_id);

create table lifecycle_domain_events (
  id uuid primary key default gen_random_uuid(),
  provider text,
  provider_event_id text,
  aggregate_type text not null,
  aggregate_id uuid not null,
  sequence integer not null check (sequence > 0),
  event_type text not null,
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  payload jsonb not null,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint lifecycle_provider_identity_check check (
    (provider is null and provider_event_id is null)
    or (provider is not null and provider_event_id is not null)
  )
);
create unique index lifecycle_provider_event_unique
  on lifecycle_domain_events(provider, provider_event_id);
create unique index lifecycle_aggregate_sequence_unique
  on lifecycle_domain_events(aggregate_type, aggregate_id, sequence);

create table lifecycle_feature_gate_approvals (
  id uuid primary key default gen_random_uuid(),
  gate text not null,
  requester_id uuid not null references commerce_users(id),
  approver_id uuid not null references commerce_users(id),
  approved boolean not null,
  approved_at timestamptz not null,
  evidence_document_id uuid not null references documents(id),
  authentication_evidence_hash text not null check (authentication_evidence_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  constraint lifecycle_gate_separation_check check (requester_id <> approver_id)
);
create unique index lifecycle_gate_approver_unique
  on lifecycle_feature_gate_approvals(gate, requester_id, approver_id);

create table lifecycle_idempotency_records (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references commerce_users(id),
  scope text not null,
  key text not null,
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  lock_token uuid not null,
  locked_until timestamptz not null,
  response_status integer,
  response_body jsonb,
  completed_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version integer not null default 1,
  constraint lifecycle_idempotency_completion_check check (
    (completed_at is null and response_status is null and response_body is null)
    or (completed_at is not null and response_status is not null and response_body is not null)
  )
);
create unique index lifecycle_idempotency_owner_key_unique
  on lifecycle_idempotency_records(owner_user_id, scope, key);
create index lifecycle_idempotency_expiry_idx on lifecycle_idempotency_records(expires_at);

-- A provider result may be replayed or race another verified delivery, but an
-- immutable commercial order line can materialize at most one entitlement.
create unique index if not exists entitlements_order_line_unique
  on entitlements(order_line_id);

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'lifecycle_partner_domains','lifecycle_agreement_template_texts','lifecycle_agreement_drafts',
    'lifecycle_click_acceptances','lifecycle_signature_envelopes','lifecycle_pass_through_acceptances',
    'lifecycle_poc_evidence','lifecycle_provisioning_attempts','lifecycle_renewal_actions',
    'lifecycle_offboarding_plans','lifecycle_migration_runs','lifecycle_migration_matches',
    'lifecycle_domain_events','lifecycle_feature_gate_approvals','lifecycle_idempotency_records'
  ] loop
    execute format('alter table %I enable row level security', table_name);
    execute format('alter table %I force row level security', table_name);
  end loop;
end $$;

create policy lifecycle_partner_domains_scope on lifecycle_partner_domains for all
  using (app_has_account(account_id)) with check (app_has_account(account_id));
create policy lifecycle_template_text_read on lifecycle_agreement_template_texts for select
  using (app_is_internal() or exists (
    select 1 from agreement_templates t where t.id = template_id and t.approval_status = 'approved'
  ));
create policy lifecycle_template_text_insert on lifecycle_agreement_template_texts for insert
  with check (app_is_internal());
create policy lifecycle_drafts_scope on lifecycle_agreement_drafts for all
  using (app_has_account(account_id)) with check (app_has_account(account_id));
create policy lifecycle_click_read on lifecycle_click_acceptances for select
  using (app_has_account(account_id));
create policy lifecycle_click_insert on lifecycle_click_acceptances for insert
  with check (app_has_account(account_id));
create policy lifecycle_envelopes_scope on lifecycle_signature_envelopes for all
  using (app_has_account(account_id)) with check (app_has_account(account_id));
create policy lifecycle_pass_through_read on lifecycle_pass_through_acceptances for select
  using (app_has_account(account_id));
create policy lifecycle_pass_through_insert on lifecycle_pass_through_acceptances for insert
  with check (app_has_account(account_id));
create policy lifecycle_poc_evidence_read on lifecycle_poc_evidence for select
  using (exists (select 1 from pocs p where p.id = poc_id and (app_has_account(p.account_id) or app_has_account(p.partner_account_id))));
create policy lifecycle_poc_evidence_insert on lifecycle_poc_evidence for insert
  with check (exists (select 1 from pocs p where p.id = poc_id and (app_has_account(p.account_id) or app_has_account(p.partner_account_id))));
create policy lifecycle_provisioning_read on lifecycle_provisioning_attempts for select
  using (app_has_account(account_id) or app_is_internal());
create policy lifecycle_provisioning_insert on lifecycle_provisioning_attempts for insert
  with check (app_has_account(account_id) or app_is_internal());
create policy lifecycle_provisioning_update_internal on lifecycle_provisioning_attempts for update
  using (app_is_internal()) with check (app_is_internal());
create policy lifecycle_renewal_read on lifecycle_renewal_actions for select
  using (app_has_account(account_id));
create policy lifecycle_renewal_insert on lifecycle_renewal_actions for insert
  with check (app_has_account(account_id));
create policy lifecycle_offboarding_scope on lifecycle_offboarding_plans for all
  using (app_has_account(account_id)) with check (app_has_account(account_id));
create policy lifecycle_migration_internal on lifecycle_migration_runs for all
  using (app_is_internal()) with check (app_is_internal());
create policy lifecycle_migration_matches_internal on lifecycle_migration_matches for all
  using (app_is_internal()) with check (app_is_internal());
create policy lifecycle_domain_events_internal on lifecycle_domain_events for all
  using (app_is_internal()) with check (app_is_internal());
create policy lifecycle_gate_approvals_internal on lifecycle_feature_gate_approvals for all
  using (app_is_internal()) with check (app_is_internal());
create policy lifecycle_idempotency_owner on lifecycle_idempotency_records for all
  using (app_is_current_user(owner_user_id)) with check (app_is_current_user(owner_user_id));

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'lifecycle_partner_domains','lifecycle_agreement_drafts','lifecycle_signature_envelopes',
    'lifecycle_provisioning_attempts','lifecycle_offboarding_plans','lifecycle_migration_runs',
    'lifecycle_idempotency_records'
  ] loop
    execute format('create trigger %I before update on %I for each row execute function touch_versioned_row()', table_name || '_version', table_name);
  end loop;
  foreach table_name in array array[
    'lifecycle_agreement_template_texts','lifecycle_click_acceptances','lifecycle_pass_through_acceptances',
    'lifecycle_poc_evidence','lifecycle_renewal_actions','lifecycle_migration_matches',
    'lifecycle_domain_events','lifecycle_feature_gate_approvals'
  ] loop
    execute format('create trigger %I before update or delete on %I for each row execute function deny_immutable_mutation()', table_name || '_immutable', table_name);
  end loop;
end $$;

grant select, insert, update, delete on table
  lifecycle_partner_domains, lifecycle_agreement_template_texts, lifecycle_agreement_drafts,
  lifecycle_click_acceptances, lifecycle_signature_envelopes, lifecycle_pass_through_acceptances,
  lifecycle_poc_evidence, lifecycle_provisioning_attempts, lifecycle_renewal_actions,
  lifecycle_offboarding_plans, lifecycle_migration_runs, lifecycle_migration_matches,
  lifecycle_domain_events, lifecycle_feature_gate_approvals, lifecycle_idempotency_records
  to clockwork_runtime, clockwork_service;
revoke update, delete on lifecycle_agreement_template_texts, lifecycle_click_acceptances,
  lifecycle_pass_through_acceptances, lifecycle_poc_evidence, lifecycle_renewal_actions,
  lifecycle_migration_matches, lifecycle_domain_events, lifecycle_feature_gate_approvals
  from clockwork_runtime;
revoke update, delete on lifecycle_provisioning_attempts from clockwork_runtime;
