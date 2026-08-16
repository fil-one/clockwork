-- WHAT WAS DETERMINED, WHAT IT WAS DETERMINED FROM, AND PER JURISDICTION.
--
-- `invoices` carries two scalars — `tax_minor` and `tax_treatment` — and 001415
-- states plainly what they cannot say: "a bill with one standard line and one
-- reverse-charged line carries a non-zero amount and must therefore record
-- `standard` at the header, and the reverse charge — including the notation the
-- document is legally required to print — is invisible at this grain. The
-- header is a summary; the per-line, per-jurisdiction truth needs its own
-- table."
--
-- This is that table, and its parent. Neither is landed as a declaration: the
-- writer is in the same change (`packages/db/src/repositories/core/
-- tax-determination.ts`, called from both invoice writers), and the round
-- before this one correctly REFUSED to land these tables without it.
--
-- THE PARENT STORES THE QUESTION, NOT ONLY THE ANSWER. `determination_input` is
-- the canonical JSON of everything the engine was given — both parties, their
-- registrations, the lines with their frozen tax codes, the tax point, and the
-- exact rule books consulted with their versions — hashed the same way
-- `core_invoice_document_snapshots` (001300) hashes its source. An answer with
-- no question cannot be replayed, and a determination that cannot be replayed
-- cannot be defended two years later to somebody who is not in the room.

-- WHERE AN ADDRESS IS, ACCORDING TO THE BOOKS THEMSELVES.
--
-- `core_resolve_tax_rule_book` (001413) answers for a jurisdiction that the
-- caller already knows. For a customer in Seattle nobody knows it: the supply
-- is in US-WA because Washington's book says the 980-994 ZIP prefixes are its
-- authority's, and that statement is rule-book data. Deriving it in code would
-- put a postal map in TypeScript, which is the one thing the rates and rules
-- were made amendable to avoid.
--
-- So the address is matched against the authorities the books DECLARE, most
-- specific first, and falls back to the country when no authority claims it.
-- The fallback is not a guess: it resolves the country book, and a country book
-- with no authority of its own (the United States has none — there is no
-- federal sales tax) then produces a refusal rather than a rate.
create or replace function core_tax_place_for_address(
  place_country text,
  place_region text,
  place_postal_code text,
  tax_point date
)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select book.jurisdiction
    from public.core_tax_rule_books book,
         lateral jsonb_array_elements(
           coalesce(book.rule_parameters -> 'engine' -> 'jurisdictions', '[]'::jsonb)
         ) as authority
    where book.status in ('active','retired')
      and book.effective_from <= tax_point
      and (book.effective_to is null or tax_point < book.effective_to)
      and split_part(book.jurisdiction, '-', 1) = upper(trim(place_country))
      and (
        exists (
          select 1
          from jsonb_array_elements_text(
            coalesce(authority -> 'postalPrefixes', '[]'::jsonb)
          ) as prefix
          where place_postal_code is not null
            and starts_with(
              upper(replace(place_postal_code, ' ', '')), upper(prefix.value)
            )
        )
        or exists (
          select 1
          from jsonb_array_elements_text(
            coalesce(authority -> 'regions', '[]'::jsonb)
          ) as region
          where place_region is not null
            and upper(trim(region.value)) = upper(trim(place_region))
        )
      )
    order by length(book.jurisdiction) desc, book.version desc
    limit 1
  ), upper(trim(place_country)))
$$;

revoke all on function public.core_tax_place_for_address(text, text, text, date) from public;
grant execute on function public.core_tax_place_for_address(text, text, text, date)
  to clockwork_runtime, clockwork_service;

comment on function public.core_tax_place_for_address(text, text, text, date) is
  'The taxing place an address falls in, decided by the postal prefixes and regions the rule books declare rather than by a map compiled into code. Falls back to the country, which is a refusal wherever the country has no authority of its own.';

-- WHICH BOOKS ANSWER A SUPPLY. Three questions, each resolved by 001413's rule:
-- the supplier's country (its territory and its export rule), the customer's
-- country (its territory), and the customer's PLACE (the authority that
-- charges). For a VAT country all three are the same book; for a US supply they
-- are the country book and the state's.
--
-- BOTH RULES 001413 STATES ARE KEPT, because they are the rules and not
-- implementation detail:
--
--   * a RETIRED book is the right answer for a back-dated tax point, which
--     `core_resolve_tax_rule_book` already does;
--   * a REVERSAL does not resolve by date at all. Given pins, this returns
--     exactly the pinned books and reads no window, so crediting last year''s
--     supply reproduces last year''s books by pointer.
--
-- A question with no answer RAISES rather than returning fewer books. A
-- composition missing the customer''s authority would determine against the
-- supplier''s alone and produce a confident wrong number.
create or replace function core_tax_rule_books_for_supply(
  supplier_country text,
  customer_country text,
  customer_region text,
  customer_postal_code text,
  tax_point date,
  pinned_rule_book_ids uuid[] default null
)
returns setof uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  pinned_count integer;
  needed text[];
  place text;
  candidate text;
  resolved uuid;
  seen uuid[] := array[]::uuid[];
begin
  if pinned_rule_book_ids is not null and array_length(pinned_rule_book_ids, 1) > 0 then
    select count(*) into pinned_count
    from public.core_tax_rule_books book
    where book.id = any(pinned_rule_book_ids);
    -- A pin that points at nothing is a bug in the caller, not a reason to fall
    -- back to a date lookup: falling back would re-determine a reversal against
    -- whatever is in force today, which is the drift the pin exists to prevent.
    if pinned_count <> array_length(pinned_rule_book_ids, 1) then
      raise exception using errcode = '23503',
        message = 'a pinned tax rule book does not exist; a reversal cannot be re-determined';
    end if;
    return query select unnest(pinned_rule_book_ids);
    return;
  end if;
  place := public.core_tax_place_for_address(
    customer_country, customer_region, customer_postal_code, tax_point
  );
  needed := array[
    upper(trim(supplier_country)), upper(trim(customer_country)), place
  ];
  foreach candidate in array needed loop
    resolved := public.core_resolve_tax_rule_book(candidate, tax_point);
    if resolved is null then
      raise exception using errcode = '23514',
        message = format('no tax rule book answers for %s on %s', candidate, tax_point);
    end if;
    if not (resolved = any(seen)) then
      seen := seen || resolved;
    end if;
  end loop;
  return query
    select book.id from public.core_tax_rule_books book
    where book.id = any(seen)
    order by book.jurisdiction;
end $$;

revoke all on function public.core_tax_rule_books_for_supply(text, text, text, text, date, uuid[]) from public;
grant execute on function public.core_tax_rule_books_for_supply(text, text, text, text, date, uuid[])
  to clockwork_runtime, clockwork_service;

comment on function public.core_tax_rule_books_for_supply(text, text, text, text, date, uuid[]) is
  'Every rule book a supply needs: the supplier country''s, the customer country''s and the customer''s taxing place, each resolved by 001413''s date rule with retired books included. With pins it returns exactly those books and reads no date, which is how a reversal reproduces its original determination.';

-- THE DETERMINATION, ONE ROW PER INVOICE.
create table core_invoice_tax_determinations (
  invoice_id uuid primary key references invoices(id),
  order_id uuid not null references orders(id),
  -- The engine's own identifier for this answer, supplied by the caller so the
  -- engine reads no generator. Unique, so two invoices cannot claim one answer.
  determination_id uuid not null unique,
  supplier_legal_entity_id uuid not null references core_legal_entities(id),
  -- Null is the `not_registered` case and is not an omission: 001410 states
  -- that no active registration in the place of supply means no tax charged and
  -- the treatment recorded. The column being empty is that statement.
  supplier_registration_id uuid references core_tax_registrations(id),
  customer_account_id uuid not null references accounts(id),
  customer_registration_id uuid references core_account_tax_identifiers(id),
  customer_status text not null check (customer_status in ('business','consumer')),
  -- Plural because a document whose lines are supplied in different places has
  -- more than one place of supply, and a scalar would be a wrong number for it.
  place_of_supply text[] not null check (array_length(place_of_supply, 1) >= 1),
  tax_point_date date not null,
  currency text not null check (currency in ('USD','EUR','GBP')),
  net_minor bigint not null check (net_minor >= 0),
  tax_minor bigint not null,
  treatment text not null check (treatment in (
    'standard','reverse_charge','zero_rated','exempt','out_of_scope','not_registered'
  )),
  confidence text not null check (confidence in ('determined','review_required')),
  review_reasons text[] not null default '{}',
  rounding text not null check (rounding in ('line','invoice')),
  -- The weakest provenance among the books consulted. A determination is only
  -- as signed as its least signed input, and recording the strongest would let
  -- one signed jurisdiction launder a fixture rate from another.
  input_provenance text not null
    check (input_provenance in ('unverified','repository_fixture','live_signed')),
  determination_input jsonb not null
    check (jsonb_typeof(determination_input) = 'object'),
  determination_input_hash text not null
    check (determination_input_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  -- The same rule the invoice header carries (001392, widened at 001415): one
  -- treatment admits an amount. Stated here too because this row is written by
  -- a different statement and a disagreement between them is exactly the drift
  -- the pair exists to prevent.
  constraint core_invoice_tax_determinations_amount_check
    check (treatment = 'standard' or tax_minor = 0),
  constraint core_invoice_tax_determinations_review_check
    check ((confidence = 'review_required') = (array_length(review_reasons, 1) >= 1))
);
create index core_invoice_tax_determination_order_idx
  on core_invoice_tax_determinations(order_id);
create index core_invoice_tax_determination_entity_idx
  on core_invoice_tax_determinations(supplier_legal_entity_id, tax_point_date);
create unique index core_invoice_tax_determination_input_unique
  on core_invoice_tax_determinations(determination_input_hash);

comment on table public.core_invoice_tax_determinations is
  'What was determined for an invoice and what it was determined from. Stores the QUESTION as canonical JSON with its hash, so the answer can be replayed against the books it was pinned to rather than merely believed.';
comment on column public.core_invoice_tax_determinations.determination_input is
  'The engine input, canonically serialised: both parties, their registrations, the lines with their frozen tax codes, the tax point, and the rule books consulted with their versions. Everything needed to reach this answer again and nothing that is the answer.';
comment on column public.core_invoice_tax_determinations.input_provenance is
  'The WEAKEST provenance among the books consulted (001411 vocabulary). A determination is only as signed as its least signed input.';
comment on column public.core_invoice_tax_determinations.supplier_registration_id is
  'The registration the charge was made under, or null. Null is the not_registered determination, which is a claim about us and not a zero rate.';

-- ONE ROW PER LINE PER JURISDICTION, which is the grain a stacked sales tax and
-- a mixed-treatment document both need and the invoice header cannot hold.
create table core_invoice_tax_lines (
  invoice_id uuid not null references invoices(id),
  -- TEXT, not a foreign key, and deliberately: a line is a
  -- `core_order_line_snapshots` id for everything that was quoted, and the
  -- signed net delta of accepted amendments has no line of its own to point at.
  -- Refusing to determine an amended invoice would be a control blocking a
  -- legitimate operation, so the delta is a line named `amendment-delta` and
  -- the shape is constrained rather than left free.
  line_id text not null check (
    line_id = 'amendment-delta'
    or line_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  jurisdiction text not null check (jurisdiction ~ '^[A-Z]{2}(-[A-Z0-9]{1,10}){0,4}$'),
  treatment text not null check (treatment in (
    'standard','reverse_charge','zero_rated','exempt','out_of_scope','not_registered'
  )),
  tax_code text not null check (length(trim(tax_code)) > 0),
  rate_ppm bigint not null check (rate_ppm >= 0),
  rate_kind text not null check (length(trim(rate_kind)) > 0),
  taxable_minor bigint not null,
  tax_minor bigint not null,
  rule_book_id uuid not null references core_tax_rule_books(id),
  rule_book_version integer not null check (rule_book_version > 0),
  legal_basis text not null check (length(trim(legal_basis)) > 0),
  notation text not null default '',
  created_at timestamptz not null default now(),
  primary key (invoice_id, line_id, jurisdiction),
  -- Only a standard supply carries an amount or a rate, on this grain as on the
  -- header's. A reverse charge at 20% recorded here would be a rate nobody
  -- charged, sitting next to a zero.
  constraint core_invoice_tax_lines_amount_check
    check (treatment = 'standard' or (tax_minor = 0 and rate_ppm = 0))
);
create index core_invoice_tax_lines_jurisdiction_idx
  on core_invoice_tax_lines(jurisdiction, treatment);
create index core_invoice_tax_lines_book_idx
  on core_invoice_tax_lines(rule_book_id);

comment on table public.core_invoice_tax_lines is
  'One taxing authority''s answer for one line. Stacked sales taxes produce several rows for one line, and a mixed-treatment document is legible here where the invoice header can only summarise it.';
comment on column public.core_invoice_tax_lines.rate_ppm is
  'Parts per million, matching core_tax_rates.rate_ppm: 8.875% is 88750 and is not an integer number of basis points.';
comment on column public.core_invoice_tax_lines.rule_book_id is
  'The book that published this answer. A composed determination reads several books and each row names the one it came from, which is what makes the replay a comparison and not a re-derivation.';

-- VALIDATION BEFORE INSERT, in the shape of validate_invoice_document_snapshot
-- (001300:374): every fact this row repeats is checked against the row it was
-- copied from, and the canonical hash is recomputed here rather than trusted.
create or replace function public.validate_invoice_tax_determination()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, public, private, extensions
as $$
declare
  persisted_invoice public.invoices%rowtype;
  binding public.core_order_supplier_bindings%rowtype;
  expected_hash text;
  weakest integer;
begin
  select * into persisted_invoice from public.invoices where id = new.invoice_id for share;
  if persisted_invoice.id is null
    or new.order_id is distinct from persisted_invoice.order_id
    or new.customer_account_id is distinct from persisted_invoice.account_id
    or new.currency is distinct from persisted_invoice.currency
    or new.tax_minor is distinct from persisted_invoice.tax_minor
    or new.treatment is distinct from persisted_invoice.tax_treatment
    or new.net_minor is distinct from persisted_invoice.amount_minor - persisted_invoice.tax_minor
  then
    raise exception using errcode = '23514',
      message = 'invoice tax determination must describe the invoice it is written for';
  end if;

  -- THE SUPPLIER IS THE ONE THE ORDER WAS BOUND TO AT ACCEPTANCE (001416), not
  -- one resolved again at invoice time. Re-resolving here would let a
  -- restatement of the assignments move the supplier of a supply that has
  -- already been made, which is the whole reason the binding is pinned.
  select * into binding from public.core_order_supplier_bindings
  where order_id = new.order_id;
  if binding.order_id is null
    or binding.supplier_legal_entity_id is distinct from new.supplier_legal_entity_id
  then
    raise exception using errcode = '23514',
      message = 'invoice tax determination must name the entity the order was bound to at acceptance';
  end if;

  if new.supplier_registration_id is not null and not exists (
    select 1 from public.core_tax_registrations registration
    where registration.id = new.supplier_registration_id
      and registration.legal_entity_id = new.supplier_legal_entity_id
  ) then
    raise exception using errcode = '23514',
      message = 'the registration a determination charged under must belong to its supplier';
  end if;
  if new.customer_registration_id is not null and not exists (
    select 1 from public.core_account_tax_identifiers identifier
    where identifier.id = new.customer_registration_id
      and identifier.account_id = new.customer_account_id
  ) then
    raise exception using errcode = '23514',
      message = 'the customer registration a determination relied on must belong to its customer';
  end if;

  -- The stored question is hashed here, not accepted from the writer. A hash
  -- the writer computed over something else is a question nobody can check.
  expected_hash := encode(extensions.digest(
    convert_to(private.canonical_jsonb_text(new.determination_input), 'UTF8'), 'sha256'
  ), 'hex');
  if new.determination_input_hash is distinct from expected_hash then
    raise exception using errcode = '23514',
      message = 'invoice tax determination canonical input hash mismatch';
  end if;

  -- The provenance recorded is the weakest of the books the question names. A
  -- determination that read one fixture book is a fixture determination however
  -- many signed books it read beside it.
  select min(
    case book.input_provenance
      when 'unverified' then 0 when 'repository_fixture' then 1 else 2 end
  ) into weakest
  from public.core_tax_rule_books book
  where book.id::text in (
    select jsonb_array_elements(new.determination_input -> 'ruleBooks') ->> 'id'
  );
  if weakest is null then
    raise exception using errcode = '23514',
      message = 'invoice tax determination names no rule book it was made against';
  end if;
  if new.input_provenance is distinct from
     (array['unverified','repository_fixture','live_signed'])[weakest + 1] then
    raise exception using errcode = '23514',
      message = 'invoice tax determination provenance must be the weakest of the books it read';
  end if;
  return new;
end $$;

revoke all on function public.validate_invoice_tax_determination() from public;
create trigger core_invoice_tax_determination_validate
before insert on public.core_invoice_tax_determinations
for each row execute function public.validate_invoice_tax_determination();

create or replace function public.protect_invoice_tax_determination()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception using errcode = '55000',
    message = 'invoice tax determinations and their lines are immutable; a corrected supply is a credit note';
end $$;
create trigger core_invoice_tax_determination_immutable
before update or delete on public.core_invoice_tax_determinations
for each row execute function public.protect_invoice_tax_determination();
create trigger core_invoice_tax_line_immutable
before update or delete on public.core_invoice_tax_lines
for each row execute function public.protect_invoice_tax_determination();

-- CROSS-ROW IDENTITY, as a deferred constraint trigger, following
-- validate_invoice_payment_projection_truth (001392) for what it checks and
-- core_validate_financial_rollup (000100:511) for how a parent and its children
-- are checked together: the lines cannot exist when the parent is inserted, so
-- the check runs at commit and holds over the pair.
create or replace function public.core_validate_invoice_tax_rollup()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_invoice uuid;
  determination public.core_invoice_tax_determinations%rowtype;
  line_tax bigint;
  line_count integer;
  mismatched integer;
begin
  target_invoice := case tg_table_name
    when 'core_invoice_tax_determinations' then new.invoice_id
    else new.invoice_id end;
  select * into determination from public.core_invoice_tax_determinations
  where invoice_id = target_invoice;
  if determination.invoice_id is null then
    raise exception using errcode = '23514',
      message = 'a tax line belongs to a determination; write the determination first';
  end if;
  select coalesce(sum(line.tax_minor), 0), count(*)
    into line_tax, line_count
  from public.core_invoice_tax_lines line
  where line.invoice_id = target_invoice;
  if line_count = 0 then
    raise exception using errcode = '23514',
      message = 'a determination with no per-jurisdiction lines states an answer it cannot show';
  end if;
  -- The per-jurisdiction rows ARE the tax. A header that disagrees with them is
  -- a figure nobody can trace to an authority.
  if line_tax <> determination.tax_minor then
    raise exception using errcode = '23514',
      message = 'invoice tax lines must sum to the determination and to the invoice';
  end if;
  -- Each row's pinned version must be the version the book it names actually
  -- carries, or the pin points at a book that says something else.
  select count(*) into mismatched
  from public.core_invoice_tax_lines line
  join public.core_tax_rule_books book on book.id = line.rule_book_id
  where line.invoice_id = target_invoice
    and book.version <> line.rule_book_version;
  if mismatched > 0 then
    raise exception using errcode = '23514',
      message = 'a tax line pins a rule book version the book does not carry';
  end if;
  return new;
end $$;

revoke all on function public.core_validate_invoice_tax_rollup() from public;
create constraint trigger core_invoice_tax_determination_rollup
after insert or update on public.core_invoice_tax_determinations
deferrable initially deferred for each row
execute function public.core_validate_invoice_tax_rollup();
create constraint trigger core_invoice_tax_line_rollup
after insert or update on public.core_invoice_tax_lines
deferrable initially deferred for each row
execute function public.core_validate_invoice_tax_rollup();

alter table core_invoice_tax_determinations enable row level security;
alter table core_invoice_tax_determinations force row level security;
alter table core_invoice_tax_lines enable row level security;
alter table core_invoice_tax_lines force row level security;

-- The tax charged on an invoice is not a secret from the person charged: the
-- notation, the rate and the authority are what the document has to print. The
-- read follows the invoice's own reach.
create policy core_invoice_tax_determination_read on core_invoice_tax_determinations
for select using (
  app_is_internal()
  or exists (
    select 1 from public.invoices invoice
    where invoice.id = invoice_id and app_has_account(invoice.account_id)
  )
);
-- The write follows the invoice's own reach rather than being internal-only:
-- both invoice writers run on the tenant pool inside the same transaction that
-- writes the invoice, and an internal-only policy here would refuse the
-- determination for a command the invoice policies admit — a control blocking a
-- legitimate operation. Nothing is taken on trust by widening it: the validation
-- trigger above refuses any row that does not match the persisted invoice, the
-- order's acceptance binding and the books it names.
create policy core_invoice_tax_determination_write on core_invoice_tax_determinations
for all using (
  app_is_internal()
  or exists (
    select 1 from public.invoices invoice
    where invoice.id = invoice_id and app_has_account(invoice.account_id)
  )
) with check (
  app_is_internal()
  or exists (
    select 1 from public.invoices invoice
    where invoice.id = invoice_id and app_has_account(invoice.account_id)
  )
);
create policy core_invoice_tax_line_read on core_invoice_tax_lines
for select using (
  app_is_internal()
  or exists (
    select 1 from public.invoices invoice
    where invoice.id = invoice_id and app_has_account(invoice.account_id)
  )
);
create policy core_invoice_tax_line_write on core_invoice_tax_lines
for all using (
  app_is_internal()
  or exists (
    select 1 from public.invoices invoice
    where invoice.id = invoice_id and app_has_account(invoice.account_id)
  )
) with check (
  app_is_internal()
  or exists (
    select 1 from public.invoices invoice
    where invoice.id = invoice_id and app_has_account(invoice.account_id)
  )
);

-- Both invoice writers run on the tenant pool, so the runtime role inserts
-- here; the row policies above are what authorise the write, and nothing may
-- update or delete either table.
grant select, insert, update, delete
  on core_invoice_tax_determinations, core_invoice_tax_lines
  to clockwork_runtime, clockwork_service;
revoke update, delete
  on core_invoice_tax_determinations, core_invoice_tax_lines
  from clockwork_runtime;
