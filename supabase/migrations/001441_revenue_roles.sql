-- Revenue and commerce administrator roles.
--
-- 1. Memberships may hold the two staff roles the application added:
--    `revenue` (sellers: MNDAs, contracts and sales references) and
--    `commerce_admin` (every internal permission, plus signatory and staff
--    management).
--
-- 2. A commerce administrator acts as every internal role. The application
--    expands the role where a session is built, so signed database claims
--    carry internal_operator, finance_approver, legal_approver and
--    destructive_action_approver for an administrator. Allow-list policies
--    (app_has_any_role, and the positive app_has_role and
--    experience_session_has_role tests) admit that composite claim unchanged.
--    The three restrictive policies that CONFINE a finance approver would also
--    confine the administrator's operator work, so two are restated below;
--    see "Restrictive policies keyed on finance_approver alone".
--    Two trigger functions read the STORED membership of the approver of
--    record, so they are restated with exactly one change each: the
--    membership test accepts commerce_admin wherever it accepted
--    finance_approver. Their bodies are otherwise copied verbatim from 001436
--    and 001430. Two-person rules compare users, not roles, and are untouched.
--
-- 3. A verified MFA receipt marks the user's authenticator as enrolled, so
--    the staff authority checks that require mfa_enrolled can pass for staff
--    who were not bootstrapped.
--
-- 4. James Kurz becomes the first commerce administrator. Everyone else keeps
--    their role until an administrator changes it on the Team page.

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

-- ---------------------------------------------------------------------------
-- Restrictive policies keyed on finance_approver alone.
-- ---------------------------------------------------------------------------
-- Three restrictive policies confine a finance approver on the tenant pool:
-- what audit rows it may read, and what audit rows it may append. They fire on
-- anyone whose claim CARRIES finance_approver, so a composite claim that also
-- carries internal_operator (an administrator, or a person given both roles)
-- lost operator rights the moment the finance role was added: the class of
-- defect 001401 documents for ['owner','finance_approver']. Measured before
-- this change: a report export audited by ['internal_operator'] on the tenant
-- pool was admitted and the same row under the administrator's expanded claim
-- was refused 42501.
--
-- Where the claim also carries internal_operator, the operator's rights
-- apply. Attribution does NOT relax: a finance holder still appends audit rows
-- only under its own user id, operator or not, because that conjunct is what
-- stops a forged four-eyes trail and every tenant-pool append in the tree is
-- already attributed to the acting user. A pure finance approver is confined
-- exactly as before.
--
-- `outbox_messages_finance_insert_guard` (001000) is attribution only (the
-- event it queues must be attributed to the caller), so it already holds for
-- operator work and is left as it is. Every other restrictive policy that
-- names a role is an allow-list (000900): more roles in a claim can only
-- satisfy it, never refuse it. The positive role tests in functions
-- (core_create_stripe_adjustment_operation, order acceptance) likewise only
-- admit.

drop policy if exists audit_events_finance_visibility_guard on public.audit_events;
create policy audit_events_finance_visibility_guard
on public.audit_events as restrictive for select to clockwork_runtime
using (
  not app_has_role('finance_approver')
  or app_has_role('internal_operator')
  or actor ->> 'id' = public.app_current_user_id()::text
  or (aggregate_type = 'credit_note' and exists (
    select 1 from public.credit_notes adjustment where adjustment.id = aggregate_id
  ))
  or (aggregate_type = 'refund' and exists (
    select 1 from public.refunds adjustment where adjustment.id = aggregate_id
  ))
  or (aggregate_type in ('dispute','dispute_case') and exists (
    select 1 from public.dispute_cases adjustment where adjustment.id = aggregate_id
  ))
  or (aggregate_type = 'collection_case' and exists (
    select 1 from public.core_collection_cases collection_case
    where collection_case.id = aggregate_id
      and collection_case.owner_user_id = public.app_current_user_id()
  ))
);

drop policy if exists audit_events_finance_insert_guard on public.audit_events;
create policy audit_events_finance_insert_guard
on public.audit_events as restrictive for insert to clockwork_runtime
with check (
  not app_has_role('finance_approver')
  or (
    -- Attribution stays unconditional for every finance holder (001401).
    actor ->> 'id' = public.app_current_user_id()::text
    and (
      app_has_account(account_id)
      -- An operator's appends are bounded by the permissive policies that
      -- admit them, as they are for an operator without the finance role.
      or app_has_role('internal_operator')
      or aggregate_type in (
        'invoice','credit_note','refund','dispute',
        'dispute_case','collection_case','collection_action'
      )
    )
  )
);

-- Revenue staff are internal staff, so their signed claims say
-- isInternalStaff = true. Internal status alone therefore does not mean
-- "operations staff"; a policy must test role names or permissions.
comment on function public.experience_session_is_internal() is
  'True for every internal staff claim, including the revenue role. Policies must test role names (experience_session_has_role) or permissions, never internal status alone.';

-- ---------------------------------------------------------------------------
-- Authenticator enrollment follows a verified challenge.
-- ---------------------------------------------------------------------------
-- `commerce_users.mfa_enrolled` gates the staff authority checks (capability,
-- catalog, provider reference, price book and finance decisions), but only
-- the bootstrap ever set it. A receipt in experience_mfa_receipts exists only
-- after WorkOS verified a live challenge against the user's own factor, which
-- is proof the factor is enrolled. Recording one marks the user enrolled once,
-- with an audit row and outbox message; later receipts change nothing. The
-- authority checks themselves are unchanged.
create function public.mark_mfa_enrolled(
  candidate_workos_user_id text,
  candidate_challenge_id text,
  candidate_verified_at timestamptz
) returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  enrolled public.commerce_users%rowtype;
  event_id uuid := gen_random_uuid();
  event_actor jsonb;
  event_after jsonb := jsonb_build_object('mfaEnrolled', true);
  event_request text := 'mfa-receipt:' || candidate_challenge_id;
begin
  update public.commerce_users
  set mfa_enrolled = true
  where workos_user_id = candidate_workos_user_id and not mfa_enrolled
  returning * into enrolled;
  if not found then return; end if;
  event_actor := jsonb_build_object('kind', 'user', 'id', enrolled.id::text);
  insert into public.audit_events (
    id, account_id, aggregate_type, aggregate_id, aggregate_version,
    event_type, event_version, actor, occurred_at, request_id, before, after,
    metadata
  ) values (
    event_id, null, 'commerce_user', enrolled.id, enrolled.row_version,
    'identity.mfa_enrolled', 1, event_actor, candidate_verified_at,
    event_request, jsonb_build_object('mfaEnrolled', false), event_after,
    jsonb_build_object('source', 'mfa_receipt')
  );
  insert into public.outbox_messages (id, event_id, topic, payload)
  values (gen_random_uuid(), event_id, 'identity.mfa_enrolled',
    jsonb_build_object(
      'eventId', event_id, 'eventType', 'identity.mfa_enrolled',
      'aggregateType', 'commerce_user', 'aggregateId', enrolled.id,
      'aggregateVersion', enrolled.row_version,
      'occurredAt', to_char(candidate_verified_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'requestId', event_request, 'actor', event_actor,
      'data', event_after));
end $$;
revoke all on function public.mark_mfa_enrolled(text, text, timestamptz)
  from public, anon, authenticated, clockwork_runtime, clockwork_service;

create function public.record_mfa_enrollment() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  perform public.mark_mfa_enrolled(
    new.workos_user_id, new.challenge_id, new.verified_at);
  return new;
end $$;
revoke all on function public.record_mfa_enrollment()
  from public, anon, authenticated, clockwork_runtime, clockwork_service;
create trigger record_mfa_enrollment
after insert on public.experience_mfa_receipts
for each row execute function public.record_mfa_enrollment();

-- Users who verified a challenge before this migration: their earliest
-- receipt goes through the same function, so the backfill writes the same
-- audit trail a new receipt would.
select public.mark_mfa_enrolled(
  first_receipt.workos_user_id, first_receipt.challenge_id,
  first_receipt.verified_at)
from (
  select distinct on (receipt.workos_user_id) receipt.*
  from public.experience_mfa_receipts receipt
  order by receipt.workos_user_id, receipt.verified_at
) first_receipt;

-- ---------------------------------------------------------------------------
-- The first commerce administrator.
-- ---------------------------------------------------------------------------
-- Exactly one person is promoted here: James Kurz (james@fil.one), and only
-- while he is internal staff holding internal_operator in the Fil One staff
-- organization of staging or production, identified by its identity-provider
-- binding exactly as 001440 does. Every other staff member keeps their role;
-- James promotes R.W. Holleman and anyone else on the Team page after deploy,
-- where the change is made by a named person and audited as theirs. A fresh
-- or local database has neither organization and changes nothing, and a
-- second run finds no internal_operator membership left to promote. The audit
-- row and outbox message match the Team page's `staff.role_changed`.
--
-- A function rather than a bare statement, so pgTAP can run the exact
-- promotion against a staff-organization fixture.
create function private.promote_first_commerce_admin() returns integer
language plpgsql security definer set search_path = pg_catalog, public as $fn$
declare promoted_count integer;
begin
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
      and lower(staff_user.email) = 'james@fil.one'
      and staff_user.is_internal_staff
      and membership.role = 'internal_operator'
    returning membership.id, membership.row_version, staff_user.email
  ),
  events as (
    insert into public.audit_events (
      id, account_id, aggregate_type, aggregate_id, aggregate_version,
      event_type, event_version, actor, occurred_at, request_id, before, after,
      metadata
    )
    select gen_random_uuid(), null, 'membership', promoted.id,
           promoted.row_version, 'staff.role_changed', 1,
           jsonb_build_object('kind', 'system', 'id', 'migration:001441_revenue_roles'),
           now(), 'migration:001441_revenue_roles',
           jsonb_build_object('email', promoted.email, 'role', 'internal_operator'),
           jsonb_build_object('email', promoted.email, 'role', 'commerce_admin'),
           jsonb_build_object('migration', '001441_revenue_roles')
    from promoted
    returning id, aggregate_id, aggregate_version, actor, occurred_at,
      request_id, after
  )
  insert into public.outbox_messages (id, event_id, topic, payload)
  select gen_random_uuid(), events.id, 'staff.role_changed',
         jsonb_build_object(
           'eventId', events.id, 'eventType', 'staff.role_changed',
           'aggregateType', 'membership', 'aggregateId', events.aggregate_id,
           'aggregateVersion', events.aggregate_version,
           'occurredAt', to_char(events.occurred_at at time zone 'UTC',
             'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'requestId', events.request_id, 'actor', events.actor,
           'data', events.after)
  from events;
  get diagnostics promoted_count = row_count;
  return promoted_count;
end $fn$;
revoke all on function private.promote_first_commerce_admin()
  from public, anon, authenticated, clockwork_runtime, clockwork_service;

select private.promote_first_commerce_admin();
