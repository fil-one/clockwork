-- Which of our entities sells an order, on what stated basis, and pinned so it
-- cannot move afterwards.
begin;
select plan(27);
set local role clockwork_service;
set local search_path = public, extensions;

select is(
  (select relrowsecurity and relforcerowsecurity from pg_class
    where oid = 'public.core_selling_entity_assignments'::regclass),
  true,
  'selling entity assignments have row security enabled and forced'
);
select is(
  (select relrowsecurity and relforcerowsecurity from pg_class
    where oid = 'public.core_order_supplier_bindings'::regclass),
  true,
  'order supplier bindings have row security enabled and forced'
);

-- RESOLUTION ORDER. Three statements, three scopes, and the most specific wins.
select is(
  (select legal_entity_id from core_selling_entity_assignments
    where id = core_resolve_selling_entity_assignment(
      '10000000-0000-4000-8000-000000000003', 'ES', '2026-08-16')),
  '97000000-0000-4000-8000-000000000002'::uuid,
  'a counterparty with its own statement gets the entity that statement names'
);
select is(
  (select legal_entity_id from core_selling_entity_assignments
    where id = core_resolve_selling_entity_assignment(
      '10000000-0000-4000-8000-000000000002', 'GB', '2026-08-16')),
  '97000000-0000-4000-8000-000000000001'::uuid,
  'a counterparty with no statement of its own falls to its country''s'
);
select is(
  (select legal_entity_id from core_selling_entity_assignments
    where id = core_resolve_selling_entity_assignment(
      '10000000-0000-4000-8000-000000000001', 'US', '2026-08-16')),
  '97000000-0000-4000-8000-000000000002'::uuid,
  'a counterparty no statement covers falls to the default'
);
-- A REFUSAL, NOT A GUESS. Before any statement was made nobody had said who
-- sells, and the resolver says so rather than picking the only entity it can
-- see.
select is(
  core_resolve_selling_entity_assignment(
    '10000000-0000-4000-8000-000000000001', 'US', '2019-12-31'),
  null,
  'a date before every statement resolves to nothing rather than to an entity'
);

-- THE PIN ITSELF, as the seed made it through the same function acceptance
-- calls.
select is(
  (select supplier_legal_entity_id from core_order_supplier_bindings
    where order_id = '80000000-0000-4000-8000-000000000001'),
  '97000000-0000-4000-8000-000000000002'::uuid,
  'a direct order is supplied by the entity the default statement names'
);
select is(
  (select merchant_legal_entity_id = supplier_legal_entity_id
   from core_order_supplier_bindings
    where order_id = '80000000-0000-4000-8000-000000000001'),
  true,
  'on a route we are merchant of record for, the two entities are one entity'
);
-- THE 001410 WORKED EXAMPLE. A US entity sells to a Spanish reseller: our
-- supplier is the US entity and the ES partner is the merchant of record to its
-- own end client. Reading the invoiced account as the merchant side — which is
-- what the code did — makes this supply Spanish.
select is(
  (select s.established_country || '->' || m.established_country
   from core_order_supplier_bindings b
   join core_legal_entities s on s.id = b.supplier_legal_entity_id
   join core_legal_entities m on m.id = b.merchant_legal_entity_id
   where b.order_id = '80000000-0000-4000-8000-000000000003'),
  'US->ES',
  'a resale order is supplied by our entity and merchanted by the partner''s'
);
select is(
  (select m.account_id from core_order_supplier_bindings b
   join core_legal_entities m on m.id = b.merchant_legal_entity_id
   where b.order_id = '80000000-0000-4000-8000-000000000003'),
  '10000000-0000-4000-8000-000000000003'::uuid,
  'the partner merchant entity is the partner account''s own entity'
);
select is(
  (select count(*) from core_order_supplier_bindings
   where order_id = '80000000-0000-4000-8000-000000000006'
     and merchant_of_record = 'marketplace'
     and supplier_legal_entity_id is null
     and merchant_legal_entity_id is null),
  1::bigint,
  'a marketplace order binds no entity of ours, and says so with a row'
);
select is(
  (select count(*) from orders o
   left join core_order_supplier_bindings b on b.order_id = o.id
   where o.id between '80000000-0000-4000-8000-000000000001'::uuid
                  and '80000000-0000-4000-8000-000000000099'::uuid
     and o.immutable_at is not null and b.order_id is null),
  0::bigint,
  'every accepted order in the fixture carries a binding'
);

-- ENSURED, NOT REQUIRED. The partner entities for the distributor and
-- white-label partners did not exist before the binding was made; refusing the
-- acceptance until somebody retyped the partner''s name would have blocked a
-- legitimate operation.
select is(
  (select count(*) from core_legal_entities
   where merchant_role = 'partner_entity'
     and account_id in ('10000000-0000-4000-8000-000000000005',
                        '10000000-0000-4000-8000-000000000007')),
  2::bigint,
  'a partner merchant entity is created from the partner account''s own facts'
);
-- AND NO REGISTRATION IS INVENTED WITH IT. An entity is an identity; a
-- registration is a claim about where we may charge.
select is(
  (select count(*) from core_tax_registrations registration
   join core_legal_entities entity on entity.id = registration.legal_entity_id
   where entity.account_id in ('10000000-0000-4000-8000-000000000005',
                               '10000000-0000-4000-8000-000000000007')),
  0::bigint,
  'creating a partner entity states no registration for it'
);
select is(
  (select count(*) from core_legal_entities
   where merchant_role = 'partner_entity'
     and account_id = '10000000-0000-4000-8000-000000000005'),
  1::bigint,
  'one partner account is one partner entity'
);
select throws_ok(
  $$insert into core_legal_entities (legal_name, merchant_role, account_id,
       established_country, registered_address)
    values ('Atlas Distribution Demo (second)', 'partner_entity',
            '10000000-0000-4000-8000-000000000005', 'US', '{}'::jsonb)$$,
  '23505',
  null,
  'a second entity for the same partner account is refused'
);

-- IDEMPOTENT BY PIN. An acceptance replayed by idempotency key must return the
-- binding that was made, not make a second one against today''s statements.
select is(
  (select selling_entity_assignment_id from core_bind_order_selling_entity(
     '80000000-0000-4000-8000-000000000001', now())),
  (select selling_entity_assignment_id from core_order_supplier_bindings
    where order_id = '80000000-0000-4000-8000-000000000001'),
  'binding an already bound order returns the pin it already has'
);

-- IMMUTABLE. A supply made by a different entity is a different supply.
select throws_ok(
  $$update core_order_supplier_bindings
      set supplier_legal_entity_id = '97000000-0000-4000-8000-000000000001'
    where order_id = '80000000-0000-4000-8000-000000000001'$$,
  '55000',
  null,
  'a pinned supplier is not restated in place'
);
select throws_ok(
  $$delete from core_order_supplier_bindings
    where order_id = '80000000-0000-4000-8000-000000000001'$$,
  '55000',
  null,
  'a pinned binding is not deleted'
);

-- CROSS-ROW IDENTITY. Every fact the row repeats is checked against the row it
-- was copied from. Two unbound orders are built here rather than reusing a
-- seeded one, because every seeded order is already bound and an insert against
-- one of those would be refused by the primary key before the identity trigger
-- ever ran — a test that passes for the wrong reason.
insert into quotes(
  id, account_id, partner_account_id, end_client_account_id, price_book_id,
  series_id, revision,
  status, currency, total_minor, margin_floor_result, expires_at, created_by
) values
  ('b9000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
   null,null,'60000000-0000-4000-8000-000000000001',
   'b9000000-0000-4000-8000-000000000011',
   1,'accepted','USD',100000,'pass','2027-12-31T00:00:00Z',
   '20000000-0000-4000-8000-000000000002'),
  ('b9000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000004',
   '10000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000004',
   '60000000-0000-4000-8000-000000000001',
   'b9000000-0000-4000-8000-000000000012',
   1,'accepted','USD',100000,'pass','2027-12-31T00:00:00Z',
   '20000000-0000-4000-8000-000000000002');
insert into core_quote_commercial_profiles(
  quote_id, channel_shape, merchant_of_record, pricing_authority,
  billing_account_id, pricing_inputs, pricing_calculated_at
) values
  ('b9000000-0000-4000-8000-000000000001','direct','fil_one','fil_one',
   '10000000-0000-4000-8000-000000000001','{}','2026-07-31T16:00:00Z'),
  ('b9000000-0000-4000-8000-000000000002','resale','partner','partner',
   '10000000-0000-4000-8000-000000000005','{}','2026-07-31T16:00:00Z');
insert into orders(
  id, quote_id, agreement_id, account_id, invoicing_account_id,
  partner_account_id, sourcing, signer_user_id, authority_title,
  authority_attested, status, service_starts_on, service_ends_on
) values
  ('b9010000-0000-4000-8000-000000000001','b9000000-0000-4000-8000-000000000001',
   '51000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-000000000001', null,'direct',
   '20000000-0000-4000-8000-000000000002','Owner',true,'accepted',
   '2026-08-01','2027-07-31'),
  ('b9010000-0000-4000-8000-000000000002','b9000000-0000-4000-8000-000000000002',
   '51000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000004',
   '10000000-0000-4000-8000-000000000005',
   '10000000-0000-4000-8000-000000000005','resale',
   '20000000-0000-4000-8000-000000000002','Owner',true,'accepted',
   '2026-08-01','2027-07-31');
insert into core_order_commercial_profiles(
  order_id, merchant_of_record, billing_shape,
  provisioning_idempotency_key, governing_agreement_version, accepted_at
) values
  ('b9010000-0000-4000-8000-000000000001','fil_one','direct',
   'binding:test:b901:1',1,'2026-07-31T16:00:00Z'),
  ('b9010000-0000-4000-8000-000000000002','partner','resale',
   'binding:test:b901:2',1,'2026-07-31T16:00:00Z');

-- A DATE NOBODY HAD STATED ANYTHING FOR. The refusal names the counterparty and
-- says what is missing, rather than choosing the only entity in the table.
select throws_ok(
  $$select core_bind_order_selling_entity(
      'b9010000-0000-4000-8000-000000000001', '2019-06-01T00:00:00Z')$$,
  '23514',
  'no selling entity is stated for Northstar Archive Labs (US) on 2019-06-01; state one before accepting an order we bill',
  'an order we bill cannot be bound before anyone has said who sells it'
);

select throws_ok(
  $$insert into core_order_supplier_bindings (order_id, merchant_of_record,
      supplier_legal_entity_id, merchant_legal_entity_id,
      selling_entity_assignment_id, supplier_established_country, bound_at)
    values ('b9010000-0000-4000-8000-000000000001', 'partner',
            '97000000-0000-4000-8000-000000000002',
            '97000000-0000-4000-8000-000000000003',
            '97700000-0000-4000-8000-000000000001', 'US', now())$$,
  '23514',
  'supplier binding merchant of record must match the persisted commercial profile',
  'a binding cannot claim a merchant of record the commercial profile does not'
);
select throws_ok(
  $$insert into core_order_supplier_bindings (order_id, merchant_of_record,
      supplier_legal_entity_id, merchant_legal_entity_id,
      selling_entity_assignment_id, supplier_established_country, bound_at)
    values ('b9010000-0000-4000-8000-000000000002', 'partner',
            '97000000-0000-4000-8000-000000000002',
            '97000000-0000-4000-8000-000000000003',
            '97700000-0000-4000-8000-000000000001', 'US', now())$$,
  '23514',
  'a partner-merchant order binds the partner account''s own entity',
  'a binding cannot name a partner entity belonging to a different partner'
);
select throws_ok(
  $$insert into core_order_supplier_bindings (order_id, merchant_of_record,
      supplier_legal_entity_id, merchant_legal_entity_id,
      selling_entity_assignment_id, supplier_established_country, bound_at)
    values ('b9010000-0000-4000-8000-000000000001', 'fil_one',
            '97000000-0000-4000-8000-000000000002',
            '97000000-0000-4000-8000-000000000002',
            '97700000-0000-4000-8000-000000000001', 'GB', now())$$,
  '23514',
  'pinned supplier establishment does not match the entity it names',
  'a pinned establishment that has drifted from its entity is refused'
);
select throws_ok(
  $$insert into core_order_supplier_bindings (order_id, merchant_of_record,
      supplier_legal_entity_id, merchant_legal_entity_id,
      selling_entity_assignment_id, supplier_established_country, bound_at)
    values ('b9010000-0000-4000-8000-000000000001', 'fil_one',
            '97000000-0000-4000-8000-000000000002',
            '97000000-0000-4000-8000-000000000002',
            '97700000-0000-4000-8000-000000000003', 'US', now())$$,
  '23514',
  'pinned selling entity assignment names a different counterparty',
  'a binding cannot pin a statement made about someone else'
);

-- THE STATEMENTS THEMSELVES. Stated, immutable, superseded rather than edited.
select throws_ok(
  $$update core_selling_entity_assignments
      set legal_entity_id = '97000000-0000-4000-8000-000000000001'
    where id = '97700000-0000-4000-8000-000000000001'$$,
  '55000',
  'a stated selling entity assignment is immutable; state a new assignment',
  'restating who sells rewrites the basis of every order pinned to it'
);
select lives_ok(
  $$update core_selling_entity_assignments set effective_to = '2027-01-01'
    where id = '97700000-0000-4000-8000-000000000002'$$,
  'closing a statement''s window is how it is superseded'
);
select throws_ok(
  $$insert into core_selling_entity_assignments (legal_entity_id, account_id,
      customer_country, effective_from, stated_by, stated_at, reason)
    values ('97000000-0000-4000-8000-000000000003', null, 'PT', '2026-01-01',
            '20000000-0000-4000-8000-000000000001', now(),
            'a partner entity cannot contract on our behalf')$$,
  '23514',
  'a selling entity assignment names one of our own entities',
  'a statement pointing at a partner''s entity is refused'
);

select * from finish();
rollback;
