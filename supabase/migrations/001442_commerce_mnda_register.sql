-- MNDA notice setting, register tracking and after-send corrections.
--
-- The Fil One notice email printed in each agreement is a commerce
-- administrator setting, independent of who countersigns. Each draft keeps the
-- value it was rendered with, like the countersigner snapshot.
create table public.commerce_mnda_settings (
  id boolean primary key default true check (id),
  notice_email text not null check (
    notice_email = lower(notice_email)
    and length(notice_email) <= 254
    and notice_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  ),
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into public.commerce_mnda_settings (id, notice_email) values (true, 'james@fil.one');

alter table public.commerce_mnda_settings enable row level security;
alter table public.commerce_mnda_settings force row level security;
revoke all on public.commerce_mnda_settings from public, anon, authenticated, clockwork_runtime, clockwork_service;
grant select, update on public.commerce_mnda_settings to clockwork_service;
create policy mnda_settings_service on public.commerce_mnda_settings for all to clockwork_service using (true) with check (true);

comment on table public.commerce_mnda_settings is
  'Single row. Fil One notice email printed in new MNDA drafts; changed only by signatory managers and audited as mnda.settings_changed.';

-- Drafts made before this migration printed the countersigner's email and keep
-- a null notice_email; the application falls back to the countersigner snapshot.
alter table public.commerce_mnda_requests
  add column notice_email text check (notice_email is null or length(notice_email) <= 254),
  add column owner_email text check (owner_email is null or length(owner_email) <= 254),
  add column corrected_signer_email text check (corrected_signer_email is null or length(corrected_signer_email) <= 254),
  add column pending_signer_email text check (pending_signer_email is null or length(pending_signer_email) <= 254),
  add column cancel_code text check (cancel_code in ('superseded', 'discarded', 'voided', 'signer_change')),
  add column cancel_reason text check (cancel_reason is null or length(cancel_reason) <= 500),
  add column sent_at timestamptz,
  add column reminded_at timestamptz;

comment on column public.commerce_mnda_requests.notice_email is 'Fil One notice email snapshotted when the draft was rendered.';
comment on column public.commerce_mnda_requests.owner_email is 'Sender, copied on the completed agreement by SignWell.';
comment on column public.commerce_mnda_requests.corrected_signer_email is 'Partner signer email after an in-app correction of a bounced or wrong address.';
comment on column public.commerce_mnda_requests.pending_signer_email is 'Partner email sent to SignWell whose result is not yet confirmed; cleared by the next successful refresh.';
comment on column public.commerce_mnda_requests.cancel_code is 'Why a request closed, as a code the interface translates: superseded or discarded drafts, voided, or voided for a different partner signer.';
comment on column public.commerce_mnda_requests.cancel_reason is 'Reason typed by the person who voided the request. Never written by the application.';
comment on column public.commerce_mnda_requests.sent_at is 'First delivery to the partner; drives days outstanding.';

update public.commerce_mnda_requests r
set owner_email = lower(u.email)
from public.commerce_users u
where u.id = r.owner_id and r.owner_email is null;

update public.commerce_mnda_requests r
set sent_at = e.first_sent
from (
  select aggregate_id, min(occurred_at) as first_sent
  from public.audit_events
  where aggregate_type = 'agreement'
    and event_type in ('mnda.sent', 'mnda.viewed', 'mnda.awaiting_countersignature', 'mnda.completed')
  group by aggregate_id
) e
where e.aggregate_id = r.id and r.sent_at is null;

-- One normalizer for stored names and duplicate lookups: case, accents,
-- punctuation, "&", dotted initials and trailing entity suffixes are ignored,
-- so "Acme, Inc." and "ACME Inc" match.
create function public.commerce_mnda_normalize_company(name text) returns text
language plpgsql immutable strict parallel safe set search_path = pg_catalog as $$
declare
  words text[];
  suffixes constant text[] := array['ab','ag','as','bv','co','company','corp','corporation','gmbh','inc','incorporated','kk','limited','llc','llp','lp','ltd','nv','oy','plc','pte','pty','sa','sarl','sas','spa','srl'];
begin
  name := lower(regexp_replace(normalize(name, NFKD), '[\u0300-\u036f]', '', 'g'));
  name := replace(name, '&', ' and ');
  name := regexp_replace(name, '\m([a-z])\.(?=[a-z]\.)', '\1', 'g');
  name := btrim(regexp_replace(name, '[^[:alnum:]]+', ' ', 'g'));
  if name = '' then
    return '';
  end if;
  words := string_to_array(name, ' ');
  while cardinality(words) > 1 and words[cardinality(words)] = any(suffixes) loop
    words := words[1:cardinality(words) - 1];
  end loop;
  return array_to_string(words, ' ');
end $$;
revoke all on function public.commerce_mnda_normalize_company(text) from public;
grant execute on function public.commerce_mnda_normalize_company(text) to clockwork_service;

-- Generated, so existing rows are filled by this migration and new rows can
-- never disagree with the lookup.
alter table public.commerce_mnda_requests
  add column normalized_company text generated always as (public.commerce_mnda_normalize_company(input->>'company')) stored;
create index commerce_mnda_requests_normalized_company on public.commerce_mnda_requests (normalized_company) where state <> 'canceled';

create index commerce_mnda_requests_created on public.commerce_mnda_requests (created_at desc, id desc);
create index commerce_mnda_requests_owner_created on public.commerce_mnda_requests (owner_id, created_at desc);
create index commerce_mnda_requests_state on public.commerce_mnda_requests (state);

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
  if new.state = 'completed' and not exists (select 1 from public.commerce_mnda_artifacts where request_id=new.id and kind='executed') then
    raise exception 'MNDA completion requires archived evidence';
  end if;
  return new;
end $$;
