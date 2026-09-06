-- Operational credential references only. This registry never stores secret values,
-- modifies runtime environment, or qualifies a provider connection.
create table public.system_provider_connection_references (
  id uuid primary key default public.uuid_v7(),
  provider text not null,
  secret_reference text not null,
  secret_version text not null,
  rotated_at timestamptz not null,
  owner text not null,
  review_interval_days integer not null,
  source_evidence text not null,
  row_version integer not null default 1,
  updated_by uuid not null references public.commerce_users(id),
  updated_at timestamptz not null default now(),
  constraint system_provider_connection_references_provider_check check (provider in ('billing','accounting','notifications','usage','workos','evidence','provisioning','screening','signature','tax','crm','document_renderer')),
  constraint system_provider_connection_references_version_check check (row_version > 0),
  constraint system_provider_connection_references_interval_check check (review_interval_days between 1 and 730),
  constraint system_provider_connection_references_reference_check check (secret_reference ~ '^(secret|vault|arn):[A-Za-z0-9_./:-]+$' and length(secret_reference) <= 1000),
  constraint system_provider_connection_references_text_check check (length(trim(owner)) between 1 and 200 and length(trim(secret_version)) between 1 and 200 and length(trim(source_evidence)) between 1 and 1000)
);
create unique index system_provider_connection_references_provider_unique on public.system_provider_connection_references(provider);
alter table public.system_provider_connection_references enable row level security;
alter table public.system_provider_connection_references force row level security;
revoke all on public.system_provider_connection_references from public, anon, authenticated, clockwork_runtime, clockwork_service;
grant select, insert, update on public.system_provider_connection_references to clockwork_service;
create policy service_provider_references on public.system_provider_connection_references for all to clockwork_service using (true) with check (true);
