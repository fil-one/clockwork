-- A receipt from an old authenticator must not mint a new token after a
-- different authenticator has revoked the old one's tokens. Remember the
-- current factor and serialize receipt changes with token creation's lock.
set lock_timeout = '5s';

alter table public.commerce_users
  add column access_token_mfa_factor_id text;

comment on column public.commerce_users.access_token_mfa_factor_id is
  'Most recently verified MFA factor for personal access token creation. Updated by the MFA receipt trigger; null before any receipt.';

-- Receipt history is retained after expiry. It therefore also identifies
-- the factor behind existing long-lived tokens. Users with no receipt keep
-- null and must verify before creating a provider-backed token.
update public.commerce_users person
set access_token_mfa_factor_id = receipt.factor_id
from (
  select distinct on (workos_user_id) workos_user_id, factor_id
  from public.experience_mfa_receipts
  order by workos_user_id, verified_at desc, challenge_id desc
) receipt
where person.workos_user_id = receipt.workos_user_id;

create or replace function public.revoke_access_tokens_on_new_factor() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  person uuid;
begin
  select u.id into person from public.commerce_users u
  where u.workos_user_id = new.workos_user_id;
  if person is null then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('access_tokens:' || person::text, 0));
  update public.commerce_users
  set access_token_mfa_factor_id = new.factor_id
  where id = person;
  perform public.revoke_commerce_access_tokens(
    person, null, 'mfa_reset', new.factor_id,
    'mfa-factor-changed:' || new.challenge_id);
  return new;
end $$;

revoke all on function public.revoke_access_tokens_on_new_factor()
  from public, anon, authenticated, clockwork_runtime, clockwork_service;

-- Repair tokens minted through the old-session gap before this migration.
-- Keep users without receipt history unchanged; no factor can be inferred.
select public.revoke_commerce_access_tokens(
  id, null, 'mfa_reset', access_token_mfa_factor_id,
  'access-token-current-factor-migration:' || id::text)
from public.commerce_users
where access_token_mfa_factor_id is not null;

reset lock_timeout;
