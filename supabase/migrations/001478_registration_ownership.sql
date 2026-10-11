-- Deal-registration ownership, before the `partner` switch is turned on.
--
-- 1. The guard runs on insert as well as update. A registration is created
--    `registered` (or `rejected`, when a prior deal refuses it); every other
--    status is a decision taken later through an update the guard sees. Its
--    partner, end client and workload are fixed once created.
-- 2. Ownership counts only what still owns the opportunity, and never the
--    same partner (renewals and expansions):
--      - an approved registration while its protection window is current;
--      - a disputed registration;
--      - a converted registration within the conversion lookback, which the
--        channel policy sets (`conversionLookbackDays`) and otherwise
--        defaults to the policy's maximum, then default, protection window.
-- 3. One active registration per partner, end client and workload, so the
--    same partner can register a different workload on the same client.
set lock_timeout = '5s';

-- The conversion lookback is an optional channel-policy term.
alter table public.core_channel_policy_versions
  add constraint channel_policy_conversion_lookback_check check (
    not (terms ? 'conversionLookbackDays')
    or (jsonb_typeof(terms->'conversionLookbackDays') = 'number'
      and terms->>'conversionLookbackDays' ~ '^[0-9]+$'
      and (terms->>'conversionLookbackDays')::integer between 1 and 3650)
  );

create or replace function public.core_current_channel_policy() returns jsonb language sql stable security definer
set search_path=pg_catalog,public as $$
 select coalesce((select jsonb_build_object('source','approved_policy','policyId',id::text,
  'version',(terms->>'version')::integer,'selfServeThresholdTb',(terms->>'selfServeThresholdTb')::numeric,
  'defaultProtectionDays',(terms->>'defaultProtectionDays')::integer,'maximumProtectionDays',(terms->>'maximumProtectionDays')::integer,
  'extensionDays',(terms->>'extensionDays')::integer,'maximumExtensions',(terms->>'maximumExtensions')::integer,
  'conversionLookbackDays',(terms->>'conversionLookbackDays')::integer)
  from public.core_channel_policy_versions where status='approved' and (terms->>'effectiveFrom')::date<=(now() at time zone 'UTC')::date
  order by terms->>'effectiveFrom' desc limit 1),
  '{"source":"legacy_defaults","policyId":null,"version":0,"selfServeThresholdTb":100,"defaultProtectionDays":90,"maximumProtectionDays":null,"extensionDays":null,"maximumExtensions":null,"conversionLookbackDays":null}'::jsonb)
$$;
revoke all on function public.core_current_channel_policy() from public;
grant execute on function public.core_current_channel_policy() to clockwork_runtime,clockwork_service;

-- The registration that already owns this end client and workload for another
-- partner, if any. One definition serves the guard below and the approval
-- command's own check.
create function public.core_registration_owner_conflict(
  candidate_id uuid,
  candidate_partner uuid,
  candidate_end_client uuid,
  candidate_workload text
) returns uuid
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare
  policy jsonb := public.core_current_channel_policy();
  lookback_days integer := coalesce(
    (policy->>'conversionLookbackDays')::integer,
    (policy->>'maximumProtectionDays')::integer,
    (policy->>'defaultProtectionDays')::integer,
    90);
  owner uuid;
begin
  select other.id into owner
  from public.deal_registrations other
  where other.id <> candidate_id
    and other.partner_account_id <> candidate_partner
    and other.end_client_account_id = candidate_end_client
    and lower(btrim(other.workload)) = lower(btrim(candidate_workload))
    and (
      other.status = 'disputed'
      or (other.status = 'approved' and other.protection_ends_at > now())
      or (other.status = 'converted'
        and coalesce(other.decided_at, other.updated_at) > now() - make_interval(days => lookback_days))
    )
  order by other.created_at
  limit 1;
  return owner;
end $$;
revoke all on function public.core_registration_owner_conflict(uuid, uuid, uuid, text) from public;
grant execute on function public.core_registration_owner_conflict(uuid, uuid, uuid, text)
  to clockwork_runtime, clockwork_service;

drop trigger deal_registration_ownership_guard on public.deal_registrations;
create or replace function public.guard_deal_registration_ownership() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if tg_op = 'INSERT' then
    if new.status not in ('registered', 'rejected') then
      raise exception using errcode = '23514', message = 'REGISTRATION_MUST_START_REGISTERED';
    end if;
    return new;
  end if;
  if new.partner_account_id is distinct from old.partner_account_id
    or new.end_client_account_id is distinct from old.end_client_account_id
    or new.workload is distinct from old.workload then
    raise exception using errcode = '23514', message = 'REGISTRATION_IDENTITY_IMMUTABLE';
  end if;
  if new.status is not distinct from old.status then
    return new;
  end if;
  if new.status = 'approved' then
    perform pg_advisory_xact_lock(hashtextextended(
      new.end_client_account_id::text || ':' || lower(btrim(new.workload)), 1468));
    if public.core_registration_owner_conflict(
      new.id, new.partner_account_id, new.end_client_account_id, new.workload) is not null then
      raise exception using errcode = '23514', message = 'REGISTRATION_ECONOMIC_OWNER_EXISTS';
    end if;
  elsif new.status = 'converted' then
    if old.status <> 'approved' then
      raise exception using errcode = '23514', message = 'REGISTRATION_CONVERT_REQUIRES_APPROVAL';
    end if;
    if new.converted_order_id is null or not exists (
      select 1 from public.orders order_record
      left join public.core_order_commercial_profiles profile on profile.order_id = order_record.id
      where order_record.id = new.converted_order_id
        and order_record.partner_account_id = new.partner_account_id
        and order_record.account_id = new.end_client_account_id
        and (profile.deal_registration_id is null or profile.deal_registration_id = new.id)
    ) then
      raise exception using errcode = '23514', message = 'REGISTRATION_CONVERT_ORDER_MISMATCH';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.guard_deal_registration_ownership() from public;
create trigger deal_registration_ownership_guard
  before insert or update on public.deal_registrations
  for each row execute function public.guard_deal_registration_ownership();

drop index public.deal_registration_active_unique;
create unique index deal_registration_active_unique
  on public.deal_registrations (partner_account_id, end_client_account_id, (lower(btrim(workload))))
  where status in ('registered', 'approved', 'disputed');

reset lock_timeout;
