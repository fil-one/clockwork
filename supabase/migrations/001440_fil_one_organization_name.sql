-- Correct the Fil One staff organization's display name in both deployments.
-- Scope by the existing identity-provider bindings, never by a partner's name.
update public.organizations
set name = 'Fil One LLC'
where workos_organization_id in (
  'org_01M21Q2N3ER4KWVJ30VRN8G0PV', -- staging
  'org_01M21RDQDM5NHYD4CEHWJZFG3J'  -- production
)
and lower(name) in ('filone llc', 'fil one llc');

update public.accounts a
set legal_name = 'Fil One LLC'
where lower(a.legal_name) in ('filone llc', 'fil one llc')
and exists (
  select 1 from public.organizations o
  where o.account_id = a.id
  and o.workos_organization_id in (
    'org_01M21Q2N3ER4KWVJ30VRN8G0PV',
    'org_01M21RDQDM5NHYD4CEHWJZFG3J'
  )
);
