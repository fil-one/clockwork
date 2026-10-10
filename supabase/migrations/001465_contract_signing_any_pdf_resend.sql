-- Any uploaded PDF sent for signature, a contract sent again after its
-- signing request ended, and the preparer copied on the signed copy.
--
--   * An uploaded PDF (document_type 'counterparty_paper', kept as the name
--     for every existing row) can now be sent from a contract on either
--     party's paper: Fil One's own term sheet or letter as well as the
--     counterparty's agreement. It is still pinned to a main PDF or draft
--     attached to an unsigned contract.
--   * A contract keeps one current signing request (the primary key on
--     contract_id is unchanged). Once that request was declined, expired or
--     voided, it can be replaced: deleting it moves the whole row into
--     commerce_contract_signing_history, append-only, and the next request is
--     numbered after it. A completed request is never replaced.
--   * The PDF prepared for each request is kept, so a contract can hold more
--     than one prepared document; the current request's is the latest.
--   * preparer_email is who SignWell copies on the completed document.

set lock_timeout = '5s';

alter table public.commerce_contract_signing
  add column if not exists request_number integer not null default 1;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.commerce_contract_signing'::regclass
      and conname = 'commerce_contract_signing_request_number_check'
  ) then
    alter table public.commerce_contract_signing
      add constraint commerce_contract_signing_request_number_check
      check (request_number >= 1);
  end if;
end $$;

alter table public.commerce_contract_signing
  add column if not exists preparer_email text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.commerce_contract_signing'::regclass
      and conname = 'commerce_contract_signing_preparer_email_check'
  ) then
    alter table public.commerce_contract_signing
      add constraint commerce_contract_signing_preparer_email_check
      check (preparer_email is null or (length(preparer_email) <= 254
        and preparer_email ~ '^[^@[:space:]]+@[^@[:space:]]+$'));
  end if;
end $$;

comment on column public.commerce_contract_signing.document_type is
  'contract_template: prepared from a counsel template. counterparty_paper: an uploaded PDF on either party''s paper, pinned by template_hash, with a Fil One signature page appended.';
comment on column public.commerce_contract_signing.request_number is
  'Which signing request this is for the contract: 1, then one more each time an ended request is replaced.';
comment on column public.commerce_contract_signing.preparer_email is
  'The preparer, copied by SignWell on the completed document. Null for requests prepared before 001465.';

create table if not exists public.commerce_contract_signing_history (
  contract_id uuid not null references public.commerce_contracts(id),
  request_number integer not null check (request_number >= 1),
  state text not null check (state in ('declined','expired','canceled')),
  -- The replaced commerce_contract_signing row, as it stood.
  request jsonb not null,
  archived_at timestamptz not null default now(),
  primary key (contract_id, request_number)
);

comment on table public.commerce_contract_signing_history is
  'Signing requests that ended without signatures and were replaced by a new request on the same contract. Written only by the security-definer delete trigger on commerce_contract_signing; the service role reads it and never writes it.';

alter table public.commerce_contract_signing_history enable row level security;

alter table public.commerce_contract_signing_history force row level security;

revoke all on public.commerce_contract_signing_history
  from public, anon, authenticated, clockwork_runtime, clockwork_service;

-- Read only: rows are written by the archive trigger alone, as its owner.
grant select on public.commerce_contract_signing_history to clockwork_service;

drop policy if exists contract_signing_history_read on public.commerce_contract_signing_history;

create policy contract_signing_history_read on public.commerce_contract_signing_history
  for select to clockwork_service using (true);

-- A replaced request moves to the history whole, in the statement that
-- removes it. Only one that ended without signatures, and is not in use,
-- can go. It runs as its owner, so the service role never writes the
-- history itself.
create or replace function public.archive_commerce_contract_signing() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if old.state not in ('declined','expired','canceled') then
    raise exception 'Only a declined, expired or voided signing request can be replaced';
  end if;
  if old.lease_until is not null and old.lease_until > now() then
    raise exception 'A signing request in use cannot be replaced';
  end if;
  insert into public.commerce_contract_signing_history (contract_id, request_number, state, request)
  values (old.contract_id, old.request_number, old.state,
    to_jsonb(old) - 'lease_token' - 'lease_until');
  return old;
end $$;

revoke all on function public.archive_commerce_contract_signing()
  from public, anon, authenticated, clockwork_runtime, clockwork_service;

drop trigger if exists archive_commerce_contract_signing on public.commerce_contract_signing;

create trigger archive_commerce_contract_signing
  before delete on public.commerce_contract_signing
  for each row execute function public.archive_commerce_contract_signing();

grant delete on public.commerce_contract_signing to clockwork_service;

-- Each request keeps the PDF it was prepared with.
drop index if exists public.commerce_contract_files_one_generated;

-- 001464's rules, with a request numbered after the ones it replaces, an
-- executed contract never sent again, and an uploaded PDF sent from a
-- contract on either party's paper.
create or replace function public.protect_commerce_contract_signing() returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.state <> 'draft' or new.approval_state not in ('pending','not_required')
       or new.approver_id is not null or new.approver_name is not null or new.decided_at is not null
       or new.rejection_reason is not null or new.provider_id is not null or new.error is not null
       or new.completed_at is not null
       or new.corrected_signer_email is not null or new.pending_signer_email is not null
       or new.cancel_code is not null or new.cancel_reason is not null then
      raise exception 'A contract signing request starts as an undecided, unsent draft';
    end if;
    if new.request_number <> coalesce((select max(h.request_number)
         from public.commerce_contract_signing_history h
         where h.contract_id = new.contract_id), 0) + 1 then
      raise exception 'A contract signing request is numbered after the requests it replaces';
    end if;
    if new.request_number > 1 and exists (
         select 1 from public.commerce_contracts c
         where c.id = new.contract_id and c.executed_at is not null) then
      raise exception 'An executed contract is not sent for signature again';
    end if;
    if new.document_type = 'counterparty_paper' and not exists (
         select 1 from public.commerce_contracts c
         join public.commerce_contract_files f on f.contract_id = c.id
         where c.id = new.contract_id and c.executed_at is null
           and f.kind in ('main','counterparty_draft') and f.sha256 = new.template_hash) then
      raise exception 'An uploaded PDF is signed only from a main PDF or draft attached to an unsigned contract';
    end if;
    return new;
  end if;
  if new.contract_id <> old.contract_id or new.request_number <> old.request_number
     or new.input <> old.input or new.counterparty_signer <> old.counterparty_signer
     or new.countersigner <> old.countersigner or new.template_id <> old.template_id
     or new.template_version <> old.template_version or new.template_hash <> old.template_hash
     or new.document_name <> old.document_name
     or new.preparer_id <> old.preparer_id or new.preparer_email is distinct from old.preparer_email
     or new.test_mode <> old.test_mode
     or new.approval_required <> old.approval_required
     or new.document_type <> old.document_type or new.counterparty_signs <> old.counterparty_signs
     or (old.provider_id is not null and new.provider_id is distinct from old.provider_id) then
    raise exception 'Contract signing snapshots and provider binding are immutable';
  end if;
  if old.state in ('completed','canceled','declined','expired') and (
    new.state <> old.state
    or new.corrected_signer_email is distinct from old.corrected_signer_email
    or new.pending_signer_email is distinct from old.pending_signer_email
    or new.cancel_code is distinct from old.cancel_code
    or new.cancel_reason is distinct from old.cancel_reason
  ) then
    raise exception 'Contract signing terminal state is immutable';
  end if;
  if (new.cancel_code is distinct from old.cancel_code
      or new.cancel_reason is distinct from old.cancel_reason)
     and new.state <> 'canceled' then
    raise exception 'Contract signing cancel code is written only when the request is canceled';
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

-- 001464's rules, with the PDF a replaced request was sent from kept too.
create or replace function public.protect_commerce_contract_file() returns trigger language plpgsql set search_path = public as $$
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
  if exists (select 1 from public.commerce_contract_signing s
             where s.contract_id = old.contract_id and s.document_type = 'counterparty_paper'
               and s.template_hash = old.sha256)
     or exists (select 1 from public.commerce_contract_signing_history h
             where h.contract_id = old.contract_id
               and h.request->>'document_type' = 'counterparty_paper'
               and h.request->>'template_hash' = old.sha256) then
    raise exception 'A PDF sent for signature is permanent';
  end if;
  return old;
end $$;

reset lock_timeout;
