create table if not exists public.experience_release_proof_sessions (
  id uuid primary key,
  user_id uuid not null references public.commerce_users(id),
  organization_id uuid not null references public.organizations(id),
  nonce_hash text not null check (nonce_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  mfa_verified boolean not null default false,
  recent_authentication_verified boolean not null default false,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint experience_release_proof_session_unique
    unique (id, user_id, organization_id)
);

create index if not exists experience_release_proof_session_expiry_idx
  on public.experience_release_proof_sessions (expires_at, revoked_at);

alter table public.experience_release_proof_sessions enable row level security;
alter table public.experience_release_proof_sessions force row level security;
create policy experience_release_proof_sessions_service
  on public.experience_release_proof_sessions
  for select
  using (app_is_internal());

revoke all on public.experience_release_proof_sessions
  from public, anon, authenticated, clockwork_runtime, clockwork_service;
grant select on public.experience_release_proof_sessions to clockwork_service;

-- Proof sessions are fixtures, never a production application mutation. Local
-- release setup connects as the test database owner to seed and revoke rows.
