-- Bringing HubSpot companies and deals into Commerce
-- (docs/operations/hubspot-handoff.md).
--
-- HubSpot stays authoritative for CRM activity and pipeline; nothing here is a
-- copy of the CRM. These tables record only what Commerce owns:
--
--   * the administrator's connection: which portal, the approved audience and
--     data scope, owner mappings. The access token is a deployment secret and
--     never reaches the database;
--   * typed links from a HubSpot company to the Commerce record it became;
--   * each reviewed import: the plan a person approved, an immutable snapshot
--     of the selected source values, and per-document results.
--
-- Live CRM reads are not stored. Pipeline and record views read HubSpot
-- through the approved scope each time (with a short in-process cache keyed by
-- the connection version), so disconnecting removes live access at once.
--
-- Staff reach these tables through server code on the service role, which
-- checks `sales:read`, `contract:write` or `staff:manage` first. Every change
-- writes a `hubspot.*` or `partner.*` audit event in the same transaction.
-- Rows are never deleted.
set lock_timeout = '5s';

create table if not exists public.commerce_hubspot_connections (
  id uuid primary key,
  portal_id text not null check (portal_id ~ '^[0-9]{1,20}$'),
  ui_domain text not null check (ui_domain ~ '^app(-[a-z0-9]{2,10})?\.hubspot\.com$'),
  status text not null check (status in ('active','disconnected')),
  -- The audience the administrator approved. It is named, not inferred from
  -- HubSpot user permissions, which a shared connection cannot reproduce.
  audience text not null check (audience = 'staff_sales_read'),
  approved_by_id uuid not null,
  approved_by_name text not null check (length(btrim(approved_by_name)) between 1 and 200),
  approved_at timestamptz not null,
  scope jsonb not null
    check (jsonb_typeof(scope) = 'object'
      and jsonb_typeof(scope->'company') = 'array'
      and jsonb_typeof(scope->'deal') = 'array'
      and jsonb_typeof(scope->'contact') = 'array'
      and jsonb_typeof(scope->'pipelines') = 'array'
      and jsonb_typeof(scope->'notes') = 'boolean'
      and jsonb_typeof(scope->'files') = 'boolean'),
  default_pipeline_id text check (default_pipeline_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  owner_mappings jsonb not null default '[]'
    check (jsonb_typeof(owner_mappings) = 'array' and jsonb_array_length(owner_mappings) <= 500),
  disconnected_by_name text,
  disconnected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  constraint commerce_hubspot_connections_disconnect_check
    check ((status = 'disconnected') = (disconnected_at is not null))
);

comment on table public.commerce_hubspot_connections is
  'The approved HubSpot portal, audience and read scope. At most one is active; disconnecting keeps the row. No credential is stored here.';

create unique index if not exists commerce_hubspot_connections_one_active
  on public.commerce_hubspot_connections ((true)) where status = 'active';

create table if not exists public.commerce_external_links (
  id uuid primary key,
  provider text not null check (provider = 'hubspot'),
  portal_id text not null check (portal_id ~ '^[0-9]{1,20}$'),
  object_type text not null check (object_type = 'company'),
  object_id text not null check (object_id ~ '^[0-9]{1,20}$'),
  destination_type text not null check (destination_type in ('partner','account')),
  partner_id uuid references public.commerce_partners(id),
  account_id uuid references public.accounts(id),
  -- The company's name when it was linked, so the link reads after disconnect.
  company_name text not null check (length(btrim(company_name)) between 1 and 200),
  created_by_id uuid not null,
  created_by_name text not null check (length(btrim(created_by_name)) between 1 and 200),
  created_at timestamptz not null default now(),
  constraint commerce_external_links_target_check check (
    num_nonnulls(partner_id, account_id) = 1
    and ((destination_type = 'partner') = (partner_id is not null)))
);

comment on table public.commerce_external_links is
  'Typed identity links from a HubSpot company to the Commerce record it became. A link copies nothing; imports do. Append-only.';

-- A HubSpot company becomes at most one partner and at most one account, so
-- two people bringing in the same company at once cannot create two partners:
-- the loser resolves to the winner's record.
create unique index if not exists commerce_external_links_source
  on public.commerce_external_links (provider, portal_id, object_type, object_id, destination_type);

-- A partner is linked to at most one company per portal.
create unique index if not exists commerce_external_links_partner
  on public.commerce_external_links (provider, portal_id, partner_id) where partner_id is not null;

create index if not exists commerce_external_links_partner_lookup
  on public.commerce_external_links (partner_id) where partner_id is not null;

create table if not exists public.commerce_hubspot_imports (
  -- The operation ID the review carried: one handoff however often it is sent.
  id uuid primary key,
  link_id uuid not null references public.commerce_external_links(id),
  partner_id uuid not null references public.commerce_partners(id),
  connection_id uuid not null references public.commerce_hubspot_connections(id),
  portal_id text not null check (portal_id ~ '^[0-9]{1,20}$'),
  company_id text not null check (company_id ~ '^[0-9]{1,20}$'),
  deal_id text check (deal_id ~ '^[0-9]{1,20}$'),
  created_partner boolean not null,
  status text not null check (status in ('complete','needs_attention','completed_with_exclusions')),
  -- The reviewed plan and the selected source values, both immutable.
  plan jsonb not null check (jsonb_typeof(plan) = 'object'),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  -- What was sent, so a retry is recognised and a different request refused.
  request_digest text not null check (request_digest ~ '^[a-f0-9]{64}$'),
  created_by_id uuid not null,
  created_by_name text not null check (length(btrim(created_by_name)) between 1 and 200),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  constraint commerce_hubspot_imports_completed_check
    check ((status = 'needs_attention') = (completed_at is null))
);

comment on table public.commerce_hubspot_imports is
  'Each reviewed HubSpot import: the plan approved, the selected source snapshot and its completion. Plans and snapshots never change.';

create index if not exists commerce_hubspot_imports_partner
  on public.commerce_hubspot_imports (partner_id, created_at desc, id desc);

create table if not exists public.commerce_hubspot_import_items (
  id uuid primary key,
  import_id uuid not null references public.commerce_hubspot_imports(id),
  file_id text not null check (file_id ~ '^[0-9]{1,20}$'),
  note_id text not null check (note_id ~ '^[0-9]{1,20}$'),
  file_name text not null check (length(file_name) between 1 and 255),
  title text not null check (length(btrim(title)) between 1 and 200),
  document_kind text not null check (document_kind in ('mnda','agreement','other')),
  -- The file version reviewed; a different file later needs a fresh review.
  file_updated_at text,
  file_size bigint check (file_size >= 0),
  status text not null default 'pending'
    check (status in ('pending','attached','failed','duplicate','reused','excluded')),
  error_code text check (error_code ~ '^[A-Z_]{1,80}$'),
  attachment_id uuid references public.commerce_account_documents(id),
  existing_attachment_id uuid references public.commerce_account_documents(id),
  excluded_reason text check (length(excluded_reason) <= 500),
  resolved_by_name text,
  attempts integer not null default 0 check (attempts >= 0),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  constraint commerce_hubspot_import_items_file unique (import_id, file_id),
  constraint commerce_hubspot_import_items_attached_check
    check ((status in ('attached','reused')) = (attachment_id is not null)),
  constraint commerce_hubspot_import_items_excluded_check
    check ((status = 'excluded') = (excluded_reason is not null))
);

comment on table public.commerce_hubspot_import_items is
  'One selected document per row, retried and resolved on its own. Attached, reused and excluded are final.';

-- Plans, snapshots and identities never change; the version advances on every
-- update; a resolved document stays resolved.
create or replace function public.protect_commerce_hubspot_row() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.version <> old.version + 1 then
    raise exception using errcode = 'P0001', message = 'HUBSPOT_VERSION_MUST_ADVANCE';
  end if;
  if tg_table_name = 'commerce_hubspot_connections' then
    if new.id <> old.id or new.portal_id <> old.portal_id
       or new.created_at <> old.created_at then
      raise exception using errcode = 'P0001', message = 'HUBSPOT_CONNECTION_IMMUTABLE';
    end if;
    if old.status = 'disconnected' then
      raise exception using errcode = 'P0001', message = 'HUBSPOT_CONNECTION_DISCONNECTED';
    end if;
  elsif tg_table_name = 'commerce_hubspot_imports' then
    if to_jsonb(new) - array['status','completed_at','updated_at','version']
       <> to_jsonb(old) - array['status','completed_at','updated_at','version'] then
      raise exception using errcode = 'P0001', message = 'HUBSPOT_IMPORT_IMMUTABLE';
    end if;
  elsif tg_table_name = 'commerce_hubspot_import_items' then
    if to_jsonb(new) - array['status','error_code','attachment_id','existing_attachment_id',
         'excluded_reason','resolved_by_name','attempts','updated_at','version']
       <> to_jsonb(old) - array['status','error_code','attachment_id','existing_attachment_id',
         'excluded_reason','resolved_by_name','attempts','updated_at','version'] then
      raise exception using errcode = 'P0001', message = 'HUBSPOT_ITEM_IMMUTABLE';
    end if;
    if old.status in ('attached','reused','excluded') then
      raise exception using errcode = 'P0001', message = 'HUBSPOT_ITEM_RESOLVED';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists protect_commerce_hubspot_connection on public.commerce_hubspot_connections;

create trigger protect_commerce_hubspot_connection before update on public.commerce_hubspot_connections
  for each row execute function public.protect_commerce_hubspot_row();

drop trigger if exists protect_commerce_hubspot_import on public.commerce_hubspot_imports;

create trigger protect_commerce_hubspot_import before update on public.commerce_hubspot_imports
  for each row execute function public.protect_commerce_hubspot_row();

drop trigger if exists protect_commerce_hubspot_import_item on public.commerce_hubspot_import_items;

create trigger protect_commerce_hubspot_import_item before update on public.commerce_hubspot_import_items
  for each row execute function public.protect_commerce_hubspot_row();

alter table public.commerce_hubspot_connections enable row level security;

alter table public.commerce_hubspot_connections force row level security;

alter table public.commerce_external_links enable row level security;

alter table public.commerce_external_links force row level security;

alter table public.commerce_hubspot_imports enable row level security;

alter table public.commerce_hubspot_imports force row level security;

alter table public.commerce_hubspot_import_items enable row level security;

alter table public.commerce_hubspot_import_items force row level security;

revoke all on public.commerce_hubspot_connections
  from public, anon, authenticated, clockwork_runtime, clockwork_service;

revoke all on public.commerce_external_links
  from public, anon, authenticated, clockwork_runtime, clockwork_service;

revoke all on public.commerce_hubspot_imports
  from public, anon, authenticated, clockwork_runtime, clockwork_service;

revoke all on public.commerce_hubspot_import_items
  from public, anon, authenticated, clockwork_runtime, clockwork_service;

revoke all on function public.protect_commerce_hubspot_row() from public;

grant select, insert, update on public.commerce_hubspot_connections to clockwork_service;

-- Links are append-only: relinking is a new reviewed decision, never an edit.
grant select, insert on public.commerce_external_links to clockwork_service;

grant select, insert, update on public.commerce_hubspot_imports to clockwork_service;

grant select, insert, update on public.commerce_hubspot_import_items to clockwork_service;

drop policy if exists hubspot_connections_service on public.commerce_hubspot_connections;

create policy hubspot_connections_service on public.commerce_hubspot_connections
  for all to clockwork_service using (true) with check (true);

drop policy if exists external_links_read on public.commerce_external_links;

create policy external_links_read on public.commerce_external_links
  for select to clockwork_service using (true);

drop policy if exists external_links_insert on public.commerce_external_links;

create policy external_links_insert on public.commerce_external_links
  for insert to clockwork_service with check (true);

drop policy if exists hubspot_imports_service on public.commerce_hubspot_imports;

create policy hubspot_imports_service on public.commerce_hubspot_imports
  for all to clockwork_service using (true) with check (true);

drop policy if exists hubspot_import_items_service on public.commerce_hubspot_import_items;

create policy hubspot_import_items_service on public.commerce_hubspot_import_items
  for all to clockwork_service using (true) with check (true);

reset lock_timeout;
