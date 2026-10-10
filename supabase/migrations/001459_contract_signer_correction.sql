-- Signer correction and typed cancel codes on template contracts.
--
-- MNDAs keep a pending and a confirmed partner email and a cancel code
-- (001442); the shared signing engine (ADR 0012) runs the same correction and
-- signer-change void on template contracts once their table can keep them:
--   * corrected_signer_email: the counterparty email after a correction
--     SignWell confirmed;
--   * pending_signer_email: an email sent to SignWell whose result is not yet
--     confirmed, cleared by the next read;
--   * cancel_code and cancel_reason: why a request closed, and the reason a
--     person typed when voiding it.
-- The protection trigger freezes all four once the request is terminal, and
-- writes the cancel columns only in the change that cancels the request.

-- Each column is added on its own, so a run that times out resumes; the
-- table holds one row per prepared contract (ADR 0009).
set lock_timeout = '5s';

alter table public.commerce_contract_signing
  add column if not exists corrected_signer_email text check (
    corrected_signer_email is null
    or (corrected_signer_email = lower(corrected_signer_email)
      and length(corrected_signer_email) <= 254));

alter table public.commerce_contract_signing
  add column if not exists pending_signer_email text check (
    pending_signer_email is null
    or (pending_signer_email = lower(pending_signer_email)
      and length(pending_signer_email) <= 254));

alter table public.commerce_contract_signing
  add column if not exists cancel_code text check (
    cancel_code in ('discarded', 'voided', 'signer_change'));

alter table public.commerce_contract_signing
  add column if not exists cancel_reason text check (
    cancel_reason is null
    or (cancel_code = 'voided' and length(btrim(cancel_reason)) between 3 and 500));

comment on column public.commerce_contract_signing.corrected_signer_email is
  'Counterparty signer email after an in-app correction of a bounced or wrong address, confirmed by SignWell.';
comment on column public.commerce_contract_signing.pending_signer_email is
  'Counterparty email sent to SignWell whose result is not yet confirmed; cleared by the next successful refresh.';
comment on column public.commerce_contract_signing.cancel_code is
  'Why a request closed, as a code the interface translates: discarded before sending, voided with a reason, or voided for a different counterparty signer.';
comment on column public.commerce_contract_signing.cancel_reason is
  'Reason typed by the person who voided the request. Never written by the application.';

-- 001443's rules, unchanged, with the new columns: empty on insert, frozen
-- once terminal, and the cancel columns written only in the change that
-- cancels the request.
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

reset lock_timeout;
