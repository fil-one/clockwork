-- RESOLUTION BY DATE, AND THE TRAP IN IT.
--
-- Price books never resolve "the one active at time T" — the caller supplies
-- the id it pinned (verified: `quotes.price_book_id`, and every read in
-- database-finance.ts goes by id). Tax has no caller who knows the id, because
-- the jurisdiction is discovered from the two parties and the date, so
-- resolution is genuinely new work rather than a pattern already in the tree.
--
-- Two rules, and the second is the one that prevents silent wrongness.

-- Ancestors of a hierarchical jurisdiction, most specific first:
-- 'US-CA-06075' -> {US-CA-06075, US-CA, US}. Pure text, no country knowledge:
-- the hierarchy is in the identifier, so this function stays correct when a
-- regime nobody anticipated is loaded as data.
create or replace function core_tax_jurisdiction_ancestors(candidate text)
returns text[]
language sql
immutable
set search_path = public
as $$
  select array_agg(prefix order by length(prefix) desc)
  from (
    select array_to_string(segments[1:depth], '-') as prefix
    from (select string_to_array(upper(trim(candidate)), '-') as segments) split,
         generate_series(1, coalesce(array_length(split.segments, 1), 0)) as depth
  ) prefixes
$$;

comment on function public.core_tax_jurisdiction_ancestors(text) is
  'Prefix chain of a hierarchical jurisdiction, most specific first. The hierarchy lives in the identifier, so no country list is compiled in.';

-- OVERLAP. The partial unique index in 001411 stops two ACTIVE books for one
-- jurisdiction; it says nothing about two RETIRED books whose windows overlap,
-- and a back-dated tax point landing in both would resolve to whichever sorted
-- first. That is the same class of defect as picking today's rates for last
-- quarter's supply, so the window is made non-overlapping here.
--
-- Done with a trigger and an advisory lock rather than an exclusion constraint
-- because that would need btree_gist, and this repository installs exactly two
-- extensions (000001:3-4). The advisory lock is what makes the check hold under
-- concurrency: without it two transactions could each see the other's row as
-- absent. It is keyed on the jurisdiction, so it serialises only publications
-- of the same place.
create or replace function protect_tax_rule_book_windows() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status not in ('active','retired') then return new; end if;
  perform pg_advisory_xact_lock(hashtext('core_tax_rule_books:' || new.jurisdiction));
  if exists (
    select 1
    from public.core_tax_rule_books other
    where other.id <> new.id
      and other.jurisdiction = new.jurisdiction
      and other.status in ('active','retired')
      and daterange(other.effective_from, other.effective_to, '[)')
          && daterange(new.effective_from, new.effective_to, '[)')
  ) then
    raise exception using errcode = '23505',
      message = format(
        'a published tax rule book already covers part of %s from %s',
        new.jurisdiction, new.effective_from
      );
  end if;
  return new;
end $$;
create trigger core_tax_rule_books_window_exclusion
before insert or update on core_tax_rule_books
for each row execute function protect_tax_rule_book_windows();

-- RULE ONE — a NEW supply resolves by date over status in ('active','retired').
-- A RETIRED book is the correct answer for a back-dated tax point. Filtering on
-- 'active' alone would silently price last quarter's supply at today's rates,
-- which is a wrong number that looks entirely fine on the invoice.
--
-- RULE TWO — a REVERSAL does not resolve by date at all. A credit note, a
-- refund adjustment or an amendment reversing a superseded line carries the
-- rule book id the original determination pinned, and reproduction by pointer
-- cannot drift. That is why `pinned_rule_book_id` short-circuits everything:
-- the reversal path is not a date lookup that happens to agree, it is a
-- different operation, and making it a parameter of the same function is what
-- stops a caller from reaching for the date lookup on a reversal.
--
-- Returns null when nothing answers. Null is a refusal, not a zero rate: the
-- caller records the treatment and raises an exception, exactly as it must when
-- there is no active registration.
create or replace function core_resolve_tax_rule_book(
  candidate_jurisdiction text,
  tax_point date,
  pinned_rule_book_id uuid default null
)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare resolved uuid;
begin
  if pinned_rule_book_id is not null then
    -- A pin that points at nothing is a bug in the caller, not a reason to
    -- fall back to a date lookup. Falling back would silently re-determine a
    -- reversal against a different book, which is the drift this rule exists
    -- to prevent, so it fails loudly instead.
    if not exists (
      select 1 from public.core_tax_rule_books book where book.id = pinned_rule_book_id
    ) then
      raise exception using errcode = '23503',
        message = 'pinned tax rule book does not exist; a reversal cannot be re-determined';
    end if;
    return pinned_rule_book_id;
  end if;
  select book.id into resolved
  from public.core_tax_rule_books book
  where book.jurisdiction = any(core_tax_jurisdiction_ancestors(candidate_jurisdiction))
    and book.status in ('active','retired')
    and book.effective_from <= tax_point
    and (book.effective_to is null or tax_point < book.effective_to)
    -- An ancestor book answers for a subdivision only when it says it is the
    -- whole answer there. A US state book that has not had its county, city and
    -- district rates loaded resolves to nothing for US-CA-06075 rather than to
    -- the state rate alone.
    and (
      book.jurisdiction = upper(trim(candidate_jurisdiction))
      or book.subdivision_scope = 'whole_jurisdiction'
    )
  order by length(book.jurisdiction) desc, book.version desc
  limit 1;
  return resolved;
end $$;

revoke all on function public.core_resolve_tax_rule_book(text, date, uuid) from public;
grant execute on function public.core_resolve_tax_rule_book(text, date, uuid)
  to clockwork_runtime, clockwork_service;

comment on function public.core_resolve_tax_rule_book(text, date, uuid) is
  'Rule book for a supply. With a pin, returns it verbatim — a reversal reproduces by pointer and never re-resolves. Without one, resolves the most specific book whose window contains the tax point, retired books included. Null means no book answers, which is a refusal and not a zero rate.';

-- THE REGISTRATION READ, AND THE RULE IT ENFORCES BY WHAT IT DOES NOT DO.
--
-- It returns the active registration, or null. It never creates one, never
-- infers one from a country code someone typed, and has no branch that invents
-- a registration where the operator has stated none. A null here is the
-- `not_registered` determination: no tax charged, the treatment recorded, an
-- exception raised. It is emphatically not a zero rate, because a zero rate is
-- a claim about the law and this is a claim about us.
--
-- A registration at an ancestor level covers its subdivisions — a US-CA
-- registration is a registration in US-CA-06075 — because that is what a state
-- sales-tax registration is. This is a read of a stated fact at a coarser
-- grain, not an inference that a fact exists.
create or replace function core_tax_registration_at(
  merchant_legal_entity_id uuid,
  candidate_jurisdiction text,
  tax_point date
)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select registration.id
  from public.core_tax_registrations registration
  where registration.legal_entity_id = merchant_legal_entity_id
    and registration.status = 'active'
    and registration.jurisdiction = any(core_tax_jurisdiction_ancestors(candidate_jurisdiction))
    and registration.effective_from <= tax_point
    and (registration.effective_to is null or tax_point < registration.effective_to)
  order by length(registration.jurisdiction) desc, registration.effective_from desc
  limit 1
$$;

revoke all on function public.core_tax_registration_at(uuid, text, date) from public;
grant execute on function public.core_tax_registration_at(uuid, text, date)
  to clockwork_runtime, clockwork_service;

comment on function public.core_tax_registration_at(uuid, text, date) is
  'The merchant''s active registration covering a place at a date, or null. Null is the not_registered determination. Nothing in this system creates or infers a registration.';
