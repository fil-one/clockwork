-- Channel terms are set per partner. This migration removes two business
-- ceilings that were enforced as integrity, and keeps the integrity checks.
--
-- 1. Channel policy windows keep sanity bounds only. Deal-registration
--    protection and extension lengths were capped at 730 days and ten
--    extensions inside the constraint. The approved policy version (two-person
--    or reasoned self-approval, immutable once approved) is the control; the
--    constraint now only bounds the most a registration could ever be
--    protected: initial maximum plus every extension, at most ten years.
alter table public.core_channel_policy_versions
  drop constraint channel_policy_terms_check;
alter table public.core_channel_policy_versions
  add constraint channel_policy_terms_check check (
  jsonb_typeof(terms)='object' and terms ?& array['version','effectiveFrom','selfServeThresholdTb','defaultProtectionDays','maximumProtectionDays','extensionDays','maximumExtensions','sourceEvidence']
  and jsonb_typeof(terms->'version')='number' and terms->>'version' ~ '^[0-9]+$'
  and jsonb_typeof(terms->'selfServeThresholdTb')='number'
  and jsonb_typeof(terms->'effectiveFrom')='string' and jsonb_typeof(terms->'sourceEvidence')='string'
  and jsonb_typeof(terms->'defaultProtectionDays')='number' and terms->>'defaultProtectionDays' ~ '^[0-9]+$'
  and jsonb_typeof(terms->'maximumProtectionDays')='number' and terms->>'maximumProtectionDays' ~ '^[0-9]+$'
  and jsonb_typeof(terms->'extensionDays')='number' and terms->>'extensionDays' ~ '^[0-9]+$'
  and jsonb_typeof(terms->'maximumExtensions')='number' and terms->>'maximumExtensions' ~ '^[0-9]+$'
  and (terms->>'version')::integer>0 and (terms->>'effectiveFrom') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  and (terms->>'effectiveFrom')::date is not null
  and (terms->>'selfServeThresholdTb')::numeric>0 and (terms->>'selfServeThresholdTb')::numeric<=1000000000
  and (terms->>'defaultProtectionDays')::integer between 1 and 3650
  and (terms->>'maximumProtectionDays')::integer between (terms->>'defaultProtectionDays')::integer and 3650
  and (terms->>'extensionDays')::integer between 1 and 3650
  and (terms->>'maximumExtensions')::integer between 0 and 100
  and (terms->>'maximumProtectionDays')::integer
    + (terms->>'extensionDays')::integer * (terms->>'maximumExtensions')::integer <= 3650
  and length(trim(terms->>'sourceEvidence'))>=8
 );

-- 2. A house-account match no longer refuses a registration. The registration
--    stays open for channel ops to approve or reject, and the match is still
--    written as derived, unresolved evidence. A prior active deal on the same
--    workload (one economic owner) is still refused, so its evidence still
--    requires a rejected registration.
drop policy core_registration_exclusion_derived_insert
  on public.core_deal_registration_exclusions;
create policy core_registration_exclusion_derived_insert
on public.core_deal_registration_exclusions
for insert to clockwork_runtime
with check (
  status = 'detected'
  and kind in ('house_account','prior_deal')
  and resolved_by is null
  and resolved_at is null
  and evidence ->> 'source' = 'unified_account_and_active_deal_records'
  and exists (
    select 1
    from public.deal_registrations registration
    where registration.id = core_deal_registration_exclusions.registration_id
      and registration.status = case core_deal_registration_exclusions.kind
        when 'prior_deal' then 'rejected' else 'registered' end
      and registration.end_client_account_id = core_deal_registration_exclusions.matched_account_id
      and app_has_account(registration.partner_account_id)
  )
);

-- 3. Channel ops decides a house-account match with the registration. Staff
--    commands run on the tenant pool, where only the service role may update
--    exclusion evidence, so this narrow function resolves the match in the
--    decision's own transaction: an approved registration clears it and needs
--    an override reason, a rejected one confirms it. The deciding staff user
--    comes from the signed authorization context, never from an argument.
create function public.core_resolve_house_account_match(
  target_registration_id uuid,
  override_reason text
) returns integer
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  claims jsonb := public.app_context_claims();
  registration public.deal_registrations%rowtype;
  next_status text;
  resolved integer;
begin
  if coalesce((claims->>'isInternalStaff')::boolean, false) is not true
    or claims->>'userId' is null
    or not public.app_has_permission('quote:approve') then
    raise exception using errcode = '42501', message = 'HOUSE_ACCOUNT_DECISION_STAFF_ONLY';
  end if;
  select * into registration from public.deal_registrations
  where id = target_registration_id;
  if registration.id is null or not public.app_has_account(registration.partner_account_id) then
    raise exception using errcode = '42501', message = 'HOUSE_ACCOUNT_REGISTRATION_NOT_VISIBLE';
  end if;
  if registration.status = 'approved' then
    if length(trim(coalesce(override_reason, ''))) not between 8 and 500 then
      raise exception using errcode = '23514', message = 'HOUSE_ACCOUNT_OVERRIDE_REASON_REQUIRED';
    end if;
    next_status := 'cleared';
  elsif registration.status = 'rejected' then
    next_status := 'confirmed';
  else
    raise exception using errcode = '23514', message = 'HOUSE_ACCOUNT_DECISION_REQUIRES_DECIDED_REGISTRATION';
  end if;
  update public.core_deal_registration_exclusions exclusion
  set status = next_status,
      resolved_by = (claims->>'userId')::uuid,
      resolved_at = now(),
      updated_at = now(),
      evidence = exclusion.evidence || jsonb_build_object('decision',
        jsonb_build_object('status', next_status, 'decidedBy', claims->>'userId', 'decidedAt', now())
        || case when next_status = 'cleared'
             then jsonb_build_object('overrideReason', trim(override_reason))
             else '{}'::jsonb end)
  where exclusion.registration_id = registration.id
    and exclusion.kind = 'house_account'
    and exclusion.status = 'detected';
  get diagnostics resolved = row_count;
  return resolved;
end $$;
revoke all on function public.core_resolve_house_account_match(uuid, text) from public;
grant execute on function public.core_resolve_house_account_match(uuid, text)
  to clockwork_runtime, clockwork_service;

-- 4. One economic owner per end client and workload, and conversion only from
--    an approval. A house-account match no longer refuses a registration, so
--    two partners can hold open registrations on one client; the approval is
--    where ownership is decided. Approving is refused while another
--    registration on the same client and workload is approved, converted or
--    disputed (serialized per client and workload). Converting requires an
--    approved registration and an order for the same partner and end client
--    that names no other registration.
create function public.guard_deal_registration_ownership() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  if new.status = 'approved' then
    perform pg_advisory_xact_lock(hashtextextended(
      new.end_client_account_id::text || ':' || lower(btrim(new.workload)), 1468));
    if exists (
      select 1 from public.deal_registrations other
      where other.id <> new.id
        and other.end_client_account_id = new.end_client_account_id
        and lower(btrim(other.workload)) = lower(btrim(new.workload))
        and other.status in ('approved', 'converted', 'disputed')
    ) then
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
  before update of status on public.deal_registrations
  for each row execute function public.guard_deal_registration_ownership();
