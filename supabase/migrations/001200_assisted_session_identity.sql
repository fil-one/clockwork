create table if not exists public.experience_assisted_sessions (
  id uuid primary key default gen_random_uuid(),
  authentication_session_id text not null,
  internal_user_id uuid not null references public.commerce_users(id),
  actor_snapshot_name text not null check (char_length(trim(actor_snapshot_name)) > 0),
  actor_snapshot_email text not null check (actor_snapshot_email = lower(trim(actor_snapshot_email))),
  target_account_id uuid not null references public.accounts(id),
  reason text not null check (char_length(trim(reason)) between 8 and 500),
  started_at timestamptz not null,
  expires_at timestamptz not null,
  ended_at timestamptz,
  request_id text not null,
  created_at timestamptz not null default now(),
  constraint experience_assisted_session_window_check
    check (expires_at > started_at and expires_at <= started_at + interval '15 minutes'),
  constraint experience_assisted_session_end_check
    check (ended_at is null or ended_at >= started_at)
);

create index if not exists experience_assisted_session_active_idx
  on public.experience_assisted_sessions
    (internal_user_id, authentication_session_id, ended_at, expires_at);

create unique index if not exists experience_assisted_session_single_live_idx
  on public.experience_assisted_sessions
    (internal_user_id, authentication_session_id)
  where ended_at is null;

create or replace function public.protect_experience_assisted_session_identity()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.internal_user_id is distinct from old.internal_user_id
    or new.authentication_session_id is distinct from old.authentication_session_id
    or new.actor_snapshot_name is distinct from old.actor_snapshot_name
    or new.actor_snapshot_email is distinct from old.actor_snapshot_email
    or new.target_account_id is distinct from old.target_account_id
    or new.reason is distinct from old.reason
    or new.started_at is distinct from old.started_at
    or new.expires_at is distinct from old.expires_at
    or new.request_id is distinct from old.request_id
    or new.created_at is distinct from old.created_at then
    raise exception 'assisted session identity is immutable' using errcode = '23514';
  end if;
  if old.ended_at is not null and new.ended_at is distinct from old.ended_at then
    raise exception 'assisted session exit is immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists experience_assisted_session_identity_immutable
  on public.experience_assisted_sessions;
create trigger experience_assisted_session_identity_immutable
before update on public.experience_assisted_sessions
for each row execute function public.protect_experience_assisted_session_identity();

alter table public.experience_assisted_sessions enable row level security;
alter table public.experience_assisted_sessions force row level security;
create policy experience_assisted_sessions_service
  on public.experience_assisted_sessions
  for all
  using (app_is_internal())
  with check (app_is_internal());

revoke all on public.experience_assisted_sessions
  from public, anon, authenticated, clockwork_runtime, clockwork_service;
grant select, insert, update on public.experience_assisted_sessions to clockwork_service;
