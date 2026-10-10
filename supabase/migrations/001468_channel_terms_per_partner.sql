-- Channel terms are set per partner. This migration removes two business
-- ceilings that were enforced as integrity, and keeps the integrity checks.
--
-- 1. Channel policy windows keep sanity bounds only. Deal-registration
--    protection and extension lengths were capped at 730 days and ten
--    extensions inside the constraint, below anything an approved policy could
--    choose. The approved policy version (two-person or reasoned
--    self-approval, immutable once approved) is the control; the constraint
--    now only rejects nonsense.
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
