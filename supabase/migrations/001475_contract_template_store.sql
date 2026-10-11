-- Contract templates kept as versioned data, managed by commerce
-- administrators in Commerce instead of committed to the repository.
--
-- Each row is one version of one template (template_key). A version starts
-- as a draft that can be edited and discarded. Activating it records who
-- activated it and when, freezes its content, and retires the version that
-- was in use, so each template has at most one active version. A retired
-- version can be activated again. Content is the template JSON the app
-- validates (fields, optional sections, derived figures and the document),
-- with the SHA-256 the app computes over it.
--
-- A prepared contract pins the exact version: its signing request keeps the
-- template key, the version label ('v' || version) and the content hash, and
-- a request for a stored template can only be created against the active
-- version with that hash. A version a contract was prepared from can never
-- change, whatever its status. Edits after activation are a new version.
--
-- Staff reach the table through server code that checks
-- `contract_template:manage` for administration and `contract:write` for
-- preparation (ADR 0011). Every change is audited in audit_events.
set lock_timeout = '5s';

create table if not exists public.commerce_contract_templates (
  id uuid primary key,
  template_key text not null check (template_key ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  version integer not null check (version between 1 and 9999),
  name text not null check (length(btrim(name)) between 1 and 120),
  contract_type text not null check (contract_type in
    ('mnda','nda_one_way','customer_msa','order_form','dpa','security_annex',
     'channel_partnership','technology_partner','sow','other')),
  requires_approval boolean not null,
  fields jsonb not null check (jsonb_typeof(fields) = 'array'),
  sections jsonb not null default '[]'::jsonb check (jsonb_typeof(sections) = 'array'),
  derived jsonb not null default '[]'::jsonb check (jsonb_typeof(derived) = 'array'),
  document jsonb not null check (jsonb_typeof(document) = 'object'),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  source_note text not null default '' check (length(source_note) <= 200),
  status text not null default 'draft' check (status in ('draft','active','retired')),
  created_by_id uuid not null,
  created_by_name text not null check (length(btrim(created_by_name)) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  activated_by_id uuid,
  activated_by_name text,
  activated_at timestamptz,
  retired_by_name text,
  retired_at timestamptz,
  -- Optimistic concurrency for edits and status changes.
  revision integer not null default 1 check (revision >= 1),
  unique (template_key, version),
  check ((activated_by_id is null) = (activated_at is null)
     and (activated_by_id is null) = (activated_by_name is null)),
  check (status = 'draft' or activated_at is not null),
  check ((status = 'retired') = (retired_at is not null))
);

comment on table public.commerce_contract_templates is
  'Versioned contract templates. Content is frozen once a version is activated; a version used to prepare a contract never changes.';

create unique index if not exists commerce_contract_templates_one_active
  on public.commerce_contract_templates (template_key) where status = 'active';

create index if not exists commerce_contract_templates_listing
  on public.commerce_contract_templates (template_key, version desc);

/* Content is editable only while a version is a draft that no contract
   used. Activation is recorded once per activation; retiring and
   re-activating change only the status columns. Nothing returns to draft. */
create or replace function public.protect_commerce_contract_template() returns trigger
language plpgsql set search_path = public as $$
declare
  used boolean;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' or new.activated_at is not null or new.retired_at is not null then
      raise exception 'A contract template version starts as a draft';
    end if;
    return new;
  end if;
  -- Used by a current signing request, or by one a later request replaced
  -- (kept in commerce_contract_signing_history, 001465).
  used := exists (
    select 1 from public.commerce_contract_signing s
    where s.template_id = old.template_key and s.template_version = 'v' || old.version)
    or exists (
    select 1 from public.commerce_contract_signing_history h
    where h.request->>'template_id' = old.template_key
      and h.request->>'template_version' = 'v' || old.version);
  if tg_op = 'DELETE' then
    if old.status <> 'draft' or used then
      raise exception 'Only an unused draft contract template can be discarded';
    end if;
    return old;
  end if;
  if new.id <> old.id or new.template_key <> old.template_key or new.version <> old.version
     or new.created_by_id <> old.created_by_id or new.created_by_name <> old.created_by_name
     or new.created_at <> old.created_at then
    raise exception 'Contract template identity is immutable';
  end if;
  if new.revision <> old.revision + 1 then
    raise exception 'Contract template revision must advance by one';
  end if;
  if (old.status <> 'draft' or used) and (
       new.name <> old.name or new.contract_type <> old.contract_type
       or new.requires_approval <> old.requires_approval or new.fields <> old.fields
       or new.sections <> old.sections or new.derived <> old.derived
       or new.document <> old.document or new.content_hash <> old.content_hash
       or new.source_note <> old.source_note) then
    raise exception 'An activated or used contract template version cannot change; create a new version';
  end if;
  if old.status <> 'draft' and new.status = 'draft' then
    raise exception 'A contract template version never returns to draft';
  end if;
  -- Who activated or retired a version, and when, is written once per
  -- transition and never rewritten.
  if new.status = old.status and (
       new.activated_at is distinct from old.activated_at
       or new.activated_by_id is distinct from old.activated_by_id
       or new.activated_by_name is distinct from old.activated_by_name
       or new.retired_at is distinct from old.retired_at
       or new.retired_by_name is distinct from old.retired_by_name) then
    raise exception 'Contract template activation and retirement records are fixed';
  end if;
  if new.status = 'active' and old.status <> 'active' and (
       new.activated_at is not distinct from old.activated_at or new.activated_by_id is null
       or new.activated_by_name is null) then
    raise exception 'Activating a contract template version records who activated it';
  end if;
  if new.status <> 'active' and (new.activated_at is distinct from old.activated_at
       or new.activated_by_id is distinct from old.activated_by_id
       or new.activated_by_name is distinct from old.activated_by_name) then
    raise exception 'Contract template activation is recorded only when a version is activated';
  end if;
  if new.status = 'active' then
    new.retired_at := null;
    new.retired_by_name := null;
  end if;
  return new;
end $$;

drop trigger if exists protect_commerce_contract_template on public.commerce_contract_templates;

create trigger protect_commerce_contract_template
  before insert or update or delete on public.commerce_contract_templates
  for each row execute function public.protect_commerce_contract_template();

/* A contract's first signing request for a stored template names the active
   version and that version's content hash. A later request on the same
   contract, sent again after the first ended (001465), keeps the version the
   contract was prepared from: it must name a stored version with that hash,
   whatever its status now. Template keys the store does not hold (the code
   templates used by tests) are left to the application. */
create or replace function public.check_commerce_contract_signing_template() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.document_type = 'contract_template'
     and exists (select 1 from public.commerce_contract_templates t where t.template_key = new.template_id)
     and not exists (
       select 1 from public.commerce_contract_templates t
       where t.template_key = new.template_id and 'v' || t.version = new.template_version
         and t.content_hash = new.template_hash
         and (t.status = 'active' or new.request_number > 1)) then
    -- CW409 lets the application ask the seller to reload the form.
    raise exception using errcode = 'CW409',
      message = 'A contract is prepared only from the active version of its template';
  end if;
  return new;
end $$;

drop trigger if exists check_commerce_contract_signing_template on public.commerce_contract_signing;

create trigger check_commerce_contract_signing_template
  before insert on public.commerce_contract_signing
  for each row execute function public.check_commerce_contract_signing_template();

alter table public.commerce_contract_templates enable row level security;

alter table public.commerce_contract_templates force row level security;

revoke all on public.commerce_contract_templates
  from public, anon, authenticated, clockwork_runtime, clockwork_service;

revoke all on function public.protect_commerce_contract_template() from public;

revoke all on function public.check_commerce_contract_signing_template() from public;

-- Customer identities have no grants. Only unused drafts can be deleted; the
-- trigger refuses the rest.
grant select, insert, update, delete on public.commerce_contract_templates to clockwork_service;

drop policy if exists contract_templates_service on public.commerce_contract_templates;

create policy contract_templates_service on public.commerce_contract_templates
  for all to clockwork_service using (true) with check (true);

reset lock_timeout;
