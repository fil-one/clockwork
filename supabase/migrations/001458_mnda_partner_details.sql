-- What the partner fills in at signing (legal name, jurisdiction and entity
-- type, signer name and title, notice contact and address) was kept only in
-- the executed PDF, so a register search by the partner's completed legal name
-- did not find the MNDA. `input` is the immutable snapshot of what staff
-- entered, so the partner's values get a column of their own.
--
-- The signing engine reads the values from SignWell's completed document and
-- writes them in the change that completes the request and archives the
-- executed PDF. They are written once, with completion, and never changed:
-- the protect trigger below refuses any other write, and the check keeps
-- them off requests that have not completed. When SignWell reports no values
-- the column holds an empty object and the history records
-- `mnda.fields_unreported`; the executed PDF stays the authoritative record.
--
-- The engine keeps at most 180 characters per value, so a full set stays well
-- under the 16 KB bound. No index and no generated column: the register
-- search and the duplicate check read a few hundred rows, and a stored
-- generated column would rewrite the table (ADR 0009).

-- Short exclusive locks on a live table; fail fast rather than queue behind a
-- long transaction (ADR 0009).
set lock_timeout = '5s';

alter table public.commerce_mnda_requests
  add column if not exists partner_details jsonb
  constraint commerce_mnda_requests_partner_details_check check (
    partner_details is null
    or (state = 'completed'
      and jsonb_typeof(partner_details) = 'object'
      and octet_length(partner_details::text) <= 16384)
  );

comment on column public.commerce_mnda_requests.partner_details is
  'What the partner entered at signing, by SignWell field id, read from SignWell with completion and fixed afterwards. Null when the partner was asked for nothing or the request has not completed; empty when SignWell reported no values. The executed PDF is authoritative.';

-- 001442's function with one more branch: partner details are written only
-- by the change that completes the request. Every earlier branch and message
-- is unchanged.
create or replace function public.protect_mnda_request() returns trigger language plpgsql set search_path = public as $$
begin
  if new.input <> old.input or new.countersigner <> old.countersigner or new.template_hash <> old.template_hash
     or new.owner_id <> old.owner_id or new.test_mode <> old.test_mode
     or new.notice_email is distinct from old.notice_email
     or (old.owner_email is not null and new.owner_email is distinct from old.owner_email)
     or (old.provider_id is not null and new.provider_id is distinct from old.provider_id) then
    raise exception 'MNDA snapshots and provider binding are immutable';
  end if;
  if old.state in ('completed','canceled','declined','expired') and (
    new.state <> old.state
    or new.corrected_signer_email is distinct from old.corrected_signer_email
    or new.pending_signer_email is distinct from old.pending_signer_email
    or new.cancel_code is distinct from old.cancel_code
    or new.cancel_reason is distinct from old.cancel_reason
  ) then
    raise exception 'MNDA terminal state is immutable';
  end if;
  if new.partner_details is distinct from old.partner_details
     and not (old.state <> 'completed' and new.state = 'completed') then
    raise exception 'MNDA partner details are recorded only with completion';
  end if;
  if new.state = 'completed' and not exists (select 1 from public.commerce_mnda_artifacts where request_id=new.id and kind='executed') then
    raise exception 'MNDA completion requires archived evidence';
  end if;
  return new;
end $$;

reset lock_timeout;
