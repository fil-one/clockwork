-- Personal access tokens: a staff member's credential for the Commerce MCP
-- endpoint at /api/mcp, used from Claude Code and other MCP clients.
--
-- A staff member creates a token on their own account page after a fresh MFA
-- verification, and sees the secret once. Only its SHA-256 hash is stored,
-- with a short display prefix. A token names its scope (`read` or
-- `read_write`) and expires within a year; it carries no roles or permissions
-- of its own. Every request resolves the person's current staff membership,
-- so a token always acts with what the person may do today.
--
-- A token is created after an MFA verification in the creating session and
-- records that verification's authenticator. It dies when its owner or a
-- commerce administrator revokes it, when the person's staff membership is
-- removed, and when the person next verifies MFA with a different
-- authenticator (their factor was reset). Should commerce ever record the
-- person as no longer MFA-enrolled, that revokes their tokens too. Each
-- revocation writes an `access_token.revoked` audit event. A revoked token
-- never comes back.
--
-- Staff reach the table through server code on the service role, which may
-- insert tokens and update only the usage, rate-limit, revocation and version
-- columns. Customer identities have no grants. Tokens are never deleted.
set lock_timeout = '5s';

create table if not exists public.commerce_access_tokens (
  id uuid primary key,
  user_id uuid not null references public.commerce_users(id),
  organization_id uuid not null references public.organizations(id),
  name text not null check (length(btrim(name)) between 1 and 100),
  scope text not null check (scope in ('read','read_write')),
  -- `fo_pat_` and the first four characters of the secret, so a person can
  -- tell their tokens apart. The rest of the secret is never stored.
  token_prefix text not null check (token_prefix ~ '^fo_pat_[A-Za-z0-9_-]{4}$'),
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  -- The authenticator verified when the token was created. Null only for a
  -- release-proof session, which has no provider factor.
  mfa_factor_id text
    check (mfa_factor_id is null or length(mfa_factor_id) between 1 and 200),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_used_at timestamptz,
  revoked_at timestamptz,
  revoked_by_id uuid,
  revoked_reason text
    check (revoked_reason in ('owner','admin','membership_removed','mfa_reset')),
  rate_window_started_at timestamptz,
  rate_window_count integer not null default 0 check (rate_window_count >= 0),
  version integer not null default 1 check (version >= 1),
  constraint commerce_access_tokens_expiry_check
    check (expires_at > created_at and expires_at <= created_at + interval '366 days'),
  constraint commerce_access_tokens_revoked_check
    check ((revoked_at is null) = (revoked_reason is null))
);

comment on table public.commerce_access_tokens is
  'Staff personal access tokens for the MCP endpoint. Only a SHA-256 hash of each secret is stored. Service role only; created and revoked with access_token.* audit events.';

create index if not exists commerce_access_tokens_user
  on public.commerce_access_tokens (user_id, created_at desc, id desc);

create index if not exists commerce_access_tokens_organization
  on public.commerce_access_tokens (organization_id, created_at desc, id desc);

-- What a token is never changes after it is created. Only use, the rate
-- window, the version and a single revocation move.
create or replace function public.guard_commerce_access_token() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.revoked_at is not null or new.version <> 1 then
      raise exception using errcode = 'P0001', message = 'ACCESS_TOKEN_MUST_START_ACTIVE';
    end if;
    return new;
  end if;
  if new.id <> old.id or new.user_id <> old.user_id
     or new.organization_id <> old.organization_id or new.name <> old.name
     or new.scope <> old.scope or new.token_prefix <> old.token_prefix
     or new.token_hash <> old.token_hash or new.created_at <> old.created_at
     or new.expires_at <> old.expires_at
     or new.mfa_factor_id is distinct from old.mfa_factor_id then
    raise exception using errcode = 'P0001', message = 'ACCESS_TOKEN_IMMUTABLE';
  end if;
  if old.revoked_at is not null and (
       new.revoked_at is distinct from old.revoked_at
       or new.revoked_reason is distinct from old.revoked_reason
       or new.revoked_by_id is distinct from old.revoked_by_id) then
    raise exception using errcode = 'P0001', message = 'ACCESS_TOKEN_REVOKED';
  end if;
  if new.version < old.version then
    raise exception using errcode = 'P0001', message = 'ACCESS_TOKEN_VERSION_MUST_ADVANCE';
  end if;
  return new;
end $$;

drop trigger if exists guard_commerce_access_token on public.commerce_access_tokens;

create trigger guard_commerce_access_token
  before insert or update on public.commerce_access_tokens
  for each row execute function public.guard_commerce_access_token();

alter table public.commerce_access_tokens enable row level security;

alter table public.commerce_access_tokens force row level security;

revoke all on public.commerce_access_tokens
  from public, anon, authenticated, clockwork_runtime, clockwork_service;

revoke all on function public.guard_commerce_access_token() from public;

grant select, insert on public.commerce_access_tokens to clockwork_service;

grant update (last_used_at, rate_window_started_at, rate_window_count,
  revoked_at, revoked_by_id, revoked_reason, version)
  on public.commerce_access_tokens to clockwork_service;

drop policy if exists access_tokens_service on public.commerce_access_tokens;

create policy access_tokens_service on public.commerce_access_tokens
  for all to clockwork_service using (true) with check (true);

-- Revokes a person's live tokens, optionally only in one organization or only
-- those not created under `current_factor_id`, with one audit event and
-- outbox message per token. Returns how many were revoked.
create or replace function public.revoke_commerce_access_tokens(
  target_user_id uuid,
  target_organization_id uuid,
  reason text,
  current_factor_id text,
  request text
) returns integer
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  token record;
  event_id uuid;
  event_actor jsonb := jsonb_build_object('kind', 'system', 'id', 'access-token-guard');
  event_after jsonb := jsonb_build_object('revokedReason', reason);
  revoked integer := 0;
begin
  for token in
    update public.commerce_access_tokens t
    set revoked_at = now(), revoked_reason = reason, version = t.version + 1
    where t.user_id = target_user_id
      and t.revoked_at is null
      and t.expires_at > now()
      and (target_organization_id is null or t.organization_id = target_organization_id)
      and (current_factor_id is null
           or t.mfa_factor_id is distinct from current_factor_id)
    returning t.id, t.version
  loop
    event_id := gen_random_uuid();
    insert into public.audit_events (
      id, account_id, aggregate_type, aggregate_id, aggregate_version,
      event_type, event_version, actor, occurred_at, request_id, before, after,
      metadata
    ) values (
      event_id, null, 'access_token', token.id, token.version,
      'access_token.revoked', 1, event_actor, now(), request, null, event_after,
      jsonb_build_object('source', reason)
    );
    insert into public.outbox_messages (id, event_id, topic, payload)
    values (gen_random_uuid(), event_id, 'access_token.revoked',
      jsonb_build_object(
        'eventId', event_id, 'eventType', 'access_token.revoked',
        'aggregateType', 'access_token', 'aggregateId', token.id,
        'aggregateVersion', token.version,
        'occurredAt', to_char(now() at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'requestId', request, 'actor', event_actor, 'data', event_after));
    revoked := revoked + 1;
  end loop;
  return revoked;
end $$;

revoke all on function public.revoke_commerce_access_tokens(uuid, uuid, text, text, text)
  from public, anon, authenticated, clockwork_runtime, clockwork_service;

-- A removed staff membership takes the person's tokens for that organization
-- with it; adding the person back later does not restore them.
create or replace function public.revoke_access_tokens_on_membership_delete() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  perform public.revoke_commerce_access_tokens(
    old.user_id, old.organization_id, 'membership_removed', null,
    'membership-removed:' || old.id::text);
  return old;
end $$;

revoke all on function public.revoke_access_tokens_on_membership_delete()
  from public, anon, authenticated, clockwork_runtime, clockwork_service;

drop trigger if exists revoke_access_tokens_on_membership_delete on public.memberships;

create trigger revoke_access_tokens_on_membership_delete
  after delete on public.memberships
  for each row execute function public.revoke_access_tokens_on_membership_delete();

-- A person no longer recorded as MFA-enrolled loses every token.
create or replace function public.revoke_access_tokens_on_mfa_unenrolled() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if old.mfa_enrolled and not new.mfa_enrolled then
    perform public.revoke_commerce_access_tokens(
      new.id, null, 'mfa_reset', null, 'mfa-unenrolled:' || new.id::text);
  end if;
  return new;
end $$;

revoke all on function public.revoke_access_tokens_on_mfa_unenrolled()
  from public, anon, authenticated, clockwork_runtime, clockwork_service;

drop trigger if exists revoke_access_tokens_on_mfa_unenrolled on public.commerce_users;

create trigger revoke_access_tokens_on_mfa_unenrolled
  after update of mfa_enrolled on public.commerce_users
  for each row execute function public.revoke_access_tokens_on_mfa_unenrolled();

-- An MFA verification with a different authenticator means the person's
-- factor was reset: tokens created under any other one, or under none, are
-- revoked.
create or replace function public.revoke_access_tokens_on_new_factor() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  person uuid;
begin
  select u.id into person from public.commerce_users u
  where u.workos_user_id = new.workos_user_id;
  if person is null then return new; end if;
  perform public.revoke_commerce_access_tokens(
    person, null, 'mfa_reset', new.factor_id,
    'mfa-factor-changed:' || new.challenge_id);
  return new;
end $$;

revoke all on function public.revoke_access_tokens_on_new_factor()
  from public, anon, authenticated, clockwork_runtime, clockwork_service;

drop trigger if exists revoke_access_tokens_on_new_factor on public.experience_mfa_receipts;

create trigger revoke_access_tokens_on_new_factor
  after insert on public.experience_mfa_receipts
  for each row execute function public.revoke_access_tokens_on_new_factor();

reset lock_timeout;
