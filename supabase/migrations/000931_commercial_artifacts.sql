create table public.core_commercial_artifact_requests (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('quote','order','amendment')),
  subject_id uuid not null,
  commercial_account_id uuid not null references public.accounts(id),
  audience_account_id uuid not null references public.accounts(id),
  audience text not null check (audience in ('end_client','partner')),
  document_kind text not null check (
    document_kind in (
      'direct_quote',
      'partner_transfer_quote',
      'partner_resale_quote',
      'order_form',
      'amendment'
    )
  ),
  source_definition jsonb not null,
  source_hash text not null check (source_hash ~ '^[a-f0-9]{64}$'),
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  retain_until timestamptz not null,
  status text not null default 'requested',
  document_id uuid references public.documents(id),
  content_hash text check (content_hash is null or content_hash ~ '^[a-f0-9]{64}$'),
  storage_version_id text,
  requested_by uuid not null references public.commerce_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version integer not null default 1,
  constraint core_commercial_artifact_state_check check (
    (
      status = 'requested'
      and document_id is null
      and content_hash is null
      and storage_version_id is null
    )
    or (
      status = 'stored'
      and document_id is not null
      and content_hash is not null
      and storage_version_id is not null
    )
  ),
  constraint core_commercial_artifact_retention_check
    check (retain_until > created_at),
  constraint core_commercial_artifact_source_unique
    unique (subject_type, subject_id, document_kind, source_hash)
);

create index core_commercial_artifact_dispatch_idx
  on public.core_commercial_artifact_requests(status, created_at);
create index core_commercial_artifact_document_idx
  on public.core_commercial_artifact_requests(document_id);

create or replace function public.protect_commercial_artifact_request()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'commercial artifact requests cannot be deleted';
  end if;
  if old.subject_type is distinct from new.subject_type
    or old.subject_id is distinct from new.subject_id
    or old.commercial_account_id is distinct from new.commercial_account_id
    or old.audience_account_id is distinct from new.audience_account_id
    or old.audience is distinct from new.audience
    or old.document_kind is distinct from new.document_kind
    or old.source_definition is distinct from new.source_definition
    or old.source_hash is distinct from new.source_hash
    or old.request_hash is distinct from new.request_hash
    or old.retain_until is distinct from new.retain_until
    or old.requested_by is distinct from new.requested_by
    or old.created_at is distinct from new.created_at
  then
    raise exception using errcode = '55000', message = 'commercial artifact source truth is immutable';
  end if;
  if old.status <> 'requested'
    or new.status <> 'stored'
    or new.document_id is null
    or new.content_hash is null
    or new.storage_version_id is null
    or new.row_version <> old.row_version + 1
  then
    raise exception using errcode = '23514', message = 'invalid commercial artifact storage transition';
  end if;
  return new;
end;
$$;

create trigger core_commercial_artifact_request_immutable
before update or delete on public.core_commercial_artifact_requests
for each row execute function public.protect_commercial_artifact_request();

alter table public.core_commercial_artifact_requests enable row level security;
alter table public.core_commercial_artifact_requests force row level security;

create policy core_commercial_artifact_select
on public.core_commercial_artifact_requests
for select to clockwork_runtime
using (app_is_internal() or app_has_account(audience_account_id));

create policy core_commercial_artifact_insert
on public.core_commercial_artifact_requests
for insert to clockwork_runtime
with check (
  app_is_internal()
  or app_has_account(commercial_account_id)
  or app_has_account(audience_account_id)
);

create policy core_commercial_artifact_service
on public.core_commercial_artifact_requests
for all to clockwork_service
using (true)
with check (true);

grant select, insert on public.core_commercial_artifact_requests
  to clockwork_runtime;
grant select, insert, update, delete on public.core_commercial_artifact_requests
  to clockwork_service;
