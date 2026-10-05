-- Fil One's registered legal name is "FIL One LLC". Correct the staff
-- organization and its account in both deployments, scoped by the identity
-- provider bindings exactly as 001440 was.
update public.organizations
set name = 'FIL One LLC'
where workos_organization_id in (
  'org_01M21Q2N3ER4KWVJ30VRN8G0PV', -- staging
  'org_01M21RDQDM5NHYD4CEHWJZFG3J'  -- production
)
and lower(name) in ('filone llc', 'fil one llc');

update public.accounts a
set legal_name = 'FIL One LLC'
where lower(a.legal_name) in ('filone llc', 'fil one llc')
and exists (
  select 1 from public.organizations o
  where o.account_id = a.id
  and o.workos_organization_id in (
    'org_01M21Q2N3ER4KWVJ30VRN8G0PV',
    'org_01M21RDQDM5NHYD4CEHWJZFG3J'
  )
);
