-- Partner sellers share an account with partner administrators, but five
-- channels carry account-level money, renewal, brand, or environment truth.
-- Account scope alone therefore cannot authorize those projection reads.
drop policy if exists experience_projection_read
  on public.experience_portal_projections;

create policy experience_projection_read
on public.experience_portal_projections
for select to clockwork_runtime using (
  (
    audience = 'internal'
    and experience_session_is_internal()
    and (
      experience_session_assisted_account() is null
      or subject_account_id = experience_session_assisted_account()
    )
    and (
      (channel = 'approvals' and (
        experience_session_has_role('legal_approver')
        or experience_session_has_role('finance_approver')
        or experience_session_has_role('destructive_action_approver')
      ))
      or (channel <> 'approvals' and experience_session_has_role('internal_operator'))
    )
  )
  or (
    audience <> 'internal'
    and app_has_account(audience_account_id)
    and (
      audience <> 'partner'
      or channel not in ('billing', 'commissions', 'renewals', 'sandboxes', 'brand')
      or experience_session_has_role('partner_admin')
      or (
        experience_session_is_internal()
        and experience_session_assisted_account() = audience_account_id
      )
    )
  )
);
