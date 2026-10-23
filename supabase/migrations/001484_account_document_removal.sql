-- Removing an attached document from a partner or account record
-- (docs/operations/partner-records.md#documents-attached-outside-commerce).
--
-- A PDF attached by mistake, or to the wrong record, or superseded by a
-- corrected copy, can be removed by staff who may attach documents. Removal is
-- an audited state, not an erasure: the row, its original details and the
-- retained bytes stay, so the history of what was attached and why it was
-- taken off remains true. A removed document no longer appears on the record,
-- cannot be viewed or downloaded, and no longer blocks attaching the same PDF
-- again. A removal can be reversed.
--
-- The staff service gains UPDATE on the removal columns only; every original
-- detail stays immutable, enforced both by the column grant and by a trigger.
set lock_timeout = '5s';

alter table public.commerce_account_documents
  add column if not exists removed_at timestamptz,
  add column if not exists removed_by_id uuid,
  add column if not exists removed_by_name text,
  add column if not exists removal_reason text,
  add column if not exists version integer not null default 1;

alter table public.commerce_account_documents
  drop constraint if exists account_documents_removal_check;

alter table public.commerce_account_documents
  add constraint account_documents_removal_check check (
    version >= 1
    and (removed_at is null) = (removed_by_id is null)
    and (removed_at is null) = (removed_by_name is null)
    and (removed_at is null) = (removal_reason is null)
    and (removal_reason is null or length(btrim(removal_reason)) between 1 and 500)
    and (removed_by_name is null or length(btrim(removed_by_name)) between 1 and 200));

-- The same PDF may be attached again once the earlier copy is removed.
drop index if exists public.account_documents_partner_hash;

create unique index account_documents_partner_hash
  on public.commerce_account_documents (partner_id, sha256)
  where partner_id is not null and removed_at is null;

drop index if exists public.account_documents_account_hash;

create unique index account_documents_account_hash
  on public.commerce_account_documents (account_id, sha256)
  where account_id is not null and removed_at is null;

create or replace function public.protect_commerce_account_document() returns trigger
language plpgsql set search_path = public as $$
begin
  if to_jsonb(new) - array['removed_at','removed_by_id','removed_by_name','removal_reason','version']
     <> to_jsonb(old) - array['removed_at','removed_by_id','removed_by_name','removal_reason','version'] then
    raise exception using errcode = 'P0001', message = 'ATTACHMENT_IMMUTABLE';
  end if;
  if new.version <> old.version + 1 then
    raise exception using errcode = 'P0001', message = 'ATTACHMENT_VERSION_MUST_ADVANCE';
  end if;
  return new;
end $$;

revoke all on function public.protect_commerce_account_document() from public;

drop trigger if exists protect_commerce_account_document on public.commerce_account_documents;

create trigger protect_commerce_account_document before update on public.commerce_account_documents
  for each row execute function public.protect_commerce_account_document();

grant update (removed_at, removed_by_id, removed_by_name, removal_reason, version)
  on public.commerce_account_documents to clockwork_service;

drop policy if exists account_documents_remove on public.commerce_account_documents;

create policy account_documents_remove on public.commerce_account_documents
  for update to clockwork_service using (true) with check (true);

comment on column public.commerce_account_documents.removed_at is
  'Set when staff removed the document from its record; the row and bytes are retained for audit.';

reset lock_timeout;
