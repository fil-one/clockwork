-- The reviewable manifest stores references and evidence, never secret values.
create table public.system_production_bootstraps (
  id uuid primary key,
  manifest_hash text not null check (manifest_hash ~ '^[a-f0-9]{64}$'),
  manifest jsonb not null check (jsonb_typeof(manifest) = 'object'),
  applied_by uuid not null references public.commerce_users(id),
  applied_at timestamptz not null
);
alter table public.system_production_bootstraps enable row level security;
alter table public.system_production_bootstraps force row level security;
revoke all on public.system_production_bootstraps from public, anon, authenticated, clockwork_runtime, clockwork_service;
grant select on public.system_production_bootstraps to clockwork_service;
create policy system_production_bootstraps_service_read on public.system_production_bootstraps for select to clockwork_service using (true);
create function public.protect_production_bootstrap() returns trigger language plpgsql set search_path = public as $$
begin
  raise exception using errcode = '55000', message = 'production bootstrap manifests are immutable';
end $$;
create trigger production_bootstrap_immutable before update or delete on public.system_production_bootstraps
for each row execute function public.protect_production_bootstrap();
