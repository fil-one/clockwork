-- Standalone staff MNDA workflow. Prospects need no commerce user/account.
-- Signed PDF plus provider audit pages are append-only in the backed-up database.
create table public.commerce_mnda_signers (
  id uuid primary key, name text not null, email text not null unique,
  title text not null, active boolean not null default true,
  is_default boolean not null default false, version integer not null default 1,
  check (not is_default or active)
);
create unique index commerce_mnda_one_default on public.commerce_mnda_signers (is_default) where is_default;
insert into public.commerce_mnda_signers (id, name, email, title, is_default) values
  ('019a44ac-0000-7000-8000-000000000001', 'James Kurz', 'james@fil.one', 'CFO/CSO', true);
create table public.commerce_mnda_requests (
  id uuid primary key, input jsonb not null, countersigner jsonb not null,
  owner_id uuid not null, owner_name text not null,
  state text not null default 'draft' check (state in
    ('draft','preparing','ready','sending','sent','viewed','awaiting_countersignature','completed','declined','expired','canceled','attention')),
  provider_id text unique, template_hash text not null,
  test_mode boolean not null, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), completed_at timestamptz,
  lease_until timestamptz, lease_token uuid, error text, version integer not null default 1
);
create table public.commerce_mnda_artifacts (
  id uuid primary key, request_id uuid not null references public.commerce_mnda_requests(id),
  kind text not null check (kind in ('original','executed')),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  base64 text not null check (length(base64) <= 16000000),
  created_at timestamptz not null default now()
);
create unique index commerce_mnda_artifact_kind on public.commerce_mnda_artifacts(request_id,kind);
alter table public.commerce_mnda_signers enable row level security;
alter table public.commerce_mnda_signers force row level security;
alter table public.commerce_mnda_requests enable row level security;
alter table public.commerce_mnda_requests force row level security;
alter table public.commerce_mnda_artifacts enable row level security;
alter table public.commerce_mnda_artifacts force row level security;
revoke all on public.commerce_mnda_signers, public.commerce_mnda_requests, public.commerce_mnda_artifacts from public, anon, authenticated, clockwork_runtime, clockwork_service;
grant select, insert, update on public.commerce_mnda_signers, public.commerce_mnda_requests to clockwork_service;
grant select, insert on public.commerce_mnda_artifacts to clockwork_service;
create policy mnda_signers_service on public.commerce_mnda_signers for all to clockwork_service using(true) with check(true);
create policy mnda_requests_service on public.commerce_mnda_requests for all to clockwork_service using(true) with check(true);
create policy mnda_artifacts_read on public.commerce_mnda_artifacts for select to clockwork_service using(true);
create policy mnda_artifacts_insert on public.commerce_mnda_artifacts for insert to clockwork_service with check(true);
create function public.protect_mnda_request() returns trigger language plpgsql set search_path = public as $$
begin
  if new.input <> old.input or new.countersigner <> old.countersigner or new.template_hash <> old.template_hash
     or new.owner_id <> old.owner_id or new.test_mode <> old.test_mode
     or (old.provider_id is not null and new.provider_id is distinct from old.provider_id) then
    raise exception 'MNDA snapshots and provider binding are immutable';
  end if;
  if old.state in ('completed','canceled','declined','expired') and new.state <> old.state then
    raise exception 'MNDA terminal state is immutable';
  end if;
  if new.state = 'completed' and not exists (select 1 from public.commerce_mnda_artifacts where request_id=new.id and kind='executed') then
    raise exception 'MNDA completion requires archived evidence';
  end if;
  return new;
end $$;
create trigger protect_mnda_request before update on public.commerce_mnda_requests for each row execute function public.protect_mnda_request();
