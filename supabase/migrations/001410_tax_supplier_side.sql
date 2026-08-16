-- THE SUPPLIER SIDE OF THE TRANSACTION, WHICH THIS SCHEMA DID NOT HAVE.
--
-- Verified before writing: `accounts` holds counterparties only — its
-- relationship_roles are direct_client, partner and end_client — and there is
-- no table anywhere in supabase/migrations that models an entity WE sell from,
-- nor any table of tax registrations. Every place-of-supply
-- rule in every VAT/GST/sales-tax regime is a function of both sides, so the
-- half that was missing is the half that decides.
--
-- This is not scaffolding for a later feature. It is the reason the current
-- determination is wrong: `TaxPort.calculate` takes one `jurisdiction: string`
-- documented in packages/contracts/src/providers.ts:153 as "Country of the
-- account being invoiced — the merchant-of-record side", and
-- packages/db/src/repositories/core/database-finance.ts:2185 populates it with
-- `invoicedAccount.country`. Confirmed by reading both. Those two statements
-- contradict each other on every route where the invoiced account is not the
-- merchant: `core_quote_commercial_profiles.merchant_of_record` (000100:86)
-- admits 'partner', and on resale and distributor routes the invoiced account
-- IS the partner. A US entity selling to a Spanish reseller therefore
-- determines against ES today and would bill Spanish VAT on a supply that
-- should be reverse charged. The comment is the wrong description AND the code
-- reads the wrong side; fixing the comment alone would leave the number wrong.
--
-- These two tables give the determination somewhere to read the supplier from.
-- Wiring the engine to read it is the engine lane's work.

-- Our selling entities, and the same shape a partner-as-merchant fills.
-- `merchant_role` makes `account_id`'s nullability mean something a constraint
-- can hold: an entity of ours has no counterparty account, and a partner
-- merchant of record is exactly an entity that points at one.
--
-- The invoice header and footer text are EXT-BRAND-01 inputs. The columns are
-- here because a legal entity is where an invoice's issuing identity lives;
-- the CONTENT is not written by this migration and the seed carries only
-- fictional placeholder text.
create table core_legal_entities (
  id uuid primary key default uuid_v7(),
  legal_name text not null check (length(trim(legal_name)) > 0),
  merchant_role text not null check (merchant_role in ('our_entity','partner_entity')),
  account_id uuid references accounts(id),
  established_country text not null check (established_country ~ '^[A-Z]{2}$'),
  registered_address jsonb not null check (jsonb_typeof(registered_address) = 'object'),
  invoice_header_text text not null default '',
  invoice_footer_text text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version integer not null default 1 check (row_version > 0),
  constraint core_legal_entities_partner_account_check
    check ((merchant_role = 'partner_entity') = (account_id is not null))
);
create index core_legal_entities_account_idx on core_legal_entities(account_id);
create trigger core_legal_entities_version before update on core_legal_entities
for each row execute function touch_versioned_row();

comment on table public.core_legal_entities is
  'Entities that can be the merchant of record on a supply: ours, and partner accounts acting as merchant. The supplier side of every place-of-supply rule.';
comment on column public.core_legal_entities.established_country is
  'ISO 3166-1 alpha-2 country of establishment. Deliberately a country and not a hierarchical jurisdiction: establishment is a country-level fact even where the tax is subdivided.';
comment on column public.core_legal_entities.account_id is
  'The counterparty account this entity is, when a partner is the merchant of record. Null for our own entities, and the biconditional with merchant_role is enforced.';
comment on column public.core_legal_entities.invoice_header_text is
  'Issuing identity text printed on invoices. Content is an EXT-BRAND-01 input; this column only gives it a home.';

-- THE OPERATOR'S STATEMENT of where a merchant is registered. Dated rows in the
-- shape of core_partner_transfer_tiers (000100:77-84), with the
-- partial-unique-active idiom of core_partner_hierarchy_edges (000100:220-228).
--
-- THE RULE THIS TABLE EXISTS TO MAKE ENFORCEABLE: the code never infers a
-- registration and never creates one. No active registration in the place of
-- supply means the determination is `not_registered` — no tax charged, the
-- treatment recorded, an exception raised. It does not zero-rate, because a
-- zero rate is a claim about the law and "we are not registered here" is a
-- claim about us. `core_tax_registration_at` in 001413 is the only read path
-- and it returns null rather than inventing a row.
--
-- `scheme` is SHAPE-CHECKED AND NOT ENUMERATED, on purpose. A closed list of
-- scheme names ('vat','gst','sales_tax', …) is a rule about the world living in
-- a migration, and the whole basis on which this work was authorised is that
-- rules the engine consults are amendable data. An operator who has to ship a
-- migration to record a registration under a scheme nobody listed is blocked
-- from a legitimate operation. What the scheme MEANS to the engine lives in
-- core_tax_rule_books.rule_parameters, which is amendable.
create table core_tax_registrations (
  id uuid primary key default uuid_v7(),
  legal_entity_id uuid not null references core_legal_entities(id),
  jurisdiction text not null check (jurisdiction ~ '^[A-Z]{2}(-[A-Z0-9]{1,10}){0,4}$'),
  scheme text not null check (scheme ~ '^[a-z][a-z0-9_]{1,31}$'),
  registration_number text not null check (length(trim(registration_number)) > 0),
  effective_from date not null,
  effective_to date,
  status text not null default 'pending'
    check (status in ('pending','active','deregistered')),
  stated_by uuid not null references commerce_users(id),
  stated_at timestamptz not null,
  evidence_document_id uuid references documents(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version integer not null default 1 check (row_version > 0),
  constraint core_tax_registrations_window_check
    check (effective_to is null or effective_to > effective_from),
  -- An active registration is what authorises charging tax in someone else's
  -- country. Recording that with no evidence at all is the claim without the
  -- basis. A 'pending' row may have none: the certificate routinely arrives
  -- after the application, and refusing to record the application would block
  -- a legitimate operation.
  constraint core_tax_registrations_active_evidence_check
    check (status <> 'active' or evidence_document_id is not null)
);
create unique index core_tax_registrations_active_unique
  on core_tax_registrations(legal_entity_id, jurisdiction, scheme)
  where status = 'active';
create index core_tax_registrations_lookup_idx
  on core_tax_registrations(jurisdiction, status, effective_from);
create index core_tax_registrations_entity_idx
  on core_tax_registrations(legal_entity_id, status);
create trigger core_tax_registrations_version before update on core_tax_registrations
for each row execute function touch_versioned_row();

-- Once a registration has been stated as active it is the recorded basis for
-- tax already charged under it. Correcting it in place rewrites that basis, so
-- everything except the status advance and the closing date is frozen; a
-- different registration number is a different registration and gets a row.
create or replace function protect_stated_tax_registration() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'pending' then return old; end if;
    raise exception using errcode = '55000',
      message = 'a stated tax registration is not deleted; deregister it';
  end if;
  if old.status <> 'pending' and (
    new.legal_entity_id is distinct from old.legal_entity_id
    or new.jurisdiction is distinct from old.jurisdiction
    or new.scheme is distinct from old.scheme
    or new.registration_number is distinct from old.registration_number
    or new.effective_from is distinct from old.effective_from
    or new.stated_by is distinct from old.stated_by
    or new.stated_at is distinct from old.stated_at
    or new.evidence_document_id is distinct from old.evidence_document_id
  ) then
    raise exception using errcode = '55000',
      message = 'a stated tax registration is immutable; state a new registration';
  end if;
  if new.status is distinct from old.status and not (
    (old.status = 'pending' and new.status in ('active','deregistered'))
    or (old.status = 'active' and new.status = 'deregistered')
  ) then
    raise exception using errcode = '23514',
      message = 'invalid tax registration status transition';
  end if;
  return new;
end $$;
create trigger core_tax_registrations_stated_immutable
before update or delete on core_tax_registrations
for each row execute function protect_stated_tax_registration();

comment on table public.core_tax_registrations is
  'Operator statements of where a merchant of record is registered. The engine reads these and never writes one: no active registration in the place of supply is a not_registered determination, not a zero rate.';
comment on column public.core_tax_registrations.jurisdiction is
  'Hierarchical place, not a country: GB, ES, US-CA, US-CA-06075. A registration at an ancestor level covers its subdivisions; core_tax_registration_at (001413) does that walk.';
comment on column public.core_tax_registrations.scheme is
  'Registration scheme identifier, shape-checked and deliberately not enumerated. What a scheme means to the determination is rule-book data, so a new scheme needs no deploy.';
comment on column public.core_tax_registrations.stated_by is
  'The operator who stated this registration. The statement is the evidence; nothing in this system derives a registration.';

alter table core_legal_entities enable row level security;
alter table core_legal_entities force row level security;
alter table core_tax_registrations enable row level security;
alter table core_tax_registrations force row level security;

-- Our own selling entities are readable by anyone who is billed by one: the
-- issuing identity is printed on their invoice. A partner-merchant entity is
-- additionally readable by the partner account it is. Writes are internal, the
-- same way core_account_tax_identifiers (000100:620) is written.
create policy core_legal_entities_read on core_legal_entities
for select using (
  app_is_internal()
  or merchant_role = 'our_entity'
  or app_has_account(account_id)
);
create policy core_legal_entities_write on core_legal_entities
for all using (app_is_internal()) with check (app_is_internal());
create policy core_tax_registrations_read on core_tax_registrations
for select using (
  app_is_internal()
  or exists (
    select 1 from core_legal_entities entity
    where entity.id = legal_entity_id and entity.account_id is not null
      and app_has_account(entity.account_id)
  )
);
create policy core_tax_registrations_write on core_tax_registrations
for all using (app_is_internal()) with check (app_is_internal());

grant select, insert, update, delete on core_legal_entities, core_tax_registrations
  to clockwork_runtime, clockwork_service;
revoke insert, update, delete on core_legal_entities, core_tax_registrations
  from clockwork_runtime;
