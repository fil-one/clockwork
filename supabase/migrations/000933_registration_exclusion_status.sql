-- Align the derived deal-registration exclusion write contract with the
-- foundation state machine (detected -> confirmed/cleared). This forward
-- migration also corrects databases that applied the earlier policy draft.
drop policy if exists core_registration_exclusion_derived_insert
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
      and registration.status = 'rejected'
      and registration.end_client_account_id = core_deal_registration_exclusions.matched_account_id
      and app_has_account(registration.partner_account_id)
  )
);
