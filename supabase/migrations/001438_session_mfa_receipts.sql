-- Session-bound receipts are written only after a live provider challenge succeeds.
-- The runtime role cannot mint assurance or reset the per-user attempt budget.
create table public.experience_mfa_attempts (
  workos_user_id text primary key,
  window_started_at timestamptz not null,
  attempts integer not null check (attempts between 1 and 5)
);
create table public.experience_mfa_receipts (
  challenge_id text primary key,
  session_id text not null,
  workos_user_id text not null,
  workos_organization_id text not null,
  factor_id text not null,
  verified_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '8 hours'),
  constraint experience_mfa_receipt_window_check check (
    expires_at > verified_at and expires_at <= verified_at + interval '8 hours'
  )
);
create index experience_mfa_receipt_session_idx on public.experience_mfa_receipts
  (session_id, workos_user_id, workos_organization_id, verified_at desc);
alter table public.experience_mfa_attempts enable row level security;
alter table public.experience_mfa_attempts force row level security;
alter table public.experience_mfa_receipts enable row level security;
alter table public.experience_mfa_receipts force row level security;
revoke all on public.experience_mfa_attempts, public.experience_mfa_receipts
  from public, anon, authenticated, clockwork_runtime, clockwork_service;
grant select, insert, update on public.experience_mfa_attempts to clockwork_service;
grant select, insert on public.experience_mfa_receipts to clockwork_service;
create policy experience_mfa_attempts_service on public.experience_mfa_attempts
  for all to clockwork_service using (true) with check (true);
create policy experience_mfa_receipts_service_read on public.experience_mfa_receipts
  for select to clockwork_service using (true);
create policy experience_mfa_receipts_service_insert on public.experience_mfa_receipts
  for insert to clockwork_service with check (true);
