-- RULE BOOKS AND RATES: the data the tax engine consults.
--
-- The owner authorised building the engine on one condition — rates and rules
-- live in DATA that can be amended without a deploy. This migration is where
-- that condition is met or broken. The ALGORITHM (place of supply, reverse
-- charge, rounding, stacking) is stable and belongs in code; every PARAMETER it
-- consults is a row here. A rate in TypeScript is a broken promise, so no rate,
-- no country list and no threshold appears anywhere except in these tables and
-- in supabase/seed.sql.
--
-- THE GRAIN IS THE PRICE BOOK'S, deliberately. price_books/rate_cards
-- (000001:560-569) is a versioned header with immutable published children,
-- frozen by protect_published_pricing (000001:1442-1477) and by
-- protect_published_discount_matrix (001310:15-26) for the jsonb carried on the
-- header. That is exactly a rule book with rates and rule_parameters, and it is
-- already solved here, so it is copied rather than reinvented.

-- PARTS PER MILLION, NOT BASIS POINTS — the one place this repository's money
-- convention genuinely does not stretch.
--
-- The spec's cross-cutting invariants (commerce_platform_spec.md:977-979) say
-- "Money is a signed integer number of minor units, rates are basis points" and
-- "Binary floating point never enters a monetary, quantity, proration, tax, or
-- commission calculation". The float prohibition is absolute and is honoured.
-- The basis-points half cannot be: US combined rates stack state, county, city
-- and district, and New York City's 8.875% is 887.5 basis points, which is not
-- an integer. Rounding it to 887 or 888 bps is a wrong number that looks fine.
--
-- Parts per million keeps the integer rule and buys three more digits: 20% is
-- 200000, 8.875% is 88750, and the representable step is 0.0001%. Every rate
-- this platform is plausibly asked to hold is exact. This is a deliberate,
-- documented departure from the bps convention for tax rates ONLY; commission
-- rates (commission_accruals.rate_bps, 000001:170), discount matrices and every
-- other rate in the schema stay in basis points, because for those the
-- convention does stretch and a second unit would be the real hazard.
create table core_tax_rule_books (
  id uuid primary key default uuid_v7(),
  jurisdiction text not null check (jurisdiction ~ '^[A-Z]{2}(-[A-Z0-9]{1,10}){0,4}$'),
  version integer not null check (version > 0),
  status text not null default 'draft' check (status in ('draft','active','retired')),
  effective_from date not null,
  effective_to date,
  -- Where the algorithm's non-rate parameters live: reverse-charge conditions,
  -- registration thresholds, rounding rule, tax-point rule, scheme semantics,
  -- which tax codes stack. Everything an accountant might amend that is not a
  -- rate. An empty object authorises nothing and is not a claim that no rules
  -- apply, exactly as an empty discount_matrix (001310) authorises no discount.
  rule_parameters jsonb not null default '{}'::jsonb
    check (jsonb_typeof(rule_parameters) = 'object'),
  authority_reference text not null check (length(trim(authority_reference)) > 0),
  determination_source text not null default 'local'
    check (determination_source in ('local','provider')),
  input_provenance text not null default 'unverified'
    check (input_provenance in ('unverified','repository_fixture','live_signed')),
  -- WHETHER THIS BOOK IS THE WHOLE ANSWER FOR THE PLACES BELOW IT. GB and ES
  -- have no taxing subdivisions, so a country book is complete. A US state book
  -- is not: county, city and district rates stack on top, and answering
  -- US-CA-06075 with California's state rate alone is a wrong number that looks
  -- fine — this project's signature defect. So the question is answered by DATA
  -- rather than by a country list in the resolver: 'this_level_only' means a
  -- subdivision must have its own book or the resolution fails closed, and an
  -- accountant who loads California's districts flips one row to
  -- 'whole_jurisdiction' with no deploy.
  subdivision_scope text not null default 'this_level_only'
    check (subdivision_scope in ('whole_jurisdiction','this_level_only')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version integer not null default 1 check (row_version > 0),
  constraint core_tax_rule_books_jurisdiction_version_unique unique (jurisdiction, version),
  -- Half-open window: effective_to is the date the successor takes over, so a
  -- supply ON that date belongs to the successor and never to both.
  constraint core_tax_rule_books_window_check
    check (effective_to is null or effective_to > effective_from),
  constraint core_tax_rule_books_retired_window_check
    check (status <> 'retired' or effective_to is not null)
);
create unique index core_tax_rule_books_active_jurisdiction_unique
  on core_tax_rule_books(jurisdiction) where status = 'active';
create index core_tax_rule_books_resolution_idx
  on core_tax_rule_books(jurisdiction, effective_from desc, effective_to);

comment on table public.core_tax_rule_books is
  'One jurisdiction''s rates and rules at a version, on the price-book grain: draft is editable, published is immutable, a new version supersedes. Amendable without a deploy, which is the condition this engine was authorised under.';
comment on column public.core_tax_rule_books.jurisdiction is
  'Hierarchical place, not a country: GB, ES, US-CA, US-CA-06075. Country-only for VAT and GST; subdivided for US sales tax where state, county, city and district rates stack.';
comment on column public.core_tax_rule_books.rule_parameters is
  'Non-rate parameters the stable algorithm consults. Amended as data. An empty object authorises nothing.';
comment on column public.core_tax_rule_books.authority_reference is
  'The citation the rates in this book came from. Required, because a rate with no stated source cannot be reviewed by the accountant who has to sign it.';
comment on column public.core_tax_rule_books.determination_source is
  'Whether this jurisdiction is determined by the local engine or delegated to an external provider. Per jurisdiction, so a hard regime can be bought while the rest is built.';
comment on column public.core_tax_rule_books.subdivision_scope is
  'whole_jurisdiction: this book answers for this place and everything under it. this_level_only: a subdivision needs its own book and resolution fails closed without one.';

-- PROVENANCE, REUSING THE MECHANISM THAT ALREADY EXISTS.
--
-- Verified: system_external_gates.input_provenance (001000:8-9) is exactly
-- unverified|repository_fixture|live_signed, and system_gate_is_active
-- (001000:22-42) already refuses to report EXT-TAX-01 active unless its
-- provenance is live_signed. Nothing new is invented here; the same column with
-- the same vocabulary moves onto the rule book so the refusal can be made PER
-- JURISDICTION instead of all-or-nothing.
--
-- What this buys: every seeded book ships as repository_fixture, so the engine
-- is live, exercised and tested end to end and is honest for demo, staging and
-- test — while EXT-TAX-01 stays blocked and no live-signed invoice can be
-- issued against fixture rates. When an accountant signs one jurisdiction's
-- matrix, that book flips to live_signed and real invoicing turns on there and
-- nowhere else.
comment on column public.core_tax_rule_books.input_provenance is
  'Same vocabulary as system_external_gates.input_provenance (001000:8). repository_fixture books make the engine exercisable and are refused for a live-signed invoice; live_signed is an accountant''s signature on this jurisdiction''s matrix.';

-- Rates. Immutable unless the parent book is draft, exactly as a rate_card is
-- immutable unless its price book is draft (000001:1470-1476).
create table core_tax_rates (
  id uuid primary key default uuid_v7(),
  tax_rule_book_id uuid not null references core_tax_rule_books(id),
  tax_code text not null check (length(trim(tax_code)) > 0),
  -- Shape-checked, not enumerated, for the same reason scheme is (001410):
  -- 'standard', 'reduced', 'zero', 'second_reduced', 'district' and whatever a
  -- regime invents next are facts about the world, and a closed list here would
  -- make adding one a deploy. What a kind means to the algorithm is
  -- rule_parameters data.
  rate_kind text not null check (rate_kind ~ '^[a-z][a-z0-9_]{1,31}$'),
  rate_ppm bigint not null check (rate_ppm >= 0),
  legal_basis text not null check (length(trim(legal_basis)) > 0),
  notation text not null default '',
  created_at timestamptz not null default now(),
  constraint core_tax_rates_book_code_unique unique (tax_rule_book_id, tax_code)
);
create index core_tax_rates_book_idx on core_tax_rates(tax_rule_book_id);

comment on table public.core_tax_rates is
  'The rates of one rule book, one row per tax code. Editable only while the parent book is draft.';
comment on column public.core_tax_rates.rate_ppm is
  'Rate in PARTS PER MILLION: 20% is 200000 and 8.875% is 88750. Not basis points — a US combined rate of 8.875% is 887.5 bps and is not an integer, and the spec forbids float in a tax calculation. Exact to 0.0001%.';
comment on column public.core_tax_rates.rate_kind is
  'Rate classification, shape-checked and deliberately not enumerated so a new regime''s kind needs no migration.';
comment on column public.core_tax_rates.legal_basis is
  'The provision this rate is charged under. Required: it is what an accountant reviews before signing the jurisdiction.';
comment on column public.core_tax_rates.notation is
  'Free text the invoice may be required to print for this code, such as a reverse-charge notation. Content is an EXT-TAX-01 input.';

-- Published immutability, copied from protect_published_pricing (000001:1442)
-- and protect_published_discount_matrix (001310:15) rather than invented.
--
-- ONE DELIBERATE DIFFERENCE FROM THE PRICE BOOK: input_provenance may move on a
-- published book. It has to — flipping a fixture book to live_signed when the
-- accountant signs it is the entire mechanism of section 3, and a book frozen
-- at repository_fixture could never be signed without being recreated, which
-- would break every determination pinned to its id. Withdrawal is permitted for
-- the same reason in reverse: a signature that has been withdrawn is a real
-- operation, and forcing retire-and-recreate would block it. Every move is
-- recorded in core_tax_rule_book_activation_events (001412).
create or replace function protect_published_tax_rule_book() returns trigger
language plpgsql set search_path = public as $$
declare book_status text;
begin
  if tg_table_name = 'core_tax_rule_books' then
    if tg_op = 'DELETE' then
      if old.status <> 'draft' then
        raise exception using errcode = '55000',
          message = 'published tax rule books are immutable; create a version';
      end if;
      return old;
    end if;
    if old.status <> 'draft' and not (
      new.id is not distinct from old.id
      and new.jurisdiction is not distinct from old.jurisdiction
      and new.version is not distinct from old.version
      and new.effective_from is not distinct from old.effective_from
      and new.rule_parameters is not distinct from old.rule_parameters
      and new.authority_reference is not distinct from old.authority_reference
      and new.determination_source is not distinct from old.determination_source
      and new.subdivision_scope is not distinct from old.subdivision_scope
      and new.created_at is not distinct from old.created_at
    ) then
      raise exception using errcode = '55000',
        message = 'published tax rule books are immutable; create a version';
    end if;
    if new.status is distinct from old.status and not (
      (old.status = 'draft' and new.status in ('active','retired'))
      or (old.status = 'active' and new.status = 'retired')
    ) then
      raise exception using errcode = '23514',
        message = 'invalid tax rule book status transition';
    end if;
  else
    select status into book_status
      from core_tax_rule_books where id = coalesce(new.tax_rule_book_id, old.tax_rule_book_id);
    if book_status <> 'draft' then
      raise exception using errcode = '55000',
        message = 'published tax rates are immutable; create a tax rule book version';
    end if;
    if tg_op = 'DELETE' then return old; end if;
  end if;
  return new;
end $$;
create trigger core_tax_rule_books_immutable
before update or delete on core_tax_rule_books
for each row execute function protect_published_tax_rule_book();
create trigger core_tax_rates_immutable
before update or delete on core_tax_rates
for each row execute function protect_published_tax_rule_book();

-- A rate INSERTed into a published book would be a new rate on a frozen book,
-- which the update/delete trigger above cannot see. The price book has the same
-- shape of hole; it is closed here because a rate appearing under a signed
-- jurisdiction after signature is precisely the value nobody reviewed.
create or replace function protect_tax_rate_insert() returns trigger
language plpgsql set search_path = public as $$
declare book_status text;
begin
  select status into book_status from core_tax_rule_books where id = new.tax_rule_book_id;
  if book_status is distinct from 'draft' then
    raise exception using errcode = '55000',
      message = 'rates are added only to a draft tax rule book; create a version';
  end if;
  return new;
end $$;
create trigger core_tax_rates_draft_only_insert
before insert on core_tax_rates
for each row execute function protect_tax_rate_insert();

create trigger core_tax_rule_books_version before update on core_tax_rule_books
for each row execute function touch_versioned_row();

alter table core_tax_rule_books enable row level security;
alter table core_tax_rule_books force row level security;
alter table core_tax_rates enable row level security;
alter table core_tax_rates force row level security;

-- Rule books carry no account. Drafts are internal; a published book and its
-- rates are readable, because the rate charged on an invoice is not a secret
-- from the person charged. This mirrors core_price_activation_read
-- (000100:620), which exposes an activation only once the book is active.
create policy core_tax_rule_books_read on core_tax_rule_books
for select using (app_is_internal() or status in ('active','retired'));
create policy core_tax_rule_books_write on core_tax_rule_books
for all using (app_is_internal()) with check (app_is_internal());
create policy core_tax_rates_read on core_tax_rates
for select using (
  app_is_internal()
  or exists (
    select 1 from core_tax_rule_books book
    where book.id = tax_rule_book_id and book.status in ('active','retired')
  )
);
create policy core_tax_rates_write on core_tax_rates
for all using (app_is_internal()) with check (app_is_internal());

-- Finance approvers scan drafts to approve them, the same narrow read
-- 001360 gave them on price_books and rate_cards.
create policy core_tax_rule_books_finance_read on core_tax_rule_books
for select to clockwork_runtime
using (app_has_any_role(array['finance_approver']));
create policy core_tax_rates_finance_read on core_tax_rates
for select to clockwork_runtime
using (app_has_any_role(array['finance_approver']));

grant select, insert, update, delete on core_tax_rule_books, core_tax_rates
  to clockwork_runtime, clockwork_service;
revoke insert, update, delete on core_tax_rule_books, core_tax_rates
  from clockwork_runtime;
