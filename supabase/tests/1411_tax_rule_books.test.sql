-- Rule books and rates: the price-book grain applied to tax, and the unit.
begin;
select plan(21);
set local role clockwork_service;
set local search_path = public, extensions;

select has_table('public', 'core_tax_rule_books', 'rates and rules live in a table');
select has_table('public', 'core_tax_rates', 'a rule book carries its rates as rows');
select has_column('public', 'core_tax_rates', 'rate_ppm', 'rates are held in parts per million');

-- THE UNIT. 8.875% is 887.5 basis points and is not an integer; the spec
-- forbids float in a tax calculation (commerce_platform_spec.md:977-979). The
-- seed decomposes the New York County combined rate into three stacked
-- components, and they sum exactly.
select is(
  (select sum(rate_ppm)::bigint from core_tax_rates
    where tax_rule_book_id = '97200000-0000-4000-8000-000000000009'),
  88750::bigint,
  'the stacked New York County components sum to 88750 ppm — 8.875% — exactly'
);
select is(
  (select rate_ppm from core_tax_rates
    where id = '97300000-0000-4000-8000-000000000012'),
  3750::bigint,
  '0.375% is representable as an integer in parts per million and is not in basis points'
);

-- Hierarchical jurisdictions, not countries.
select lives_ok($$
  insert into core_tax_rule_books (
    id, jurisdiction, version, effective_from, authority_reference
  ) values (
    'cb100000-0000-4000-8000-000000000001','US-CA-06075',1,'2026-01-01','pgTAP fixture'
  )
$$, 'a jurisdiction may be subdivided to district level');
select throws_ok($$
  insert into core_tax_rule_books (
    jurisdiction, version, effective_from, authority_reference
  ) values ('gb',1,'2026-01-01','pgTAP fixture')
$$, '23514', null, 'a jurisdiction is upper case and starts with a country code');
select throws_ok($$
  insert into core_tax_rule_books (
    jurisdiction, version, effective_from, authority_reference
  ) values ('GB',1,'2026-01-01','   ')
$$, '23514', null, 'a rule book states the authority its rates came from');

-- A book is created as a draft. Insert-as-published would walk straight past
-- the two-person control that 001412 puts on the transition.
select throws_ok($$
  insert into core_tax_rule_books (
    jurisdiction, version, status, effective_from, authority_reference
  ) values ('MT',1,'active','2026-01-01','pgTAP fixture')
$$, '23514', null, 'a rule book cannot be created already published');

-- TWO ACTIVE BOOKS FOR ONE JURISDICTION ARE IMPOSSIBLE. The seed leaves GB
-- version 2 active, so a fully approved rival with rates still cannot join it.
insert into core_tax_rule_books (
  id, jurisdiction, version, effective_from, authority_reference, subdivision_scope
) values (
  'cb100000-0000-4000-8000-000000000002','GB',99,'2026-06-01','pgTAP rival fixture','whole_jurisdiction'
);
insert into core_tax_rates (tax_rule_book_id, tax_code, rate_kind, rate_ppm, legal_basis)
values ('cb100000-0000-4000-8000-000000000002','txcd_demo','standard',150000,'pgTAP rival fixture');
insert into approvals (
  action, object_type, object_id, requested_by, approved_by, status, requested_at, decided_at
) values (
  'tax_rule_book_activation','tax_rule_book','cb100000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002',
  'approved','2026-06-01T00:00:00Z','2026-06-01T01:00:00Z'
);
select throws_ok($$
  update core_tax_rule_books set status = 'active'
  where id = 'cb100000-0000-4000-8000-000000000002'
$$, '23505', null, 'two active rule books for one jurisdiction are impossible');

-- AN ACTIVE BOOK IS IMMUTABLE.
select throws_ok($$
  update core_tax_rule_books set authority_reference = 'rewritten after signing'
  where id = '97200000-0000-4000-8000-000000000002'
$$, '55000', null, 'a published rule book''s authority citation is immutable');
select throws_ok($$
  update core_tax_rule_books set rule_parameters = '{"placeOfSupply":"origin"}'
  where id = '97200000-0000-4000-8000-000000000002'
$$, '55000', null, 'a published rule book''s parameters are immutable; create a version');
select throws_ok($$
  update core_tax_rule_books set subdivision_scope = 'this_level_only'
  where id = '97200000-0000-4000-8000-000000000002'
$$, '55000', null, 'a published rule book''s subdivision scope is immutable');
select throws_ok($$
  delete from core_tax_rule_books where id = '97200000-0000-4000-8000-000000000002'
$$, '55000', null, 'a published rule book is not deleted; create a version');

-- PROVENANCE IS THE ONE THING THAT MOVES ON A PUBLISHED BOOK, because flipping
-- a fixture to live_signed when the accountant signs it is the entire
-- mechanism, and it must not require recreating a book that determinations are
-- pinned to.
select lives_ok($$
  update core_tax_rule_books set input_provenance = 'live_signed'
  where id = '97200000-0000-4000-8000-000000000002'
$$, 'an accountant''s signature flips a published book to live_signed');
select is(
  (select count(*)::integer from core_tax_rule_books
    where input_provenance <> 'repository_fixture'
      and id between '97200000-0000-4000-8000-000000000003'::uuid
      and '97200000-0000-4000-8000-000000000014'::uuid),
  0, 'signing one jurisdiction leaves every other jurisdiction a fixture'
);

-- A RATE OUTSIDE A DRAFT BOOK CANNOT BE EDITED — or added, which is the same
-- hole from the other side.
select throws_ok($$
  update core_tax_rates set rate_ppm = 250000
  where id = '97300000-0000-4000-8000-000000000002'
$$, '55000', null, 'a rate in a published book is immutable');
select throws_ok($$
  delete from core_tax_rates where id = '97300000-0000-4000-8000-000000000002'
$$, '55000', null, 'a rate in a published book cannot be deleted');
select throws_ok($$
  insert into core_tax_rates (tax_rule_book_id, tax_code, rate_kind, rate_ppm, legal_basis)
  values ('97200000-0000-4000-8000-000000000002','txcd_smuggled','standard',990000,'none')
$$, '55000', null, 'a rate cannot be added to a published book after it was reviewed');
select lives_ok($$
  insert into core_tax_rates (tax_rule_book_id, tax_code, rate_kind, rate_ppm, legal_basis)
  values ('cb100000-0000-4000-8000-000000000001','txcd_draft','standard',85000,'pgTAP fixture')
$$, 'a draft book''s rates are editable, which is what a draft is for');
select throws_ok($$
  insert into core_tax_rates (tax_rule_book_id, tax_code, rate_kind, rate_ppm, legal_basis)
  values ('cb100000-0000-4000-8000-000000000001','txcd_draft','reduced',10000,'pgTAP fixture')
$$, '23505', null, 'one tax code has one rate in a book');

select * from finish();
rollback;
