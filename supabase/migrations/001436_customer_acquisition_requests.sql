-- Customer assent is retained separately from provider provisioning and billing cutover.
create table public.core_customer_acquisition_requests (
 id uuid primary key,
 account_id uuid not null references public.accounts(id),
 organization_id uuid not null references public.organizations(id),
 requested_by uuid not null references public.commerce_users(id),
 kind text not null check(kind in ('payg','trial','convert_to_payg','cancel_payg')),
 status text not null default 'pending' check(status in ('pending','fulfilled','declined')),
 offer_version_id uuid not null references public.core_payg_offer_versions(id),
 request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),
 snapshot jsonb not null check(jsonb_typeof(snapshot)='object'),
 trial_id uuid references public.core_trial_claims(id),
 enrollment_id uuid references public.core_payg_enrollments(id),
 resolved_by uuid references public.commerce_users(id),
 resolution_reason text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 row_version integer not null default 1 check(row_version>0),
 constraint acquisition_resolution_check check((status='pending' and resolved_by is null and resolution_reason is null) or (status<>'pending' and resolved_by is not null and resolution_reason is not null and length(trim(resolution_reason))>=8))
);
create unique index acquisition_pending_service_unique on public.core_customer_acquisition_requests(organization_id) where status='pending' and kind<>'cancel_payg';
create unique index acquisition_pending_cancel_unique on public.core_customer_acquisition_requests(enrollment_id) where status='pending' and kind='cancel_payg';
create index acquisition_account_created on public.core_customer_acquisition_requests(account_id,created_at desc);
alter table public.core_customer_acquisition_requests enable row level security;
alter table public.core_customer_acquisition_requests force row level security;
revoke all on public.core_customer_acquisition_requests from public,anon,authenticated,clockwork_runtime;
grant select on public.core_customer_acquisition_requests to clockwork_runtime;
grant select,insert,update on public.core_customer_acquisition_requests to clockwork_service;
create policy acquisition_service on public.core_customer_acquisition_requests for all to clockwork_service using(public.app_is_internal()) with check(public.app_is_internal());
create policy acquisition_account_read on public.core_customer_acquisition_requests for select to clockwork_runtime using(public.app_has_account(account_id) or public.app_is_internal());

create function public.guard_customer_acquisition_request() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
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
 if not exists(select 1 from public.commerce_users u join public.memberships m on m.user_id=u.id where u.id=new.resolved_by and u.is_internal_staff and u.mfa_enrolled and m.role='finance_approver') then raise exception 'ACQUISITION_FINANCE_REQUIRED'; end if;
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
create trigger guard_customer_acquisition_request before insert or update or delete on public.core_customer_acquisition_requests for each row execute function public.guard_customer_acquisition_request();

revoke all on function public.guard_customer_acquisition_request() from public,anon,authenticated,clockwork_runtime,clockwork_service;
