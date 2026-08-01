-- Authoritative portal, e-sign return, evidence-ingestion, and document-delivery
-- persistence. Fixture data is deliberately not seeded here.

create table public.experience_portal_projections (
  id uuid primary key default gen_random_uuid(),
  audience text not null check (audience in ('customer','partner','internal')),
  audience_account_id uuid references public.accounts(id),
  subject_account_id uuid references public.accounts(id),
  channel text not null check (channel ~ '^[a-z][a-z0-9_-]{1,63}$'),
  record_key text not null check (length(record_key) between 1 and 160),
  aggregate_type text not null check (length(aggregate_type) between 1 and 80),
  aggregate_id uuid not null,
  command_resource text,
  payload jsonb not null,
  source_hash text not null check (source_hash ~ '^[a-f0-9]{64}$'),
  source_updated_at timestamptz not null,
  projected_at timestamptz not null default now(),
  row_version integer not null default 1 check (row_version > 0),
  constraint experience_projection_audience_scope_check check (
    (audience = 'internal' and audience_account_id is null)
    or (audience <> 'internal' and audience_account_id is not null)
  ),
  constraint experience_projection_payload_check check (
    jsonb_typeof(payload) = 'object'
    and (not (payload ? 'allowedActions') or jsonb_typeof(payload->'allowedActions') = 'array')
  ),
  constraint experience_projection_identity_unique
    unique nulls not distinct (audience, audience_account_id, channel, record_key)
);

create index experience_projection_page_idx
  on public.experience_portal_projections (
    audience,
    audience_account_id,
    channel,
    source_updated_at desc,
    id desc
  );
create index experience_projection_aggregate_idx
  on public.experience_portal_projections (aggregate_type, aggregate_id);

create table public.experience_projection_action_requests (
  id uuid primary key default gen_random_uuid(),
  projection_id uuid not null references public.experience_portal_projections(id),
  audience_account_id uuid references public.accounts(id),
  subject_account_id uuid references public.accounts(id),
  aggregate_type text not null,
  aggregate_id uuid not null,
  command_resource text not null,
  action text not null check (action ~ '^[a-z][a-z0-9_]{1,79}$'),
  expected_version integer not null check (expected_version > 0),
  actor_user_id uuid not null references public.commerce_users(id),
  effective_account_id uuid references public.accounts(id),
  assisted_session_id uuid,
  assisted_reason text,
  idempotency_key text not null check (length(idempotency_key) between 16 and 255),
  request_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(request_payload) = 'object'),
  status text not null default 'queued' check (status in ('queued','applied','rejected','failed')),
  result_reference text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  audit_event_id uuid not null unique default gen_random_uuid() references public.audit_events(id),
  outbox_message_id uuid not null unique default gen_random_uuid() references public.outbox_messages(id),
  constraint experience_action_idempotency_unique unique (actor_user_id, idempotency_key),
  constraint experience_action_completion_check check (
    (status = 'queued' and completed_at is null and result_reference is null)
    or (status <> 'queued' and completed_at is not null)
  ),
  constraint experience_action_assisted_check check (
    (assisted_session_id is null and assisted_reason is null)
    or (
      assisted_session_id is not null
      and effective_account_id is not null
      and length(trim(assisted_reason)) >= 8
    )
  )
);

create index experience_action_dispatch_idx
  on public.experience_projection_action_requests(status, created_at);

create or replace function public.validate_experience_projection_action()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  projection public.experience_portal_projections%rowtype;
begin
  select * into projection
  from public.experience_portal_projections
  where id = new.projection_id
  for share;

  if not found then
    raise exception using errcode = 'P0002', message = 'projection record not found';
  end if;
  if projection.row_version <> new.expected_version then
    raise exception using errcode = '40001', message = 'projection version conflict';
  end if;
  if projection.aggregate_type <> new.aggregate_type
    or projection.aggregate_id <> new.aggregate_id
    or projection.command_resource is distinct from new.command_resource
    or projection.audience_account_id is distinct from new.audience_account_id
    or projection.subject_account_id is distinct from new.subject_account_id
  then
    raise exception using errcode = '42501', message = 'projection command binding mismatch';
  end if;
  if not coalesce(projection.payload->'allowedActions', '[]'::jsonb) ? new.action then
    raise exception using errcode = '42501', message = 'projection action is not allowed';
  end if;
  return new;
end;
$$;

create trigger experience_projection_action_validate
before insert on public.experience_projection_action_requests
for each row execute function public.validate_experience_projection_action();

create or replace function public.protect_experience_projection_action()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'projection action requests cannot be deleted';
  end if;
  if old.projection_id is distinct from new.projection_id
    or old.audience_account_id is distinct from new.audience_account_id
    or old.subject_account_id is distinct from new.subject_account_id
    or old.aggregate_type is distinct from new.aggregate_type
    or old.aggregate_id is distinct from new.aggregate_id
    or old.command_resource is distinct from new.command_resource
    or old.action is distinct from new.action
    or old.expected_version is distinct from new.expected_version
    or old.actor_user_id is distinct from new.actor_user_id
    or old.effective_account_id is distinct from new.effective_account_id
    or old.assisted_session_id is distinct from new.assisted_session_id
    or old.assisted_reason is distinct from new.assisted_reason
    or old.idempotency_key is distinct from new.idempotency_key
    or old.request_payload is distinct from new.request_payload
    or old.created_at is distinct from new.created_at
    or old.audit_event_id is distinct from new.audit_event_id
    or old.outbox_message_id is distinct from new.outbox_message_id
  then
    raise exception using errcode = '55000', message = 'projection action identity is immutable';
  end if;
  if old.status <> 'queued'
    or new.status not in ('applied','rejected','failed')
    or new.completed_at is null
  then
    raise exception using errcode = '23514', message = 'invalid projection action transition';
  end if;
  return new;
end;
$$;

create trigger experience_projection_action_protect
before update or delete on public.experience_projection_action_requests
for each row execute function public.protect_experience_projection_action();

create or replace function public.append_experience_projection_action_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not app_context_is_valid() or not app_is_current_user(new.actor_user_id) then
    raise exception using errcode = '42501', message = 'invalid projection action actor context';
  end if;
  insert into public.audit_events (
    id, account_id, aggregate_type, aggregate_id, aggregate_version,
    event_type, event_version, actor, occurred_at, request_id, after, metadata
  ) values (
    new.audit_event_id,
    coalesce(new.effective_account_id, new.subject_account_id, new.audience_account_id),
    'experience_action_request', new.id, 1,
    'experience.projection_action.queued', 1,
    jsonb_strip_nulls(jsonb_build_object(
      'kind', 'user',
      'id', new.actor_user_id,
      'effectiveAccountId', new.effective_account_id,
      'assistedSessionId', new.assisted_session_id,
      'assistedActionReason', new.assisted_reason
    )),
    new.created_at,
    coalesce(app_context_claims()->>'requestId', 'experience-action'),
    jsonb_build_object(
      'actionRequestId', new.id,
      'projectionId', new.projection_id,
      'aggregateType', new.aggregate_type,
      'aggregateId', new.aggregate_id,
      'action', new.action,
      'expectedVersion', new.expected_version,
      'status', new.status
    ),
    jsonb_build_object(
      'commandResource', new.command_resource,
      'idempotencyKey', new.idempotency_key
    )
  );
  insert into public.outbox_messages (id, event_id, topic, payload)
  values (
    new.outbox_message_id,
    new.audit_event_id,
    'experience.projection_action.queued',
    jsonb_build_object(
      'eventId', new.audit_event_id,
      'actionRequestId', new.id,
      'projectionId', new.projection_id,
      'aggregateType', new.aggregate_type,
      'aggregateId', new.aggregate_id,
      'action', new.action,
      'expectedVersion', new.expected_version
    )
  );
  return new;
end;
$$;

create trigger experience_projection_action_audit_outbox
before insert on public.experience_projection_action_requests
for each row execute function public.append_experience_projection_action_event();

create table public.experience_esign_return_correlations (
  id uuid primary key default gen_random_uuid(),
  state_hash text not null unique check (state_hash ~ '^[a-f0-9]{64}$'),
  envelope_id uuid not null unique references public.lifecycle_signature_envelopes(id),
  agreement_draft_id uuid not null references public.lifecycle_agreement_drafts(id),
  account_id uuid not null references public.accounts(id),
  signer_user_id uuid not null references public.commerce_users(id),
  signer_email text not null check (signer_email = lower(signer_email)),
  document_id uuid not null references public.documents(id),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint experience_esign_return_expiry_check check (expires_at > created_at)
);

create table public.experience_esign_return_receipts (
  id uuid primary key default gen_random_uuid(),
  correlation_id uuid not null references public.experience_esign_return_correlations(id),
  actor_user_id uuid not null references public.commerce_users(id),
  observed_envelope_state text not null,
  observed_at timestamptz not null default now(),
  request_id text not null check (length(request_id) between 8 and 128),
  constraint experience_esign_receipt_request_unique unique (correlation_id, request_id)
);

create index experience_esign_receipt_correlation_idx
  on public.experience_esign_return_receipts(correlation_id, observed_at);

create or replace function public.validate_experience_esign_correlation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.lifecycle_signature_envelopes envelope
    join public.commerce_users signer
      on signer.id = new.signer_user_id
     and lower(signer.email) = new.signer_email
    where envelope.id = new.envelope_id
      and envelope.agreement_draft_id = new.agreement_draft_id
      and envelope.account_id = new.account_id
      and envelope.document_id = new.document_id
      and envelope.signer_email = new.signer_email
  ) then
    raise exception using errcode = '42501', message = 'e-sign correlation binding mismatch';
  end if;
  return new;
end;
$$;

create trigger experience_esign_correlation_validate
before insert on public.experience_esign_return_correlations
for each row execute function public.validate_experience_esign_correlation();
create trigger experience_esign_correlation_immutable
before update or delete on public.experience_esign_return_correlations
for each row execute function public.deny_immutable_mutation();
create trigger experience_esign_receipt_immutable
before update or delete on public.experience_esign_return_receipts
for each row execute function public.deny_immutable_mutation();

create table public.experience_evidence_uploads (
  id uuid primary key default gen_random_uuid(),
  public_upload_id text not null unique check (public_upload_id ~ '^upl_[A-Za-z0-9_-]{20,80}$'),
  idempotency_key text not null check (length(idempotency_key) between 16 and 255),
  provider_upload_id text unique,
  owner_user_id uuid not null references public.commerce_users(id),
  account_id uuid references public.accounts(id),
  organization_id uuid references public.organizations(id),
  journey text not null check (journey in ('customer_paper','poc','procurement','exception','approval')),
  target_id uuid not null,
  evidence_kind text not null check (
    evidence_kind in ('agreement','acceptance','quote','order_form','amendment','notice','completion_certificate','deletion_certificate','screening','approval')
  ),
  declared_content_hash text not null check (declared_content_hash ~ '^[a-f0-9]{64}$'),
  declared_mime_type text not null check (
    declared_mime_type in ('application/pdf','image/png','image/jpeg','text/plain','text/csv')
  ),
  declared_byte_length bigint not null check (declared_byte_length between 1 and 52428800),
  quarantine_storage_key text,
  immutable_storage_key text,
  storage_version_id text,
  scan_reference text,
  document_id uuid references public.documents(id),
  retain_until timestamptz not null,
  expires_at timestamptz not null,
  legal_hold boolean not null default false,
  status text not null default 'pending' check (
    status in ('pending','uploaded','scanning','quarantined','promoted','expired','failed')
  ),
  failure_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version integer not null default 1 check (row_version > 0),
  constraint experience_evidence_expiry_retention_check check (
    expires_at > created_at and retain_until > expires_at
  ),
  constraint experience_evidence_scope_check check (
    account_id is not null
  ),
  constraint experience_evidence_idempotency_unique unique (owner_user_id, idempotency_key),
  constraint experience_evidence_state_metadata_check check (
    (status = 'pending' and provider_upload_id is null and document_id is null)
    or (status in ('uploaded','scanning') and provider_upload_id is not null and document_id is null)
    or (status = 'quarantined' and scan_reference is not null and document_id is null)
    or (
      status = 'promoted'
      and provider_upload_id is not null
      and immutable_storage_key is not null
      and storage_version_id is not null
      and scan_reference is not null
      and document_id is not null
      and failure_code is null
    )
    or (status in ('expired','failed') and document_id is null)
  )
);

create index experience_evidence_owner_idx
  on public.experience_evidence_uploads(owner_user_id, created_at desc);
create index experience_evidence_pending_idx
  on public.experience_evidence_uploads(status, expires_at);

create or replace function public.protect_experience_evidence_upload()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'evidence upload records cannot be deleted';
  end if;
  if old.public_upload_id is distinct from new.public_upload_id
    or old.idempotency_key is distinct from new.idempotency_key
    or old.owner_user_id is distinct from new.owner_user_id
    or old.account_id is distinct from new.account_id
    or old.organization_id is distinct from new.organization_id
    or old.journey is distinct from new.journey
    or old.target_id is distinct from new.target_id
    or old.evidence_kind is distinct from new.evidence_kind
    or old.declared_content_hash is distinct from new.declared_content_hash
    or old.declared_mime_type is distinct from new.declared_mime_type
    or old.declared_byte_length is distinct from new.declared_byte_length
    or old.retain_until is distinct from new.retain_until
    or old.expires_at is distinct from new.expires_at
    or old.legal_hold is distinct from new.legal_hold
    or old.created_at is distinct from new.created_at
  then
    raise exception using errcode = '55000', message = 'evidence upload identity is immutable';
  end if;
  if new.row_version <> old.row_version + 1 then
    raise exception using errcode = '40001', message = 'evidence upload version conflict';
  end if;
  if not (
    (old.status = 'pending' and new.status in ('uploaded','expired','failed'))
    or (old.status = 'uploaded' and new.status in ('scanning','expired','failed'))
    or (old.status = 'scanning' and new.status in ('quarantined','promoted','expired','failed'))
    or (old.status = 'quarantined' and new.status = 'quarantined')
    or (old.status = 'promoted' and new.status = 'promoted')
  ) then
    raise exception using errcode = '23514', message = 'invalid evidence upload transition';
  end if;
  return new;
end;
$$;

create trigger experience_evidence_upload_protect
before update or delete on public.experience_evidence_uploads
for each row execute function public.protect_experience_evidence_upload();

create table public.experience_document_render_requests (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id),
  audience text not null check (audience in ('customer','partner','internal')),
  audience_account_id uuid references public.accounts(id),
  subject_type text not null check (length(subject_type) between 1 and 80),
  subject_id uuid not null,
  document_kind text not null check (
    document_kind in (
      'direct_quote','partner_transfer_quote','partner_resale_quote','order_form','amendment',
      'poc_summary','poc_final_report','invoice_companion','receipt','commission_statement',
      'renewal_confirmation','decline_confirmation','deletion_certificate','reconciliation_report','report_export'
    )
  ),
  input jsonb not null check (jsonb_typeof(input) = 'object'),
  source_hash text not null check (source_hash ~ '^[a-f0-9]{64}$'),
  requested_by uuid not null references public.commerce_users(id),
  retain_until timestamptz not null,
  status text not null default 'pending' check (status in ('pending','rendering','stored','failed')),
  failure_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version integer not null default 1 check (row_version > 0),
  constraint experience_render_audience_check check (
    (audience = 'internal' and audience_account_id is null)
    or (audience <> 'internal' and audience_account_id is not null)
  ),
  constraint experience_render_retention_check check (retain_until > created_at),
  constraint experience_render_source_unique unique (subject_type, subject_id, document_kind, source_hash)
);

create table public.experience_artifact_deliveries (
  id uuid primary key default gen_random_uuid(),
  render_request_id uuid not null unique references public.experience_document_render_requests(id),
  account_id uuid not null references public.accounts(id),
  audience text not null check (audience in ('customer','partner','internal')),
  audience_account_id uuid references public.accounts(id),
  subject_type text not null,
  subject_id uuid not null,
  document_kind text not null check (
    document_kind in (
      'direct_quote','partner_transfer_quote','partner_resale_quote','order_form','amendment',
      'poc_summary','poc_final_report','invoice_companion','receipt','commission_statement',
      'renewal_confirmation','decline_confirmation','deletion_certificate','reconciliation_report','report_export'
    )
  ),
  document_id uuid not null unique references public.documents(id),
  immutable_version text not null check (length(immutable_version) between 1 and 80),
  source_hash text not null check (source_hash ~ '^[a-f0-9]{64}$'),
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  storage_version_id text not null,
  mime_type text not null check (mime_type = 'application/pdf'),
  byte_length bigint not null check (byte_length > 0),
  filename text not null check (
    filename ~ '^[a-z0-9][a-z0-9._-]{0,159}\.pdf$'
    and filename !~ '\.\.'
  ),
  retain_until timestamptz not null,
  created_at timestamptz not null default now(),
  constraint experience_delivery_audience_check check (
    (audience = 'internal' and audience_account_id is null)
    or (audience <> 'internal' and audience_account_id is not null)
  )
);

create index experience_delivery_subject_idx
  on public.experience_artifact_deliveries(subject_type, subject_id, document_kind);
create index experience_delivery_audience_idx
  on public.experience_artifact_deliveries(audience, audience_account_id, created_at desc);

create or replace function public.protect_experience_render_truth()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = format('%s cannot be deleted', tg_table_name);
  end if;
  if tg_table_name = 'experience_artifact_deliveries' then
    raise exception using errcode = '55000', message = 'artifact deliveries are immutable';
  end if;
  if old.account_id is distinct from new.account_id
    or old.audience is distinct from new.audience
    or old.audience_account_id is distinct from new.audience_account_id
    or old.subject_type is distinct from new.subject_type
    or old.subject_id is distinct from new.subject_id
    or old.document_kind is distinct from new.document_kind
    or old.input is distinct from new.input
    or old.source_hash is distinct from new.source_hash
    or old.requested_by is distinct from new.requested_by
    or old.retain_until is distinct from new.retain_until
    or old.created_at is distinct from new.created_at
  then
    raise exception using errcode = '55000', message = 'render source truth is immutable';
  end if;
  if new.row_version <> old.row_version + 1 then
    raise exception using errcode = '40001', message = 'render request version conflict';
  end if;
  if not (
    (old.status = 'pending' and new.status in ('rendering','failed'))
    or (old.status = 'rendering' and new.status in ('stored','failed'))
  ) then
    raise exception using errcode = '23514', message = 'invalid render request transition';
  end if;
  return new;
end;
$$;

create trigger experience_render_request_protect
before update or delete on public.experience_document_render_requests
for each row execute function public.protect_experience_render_truth();
create trigger experience_artifact_delivery_immutable
before update or delete on public.experience_artifact_deliveries
for each row execute function public.protect_experience_render_truth();

-- RLS policies intentionally distinguish runtime audience reads from service
-- projection/provider writes. Cross-audience partner rows are never inferred.
create or replace function public.experience_session_is_internal()
returns boolean
language sql
stable
set search_path = public
as $$
  select app_context_is_valid()
    and coalesce((app_context_claims()->>'isInternalStaff')::boolean, false)
$$;

create or replace function public.experience_session_has_role(candidate text)
returns boolean
language sql
stable
set search_path = public
as $$
  select app_context_is_valid()
    and candidate in (
      select jsonb_array_elements_text(app_context_claims()->'roles')
    )
$$;

create or replace function public.experience_session_assisted_account()
returns uuid
language plpgsql
stable
set search_path = public
as $$
declare
  accounts jsonb;
begin
  if not experience_session_is_internal() then return null; end if;
  accounts := coalesce(app_context_claims()->'accountIds', '[]'::jsonb);
  if jsonb_array_length(accounts) <> 1 then return null; end if;
  return (accounts->>0)::uuid;
exception when others then
  return null;
end;
$$;

alter table public.experience_portal_projections enable row level security;
alter table public.experience_portal_projections force row level security;
alter table public.experience_projection_action_requests enable row level security;
alter table public.experience_projection_action_requests force row level security;
alter table public.experience_esign_return_correlations enable row level security;
alter table public.experience_esign_return_correlations force row level security;
alter table public.experience_esign_return_receipts enable row level security;
alter table public.experience_esign_return_receipts force row level security;
alter table public.experience_evidence_uploads enable row level security;
alter table public.experience_evidence_uploads force row level security;
alter table public.experience_document_render_requests enable row level security;
alter table public.experience_document_render_requests force row level security;
alter table public.experience_artifact_deliveries enable row level security;
alter table public.experience_artifact_deliveries force row level security;

create policy experience_projection_read on public.experience_portal_projections
for select to clockwork_runtime using (
  (
    audience = 'internal'
    and experience_session_is_internal()
    and (
      experience_session_assisted_account() is null
      or subject_account_id = experience_session_assisted_account()
    )
    and (
      (channel = 'approvals' and (
        experience_session_has_role('legal_approver')
        or experience_session_has_role('finance_approver')
        or experience_session_has_role('destructive_action_approver')
      ))
      or (channel <> 'approvals' and experience_session_has_role('internal_operator'))
    )
  )
  or (audience <> 'internal' and app_has_account(audience_account_id))
);
create policy experience_projection_service on public.experience_portal_projections
for all to clockwork_service using (true) with check (true);

create policy experience_action_read on public.experience_projection_action_requests
for select to clockwork_runtime using (
  app_is_current_user(actor_user_id)
  and (
    (audience_account_id is null and experience_session_is_internal())
    or app_has_account(audience_account_id)
  )
);
create policy experience_action_insert on public.experience_projection_action_requests
for insert to clockwork_runtime with check (
  app_is_current_user(actor_user_id)
  and (
    (audience_account_id is null and experience_session_is_internal())
    or app_has_account(audience_account_id)
  )
);
create policy experience_action_service on public.experience_projection_action_requests
for all to clockwork_service using (true) with check (true);

create policy experience_esign_correlation_read on public.experience_esign_return_correlations
for select to clockwork_runtime using (
  app_has_account(account_id) and app_is_current_user(signer_user_id)
);
create policy experience_esign_correlation_insert on public.experience_esign_return_correlations
for insert to clockwork_runtime with check (
  app_has_account(account_id) and app_is_current_user(signer_user_id)
);
create policy experience_esign_correlation_service on public.experience_esign_return_correlations
for all to clockwork_service using (true) with check (true);
create policy experience_esign_receipt_read on public.experience_esign_return_receipts
for select to clockwork_runtime using (
  app_is_current_user(actor_user_id)
  and exists (
    select 1 from public.experience_esign_return_correlations correlation
    where correlation.id = correlation_id
      and app_has_account(correlation.account_id)
      and app_is_current_user(correlation.signer_user_id)
  )
);
create policy experience_esign_receipt_insert on public.experience_esign_return_receipts
for insert to clockwork_runtime with check (
  app_is_current_user(actor_user_id)
  and exists (
    select 1 from public.experience_esign_return_correlations correlation
    where correlation.id = correlation_id
      and app_has_account(correlation.account_id)
      and app_is_current_user(correlation.signer_user_id)
  )
);
create policy experience_esign_receipt_service on public.experience_esign_return_receipts
for all to clockwork_service using (true) with check (true);

create policy experience_evidence_read on public.experience_evidence_uploads
for select to clockwork_runtime using (
  app_is_current_user(owner_user_id)
  and (
    app_has_account(account_id)
    or (
      experience_session_is_internal()
      and (
        experience_session_assisted_account() is null
        or account_id = experience_session_assisted_account()
      )
      and (
        (journey = 'exception' and experience_session_has_role('internal_operator'))
        or (journey = 'approval' and (
          experience_session_has_role('legal_approver')
          or experience_session_has_role('finance_approver')
          or experience_session_has_role('destructive_action_approver')
        ))
      )
    )
  )
);
create policy experience_evidence_insert on public.experience_evidence_uploads
for insert to clockwork_runtime with check (
  app_is_current_user(owner_user_id)
  and (
    app_has_account(account_id)
    or (
      experience_session_is_internal()
      and (
        experience_session_assisted_account() is null
        or account_id = experience_session_assisted_account()
      )
      and (
        (journey = 'exception' and experience_session_has_role('internal_operator'))
        or (journey = 'approval' and (
          experience_session_has_role('legal_approver')
          or experience_session_has_role('finance_approver')
          or experience_session_has_role('destructive_action_approver')
        ))
      )
    )
  )
);
create policy experience_evidence_service on public.experience_evidence_uploads
for all to clockwork_service using (true) with check (true);

create policy experience_render_read on public.experience_document_render_requests
for select to clockwork_runtime using (
  (
    audience = 'internal'
    and experience_session_is_internal()
    and experience_session_has_role('internal_operator')
    and (
      experience_session_assisted_account() is null
      or account_id = experience_session_assisted_account()
    )
  )
  or (
    audience <> 'internal'
    and app_has_account(account_id)
    and app_has_account(audience_account_id)
  )
);
create policy experience_render_insert on public.experience_document_render_requests
for insert to clockwork_runtime with check (
  app_has_account(account_id)
  and app_is_current_user(requested_by)
  and (audience_account_id is null or app_has_account(audience_account_id))
);
create policy experience_render_service on public.experience_document_render_requests
for all to clockwork_service using (true) with check (true);
create policy experience_delivery_read on public.experience_artifact_deliveries
for select to clockwork_runtime using (
  (
    audience = 'internal'
    and experience_session_is_internal()
    and experience_session_has_role('internal_operator')
    and (
      experience_session_assisted_account() is null
      or account_id = experience_session_assisted_account()
    )
  )
  or (audience <> 'internal' and app_has_account(audience_account_id))
);
create policy experience_delivery_service on public.experience_artifact_deliveries
for all to clockwork_service using (true) with check (true);

grant select on public.experience_portal_projections to clockwork_runtime;
grant select, insert on public.experience_projection_action_requests to clockwork_runtime;
grant select, insert on public.experience_esign_return_correlations to clockwork_runtime;
grant select, insert on public.experience_esign_return_receipts to clockwork_runtime;
grant select, insert on public.experience_evidence_uploads to clockwork_runtime;
grant select, insert on public.experience_document_render_requests to clockwork_runtime;
grant select on public.experience_artifact_deliveries to clockwork_runtime;

grant select, insert, update, delete on
  public.experience_portal_projections,
  public.experience_projection_action_requests,
  public.experience_esign_return_correlations,
  public.experience_esign_return_receipts,
  public.experience_evidence_uploads,
  public.experience_document_render_requests,
  public.experience_artifact_deliveries
to clockwork_service;
