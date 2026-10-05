-- Staff contract register, template signing requests and sales library.
-- Standalone like the MNDA workflow (ADR 0011): prospects, customers and
-- partners need no commerce account, and nothing here writes to the lifecycle
-- `agreements` model or to the MNDA tables, which it only reads.
--
-- Stored PDFs live in the backed-up database behind a storage seam. Contract
-- and collateral rows carry a storage backend and key, so moving bytes to Fil
-- One S3-compatible storage later changes configuration, not these tables.

create table public.commerce_stored_documents (
  id uuid primary key,
  purpose text not null check (purpose in ('contract','collateral')),
  content_type text not null check (content_type = 'application/pdf'),
  size_bytes integer not null check (size_bytes between 5 and 26214400),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  bytes bytea not null,
  created_at timestamptz not null default now(),
  check (octet_length(bytes) = size_bytes),
  check (substring(bytes from 1 for 5) = '\x255044462d'::bytea)
);
comment on table public.commerce_stored_documents is
  'Database document store (storage backend "postgres"). PDF only, at most 25 MiB, SHA-256 verified on read.';

create table public.commerce_contracts (
  id uuid primary key,
  counterparty_name text not null check (length(btrim(counterparty_name)) between 1 and 200),
  title text not null default '' check (length(title) <= 200),
  contract_type text not null check (contract_type in
    ('mnda','nda_one_way','customer_msa','order_form','dpa','security_annex',
     'channel_partnership','technology_partner','sow','other')),
  paper text not null check (paper in ('ours','theirs')),
  status text not null check (status in
    ('draft','in_negotiation','out_for_signature','executed','expired','terminated')),
  effective_date date,
  initial_term_months integer check (initial_term_months between 1 and 600),
  auto_renew boolean not null default false,
  renewal_term_months integer check (renewal_term_months between 1 and 600),
  notice_period_days integer check (notice_period_days between 0 and 3650),
  value_minor bigint check (value_minor >= 0),
  currency text check (currency in ('USD','EUR','GBP')),
  pricing_notes text not null default '' check (length(pricing_notes) <= 2000),
  owner_name text not null check (length(btrim(owner_name)) between 1 and 120),
  internal_notes text not null default '' check (length(internal_notes) <= 10000),
  tags text[] not null default '{}' check (cardinality(tags) <= 20),
  source text not null default 'register' check (source in ('register','template')),
  -- Set the first time the contract is executed and never cleared. Its
  -- documents stay permanent even if it later expires or is terminated.
  executed_at timestamptz,
  created_by_id uuid not null,
  created_by_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  check ((value_minor is null) = (currency is null)),
  check (not auto_renew or (effective_date is not null and initial_term_months is not null and renewal_term_months is not null)),
  check (initial_term_months is null or effective_date is not null)
);
create index commerce_contracts_type_status on public.commerce_contracts (contract_type, status);
create index commerce_contracts_updated on public.commerce_contracts (updated_at desc);
create index commerce_contracts_counterparty on public.commerce_contracts (lower(counterparty_name));

create table public.commerce_contract_files (
  id uuid primary key,
  contract_id uuid not null references public.commerce_contracts(id),
  kind text not null check (kind in
    ('main','attachment','counterparty_draft','redline','generated','executed')),
  file_name text not null check (length(btrim(file_name)) between 1 and 200),
  storage_backend text not null check (storage_backend in ('postgres','fil_one_s3')),
  storage_key text not null check (length(storage_key) between 1 and 512),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes integer not null check (size_bytes between 5 and 26214400),
  content_type text not null check (content_type = 'application/pdf'),
  uploaded_by_id uuid,
  uploaded_by_name text not null,
  created_at timestamptz not null default now(),
  unique (storage_backend, storage_key)
);
create index commerce_contract_files_contract on public.commerce_contract_files (contract_id, created_at);
create unique index commerce_contract_files_one_generated on public.commerce_contract_files (contract_id) where kind = 'generated';
create unique index commerce_contract_files_one_executed on public.commerce_contract_files (contract_id) where kind = 'executed';

create table public.commerce_contract_events (
  id uuid primary key,
  contract_id uuid not null references public.commerce_contracts(id),
  event_type text not null check (event_type ~ '^contract\.[a-z_]+$'),
  actor_id uuid,
  actor_name text not null,
  changes jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);
create index commerce_contract_events_contract on public.commerce_contract_events (contract_id, occurred_at);

-- One signing request per template-prepared contract. Snapshots are taken at
-- preparation and never change; a correction is a new preparation.
create table public.commerce_contract_signing (
  contract_id uuid primary key references public.commerce_contracts(id),
  template_id text not null check (template_id ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  template_version text not null check (length(template_version) between 1 and 40),
  template_hash text not null check (template_hash ~ '^[0-9a-f]{64}$'),
  -- Shown to signers as the SignWell document name; never an internal reference.
  document_name text not null check (length(btrim(document_name)) between 1 and 200),
  input jsonb not null,
  counterparty_signer jsonb not null,
  countersigner jsonb not null,
  preparer_id uuid not null,
  preparer_name text not null,
  approval_required boolean not null,
  approval_state text not null check (approval_state in ('not_required','pending','approved','rejected')),
  approver_id uuid,
  approver_name text,
  decided_at timestamptz,
  rejection_reason text check (rejection_reason is null or length(btrim(rejection_reason)) between 1 and 1000),
  state text not null default 'draft' check (state in
    ('draft','preparing','ready','sending','sent','viewed','awaiting_countersignature',
     'completed','declined','expired','canceled','attention')),
  provider_id text unique,
  test_mode boolean not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  lease_until timestamptz,
  lease_token uuid,
  error text,
  version integer not null default 1,
  check ((approval_state = 'not_required') = (not approval_required)),
  -- Two-person rule: whoever prepared the contract cannot approve it.
  check (approver_id is null or approver_id <> preparer_id),
  check ((approval_state in ('approved','rejected')) = (approver_id is not null and decided_at is not null)),
  check ((approval_state = 'rejected') = (rejection_reason is not null))
);

create table public.commerce_sales_collateral (
  id uuid primary key,
  title text not null check (length(btrim(title)) between 1 and 160),
  description text not null default '' check (length(description) <= 1000),
  kind text not null check (kind in ('pitch_deck','one_pager','pricing_sheet','case_study','other')),
  audience text not null check (audience in ('customer','partner')),
  status text not null check (status in ('current','archived')),
  content_updated_on date not null,
  link_url text check (link_url ~ '^https://' and length(link_url) <= 2000),
  file_name text check (length(btrim(file_name)) between 1 and 200),
  storage_backend text check (storage_backend in ('postgres','fil_one_s3')),
  storage_key text check (length(storage_key) between 1 and 512),
  sha256 text check (sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes integer check (size_bytes between 5 and 26214400),
  created_by_id uuid not null,
  created_by_name text not null,
  updated_by_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  -- Exactly one of a link or a stored PDF.
  check ((link_url is null) <> (storage_key is null)),
  check ((storage_key is null) = (storage_backend is null)
     and (storage_key is null) = (sha256 is null)
     and (storage_key is null) = (size_bytes is null)
     and (storage_key is null) = (file_name is null))
);
create index commerce_sales_collateral_listing on public.commerce_sales_collateral (status, audience, content_updated_on desc);

/* The first day after the current term as of `as_of`: a fixed term's expiry,
   or an auto-renewing contract's next renewal. Month arithmetic is measured
   from the effective date so month-end anniversaries do not drift; date +
   interval clamps to the last day of shorter months. Mirrors
   packages/domain/src/contract-terms.ts. */
create function public.commerce_contract_term_boundary(
  effective_date date, initial_term_months integer, auto_renew boolean,
  renewal_term_months integer, as_of date
) returns date language plpgsql immutable set search_path = public as $$
declare
  first_boundary date;
  candidate date;
  renewals integer;
begin
  if effective_date is null or initial_term_months is null then
    return null;
  end if;
  first_boundary := (effective_date + make_interval(months => initial_term_months))::date;
  if not auto_renew or renewal_term_months is null or first_boundary > as_of then
    return first_boundary;
  end if;
  renewals := greatest(0, ((extract(year from as_of)::integer - extract(year from first_boundary)::integer) * 12
    + extract(month from as_of)::integer - extract(month from first_boundary)::integer) / renewal_term_months - 1);
  loop
    candidate := (effective_date + make_interval(months => initial_term_months + renewals * renewal_term_months))::date;
    if candidate > as_of then
      return candidate;
    end if;
    renewals := renewals + 1;
  end loop;
end $$;

create function public.protect_commerce_contract_file() returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'Contract files are immutable';
  end if;
  if old.kind in ('generated','executed') then
    raise exception 'Prepared and executed contract documents are permanent';
  end if;
  if exists (select 1 from public.commerce_contracts where id = old.contract_id and executed_at is not null) then
    raise exception 'Documents on an executed contract are permanent';
  end if;
  return old;
end $$;
create trigger protect_commerce_contract_file before update or delete on public.commerce_contract_files
  for each row execute function public.protect_commerce_contract_file();

/* Executed is final for ordinary edits: once executed, a contract may only
   become expired or terminated, and executed_at never changes. */
create function public.protect_commerce_contract() returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and old.executed_at is not null then
    new.executed_at := old.executed_at;
    if new.status not in ('executed','expired','terminated') then
      raise exception 'An executed contract can only expire or be terminated';
    end if;
  end if;
  if new.status = 'executed' and new.executed_at is null then
    new.executed_at := now();
  end if;
  return new;
end $$;
create trigger protect_commerce_contract before insert or update on public.commerce_contracts
  for each row execute function public.protect_commerce_contract();

/* Stored bytes outlive any cleanup that cannot tell whether its transaction
   committed: a document still referenced by a contract file or a sales
   library item cannot be deleted. */
create function public.protect_commerce_stored_document() returns trigger language plpgsql set search_path = public as $$
begin
  if exists (select 1 from public.commerce_contract_files
               where storage_backend = 'postgres' and storage_key = old.id::text)
     or exists (select 1 from public.commerce_sales_collateral
               where storage_backend = 'postgres' and storage_key = old.id::text) then
    raise exception 'Stored document is still referenced';
  end if;
  return old;
end $$;
create trigger protect_commerce_stored_document before delete on public.commerce_stored_documents
  for each row execute function public.protect_commerce_stored_document();

create function public.protect_commerce_contract_signing() returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.state <> 'draft' or new.approval_state not in ('pending','not_required')
       or new.approver_id is not null or new.approver_name is not null or new.decided_at is not null
       or new.rejection_reason is not null or new.provider_id is not null or new.error is not null
       or new.completed_at is not null then
      raise exception 'A contract signing request starts as an undecided, unsent draft';
    end if;
    return new;
  end if;
  if new.input <> old.input or new.counterparty_signer <> old.counterparty_signer
     or new.countersigner <> old.countersigner or new.template_id <> old.template_id
     or new.template_version <> old.template_version or new.template_hash <> old.template_hash
     or new.document_name <> old.document_name
     or new.preparer_id <> old.preparer_id or new.test_mode <> old.test_mode
     or new.approval_required <> old.approval_required
     or (old.provider_id is not null and new.provider_id is distinct from old.provider_id) then
    raise exception 'Contract signing snapshots and provider binding are immutable';
  end if;
  if old.state in ('completed','canceled','declined','expired') and new.state <> old.state then
    raise exception 'Contract signing terminal state is immutable';
  end if;
  if old.approval_state in ('approved','rejected') and (new.approval_state <> old.approval_state
     or new.approver_id is distinct from old.approver_id or new.decided_at is distinct from old.decided_at) then
    raise exception 'Contract approval decisions are final';
  end if;
  if new.approval_state <> old.approval_state and not (
       (old.approval_state = 'pending' and new.approval_state in ('approved','rejected'))) then
    raise exception 'Contract approval can only be decided while pending';
  end if;
  if new.state in ('preparing','ready','sending','sent','viewed','awaiting_countersignature','completed')
     and new.state <> old.state and new.approval_state not in ('not_required','approved') then
    raise exception 'Contract requires approval before sending';
  end if;
  if new.state = 'completed' and not exists (
       select 1 from public.commerce_contract_files where contract_id = new.contract_id and kind = 'executed') then
    raise exception 'Contract completion requires archived evidence';
  end if;
  return new;
end $$;
create trigger protect_commerce_contract_signing before insert or update on public.commerce_contract_signing
  for each row execute function public.protect_commerce_contract_signing();

alter table public.commerce_stored_documents enable row level security;
alter table public.commerce_stored_documents force row level security;
alter table public.commerce_contracts enable row level security;
alter table public.commerce_contracts force row level security;
alter table public.commerce_contract_files enable row level security;
alter table public.commerce_contract_files force row level security;
alter table public.commerce_contract_events enable row level security;
alter table public.commerce_contract_events force row level security;
alter table public.commerce_contract_signing enable row level security;
alter table public.commerce_contract_signing force row level security;
alter table public.commerce_sales_collateral enable row level security;
alter table public.commerce_sales_collateral force row level security;

revoke all on public.commerce_stored_documents, public.commerce_contracts,
  public.commerce_contract_files, public.commerce_contract_events,
  public.commerce_contract_signing, public.commerce_sales_collateral
  from public, anon, authenticated, clockwork_runtime, clockwork_service;
revoke all on function public.commerce_contract_term_boundary(date, integer, boolean, integer, date) from public;
grant execute on function public.commerce_contract_term_boundary(date, integer, boolean, integer, date) to clockwork_service;

-- Customer identities have no grants. Staff reach these tables only through
-- server code that re-checks session, MFA and permission (ADR 0011).
grant select, insert, delete on public.commerce_stored_documents to clockwork_service;
grant select, insert, update on public.commerce_contracts to clockwork_service;
grant select, insert, delete on public.commerce_contract_files to clockwork_service;
grant select, insert on public.commerce_contract_events to clockwork_service;
grant select, insert, update on public.commerce_contract_signing to clockwork_service;
grant select, insert, update on public.commerce_sales_collateral to clockwork_service;

create policy contract_documents_read on public.commerce_stored_documents for select to clockwork_service using (true);
create policy contract_documents_insert on public.commerce_stored_documents for insert to clockwork_service with check (true);
create policy contract_documents_delete on public.commerce_stored_documents for delete to clockwork_service using (true);
create policy contracts_service on public.commerce_contracts for all to clockwork_service using (true) with check (true);
create policy contract_files_read on public.commerce_contract_files for select to clockwork_service using (true);
create policy contract_files_insert on public.commerce_contract_files for insert to clockwork_service with check (true);
create policy contract_files_delete on public.commerce_contract_files for delete to clockwork_service using (true);
create policy contract_events_read on public.commerce_contract_events for select to clockwork_service using (true);
create policy contract_events_insert on public.commerce_contract_events for insert to clockwork_service with check (true);
create policy contract_signing_service on public.commerce_contract_signing for all to clockwork_service using (true) with check (true);
create policy sales_collateral_service on public.commerce_sales_collateral for all to clockwork_service using (true) with check (true);
