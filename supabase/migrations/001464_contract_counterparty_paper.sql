-- Counterparty paper sent for the Fil One countersignature.
--
-- A contract recorded on the counterparty's paper can now be sent through
-- SignWell: its uploaded PDF, with a Fil One signature page appended, is a
-- second document type on the same signing table (ADR 0012):
--   * document_type: 'contract_template' for every existing row, or
--     'counterparty_paper';
--   * counterparty_signs: whether the counterparty signs in SignWell first,
--     or signed on their paper already and only Fil One signs here. A
--     template contract is always signed by both.
-- The signing request is pinned to the uploaded PDF by its SHA-256 (kept as
-- template_hash, which SignWell's copy must carry): the request can only be
-- created for a contract on the counterparty's paper with that PDF attached,
-- and the PDF cannot be removed while the request exists.

set lock_timeout = '5s';

-- Constant defaults: no table rewrite, existing rows read as template
-- contracts signed by both parties.
alter table public.commerce_contract_signing
  add column if not exists document_type text not null default 'contract_template'
    check (document_type in ('contract_template', 'counterparty_paper'));

alter table public.commerce_contract_signing
  add column if not exists counterparty_signs boolean not null default true;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.commerce_contract_signing'::regclass
      and conname = 'commerce_contract_signing_counterparty_signs_check'
  ) then
    alter table public.commerce_contract_signing
      add constraint commerce_contract_signing_counterparty_signs_check
      check (counterparty_signs or document_type = 'counterparty_paper');
  end if;
end $$;

comment on column public.commerce_contract_signing.document_type is
  'contract_template: prepared from a counsel template. counterparty_paper: the counterparty''s uploaded PDF, pinned by template_hash, with a Fil One signature page appended.';
comment on column public.commerce_contract_signing.counterparty_signs is
  'The counterparty signs in SignWell before Fil One. False only for counterparty paper they signed already.';

-- 001459's rules, unchanged, with the two new columns fixed at creation and
-- counterparty paper bound to an attached PDF on the counterparty's paper.
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
    if new.document_type = 'counterparty_paper' and not exists (
         select 1 from public.commerce_contracts c
         join public.commerce_contract_files f on f.contract_id = c.id
         where c.id = new.contract_id and c.paper = 'theirs' and c.executed_at is null
           and f.kind in ('main','counterparty_draft') and f.sha256 = new.template_hash) then
      raise exception 'Counterparty paper is signed only from a PDF attached to a contract on their paper';
    end if;
    return new;
  end if;
  if new.input <> old.input or new.counterparty_signer <> old.counterparty_signer
     or new.countersigner <> old.countersigner or new.template_id <> old.template_id
     or new.template_version <> old.template_version or new.template_hash <> old.template_hash
     or new.document_name <> old.document_name
     or new.preparer_id <> old.preparer_id or new.test_mode <> old.test_mode
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

-- 001443's rules, unchanged, and the PDF a counterparty-paper request is
-- pinned to stays attached.
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
               and s.template_hash = old.sha256) then
    raise exception 'A PDF sent for signature is permanent';
  end if;
  return old;
end $$;

reset lock_timeout;
