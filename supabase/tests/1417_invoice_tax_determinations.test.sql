-- What was determined, what it was determined from, and the checks that stop
-- either from being restated afterwards.
begin;
select plan(24);
set local role clockwork_service;
set local search_path = public, extensions;

select is(
  (select relrowsecurity and relforcerowsecurity from pg_class
    where oid = 'public.core_invoice_tax_determinations'::regclass),
  true,
  'invoice tax determinations have row security enabled and forced'
);
select is(
  (select relrowsecurity and relforcerowsecurity from pg_class
    where oid = 'public.core_invoice_tax_lines'::regclass),
  true,
  'invoice tax lines have row security enabled and forced'
);

-- WHERE AN ADDRESS IS, decided by what the books declare and not by a map in
-- code. Boston is claimed by Massachusetts' 010-027 prefixes; Seattle by
-- Washington's 980-994.
select is(
  core_tax_place_for_address('US', null, '02108', '2026-08-16'),
  'US-MA',
  'a Boston postal code resolves to the authority whose book claims it'
);
select is(
  core_tax_place_for_address('US', null, '98101', '2026-08-16'),
  'US-WA',
  'a Seattle postal code resolves to Washington'
);
-- MANHATTAN, WHICH IS THE ONE THAT MUST NOT RESOLVE. New York County's
-- combined 8.875% has its own book and the state book deliberately does not
-- claim 100-104, so the address reaches the country and the country has no
-- authority of its own. 001411 was explicit that answering it with the state's
-- 4% alone is the wrong number that looks fine.
select is(
  core_tax_place_for_address('US', null, '10001', '2026-08-16'),
  'US',
  'a Manhattan postal code is claimed by no state authority and falls to the country'
);
select is(
  core_tax_place_for_address('ES', null, '28001', '2026-08-16'),
  'ES',
  'a country whose single authority claims no prefixes resolves to itself'
);

-- WHICH BOOKS A SUPPLY NEEDS.
select is(
  (select array_agg(book.jurisdiction order by book.jurisdiction)
   from core_tax_rule_books book
   where book.id in (
     select core_tax_rule_books_for_supply('US', 'US', null, '02108', '2026-08-16')
   )),
  array['US','US-MA'],
  'a domestic US supply needs the country''s territory and the state''s authority'
);
select is(
  (select array_agg(book.jurisdiction order by book.jurisdiction)
   from core_tax_rule_books book
   where book.id in (
     select core_tax_rule_books_for_supply('US', 'ES', null, '28001', '2026-08-16')
   )),
  array['ES','US'],
  'a cross-border supply needs both sides, because place of supply compares them'
);
-- A RETIRED BOOK STILL ANSWERS a back-dated tax point (001413's rule), and the
-- engine parameters were added by a successor, so the two books are different
-- rows for the same jurisdiction.
select isnt(
  (select core_tax_rule_books_for_supply('GB', 'GB', null, null, '2026-03-01')),
  (select core_tax_rule_books_for_supply('GB', 'GB', null, null, '2026-08-16')),
  'a back-dated supply resolves the book that was in force, not today''s'
);
select is(
  (select status from core_tax_rule_books where id =
    (select core_tax_rule_books_for_supply('GB', 'GB', null, null, '2026-03-01'))),
  'retired',
  'the book a back-dated supply resolves to is genuinely retired'
);
select throws_ok(
  $$select core_tax_rule_books_for_supply('ZZ', 'ZZ', null, null, '2026-08-16')$$,
  '23514',
  'no tax rule book answers for ZZ on 2026-08-16',
  'a supply no book answers for raises rather than returning fewer books'
);
-- A REVERSAL READS NO DATE AT ALL.
select is(
  (select array_agg(id::text order by id::text) from (
     select core_tax_rule_books_for_supply(
       'US', 'US', null, '02108', '1900-01-01',
       array[(select id from core_tax_rule_books where jurisdiction = 'ES' and status = 'active')]
     ) as id
   ) pinned),
  array[(select id::text from core_tax_rule_books where jurisdiction = 'ES' and status = 'active')],
  'a pinned reversal reproduces its books by pointer and ignores the tax point'
);
select throws_ok(
  $$select core_tax_rule_books_for_supply('US', 'US', null, '02108', '2026-08-16',
      array['00000000-0000-4000-8000-000000000000'::uuid])$$,
  '23503',
  'a pinned tax rule book does not exist; a reversal cannot be re-determined',
  'a pin that points at nothing fails loudly instead of resolving by date'
);

-- A DETERMINED INVOICE, built the way the writers build one.
insert into quotes(
  id, account_id, price_book_id, series_id, revision, status, currency,
  total_minor, margin_floor_result, expires_at, created_by, immutable_at
) values (
  'ba000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000001','ba000000-0000-4000-8000-000000000011',
  1,'accepted','USD',100000,'pass','2027-12-31T00:00:00Z',
  '20000000-0000-4000-8000-000000000002','2026-08-16T09:00:00Z'
);
insert into core_quote_commercial_profiles(
  quote_id, channel_shape, merchant_of_record, pricing_authority,
  billing_account_id, pricing_inputs, pricing_calculated_at
) values (
  'ba000000-0000-4000-8000-000000000001','direct','fil_one','fil_one',
  '10000000-0000-4000-8000-000000000001','{}','2026-08-16T09:00:00Z'
);
insert into orders(
  id, quote_id, agreement_id, account_id, invoicing_account_id, sourcing,
  signer_user_id, authority_title, authority_attested, status,
  service_starts_on, service_ends_on, immutable_at
) values (
  'ba010000-0000-4000-8000-000000000001','ba000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001','direct',
  '20000000-0000-4000-8000-000000000002','Owner',true,'active',
  '2026-08-16','2027-08-15','2026-08-16T10:00:00Z'
);
insert into core_order_commercial_profiles(
  order_id, merchant_of_record, billing_shape,
  provisioning_idempotency_key, governing_agreement_version, accepted_at
) values (
  'ba010000-0000-4000-8000-000000000001','fil_one','direct',
  'determination:test:ba01:1',1,'2026-08-16T10:00:00Z'
);
select public.core_bind_order_selling_entity(
  'ba010000-0000-4000-8000-000000000001', '2026-08-16T10:00:00Z'
);
insert into invoices(
  id, order_id, account_id, currency, amount_minor, tax_minor, tax_treatment,
  status
) values (
  'ba020000-0000-4000-8000-000000000001','ba010000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001','USD',106250,6250,'standard','draft'
);

-- The stored question and its canonical hash, computed once by the owner:
-- `private.canonical_jsonb_text` is not granted to the runtime roles, because
-- the writers hash in TypeScript and the database recomputes it inside a
-- security-definer trigger. A test that needed a new grant to run would be
-- testing a different deployment.
reset role;
create temporary table determination_fixture as
select
  input,
  encode(extensions.digest(
    convert_to(private.canonical_jsonb_text(input), 'UTF8'), 'sha256'
  ), 'hex') as hash,
  -- A second, distinct question for the probe that writes an answer with no
  -- rows behind it. Distinct because determination_input_hash is unique: two
  -- determinations are two questions.
  input || jsonb_build_object('documentType', 'proforma') as alt_input,
  encode(extensions.digest(
    convert_to(private.canonical_jsonb_text(
      input || jsonb_build_object('documentType', 'proforma')
    ), 'UTF8'), 'sha256'
  ), 'hex') as alt_hash
from (select
  jsonb_build_object(
    'orderId','ba010000-0000-4000-8000-000000000001',
    'documentType','invoice',
    'taxPointDate','2026-08-16',
    'currency','USD',
    'lines', jsonb_build_array(jsonb_build_object(
      'lineId','ba030000-0000-4000-8000-000000000001',
      'taxCode','txcd_demo','supplyType','digital_service','netMinor','100000'
    )),
    'ruleBooks', jsonb_build_array(jsonb_build_object(
      'id',(select id::text from core_tax_rule_books where jurisdiction='US-MA' and status='active'),
      'jurisdiction','US-MA','version','1'
    ))
  ) as input) fixture;
grant select on determination_fixture to clockwork_service;
set local role clockwork_service;

-- THE QUESTION IS HASHED HERE, NOT TRUSTED.
select throws_ok(
  $$insert into core_invoice_tax_determinations (
      invoice_id, order_id, determination_id, supplier_legal_entity_id,
      customer_account_id, customer_status, place_of_supply, tax_point_date,
      currency, net_minor, tax_minor, treatment, confidence, review_reasons,
      rounding, input_provenance, determination_input, determination_input_hash
    )
    select 'ba020000-0000-4000-8000-000000000001',
           'ba010000-0000-4000-8000-000000000001',
           'ba040000-0000-4000-8000-000000000002',
           '97000000-0000-4000-8000-000000000002',
           '10000000-0000-4000-8000-000000000001', 'business',
           array['US'], '2026-08-16', 'USD', 100000, 6250, 'standard',
           'determined', array[]::text[], 'line', 'repository_fixture',
           fixture.input, repeat('a', 64)
    from determination_fixture fixture$$,
  '23514',
  null,
  'a hash the writer computed over something else is refused'
);

-- AND THE SUPPLIER IS THE ONE THE ORDER WAS BOUND TO AT ACCEPTANCE.
select throws_ok(
  $$insert into core_invoice_tax_determinations (
      invoice_id, order_id, determination_id, supplier_legal_entity_id,
      customer_account_id, customer_status, place_of_supply, tax_point_date,
      currency, net_minor, tax_minor, treatment, confidence, review_reasons,
      rounding, input_provenance, determination_input, determination_input_hash
    )
    select 'ba020000-0000-4000-8000-000000000001',
           'ba010000-0000-4000-8000-000000000001',
           'ba040000-0000-4000-8000-000000000003',
           '97000000-0000-4000-8000-000000000001',
           '10000000-0000-4000-8000-000000000001', 'business',
           array['US'], '2026-08-16', 'USD', 100000, 6250, 'standard',
           'determined', array[]::text[], 'line', 'repository_fixture',
           fixture.input, fixture.hash
    from determination_fixture fixture$$,
  '23514',
  'invoice tax determination must name the entity the order was bound to at acceptance',
  'a determination cannot name a supplier the order was not sold by'
);

-- PROVENANCE IS THE WEAKEST OF THE BOOKS READ.
select throws_ok(
  $$insert into core_invoice_tax_determinations (
      invoice_id, order_id, determination_id, supplier_legal_entity_id,
      customer_account_id, customer_status, place_of_supply, tax_point_date,
      currency, net_minor, tax_minor, treatment, confidence, review_reasons,
      rounding, input_provenance, determination_input, determination_input_hash
    )
    select 'ba020000-0000-4000-8000-000000000001',
           'ba010000-0000-4000-8000-000000000001',
           'ba040000-0000-4000-8000-000000000004',
           '97000000-0000-4000-8000-000000000002',
           '10000000-0000-4000-8000-000000000001', 'business',
           array['US'], '2026-08-16', 'USD', 100000, 6250, 'standard',
           'determined', array[]::text[], 'line', 'live_signed',
           fixture.input, fixture.hash
    from determination_fixture fixture$$,
  '23514',
  'invoice tax determination provenance must be the weakest of the books it read',
  'a fixture matrix cannot be recorded as a signed one'
);

select lives_ok(
  $$insert into core_invoice_tax_determinations (
      invoice_id, order_id, determination_id, supplier_legal_entity_id,
      supplier_registration_id, customer_account_id, customer_status,
      place_of_supply, tax_point_date, currency, net_minor, tax_minor,
      treatment, confidence, review_reasons, rounding, input_provenance,
      determination_input, determination_input_hash
    )
    select 'ba020000-0000-4000-8000-000000000001',
           'ba010000-0000-4000-8000-000000000001',
           'ba040000-0000-4000-8000-000000000001',
           '97000000-0000-4000-8000-000000000002',
           (select id from core_tax_registrations
             where legal_entity_id = '97000000-0000-4000-8000-000000000002'
               and jurisdiction = 'US-MA' and status = 'active'),
           '10000000-0000-4000-8000-000000000001', 'business',
           array['US'], '2026-08-16', 'USD', 100000, 6250, 'standard',
           'determined', array[]::text[], 'line', 'repository_fixture',
           fixture.input, fixture.hash
    from determination_fixture fixture$$,
  'a determination that matches its invoice, its binding and its books is written'
);

select throws_ok(
  $$insert into core_invoice_tax_lines (
      invoice_id, line_id, jurisdiction, treatment, tax_code, rate_ppm,
      rate_kind, taxable_minor, tax_minor, rule_book_id, rule_book_version,
      legal_basis
    ) values (
      'ba020000-0000-4000-8000-000000000001',
      'ba030000-0000-4000-8000-000000000001', 'US-MA', 'reverse_charge',
      'txcd_demo', 62500, 'standard', 100000, 6250,
      (select id from core_tax_rule_books where jurisdiction='US-MA' and status='active'),
      1, 'Repository fixture: Massachusetts state rate'
    )$$,
  '23514',
  null,
  'a rate and an amount on a reverse-charged row are refused on this grain too'
);

select lives_ok(
  $$insert into core_invoice_tax_lines (
      invoice_id, line_id, jurisdiction, treatment, tax_code, rate_ppm,
      rate_kind, taxable_minor, tax_minor, rule_book_id, rule_book_version,
      legal_basis
    ) values (
      'ba020000-0000-4000-8000-000000000001',
      'ba030000-0000-4000-8000-000000000001', 'US-MA', 'standard',
      'txcd_demo', 62500, 'standard', 100000, 6250,
      (select id from core_tax_rule_books where jurisdiction='US-MA' and status='active'),
      1, 'Repository fixture: Massachusetts state rate'
    )$$,
  'the per-jurisdiction row that sums to the header is written'
);

-- IMMUTABLE, both of them.
select throws_ok(
  $$update core_invoice_tax_determinations set tax_minor = 0
    where invoice_id = 'ba020000-0000-4000-8000-000000000001'$$,
  '55000',
  'invoice tax determinations and their lines are immutable; a corrected supply is a credit note',
  'a determination is not restated in place'
);
select throws_ok(
  $$delete from core_invoice_tax_lines
    where invoice_id = 'ba020000-0000-4000-8000-000000000001'$$,
  '55000',
  null,
  'a per-jurisdiction row is not deleted'
);

-- THE ROLLUP, which is deferred because the lines cannot exist when the parent
-- is written.
select throws_ok(
  $probe$do $rollup$
    begin
      insert into core_invoice_tax_lines (
        invoice_id, line_id, jurisdiction, treatment, tax_code, rate_ppm,
        rate_kind, taxable_minor, tax_minor, rule_book_id, rule_book_version,
        legal_basis
      ) values (
        'ba020000-0000-4000-8000-000000000001',
        'ba030000-0000-4000-8000-000000000002', 'US-MA', 'standard',
        'txcd_demo', 62500, 'standard', 100000, 1,
        (select id from core_tax_rule_books where jurisdiction='US-MA' and status='active'),
        1, 'Repository fixture: Massachusetts state rate'
      );
      set constraints core_invoice_tax_line_rollup immediate;
    end
  $rollup$$probe$,
  '23514',
  'invoice tax lines must sum to the determination and to the invoice',
  'rows that do not sum to the figure the customer was billed are refused'
);

select throws_ok(
  $$insert into core_invoice_tax_lines (
      invoice_id, line_id, jurisdiction, treatment, tax_code, rate_ppm,
      rate_kind, taxable_minor, tax_minor, rule_book_id, rule_book_version,
      legal_basis
    ) values (
      'ba020000-0000-4000-8000-000000000001', 'line-7', 'US-MA', 'standard',
      'txcd_demo', 0, 'standard', 0, 0,
      (select id from core_tax_rule_books where jurisdiction='US-MA' and status='active'),
      1, 'Repository fixture: Massachusetts state rate'
    )$$,
  '23514',
  null,
  'a line identifier is a snapshot id or the named amendment delta, not free text'
);

-- AND A DETERMINATION WITH NO PER-JURISDICTION LINES IS NOT AN ANSWER.
-- Written into a second invoice for the same order so the first determination's
-- own rollup is not disturbed; the check runs at commit, which is why the probe
-- makes it immediate.
insert into invoices(
  id, order_id, account_id, currency, amount_minor, tax_minor, tax_treatment,
  status
) values (
  'ba020000-0000-4000-8000-000000000002','ba010000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001','USD',106250,6250,'standard','draft'
);
select throws_ok(
  $probe$do $rollup$
    begin
      insert into core_invoice_tax_determinations (
        invoice_id, order_id, determination_id, supplier_legal_entity_id,
        customer_account_id, customer_status, place_of_supply, tax_point_date,
        currency, net_minor, tax_minor, treatment, confidence, review_reasons,
        rounding, input_provenance, determination_input, determination_input_hash
      )
      select 'ba020000-0000-4000-8000-000000000002',
             'ba010000-0000-4000-8000-000000000001',
             'ba040000-0000-4000-8000-000000000005',
             '97000000-0000-4000-8000-000000000002',
             '10000000-0000-4000-8000-000000000001', 'business',
             array['US'], '2026-08-16', 'USD', 100000, 6250, 'standard',
             'determined', array[]::text[], 'line', 'repository_fixture',
             fixture.alt_input, fixture.alt_hash
      from determination_fixture fixture;
      set constraints core_invoice_tax_determination_rollup immediate;
    end
  $rollup$$probe$,
  '23514',
  'a determination with no per-jurisdiction lines states an answer it cannot show',
  'an answer with no rows behind it is refused at commit'
);

select * from finish();
rollback;
