-- Externally supplied PDFs attached explicitly to a staff partner or account.
-- These are retained evidence, not a signing request or a lifecycle agreement.
alter table public.commerce_stored_documents drop constraint commerce_stored_documents_purpose_check;
alter table public.commerce_stored_documents add constraint commerce_stored_documents_purpose_check
  check (purpose in ('contract', 'collateral', 'account_attachment'));

create table public.commerce_account_documents (
  id uuid primary key,
  partner_id uuid references public.commerce_partners(id),
  account_id uuid references public.accounts(id),
  title text not null check (length(btrim(title)) between 1 and 200),
  kind text not null check (kind in ('mnda','agreement','other')),
  signed_on date,
  file_name text not null check (length(file_name) between 1 and 200),
  storage_backend text not null,
  storage_key text not null,
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  size_bytes integer not null check (size_bytes between 5 and 26214400),
  content_type text not null check (content_type = 'application/pdf'),
  uploaded_by_id uuid not null,
  uploaded_by_name text not null,
  created_at timestamptz not null default now(),
  constraint account_documents_one_target check (num_nonnulls(partner_id, account_id) = 1)
);
create unique index account_documents_storage on public.commerce_account_documents(storage_backend, storage_key);
create unique index account_documents_partner_hash on public.commerce_account_documents(partner_id, sha256) where partner_id is not null;
create unique index account_documents_account_hash on public.commerce_account_documents(account_id, sha256) where account_id is not null;
create index account_documents_partner on public.commerce_account_documents(partner_id, created_at desc, id);
create index account_documents_account on public.commerce_account_documents(account_id, created_at desc, id);

-- The staff service has no permission to change or erase attached evidence.
alter table public.commerce_account_documents enable row level security;
alter table public.commerce_account_documents force row level security;
revoke all on public.commerce_account_documents from public, anon, authenticated, clockwork_runtime, clockwork_service;
grant select, insert on public.commerce_account_documents to clockwork_service;
create policy account_documents_read on public.commerce_account_documents for select to clockwork_service using (true);
create policy account_documents_insert on public.commerce_account_documents for insert to clockwork_service with check (true);

-- Keep the original protection for contracts/collateral and include attachments.
-- Failed/ambiguous-commit cleanup must never delete a referenced PDF.
create or replace function public.protect_commerce_stored_document() returns trigger language plpgsql set search_path = public as $$
begin
  if exists (select 1 from public.commerce_contract_files where storage_backend = 'postgres' and storage_key = old.id::text)
     or exists (select 1 from public.commerce_sales_collateral where storage_backend = 'postgres' and storage_key = old.id::text)
     or exists (select 1 from public.commerce_account_documents where storage_backend = 'postgres' and storage_key = old.id::text) then
    raise exception 'Stored document is still referenced';
  end if;
  return old;
end $$;
