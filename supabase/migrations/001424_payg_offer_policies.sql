-- Draft and approved policy only. This migration enables no capability and
-- creates no paid offer, enrollment, provider mapping, or billing authority.
create table public.core_payg_offer_versions (
  id uuid primary key default public.uuid_v7(),
  sku text not null,
  region text not null,
  version integer not null,
  status text not null default 'draft',
  terms jsonb not null,
  created_by uuid not null references public.commerce_users(id),
  last_edited_by uuid not null references public.commerce_users(id),
  proposed_by uuid references public.commerce_users(id),
  approved_by uuid references public.commerce_users(id),
  approval_evidence_id text,
  decision_reason text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version integer not null default 1,
  constraint core_payg_offer_status_check check (status in ('draft','proposed','approved','retired')),
  constraint core_payg_offer_version_check check (version > 0 and row_version > 0),
  constraint core_payg_offer_approval_check check (status not in ('approved','retired') or
    (approved_by is not null and proposed_by is not null and approved_by <> proposed_by
      and approved_by <> created_by and approved_by <> last_edited_by and approval_evidence_id is not null and length(trim(approval_evidence_id)) > 0)),
  constraint core_payg_offer_terms_binding_check check (jsonb_typeof(terms) = 'object' and terms->>'sku' is not null and terms->>'region' is not null and terms->>'version' is not null and terms->>'sku' = sku and terms->>'region' = region and (terms->>'version')::integer = version)
);
create unique index core_payg_offer_version_unique on public.core_payg_offer_versions(sku, region, version);

alter table public.core_payg_offer_versions enable row level security;
alter table public.core_payg_offer_versions force row level security;
revoke all on public.core_payg_offer_versions from public, anon, authenticated, clockwork_runtime;
grant select, insert, update on public.core_payg_offer_versions to clockwork_service;
create policy core_payg_offer_service on public.core_payg_offer_versions
  for all to clockwork_service using (public.app_is_internal()) with check (public.app_is_internal());

create function public.guard_payg_offer_version() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' or new.row_version <> 1 or new.proposed_by is not null or
      new.approved_by is not null or new.approval_evidence_id is not null or new.created_by <> new.last_edited_by then
      raise exception 'PAYG_OFFER_MUST_START_AS_DRAFT';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then raise exception 'PAYG_OFFER_HISTORY_IMMUTABLE'; end if;
  if new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception 'PAYG_OFFER_CREATOR_IMMUTABLE';
  end if;
  if not ((old.status = 'draft' and new.status in ('draft','proposed')) or
    (old.status = 'proposed' and new.status in ('draft','approved')) or
    (old.status = 'approved' and new.status = 'retired')) then
    raise exception 'PAYG_OFFER_TRANSITION_INVALID';
  end if;
  if new.status = 'proposed' and new.proposed_by is null then raise exception 'PAYG_OFFER_PROPOSER_REQUIRED'; end if;
  if old.status in ('approved','retired') and
    (new.terms is distinct from old.terms or new.sku is distinct from old.sku or new.region is distinct from old.region
      or new.version is distinct from old.version or new.created_by is distinct from old.created_by
      or new.last_edited_by is distinct from old.last_edited_by or new.proposed_by is distinct from old.proposed_by
      or new.approved_by is distinct from old.approved_by or new.approval_evidence_id is distinct from old.approval_evidence_id
      or (old.status = 'retired' or new.status not in ('approved','retired'))) then
    raise exception 'PAYG_OFFER_APPROVED_VERSION_IMMUTABLE';
  end if;
  if old.status = 'proposed' and new.terms is distinct from old.terms then
    raise exception 'PAYG_OFFER_PROPOSED_TERMS_IMMUTABLE';
  end if;
  if old.status = 'proposed' and (new.last_edited_by is distinct from old.last_edited_by or
    (new.status = 'approved' and new.proposed_by is distinct from old.proposed_by) or
    (new.status = 'draft' and new.proposed_by is not null)) then
    raise exception 'PAYG_OFFER_PROPOSED_ATTRIBUTION_IMMUTABLE';
  end if;
  if new.row_version <> old.row_version + 1 then raise exception 'PAYG_OFFER_VERSION_CONFLICT'; end if;
  return new;
end;
$$;
create trigger core_payg_offer_version_guard before insert or update or delete on public.core_payg_offer_versions
  for each row execute function public.guard_payg_offer_version();
