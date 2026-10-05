-- Revenue and commerce administrator roles.
--
-- 1. Memberships may hold the two staff roles the application added:
--    `revenue` (sellers: MNDAs, contracts and sales references) and
--    `commerce_admin` (every internal permission, plus signatory and staff
--    management).
--
-- 2. A commerce administrator acts as every internal role. The application
--    expands the role where a session is built, so signed database claims
--    already carry internal_operator, finance_approver, legal_approver and
--    destructive_action_approver for an administrator, and every policy that
--    tests a claimed role (app_has_role, app_has_any_role,
--    experience_session_has_role) holds without change here. Two trigger
--    functions instead read the STORED membership of the approver of record,
--    so they are restated below with exactly one change each: the membership
--    test accepts commerce_admin wherever it accepted finance_approver. The
--    function bodies are otherwise copied verbatim from 001436 and 001430.
--    Two-person rules compare users, not roles, and are untouched.
--
-- 3. Fil One staff who operate the portal today become commerce
--    administrators. The scope is the Fil One staff organization in staging
--    and production, by its identity-provider binding exactly as 001440 does,
--    and only internal-staff users who currently hold internal_operator. On
--    4 October 2026 that is James Kurz and R.W. Holleman. A fresh or local
--    database has neither organization, so nothing changes there, and a second
--    run finds no internal_operator membership left to promote. Each change is
--    recorded in audit_events.

alter table public.memberships drop constraint memberships_role_check;
alter table public.memberships add constraint memberships_role_check check (role in (
  'owner','admin','billing','member','partner_admin','partner_seller','internal_operator',
  'finance_approver','legal_approver','destructive_action_approver',
  'revenue','commerce_admin'
));

create or replace function public.guard_customer_acquisition_request() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare
 offer public.core_payg_offer_versions%rowtype;
 org public.organizations%rowtype;
 trial public.core_trial_claims%rowtype;
 enrollment public.core_payg_enrollments%rowtype;
 command jsonb; notices jsonb; reference jsonb;
begin
 if tg_op='DELETE' then raise exception 'ACQUISITION_IMMUTABLE'; end if;
 if tg_op='INSERT' then
  select * into org from public.organizations where id=new.organization_id for share;
  if not found or org.account_id<>new.account_id or not exists(select 1 from public.memberships where organization_id=new.organization_id and user_id=new.requested_by and role in ('owner','admin')) then raise exception 'ACQUISITION_ACCOUNT_AUTHORITY_REQUIRED'; end if;
  select * into offer from public.core_payg_offer_versions where id=new.offer_version_id for share;
  if not found or new.status<>'pending' or new.row_version<>1 or new.resolved_by is not null or new.resolution_reason is not null then raise exception 'ACQUISITION_INVALID_INITIAL_STATE'; end if;
  command:=new.snapshot->'command'; notices:=offer.terms->'customerAcquisition';
  if new.snapshot->'terms' is distinct from offer.terms or command->>'id' is distinct from new.id::text or command->>'accountId' is distinct from new.account_id::text or command->>'organizationId' is distinct from new.organization_id::text or command->>'kind' is distinct from new.kind or new.snapshot#>>'{offer,id}' is distinct from offer.id::text or new.snapshot#>>'{offer,fingerprint}' is distinct from encode(extensions.digest(convert_to(private.canonical_jsonb_text(offer.terms),'UTF8'),'sha256'),'hex') then raise exception 'ACQUISITION_SNAPSHOT_MISMATCH'; end if;
  if new.snapshot->'offer' is distinct from jsonb_build_object('id',offer.id::text,'rowVersion',offer.row_version,'fingerprint',encode(extensions.digest(convert_to(private.canonical_jsonb_text(offer.terms),'UTF8'),'sha256'),'hex'),'name',offer.terms->>'name','sku',offer.terms->>'sku','region',offer.terms->>'region','version',offer.terms->'version','effectiveFrom',offer.terms->>'effectiveFrom','currency',offer.terms#>>'{payg,currency}','storageTbMonthMinor',offer.terms#>>'{payg,storageTbMonthMinor}','monthlyMinimumMinor',offer.terms#>>'{payg,monthlyMinimumMinor}','partialMonthMinimum',offer.terms#>>'{payg,partialMonthMinimum}','trial',offer.terms->'trial','notices',notices) then raise exception 'ACQUISITION_PUBLIC_OFFER_MISMATCH'; end if;
  if new.request_hash is distinct from encode(extensions.digest(convert_to(private.canonical_jsonb_text(jsonb_build_object('command',command,'userId',new.requested_by::text)),'UTF8'),'sha256'),'hex') then raise exception 'ACQUISITION_REQUEST_HASH_MISMATCH'; end if;
  if jsonb_typeof(notices) is distinct from 'object' or not (notices ?& array['serviceNotice','cancellationNotice','trialNotice','terms','retention']) or jsonb_typeof(notices->'serviceNotice') is distinct from 'string' or jsonb_typeof(notices->'cancellationNotice') is distinct from 'string' or jsonb_typeof(notices->'trialNotice') is distinct from 'string' or coalesce(length(trim(notices->>'serviceNotice')),0)<20 or coalesce(length(trim(notices->>'cancellationNotice')),0)<20 or coalesce(length(trim(notices->>'trialNotice')),0)<20 or notices#>>'{terms,sha256}' is null or notices#>>'{terms,sha256}' !~ '^[a-f0-9]{64}$' or notices#>>'{retention,sha256}' is null or notices#>>'{retention,sha256}' !~ '^[a-f0-9]{64}$' then raise exception 'ACQUISITION_CUSTOMER_NOTICES_REQUIRED'; end if;
  for reference in select value from jsonb_array_elements(jsonb_build_array(notices->'terms',notices->'retention')) loop
   if jsonb_typeof(reference) is distinct from 'object' or not (reference ?& array['documentId','version','uri','sha256']) or coalesce(length(trim(reference->>'documentId')),0)=0 or coalesce(length(trim(reference->>'version')),0)=0 or jsonb_typeof(reference->'uri') is distinct from 'string' or reference->>'uri' !~ '^https://[^/?#@]+(/[^?#]*)?$' then raise exception 'ACQUISITION_CUSTOMER_NOTICES_REQUIRED'; end if;
  end loop;
  if new.kind='cancel_payg' then
   select * into enrollment from public.core_payg_enrollments where id=new.enrollment_id for share;
   if not found or command->>'enrollmentId' is distinct from enrollment.id::text or enrollment.account_id<>new.account_id or enrollment.offer_version_id<>offer.id or enrollment.snapshot#>>'{binding,tenantId}' is distinct from org.external_provisioning_id or enrollment.snapshot->>'endsAt' is not null then raise exception 'ACQUISITION_ENROLLMENT_MISMATCH'; end if;
  else
   if offer.status<>'approved' or offer.approval_evidence_id is null or (offer.terms->>'effectiveFrom')::date>(new.created_at at time zone 'UTC')::date or command->>'offerVersionId' is distinct from offer.id::text or command->>'offerRowVersion' is distinct from offer.row_version::text or command->>'offerFingerprint' is distinct from new.snapshot#>>'{offer,fingerprint}' or command->'acceptedTerms' is distinct from 'true'::jsonb then raise exception 'ACQUISITION_APPROVED_ASSENT_REQUIRED'; end if;
   if (new.kind='trial' and notices->'trialRequestsEnabled' is distinct from 'true'::jsonb) or (new.kind<>'trial' and notices->'paygRequestsEnabled' is distinct from 'true'::jsonb) then raise exception 'ACQUISITION_KIND_UNAVAILABLE'; end if;
   if new.kind='convert_to_payg' then
    select * into trial from public.core_trial_claims where id=new.trial_id for share;
    if not found or trial.account_id<>new.account_id or trial.organization_id<>new.organization_id or trial.snapshot->>'convertedAt' is not null or command->>'trialId' is distinct from trial.id::text then raise exception 'ACQUISITION_TRIAL_MISMATCH'; end if;
   elsif new.trial_id is not null or new.enrollment_id is not null then raise exception 'ACQUISITION_INVALID_INITIAL_STATE'; end if;
  end if;
  return new;
 end if;
 if old.status<>'pending' or new.status not in ('fulfilled','declined') or new.row_version<>old.row_version+1 or new.id<>old.id or new.account_id<>old.account_id or new.organization_id<>old.organization_id or new.requested_by<>old.requested_by or new.kind<>old.kind or new.offer_version_id<>old.offer_version_id or new.request_hash<>old.request_hash or new.snapshot is distinct from old.snapshot or new.created_at<>old.created_at then raise exception 'ACQUISITION_IMMUTABLE'; end if;
 if not exists(select 1 from public.commerce_users u join public.memberships m on m.user_id=u.id where u.id=new.resolved_by and u.is_internal_staff and u.mfa_enrolled and m.role in ('finance_approver','commerce_admin')) then raise exception 'ACQUISITION_FINANCE_REQUIRED'; end if;
 if new.status='declined' then
  if new.trial_id is distinct from old.trial_id or new.enrollment_id is distinct from old.enrollment_id then raise exception 'ACQUISITION_DECLINE_CANNOT_BIND'; end if;
  return new;
 end if;
 select * into org from public.organizations where id=new.organization_id for share;
 if org.account_id is distinct from new.account_id or org.external_provisioning_id is null then raise exception 'ACQUISITION_VERIFIED_RESULT_REQUIRED'; end if;
 if new.kind='trial' then
  select * into trial from public.core_trial_claims where id=new.trial_id for share;
  if not found or trial.account_id<>new.account_id or trial.organization_id<>new.organization_id or trial.offer_version_id<>new.offer_version_id or (trial.snapshot->>'startsAt')::timestamptz<new.created_at or trial.snapshot->>'tenantId' is distinct from org.external_provisioning_id or new.enrollment_id is not null then raise exception 'ACQUISITION_VERIFIED_RESULT_REQUIRED'; end if;
 else
  select * into enrollment from public.core_payg_enrollments where id=new.enrollment_id for share;
  if not found or enrollment.account_id<>new.account_id or enrollment.offer_version_id<>new.offer_version_id or enrollment.snapshot#>>'{binding,tenantId}' is distinct from org.external_provisioning_id or enrollment.snapshot->>'billingAuthority' is distinct from 'clockwork' or nullif(enrollment.snapshot->>'cutoverEvidenceId','') is null or (enrollment.snapshot->>'startsAt')::timestamptz>new.updated_at then raise exception 'ACQUISITION_VERIFIED_RESULT_REQUIRED'; end if;
  if new.kind<>'cancel_payg' and (enrollment.snapshot->>'startsAt')::timestamptz<new.created_at then raise exception 'ACQUISITION_SERVICE_PREDATES_ASSENT'; end if;
  if new.kind='cancel_payg' then
   if new.enrollment_id is distinct from old.enrollment_id or enrollment.snapshot->>'endsAt' is null or (enrollment.snapshot->>'endsAt')::timestamptz>new.updated_at or enrollment.cancellation_evidence_id is null then raise exception 'ACQUISITION_CONFIRMED_CANCELLATION_REQUIRED'; end if;
  elsif enrollment.snapshot->>'endsAt' is not null then raise exception 'ACQUISITION_VERIFIED_RESULT_REQUIRED'; end if;
  if new.kind='convert_to_payg' then
   select * into trial from public.core_trial_claims where id=old.trial_id for share;
   if not found or new.trial_id is distinct from old.trial_id or trial.organization_id<>new.organization_id or trial.account_id<>new.account_id or trial.snapshot->>'paidPaygEnrollmentId' is distinct from enrollment.id::text or trial.snapshot->>'convertedAt' is null or (trial.snapshot->>'convertedAt')::timestamptz<new.created_at then raise exception 'ACQUISITION_CONFIRMED_CONVERSION_REQUIRED'; end if;
  elsif new.trial_id is not null then raise exception 'ACQUISITION_VERIFIED_RESULT_REQUIRED'; end if;
 end if;
 return new;
end $$;

create or replace function public.validate_payg_credit_source() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,private,extensions as $$
declare
  credit public.credit_notes%rowtype;
  invoice public.invoices%rowtype;
  invoice_source public.core_payg_invoice_sources%rowtype;
  effect public.core_payg_pending_invoice_effects%rowtype;
  revision public.core_payg_period_revisions%rowtype;
  prior_total bigint;
  prior_net bigint;
  prior_tax bigint;
  original_net bigint;
  expected_tax bigint;
  allocated_net bigint;
  expected_source jsonb;
begin
  select * into credit from public.credit_notes where id=new.credit_note_id;
  select * into invoice from public.invoices where id=new.invoice_id for update;
  select * into invoice_source from public.core_payg_invoice_sources where invoice_id=new.invoice_id;
  select * into effect from public.core_payg_pending_invoice_effects where idempotency_key=new.effect_key for update;
  select * into revision from public.core_payg_period_revisions rated where rated.enrollment_id=effect.enrollment_id
    and rated.month=effect.payload->>'month' and rated.revision=(effect.payload->>'revision')::integer;
  select (previous.snapshot#>>'{rating,total,minor}')::bigint into prior_total
    from public.core_payg_period_revisions previous where previous.enrollment_id=revision.enrollment_id
      and previous.month=revision.month and previous.revision=revision.revision-1;
  if credit.id is null or invoice.id is null or invoice.billing_source <> 'payg' or invoice_source.invoice_id is null
    or credit.invoice_id is distinct from new.invoice_id or credit.order_id is not null
    or credit.currency is distinct from invoice.currency or credit.amount_minor is distinct from new.amount_minor
    or effect.enrollment_id is distinct from invoice_source.enrollment_id
    or effect.payload->>'kind' is distinct from 'credit_adjustment'
    or effect.payload->>'idempotencyKey' is distinct from new.effect_key
    or effect.payload->>'accountId' is distinct from invoice.account_id::text
    or effect.payload#>>'{amount,currency}' is distinct from invoice.currency
    or effect.payload->>'month' is distinct from invoice_source.source_snapshot#>>'{effect,month}'
    or effect.payload->>'originalInvoiceKey' is distinct from invoice_source.source_snapshot#>>'{effect,originalInvoiceKey}'
    or revision.snapshot#>'{rating,policy}' is distinct from invoice_source.source_snapshot#>'{rating,policy}'
    or revision.snapshot#>'{rating,binding}' is distinct from invoice_source.source_snapshot#>'{rating,binding}'
    or effect.payload->>'ratingEvidenceHash' is distinct from revision.snapshot#>>'{rating,evidenceHash}'
    or prior_total is null or prior_total <= (revision.snapshot#>>'{rating,total,minor}')::bigint
    or (effect.payload#>>'{amount,minor}')::bigint is distinct from prior_total-(revision.snapshot#>>'{rating,total,minor}')::bigint
    or not exists (select 1 from public.commerce_users staff join public.memberships membership on membership.user_id=staff.id
      where staff.id=credit.approved_by and staff.is_internal_staff and staff.mfa_enrolled and membership.role in ('finance_approver','commerce_admin'))
  then raise exception using errcode='23514',message='PAYG credit must allocate its retained negative correction to an authorized invoice'; end if;
  select coalesce(sum(net_minor),0),coalesce(sum(tax_minor),0) into prior_net,prior_tax
    from public.core_payg_credit_sources where invoice_id=new.invoice_id;
  original_net := invoice.amount_minor-invoice.tax_minor;
  if original_net <= 0 or prior_net+new.net_minor > original_net then
    raise exception using errcode='23514',message='PAYG credit net exceeds the remaining invoiced net';
  end if;
  expected_tax := floor(((prior_net+new.net_minor)::numeric*invoice.tax_minor*2+original_net)/(original_net::numeric*2))::bigint-prior_tax;
  if expected_tax is distinct from new.tax_minor or prior_tax+new.tax_minor > invoice.tax_minor then
    raise exception using errcode='23514',message='PAYG credit tax must equal the cumulative share of its original invoice tax';
  end if;
  select coalesce(sum(net_minor),0) into allocated_net from public.core_payg_credit_sources where effect_key=new.effect_key;
  if allocated_net+new.net_minor > (effect.payload#>>'{amount,minor}')::bigint then
    raise exception using errcode='23514',message='PAYG credit allocation exceeds its correction effect';
  end if;
  expected_source := jsonb_build_object('effect',effect.payload,'invoiceSourceHash',invoice_source.source_hash,
    'netMinor',new.net_minor::text,'taxMinor',new.tax_minor::text,'amountMinor',new.amount_minor::text);
  if new.source_snapshot is distinct from expected_source or new.source_hash is distinct from
    encode(extensions.digest(convert_to(private.canonical_jsonb_text(expected_source),'UTF8'),'sha256'),'hex') then
    raise exception using errcode='23514',message='PAYG credit immutable source or canonical hash mismatch';
  end if;
  return new;
end $$;

with promoted as (
  update public.memberships membership
  set role = 'commerce_admin'
  from public.organizations staff_organization, public.commerce_users staff_user
  where membership.organization_id = staff_organization.id
    and membership.user_id = staff_user.id
    and staff_organization.workos_organization_id in (
      'org_01M21Q2N3ER4KWVJ30VRN8G0PV', -- staging
      'org_01M21RDQDM5NHYD4CEHWJZFG3J'  -- production
    )
    and staff_user.is_internal_staff
    and membership.role = 'internal_operator'
  returning membership.id, membership.row_version, membership.user_id,
    membership.organization_id
)
insert into public.audit_events (
  id, account_id, aggregate_type, aggregate_id, aggregate_version,
  event_type, event_version, actor, occurred_at, request_id, after, metadata
)
select gen_random_uuid(), null, 'membership', promoted.id, promoted.row_version,
       'staff.role_changed', 1,
       jsonb_build_object('kind', 'system', 'id', 'migration:001441_revenue_roles'),
       now(), 'migration:001441_revenue_roles',
       jsonb_build_object(
         'userId', promoted.user_id,
         'organizationId', promoted.organization_id,
         'previousRole', 'internal_operator',
         'role', 'commerce_admin'
       ),
       jsonb_build_object('migration', '001441_revenue_roles')
from promoted;
