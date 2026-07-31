-- Durable provider identity bindings and projection watermarks are service
-- facts. Tenant sessions never read or mutate them directly.

create table system_provider_resource_bindings (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_resource_type text not null,
  provider_resource_id text not null,
  aggregate_type text not null,
  aggregate_id uuid not null,
  binding jsonb not null,
  created_at timestamptz not null default now(),
  constraint system_provider_binding_names_check check (
    length(trim(provider)) > 0
    and length(trim(provider_resource_type)) > 0
    and length(trim(provider_resource_id)) > 0
    and length(trim(aggregate_type)) > 0
  )
);
create unique index system_provider_resource_binding_unique
  on system_provider_resource_bindings(provider, provider_resource_type, provider_resource_id);
create index system_provider_aggregate_binding_idx
  on system_provider_resource_bindings(aggregate_type, aggregate_id);

create table system_provider_projection_checkpoints (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  aggregate_key text not null,
  provider_event_id text not null,
  occurred_at timestamptz not null,
  updated_at timestamptz not null default now()
);
create unique index system_provider_projection_checkpoint_unique
  on system_provider_projection_checkpoints(provider, aggregate_key);
create index system_provider_projection_checkpoint_time_idx
  on system_provider_projection_checkpoints(provider, occurred_at);

alter table system_provider_resource_bindings enable row level security;
alter table system_provider_resource_bindings force row level security;
alter table system_provider_projection_checkpoints enable row level security;
alter table system_provider_projection_checkpoints force row level security;

create policy system_provider_resource_bindings_service
  on system_provider_resource_bindings for all
  using (app_is_internal()) with check (app_is_internal());
create policy system_provider_projection_checkpoints_service
  on system_provider_projection_checkpoints for all
  using (app_is_internal()) with check (app_is_internal());

grant select, insert, update, delete on system_provider_resource_bindings
  to clockwork_runtime, clockwork_service;
grant select, insert, update, delete on system_provider_projection_checkpoints
  to clockwork_runtime, clockwork_service;

