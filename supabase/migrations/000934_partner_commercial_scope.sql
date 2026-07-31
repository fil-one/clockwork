-- Partner access to a named end client is relationship-derived, never supplied
-- by the request. Quote writes are additionally constrained to a currently
-- protected approved registration so raw table access cannot manufacture a
-- cross-tenant portfolio relationship.
create policy quotes_partner_registration_insert_guard
on public.quotes
as restrictive
for insert to clockwork_runtime
with check (
  app_is_internal()
  or app_has_account(account_id)
  or (
    partner_account_id is not null
    and end_client_account_id = account_id
    and app_has_account(partner_account_id)
    and exists (
      select 1
      from public.deal_registrations registration
      where registration.partner_account_id = quotes.partner_account_id
        and registration.end_client_account_id = quotes.account_id
        and registration.status = 'approved'
        and registration.protection_starts_at <= now()
        and registration.protection_ends_at > now()
    )
  )
);

create or replace function public.core_partner_can_access_account(candidate uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select app_is_internal() or exists (
    select 1
    from public.deal_registrations registration
    where registration.end_client_account_id = candidate
      and registration.status = 'approved'
      and app_has_account(registration.partner_account_id)
  ) or exists (
    select 1
    from public.quotes quote
    where quote.account_id = candidate
      and quote.partner_account_id is not null
      and app_has_account(quote.partner_account_id)
  )
$$;

create policy accounts_partner_portfolio_read
on public.accounts
for select to clockwork_runtime
using (core_partner_can_access_account(id));

create policy procurement_partner_portfolio_read
on public.procurement_profiles
for select to clockwork_runtime
using (core_partner_can_access_account(account_id));

create policy core_account_commercial_partner_portfolio_read
on public.core_account_commercial_profiles
for select to clockwork_runtime
using (core_partner_can_access_account(account_id));
