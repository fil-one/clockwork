-- First-party recipient capabilities and durable mail. Browser/tenant roles
-- cannot read these tables. A capability is bound to one recipient and source;
-- correction rotates its nonce, and every route revalidates the source record.
set lock_timeout = '5s';
create table public.commerce_signing_recipients (
  id uuid primary key,
  kind text not null check (kind in ('mnda', 'contract')),
  request_id uuid not null,
  provider_id text not null,
  slot text not null,
  name text not null,
  email text not null,
  nonce uuid not null,
  title text not null,
  test_mode boolean not null,
  next_to_sign boolean not null default false,
  signed boolean not null default false,
  revoked boolean not null default false,
  provider_read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint commerce_signing_recipient_slot unique (provider_id, slot)
);
create index commerce_signing_recipient_request on public.commerce_signing_recipients(kind, request_id);
create table public.commerce_signing_mail (
  id uuid primary key,
  recipient_id uuid not null references public.commerce_signing_recipients(id),
  recipient_nonce uuid not null,
  purpose text not null check (purpose in ('invite', 'reminder', 'completed')),
  dedupe_key text not null unique,
  state text not null default 'pending' check (state in ('pending','sending','sent','skipped','failed')),
  attempts integer not null default 0 check (attempts between 0 and 6),
  available_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  provider_code text,
  created_at timestamptz not null default now(),
  check ((lease_token is null) = (lease_until is null))
);
create index commerce_signing_mail_due on public.commerce_signing_mail(state, available_at);
alter table public.commerce_signing_recipients enable row level security;
alter table public.commerce_signing_recipients force row level security;
alter table public.commerce_signing_mail enable row level security;
alter table public.commerce_signing_mail force row level security;
revoke all on public.commerce_signing_recipients, public.commerce_signing_mail from public, anon, authenticated, clockwork_runtime;
grant select, insert, update on public.commerce_signing_recipients, public.commerce_signing_mail to clockwork_service;
create policy signing_recipients_service on public.commerce_signing_recipients to clockwork_service using (true) with check (true);
create policy signing_mail_service on public.commerce_signing_mail to clockwork_service using (true) with check (true);
reset lock_timeout;
