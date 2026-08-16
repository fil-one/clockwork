-- Resolution by date, the trap in it, and the refusal that is not a zero rate.
begin;
select plan(17);
set local role clockwork_service;
set local search_path = public, extensions;

select is(
  core_tax_jurisdiction_ancestors('US-NY-36061'),
  array['US-NY-36061','US-NY','US'],
  'a hierarchical jurisdiction walks up to its country, most specific first'
);
select is(
  core_tax_jurisdiction_ancestors('gb'),
  array['GB'],
  'a country-only jurisdiction is its own only ancestor, case folded'
);

-- RULE ONE, AND THE TRAP. A retired book is the correct answer for a back-dated
-- tax point. Resolving over 'active' alone would price a 2025 supply at 2026
-- rates and nothing on the invoice would look wrong.
select is(
  core_resolve_tax_rule_book('GB', '2025-06-01'),
  '97200000-0000-4000-8000-000000000001'::uuid,
  'a back-dated tax point resolves to the retired book that was in force'
);
select is(
  core_resolve_tax_rule_book('GB', '2026-06-01'),
  '97200000-0000-4000-8000-000000000002'::uuid,
  'a current tax point resolves to the active book'
);
select is(
  (select status from core_tax_rule_books
    where id = core_resolve_tax_rule_book('GB', '2025-06-01')),
  'retired',
  'the book a back-dated supply resolves to is genuinely retired, not merely old'
);
select is(
  core_resolve_tax_rule_book('GB', '2019-01-01'),
  null,
  'a tax point before any book resolves to nothing rather than to the earliest'
);
-- The window is half-open, so a supply on a changeover date belongs to the
-- successor and never to both.
select is(
  core_resolve_tax_rule_book('GB', '2026-01-01'),
  '97200000-0000-4000-8000-000000000002'::uuid,
  'a supply on the changeover date belongs to the successor'
);

-- RULE TWO. A reversal carries the pinned id forward and does not resolve by
-- date at all. Reproduction by pointer cannot drift: the same call that would
-- have resolved the 2026 book returns the 2025 one when the pin says so.
select is(
  core_resolve_tax_rule_book('GB', '2026-06-01', '97200000-0000-4000-8000-000000000001'),
  '97200000-0000-4000-8000-000000000001'::uuid,
  'a reversal reproduces the pinned book and ignores the tax point entirely'
);
select is(
  core_resolve_tax_rule_book('ZZ', '1900-01-01', '97200000-0000-4000-8000-000000000004'),
  '97200000-0000-4000-8000-000000000004'::uuid,
  'a pin ignores the jurisdiction too; it is a pointer, not a query'
);
select throws_ok($$
  select core_resolve_tax_rule_book(
    'GB', '2026-06-01', '00000000-0000-4000-8000-000000000000'
  )
$$, '23503', null, 'a pin at nothing fails loudly rather than silently re-determining');

-- HIERARCHY. A state book that has not had its local rates loaded says so, and
-- answering a city with the state rate alone is refused rather than guessed.
select is(
  core_resolve_tax_rule_book('US-NY-36061', '2026-06-01'),
  '97200000-0000-4000-8000-000000000009'::uuid,
  'the most specific book wins where one exists'
);
select is(
  core_resolve_tax_rule_book('US-NY-36047', '2026-06-01'),
  null,
  'a New York locality with no book of its own does not fall back to the state rate'
);
select is(
  core_resolve_tax_rule_book('US-CT-09001', '2026-06-01'),
  '97200000-0000-4000-8000-000000000014'::uuid,
  'a jurisdiction that declares itself the whole answer does cover its subdivisions'
);
select is(
  core_resolve_tax_rule_book('US-CA', '2026-06-01'),
  null,
  'a state with no rule book resolves to nothing; there is no US-wide fallback'
);

-- THE REGISTRATION READ. No active registration in the place of supply is a
-- refusal, not a zero rate, and nothing here creates one.
select is(
  core_tax_registration_at(
    '97000000-0000-4000-8000-000000000002','US-NY-36061','2026-06-01'
  ),
  '97100000-0000-4000-8000-000000000003'::uuid,
  'a state registration covers a supply in one of its localities'
);
select is(
  core_tax_registration_at(
    '97000000-0000-4000-8000-000000000002','US-CT','2026-06-01'
  ),
  null,
  'Connecticut has rates and no registration, so the determination is not_registered'
);
-- A pending application is not a registration. It is the operator saying they
-- have applied, and charging tax on it would be charging under a registration
-- that does not exist yet.
select is(
  core_tax_registration_at(
    '97000000-0000-4000-8000-000000000002','US-TX','2026-10-01'
  ),
  null,
  'a pending application does not authorise charging tax'
);

select * from finish();
rollback;
