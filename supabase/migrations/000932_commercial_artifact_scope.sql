drop policy if exists core_commercial_artifact_insert
  on public.core_commercial_artifact_requests;

create policy core_commercial_artifact_insert
on public.core_commercial_artifact_requests
for insert to clockwork_runtime
with check (
  app_is_internal()
  or (
    subject_type in ('order','amendment')
    and document_kind in ('order_form','amendment')
    and app_has_account(audience_account_id)
  )
  or (
    subject_type = 'quote'
    and exists (
      select 1
      from public.quotes q
      where q.id = subject_id
        and q.account_id = commercial_account_id
        and (
          (
            document_kind = 'direct_quote'
            and audience = 'end_client'
            and audience_account_id = q.account_id
            and app_has_account(audience_account_id)
          )
          or (
            document_kind = 'partner_transfer_quote'
            and audience = 'partner'
            and q.partner_account_id is not null
            and audience_account_id = q.partner_account_id
            and app_has_account(audience_account_id)
          )
          or (
            document_kind = 'partner_resale_quote'
            and audience = 'end_client'
            and audience_account_id = q.account_id
            and commercial_account_id = q.account_id
            and (
              app_has_account(audience_account_id)
              or (
                q.partner_account_id is not null
                and app_has_account(q.partner_account_id)
              )
            )
          )
        )
    )
  )
);

grant insert on public.core_deal_registration_exclusions
  to clockwork_runtime;

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
