-- Workflow controls are independently versioned from currency-specific pricing.
create table public.core_channel_policy_versions (
 id uuid primary key default public.uuid_v7(),
 row_version integer not null default 1 check(row_version>0),
 status text not null default 'draft' check(status in ('draft','proposed','approved')),
 terms jsonb not null,
 created_by uuid not null references public.commerce_users(id),
 last_edited_by uuid not null references public.commerce_users(id),
 proposed_by uuid references public.commerce_users(id),
 approved_by uuid references public.commerce_users(id),
 approval_evidence text,
 decision_reason text not null default '',
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint channel_policy_terms_check check (
  jsonb_typeof(terms)='object' and terms ?& array['version','effectiveFrom','selfServeThresholdTb','defaultProtectionDays','maximumProtectionDays','extensionDays','maximumExtensions','sourceEvidence']
  and jsonb_typeof(terms->'version')='number' and terms->>'version' ~ '^[0-9]+$'
  and jsonb_typeof(terms->'selfServeThresholdTb')='number'
  and jsonb_typeof(terms->'effectiveFrom')='string' and jsonb_typeof(terms->'sourceEvidence')='string'
  and jsonb_typeof(terms->'defaultProtectionDays')='number' and terms->>'defaultProtectionDays' ~ '^[0-9]+$'
  and jsonb_typeof(terms->'maximumProtectionDays')='number' and terms->>'maximumProtectionDays' ~ '^[0-9]+$'
  and jsonb_typeof(terms->'extensionDays')='number' and terms->>'extensionDays' ~ '^[0-9]+$'
  and jsonb_typeof(terms->'maximumExtensions')='number' and terms->>'maximumExtensions' ~ '^[0-9]+$'
  and (terms->>'version')::integer>0 and (terms->>'effectiveFrom') ~ '^\d{4}-\d{2}-\d{2}$'
  and (terms->>'effectiveFrom')::date is not null
  and (terms->>'selfServeThresholdTb')::numeric>0 and (terms->>'selfServeThresholdTb')::numeric<=1000000000
  and (terms->>'defaultProtectionDays')::integer between 1 and 730
  and (terms->>'maximumProtectionDays')::integer between (terms->>'defaultProtectionDays')::integer and 730
  and (terms->>'extensionDays')::integer between 1 and 730
  and (terms->>'maximumExtensions')::integer between 0 and 10
  and length(trim(terms->>'sourceEvidence'))>=8
 ),
 constraint channel_policy_approval_check check(status<>'approved' or (
  approved_by is not null and proposed_by is not null and approved_by<>created_by and approved_by<>last_edited_by
  and approved_by<>proposed_by and approval_evidence is not null and length(trim(approval_evidence))>=8
 ))
);
create unique index core_channel_policy_version_unique on public.core_channel_policy_versions(((terms->>'version')::integer));
create unique index core_channel_policy_effective_unique on public.core_channel_policy_versions((terms->>'effectiveFrom')) where status='approved';
alter table public.core_channel_policy_versions enable row level security;
alter table public.core_channel_policy_versions force row level security;
revoke all on public.core_channel_policy_versions from public,anon,authenticated,clockwork_runtime;
grant select,insert,update on public.core_channel_policy_versions to clockwork_service;
create policy core_channel_policy_service on public.core_channel_policy_versions for all to clockwork_service
 using(public.app_is_internal()) with check(public.app_is_internal());
create function public.guard_channel_policy_version() returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
 if tg_op='DELETE' then raise exception 'CHANNEL_POLICY_IMMUTABLE'; end if;
 if tg_op='INSERT' then
  if new.status<>'draft' or new.row_version<>1 or new.created_by<>new.last_edited_by or new.proposed_by is not null
   or new.approved_by is not null or new.approval_evidence is not null then raise exception 'CHANNEL_POLICY_MUST_START_DRAFT'; end if;
  return new;
 end if;
 if old.status='approved' then raise exception 'CHANNEL_POLICY_IMMUTABLE'; end if;
 if new.id is distinct from old.id or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then raise exception 'CHANNEL_POLICY_CREATOR_IMMUTABLE'; end if;
 if new.row_version<>old.row_version+1 then raise exception 'CHANNEL_POLICY_VERSION_CONFLICT'; end if;
 if not ((old.status='draft' and new.status in ('draft','proposed')) or (old.status='proposed' and new.status in ('draft','approved'))) then raise exception 'CHANNEL_POLICY_TRANSITION_INVALID'; end if;
 if new.status='proposed' and new.proposed_by is null then raise exception 'CHANNEL_POLICY_PROPOSER_REQUIRED'; end if;
 if old.status='proposed' and (new.terms is distinct from old.terms or new.last_edited_by is distinct from old.last_edited_by
   or (new.status='approved' and new.proposed_by is distinct from old.proposed_by)
   or (new.status='draft' and new.proposed_by is not null)) then raise exception 'CHANNEL_POLICY_PROPOSED_CONTENT_IMMUTABLE'; end if;
 if new.status='approved' and (new.terms->>'effectiveFrom')::date<(now() at time zone 'UTC')::date then raise exception 'CHANNEL_POLICY_BACKDATED_APPROVAL'; end if;
 return new;
end $$;
create trigger core_channel_policy_guard before insert or update or delete on public.core_channel_policy_versions
 for each row execute function public.guard_channel_policy_version();

-- Sanitized current controls are readable by the application without exposing
-- internal approval identities or evidence references to a tenant.
create function public.core_current_channel_policy() returns jsonb language sql stable security definer
set search_path=pg_catalog,public as $$
 select coalesce((select jsonb_build_object('source','approved_policy','policyId',id::text,
  'version',(terms->>'version')::integer,'selfServeThresholdTb',(terms->>'selfServeThresholdTb')::numeric,
  'defaultProtectionDays',(terms->>'defaultProtectionDays')::integer,'maximumProtectionDays',(terms->>'maximumProtectionDays')::integer,
  'extensionDays',(terms->>'extensionDays')::integer,'maximumExtensions',(terms->>'maximumExtensions')::integer)
  from public.core_channel_policy_versions where status='approved' and (terms->>'effectiveFrom')::date<=(now() at time zone 'UTC')::date
  order by terms->>'effectiveFrom' desc limit 1),
  '{"source":"legacy_defaults","policyId":null,"version":0,"selfServeThresholdTb":100,"defaultProtectionDays":90,"maximumProtectionDays":null,"extensionDays":null,"maximumExtensions":null}'::jsonb)
$$;
revoke all on function public.core_current_channel_policy() from public;
grant execute on function public.core_current_channel_policy() to clockwork_runtime,clockwork_service;

alter table public.deal_registrations add column channel_policy_snapshot jsonb;
alter table public.deal_registrations add column policy_extension_count integer not null default 0 check(policy_extension_count>=0);
alter table public.deal_registrations add column extension_reason text;
create function public.capture_registration_channel_policy() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare policy jsonb; initial_days numeric; extension_days numeric;
begin
 if tg_op='INSERT' then
  policy:=public.core_current_channel_policy();
  initial_days:=extract(epoch from new.protection_ends_at-new.protection_starts_at)/86400;
  if initial_days<=0 or initial_days<>trunc(initial_days) then raise exception 'REGISTRATION_PROTECTION_WHOLE_DAYS_REQUIRED'; end if;
  if policy->>'source'='approved_policy' and initial_days>(policy->>'maximumProtectionDays')::integer then raise exception 'REGISTRATION_POLICY_PROTECTION_MAXIMUM'; end if;
  -- Ignore caller-supplied policy, counter, or rationale. These are derived facts.
  new.channel_policy_snapshot:=policy||jsonb_build_object('initialProtectionDays',initial_days);
  new.policy_extension_count:=0;
  new.extension_reason:=null;
  return new;
 end if;
 if new.channel_policy_snapshot is distinct from old.channel_policy_snapshot or new.protection_starts_at is distinct from old.protection_starts_at then
  raise exception 'REGISTRATION_CHANNEL_POLICY_IMMUTABLE';
 end if;
 if old.channel_policy_snapshot->>'source'='approved_policy' then
  policy:=old.channel_policy_snapshot;
  if new.protection_ends_at is distinct from old.protection_ends_at then
   extension_days:=extract(epoch from new.protection_ends_at-old.protection_ends_at)/86400;
   if old.status not in ('registered','approved') or new.status<>old.status or extension_days<=0 or extension_days<>trunc(extension_days)
    or extension_days>(policy->>'extensionDays')::integer or old.policy_extension_count>=(policy->>'maximumExtensions')::integer
    or extract(epoch from new.protection_ends_at-old.protection_starts_at)/86400 >
       (policy->>'initialProtectionDays')::numeric+(policy->>'extensionDays')::integer*(policy->>'maximumExtensions')::integer
    or length(trim(coalesce(new.extension_reason,'')))<8 then raise exception 'REGISTRATION_POLICY_EXTENSION_LIMIT_OR_REASON'; end if;
   new.policy_extension_count:=old.policy_extension_count+1;
  elsif new.policy_extension_count is distinct from old.policy_extension_count or new.extension_reason is distinct from old.extension_reason then
   raise exception 'REGISTRATION_POLICY_EXTENSION_EVIDENCE_IMMUTABLE';
  end if;
 elsif new.policy_extension_count is distinct from old.policy_extension_count then
  raise exception 'REGISTRATION_POLICY_EXTENSION_EVIDENCE_IMMUTABLE';
 end if;
 return new;
end $$;
revoke all on function public.capture_registration_channel_policy() from public;
create trigger deal_registration_channel_policy before insert or update on public.deal_registrations
 for each row execute function public.capture_registration_channel_policy();
