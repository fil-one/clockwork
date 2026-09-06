-- Verified lifetime claims and conservative per-operation quota reservations.
create table public.core_trial_claims (
 id uuid primary key, account_id uuid not null references public.accounts(id),
 organization_id uuid not null unique references public.organizations(id),
 verified_domain text not null unique check (verified_domain = lower(verified_domain) and length(verified_domain)>2),
 offer_version_id uuid not null references public.core_payg_offer_versions(id),
 verification_evidence_id text not null check(length(trim(verification_evidence_id))>0),
 snapshot jsonb not null, created_at timestamptz not null default now()
);
create table public.core_trial_counter_receipts (
 id text primary key, trial_id uuid not null references public.core_trial_claims(id),
 payload jsonb not null, payload_hash text not null check(payload_hash ~ '^[a-f0-9]{64}$'), verification_evidence_id text not null check(length(trim(verification_evidence_id))>0),
 counters jsonb not null, measured_at timestamptz not null, recorded_at timestamptz not null default now(), check(measured_at<=recorded_at)
);
create index core_trial_counter_latest on public.core_trial_counter_receipts(trial_id,measured_at desc);
create table public.core_trial_reservations (
 id text primary key, trial_id uuid not null references public.core_trial_claims(id), operation jsonb not null,
 authorized_at timestamptz not null, counter_receipt_id text not null references public.core_trial_counter_receipts(id)
);
create index core_trial_reservations_trial on public.core_trial_reservations(trial_id);
create table public.core_trial_reservation_settlements (
 reservation_id text primary key references public.core_trial_reservations(id),
 receipt_id text not null references public.core_trial_counter_receipts(id), outcome text not null check(outcome in('completed','rejected')),
 actual_bytes text not null default '0' check(actual_bytes ~ '^(0|[1-9][0-9]*)$'), check(outcome<>'rejected' or actual_bytes='0')
);
create function private.guard_trial_claim() returns trigger language plpgsql set search_path=public,pg_temp as $$
declare org public.organizations; policy public.core_payg_offer_versions; evidence_id uuid; valid_evidence boolean := false;
begin
 if TG_OP='DELETE' then raise exception 'TRIAL_LIFETIME_CLAIM_IMMUTABLE'; end if;
 if TG_OP='UPDATE' then
  select * into org from public.organizations where id=new.organization_id for share;
  if org.account_id is distinct from new.account_id or org.external_provisioning_id is distinct from (new.snapshot->>'tenantId') then raise exception 'TRIAL_PAID_CONVERSION_NOT_CONFIRMED'; end if;
  if (to_jsonb(new)-'snapshot') is distinct from (to_jsonb(old)-'snapshot') or
   (new.snapshot-'convertedAt'-'paidEntitlementId'-'paidOrderId'-'conversionEvidenceId'-'paidPaygEnrollmentId') is distinct from
   (old.snapshot-'convertedAt'-'paidEntitlementId'-'paidOrderId'-'conversionEvidenceId'-'paidPaygEnrollmentId') or old.snapshot ? 'convertedAt' or not(new.snapshot ? 'convertedAt') then raise exception 'TRIAL_CLAIM_IMMUTABLE'; end if;
  if nullif(new.snapshot->>'convertedAt','') is null or (new.snapshot->>'convertedAt')::timestamptz < (old.snapshot->>'startsAt')::timestamptz or
   (new.snapshot ? 'paidOrderId') = (new.snapshot ? 'paidPaygEnrollmentId') or nullif(new.snapshot->>'paidEntitlementId','') is null or nullif(new.snapshot->>'conversionEvidenceId','') is null then raise exception 'TRIAL_PAID_BINDING_REQUIRED'; end if;
  if new.snapshot ? 'paidOrderId' then
   perform 1 from public.entitlements e join public.orders o on o.id=e.order_id where e.id::text=new.snapshot->>'paidEntitlementId' for share of e,o;
   if not exists(select 1 from public.entitlements e join public.orders o on o.id=e.order_id where e.id::text=new.snapshot->>'paidEntitlementId' and e.order_id::text=new.snapshot->>'paidOrderId' and e.organization_id=new.organization_id and e.status='active' and e.activated_at is not null and e.activated_at<=(new.snapshot->>'convertedAt')::timestamptz and e.provisioned_resource_id is not null and o.account_id=new.account_id and o.status='active' and new.snapshot->>'conversionEvidenceId'='entitlement:'||e.id::text||':'||e.row_version::text) then raise exception 'TRIAL_PAID_CONVERSION_NOT_CONFIRMED'; end if;
  else
   perform 1 from public.core_payg_enrollments e where e.id::text=new.snapshot->>'paidPaygEnrollmentId' for share;
   if not exists(select 1 from public.core_payg_enrollments e where e.id::text=new.snapshot->>'paidPaygEnrollmentId' and e.account_id=new.account_id and e.snapshot->'binding'->>'tenantId'=new.snapshot->>'tenantId' and e.snapshot->'binding'->>'entitlementId'=new.snapshot->>'paidEntitlementId' and e.binding_evidence_id=new.snapshot->>'conversionEvidenceId' and e.snapshot->>'billingAuthority'='clockwork' and nullif(e.snapshot->>'cutoverEvidenceId','') is not null and (e.snapshot->>'startsAt')::timestamptz<=(new.snapshot->>'convertedAt')::timestamptz and not(e.snapshot ? 'endsAt')) then raise exception 'TRIAL_PAID_CONVERSION_NOT_CONFIRMED'; end if;
  end if;
  return new;
 end if;
 select * into org from public.organizations where id=new.organization_id;
 select * into policy from public.core_payg_offer_versions where id=new.offer_version_id;
 if org.account_id is distinct from new.account_id or org.external_provisioning_id is null or not exists(select 1 from public.accounts a where a.id=new.account_id and a.screening_status='clear' and lower(a.domain)=new.verified_domain) or
  policy.status<>'approved' or policy.approval_evidence_id is null or (policy.terms->>'effectiveFrom')::date>(new.created_at at time zone 'UTC')::date or
  (new.snapshot->>'id') is distinct from new.id::text or (new.snapshot->>'organizationId') is distinct from org.id::text or
  (new.snapshot->>'tenantId') is distinct from org.external_provisioning_id or (new.snapshot->>'verifiedDomain') is distinct from new.verified_domain or
  (new.snapshot->>'domainVerificationEvidenceId') is distinct from new.verification_evidence_id or
  (new.snapshot->'policy') is distinct from ((policy.terms->'trial') || jsonb_build_object('id',policy.id,'version',policy.version,'approvalEvidenceId',policy.approval_evidence_id)) or
  (new.snapshot->>'startsAt')::timestamptz is distinct from new.created_at or (new.snapshot->>'expiresAt')::timestamptz is distinct from new.created_at + make_interval(days => (policy.terms->'trial'->>'durationDays')::integer) or
  new.snapshot ? 'convertedAt' then raise exception 'TRIAL_VERIFIED_CLAIM_REQUIRED'; end if;
 evidence_id := split_part(new.verification_evidence_id,':',2)::uuid;
 if split_part(new.verification_evidence_id,':',1)='registration' then
  select exists(select 1 from public.audit_events e where e.id=evidence_id and e.account_id=new.account_id and e.event_type='account.registered' and e.after->>'organizationId'=org.id::text and lower(e.after->>'verifiedDomain')=new.verified_domain and (e.after->>'domainVerifiedAt')::timestamptz<=new.created_at) into valid_evidence;
 elsif split_part(new.verification_evidence_id,':',1)='dns' then
  select exists(select 1 from public.lifecycle_partner_domains d where d.id=evidence_id and d.account_id=new.account_id and d.domain=new.verified_domain and d.verified_at<=new.created_at) into valid_evidence;
 end if;
 if valid_evidence is distinct from true then raise exception 'TRIAL_PERSISTED_DOMAIN_EVIDENCE_REQUIRED'; end if;
 return new;
end $$;
create trigger guard_trial_claim before insert or update or delete on public.core_trial_claims for each row execute function private.guard_trial_claim();
create function private.guard_trial_history() returns trigger language plpgsql set search_path=public,pg_temp as $$ begin raise exception 'TRIAL_HISTORY_IMMUTABLE'; end $$;
do $$ declare table_name text; begin
 foreach table_name in array array['core_trial_claims','core_trial_counter_receipts','core_trial_reservations','core_trial_reservation_settlements'] loop
  execute format('alter table public.%I enable row level security',table_name);
  execute format('alter table public.%I force row level security',table_name);
  execute format('revoke all on public.%I from public,anon,authenticated,clockwork_runtime',table_name);
  execute format('grant select,insert on public.%I to clockwork_service',table_name);
  execute format('create policy service_all on public.%I for all to clockwork_service using(public.app_is_internal()) with check(public.app_is_internal())',table_name);
  if table_name<>'core_trial_claims' then execute format('create trigger guard_trial_history before update or delete on public.%I for each row execute function private.guard_trial_history()',table_name); end if;
 end loop;
end $$;
grant update on public.core_trial_claims to clockwork_service;

create function private.guard_trial_boundary_insert() returns trigger language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare claim public.core_trial_claims; prior public.core_trial_counter_receipts; reservation public.core_trial_reservations; receipt public.core_trial_counter_receipts; stored numeric; egress numeric; delta numeric;
begin
 if TG_TABLE_NAME='core_trial_counter_receipts' then
  select * into claim from public.core_trial_claims where id=new.trial_id for update;
  if (new.counters->>'organizationId') is distinct from claim.organization_id::text or (new.counters->>'tenantId') is distinct from (claim.snapshot->>'tenantId') or
   (new.counters->>'measuredAt')::timestamptz is distinct from new.measured_at or
   coalesce(new.counters->>'storedBytes','') !~ '^(0|[1-9][0-9]*)$' or coalesce(new.counters->>'cumulativeEgressBytes','') !~ '^(0|[1-9][0-9]*)$' or
   new.payload->'counters' is distinct from new.counters or new.payload->>'trialId' is distinct from new.trial_id::text or
   jsonb_typeof(new.payload->'settlements') is distinct from 'array' or new.payload_hash is distinct from encode(extensions.digest(convert_to(private.canonical_jsonb_text(new.payload),'UTF8'),'sha256'),'hex') then raise exception 'TRIAL_COUNTER_SOURCE_INVALID'; end if;
  select * into prior from public.core_trial_counter_receipts where trial_id=new.trial_id order by measured_at desc limit 1;
  if found and (new.measured_at<=prior.measured_at or (new.counters->>'cumulativeEgressBytes')::numeric < (prior.counters->>'cumulativeEgressBytes')::numeric) then raise exception 'TRIAL_COUNTER_WATERMARK_REGRESSION'; end if;
 elsif TG_TABLE_NAME='core_trial_reservations' then
  select * into claim from public.core_trial_claims where id=new.trial_id for update;
  select * into receipt from public.core_trial_counter_receipts where id=new.counter_receipt_id;
  if exists(select 1 from public.accounts a where a.id=claim.account_id and a.screening_status='blocked') or not exists(select 1 from public.organizations o where o.id=claim.organization_id and o.account_id=claim.account_id and o.external_provisioning_id=claim.snapshot->>'tenantId') or receipt.trial_id is distinct from new.trial_id or coalesce(new.operation->>'kind','') not in('write','egress','api') or (claim.snapshot ? 'convertedAt') or
   new.authorized_at<receipt.recorded_at or new.authorized_at>=receipt.measured_at+make_interval(secs => (claim.snapshot->'policy'->>'maximumCounterAgeSeconds')::integer) or
   new.authorized_at<(claim.snapshot->>'startsAt')::timestamptz or new.authorized_at>=(claim.snapshot->>'expiresAt')::timestamptz+make_interval(days => (claim.snapshot->'policy'->>'gracePeriodDays')::integer) or
   (new.operation->>'kind'='write' and new.authorized_at>=(claim.snapshot->>'expiresAt')::timestamptz) or
   exists(select 1 from public.core_trial_counter_receipts later where later.trial_id=new.trial_id and later.measured_at>receipt.measured_at) then raise exception 'TRIAL_RESERVATION_SOURCE_INVALID'; end if;
  if (new.operation->>'kind'='write' and coalesce(new.operation->>'additionalBytes','') !~ '^(0|[1-9][0-9]*)$') or (new.operation->>'kind'='egress' and coalesce(new.operation->>'bytes','') !~ '^(0|[1-9][0-9]*)$') then raise exception 'TRIAL_OPERATION_INVALID'; end if;
  select coalesce(sum(case r.operation->>'kind' when 'write' then (r.operation->>'additionalBytes')::numeric else 0 end),0), coalesce(sum(case r.operation->>'kind' when 'egress' then (r.operation->>'bytes')::numeric else 0 end),0) into stored,egress from public.core_trial_reservations r left join public.core_trial_reservation_settlements s on s.reservation_id=r.id where r.trial_id=new.trial_id and s.reservation_id is null;
  stored := stored + (receipt.counters->>'storedBytes')::numeric; egress := egress + (receipt.counters->>'cumulativeEgressBytes')::numeric;
  delta := case new.operation->>'kind' when 'write' then (new.operation->>'additionalBytes')::numeric when 'egress' then (new.operation->>'bytes')::numeric else 0 end;
  if (claim.snapshot->'policy'->>'egressExhaustion'='disable_all' and egress>=(claim.snapshot->'policy'->>'cumulativeEgressLimitBytes')::numeric) or
   (new.operation->>'kind'='write' and (stored>=(claim.snapshot->'policy'->>'storageLimitBytes')::numeric or stored+delta>(claim.snapshot->'policy'->>'storageLimitBytes')::numeric)) or
   (new.operation->>'kind'='egress' and egress+delta>(claim.snapshot->'policy'->>'cumulativeEgressLimitBytes')::numeric) then raise exception 'TRIAL_QUOTA_EXHAUSTED'; end if;
 else
  select * into reservation from public.core_trial_reservations where id=new.reservation_id;
  select * into claim from public.core_trial_claims where id=reservation.trial_id for update;
  select * into receipt from public.core_trial_counter_receipts where id=new.receipt_id;
  if receipt.trial_id is distinct from reservation.trial_id or receipt.measured_at<reservation.authorized_at or
   not exists(select 1 from jsonb_array_elements(receipt.payload->'settlements') item where item->>'reservationId'=new.reservation_id and item->>'outcome'=new.outcome and item->>'actualBytes'=new.actual_bytes) or
   new.actual_bytes::numeric > (case reservation.operation->>'kind' when 'write' then (reservation.operation->>'additionalBytes')::numeric when 'egress' then (reservation.operation->>'bytes')::numeric else 0 end) then raise exception 'TRIAL_SETTLEMENT_BINDING_INVALID'; end if;
 end if;
 return new;
end $$;
create trigger trial_counter_source_guard before insert on public.core_trial_counter_receipts for each row execute function private.guard_trial_boundary_insert();
create trigger trial_reservation_source_guard before insert on public.core_trial_reservations for each row execute function private.guard_trial_boundary_insert();
create trigger trial_settlement_source_guard before insert on public.core_trial_reservation_settlements for each row execute function private.guard_trial_boundary_insert();
create function private.verify_trial_settlement_balance() returns trigger language plpgsql set search_path=public,pg_temp as $$
declare held_trial uuid; cumulative numeric; confirmed numeric; held_payload jsonb;
begin
 if TG_TABLE_NAME='core_trial_counter_receipts' then held_trial:=new.trial_id; held_payload:=new.payload;
 else select trial_id into held_trial from public.core_trial_reservations where id=new.reservation_id; end if;
 select (counters->>'cumulativeEgressBytes')::numeric into cumulative from public.core_trial_counter_receipts where trial_id=held_trial order by measured_at desc limit 1;
 select coalesce(sum(s.actual_bytes::numeric),0) into confirmed from public.core_trial_reservation_settlements s join public.core_trial_reservations r on r.id=s.reservation_id where r.trial_id=held_trial and r.operation->>'kind'='egress';
 if cumulative<confirmed then raise exception 'TRIAL_EGRESS_BELOW_CONFIRMED_OPERATIONS'; end if;
 if held_payload is not null and exists(select 1 from jsonb_array_elements(held_payload->'settlements') item where not exists(select 1 from public.core_trial_reservation_settlements s where s.reservation_id=item->>'reservationId' and s.outcome=item->>'outcome' and s.actual_bytes=item->>'actualBytes')) then raise exception 'TRIAL_RECEIPT_SETTLEMENTS_INCOMPLETE'; end if;
 return new;
end $$;
create constraint trigger trial_receipt_settlement_balance after insert on public.core_trial_counter_receipts deferrable initially deferred for each row execute function private.verify_trial_settlement_balance();
create constraint trigger trial_settlement_balance after insert on public.core_trial_reservation_settlements deferrable initially deferred for each row execute function private.verify_trial_settlement_balance();

revoke all on function private.guard_trial_boundary_insert() from public;
