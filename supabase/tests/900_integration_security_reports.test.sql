begin;
select plan(29);

set local role clockwork_service;
set local search_path = public, extensions;

select lives_ok($$
  insert into core_partner_transfer_tiers(
    id, rate_card_id, agreement_type, tier, transfer_price_minor,
    floor_price_minor, effective_from
  ) values (
    'f9000000-0000-4000-8000-000000000001',
    '61000000-0000-4000-8000-000000000001',
    'resale', 'integration-private', 12000, 10000, '2026-01-01'
  )
$$, 'service can seed a private partner transfer tier');

select lives_ok($$
  insert into quotes(
    id, account_id, price_book_id, series_id, revision, status, currency,
    total_minor, margin_floor_result, expires_at, created_by
  ) values (
    'f9100000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000001',
    'f9110000-0000-4000-8000-000000000001',
    1, 'accepted', 'USD', 100, 'pass', '2027-01-01T00:00:00Z',
    '20000000-0000-4000-8000-000000000002'
  );
  insert into quote_lines(
    id, quote_id, rate_card_id, sku, quantity, term_months,
    unit_price_minor, overage_rate_minor, discount_bps, line_total_minor
  ) values (
    'f9120000-0000-4000-8000-000000000001',
    'f9100000-0000-4000-8000-000000000001',
    '61000000-0000-4000-8000-000000000001',
    'LOCKED-STORAGE-TB', 1, 3, 34, 40, 0, 100
  );
  insert into orders(
    id, quote_id, agreement_id, account_id, invoicing_account_id,
    sourcing, po_number, signer_user_id, authority_title, authority_attested,
    status, service_starts_on, service_ends_on
  ) values (
    'f9130000-0000-4000-8000-000000000001',
    'f9100000-0000-4000-8000-000000000001',
    '51000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'direct', 'PO-RC-REMAINDER',
    '20000000-0000-4000-8000-000000000002',
    'Chief Demo Officer', true, 'active', '2026-01-01', '2026-04-01'
  )
$$, 'service can seed a three-month residual-allocation order');

select lives_ok($$
  insert into quotes(
    id, account_id, end_client_account_id, partner_account_id, price_book_id,
    series_id, revision, status, currency, total_minor, margin_floor_result,
    expires_at, created_by
  ) values (
    'f9400000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000005',
    '60000000-0000-4000-8000-000000000001',
    'f9410000-0000-4000-8000-000000000001',
    1, 'accepted', 'USD', 132000, 'pass', '2027-01-01T00:00:00Z',
    '20000000-0000-4000-8000-000000000005'
  );
  insert into core_quote_commercial_profiles(
    quote_id, channel_shape, merchant_of_record, pricing_authority,
    billing_account_id, distributor_account_id, pricing_inputs,
    pricing_calculated_at
  ) values (
    'f9400000-0000-4000-8000-000000000001', 'distributor',
    'partner', 'partner', '10000000-0000-4000-8000-000000000005',
    '10000000-0000-4000-8000-000000000005', '{}',
    '2026-07-31T16:00:00Z'
  );
  insert into orders(
    id, quote_id, agreement_id, account_id, invoicing_account_id,
    partner_account_id, sourcing, po_number, signer_user_id,
    authority_title, authority_attested, status, service_starts_on,
    service_ends_on
  ) values (
    'f9420000-0000-4000-8000-000000000001',
    'f9400000-0000-4000-8000-000000000001',
    '51000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000005',
    '10000000-0000-4000-8000-000000000005',
    'distributor', 'PO-RC-DISTRIBUTOR',
    '20000000-0000-4000-8000-000000000005',
    'Distribution Director', true, 'active', '2026-08-01', '2027-07-31'
  );
  insert into core_order_commercial_profiles(
    order_id, merchant_of_record, billing_shape,
    provisioning_idempotency_key, governing_agreement_version,
    distributor_account_id, accepted_at
  ) values (
    'f9420000-0000-4000-8000-000000000001',
    'partner', 'distributor', 'provision:order:f9420000:v1', 1,
    '10000000-0000-4000-8000-000000000005',
    '2026-08-01T00:00:00Z'
  )
$$, 'distributor order binds end client service to partner invoicing');

select lives_ok($$
  insert into quotes(
    id, account_id, price_book_id, series_id, revision, status, currency,
    total_minor, margin_floor_result, expires_at, created_by
  ) values (
    'f9500000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000004',
    '60000000-0000-4000-8000-000000000001',
    'f9510000-0000-4000-8000-000000000001',
    1, 'accepted', 'USD', 156000, 'pass', '2027-01-01T00:00:00Z',
    '20000000-0000-4000-8000-000000000004'
  );
  insert into orders(
    id, quote_id, agreement_id, account_id, invoicing_account_id,
    sourcing, po_number, signer_user_id, authority_title,
    authority_attested, status, service_starts_on, service_ends_on
  ) values (
    'f9520000-0000-4000-8000-000000000001',
    'f9500000-0000-4000-8000-000000000001',
    '51000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000004',
    'marketplace', 'PO-RC-MARKETPLACE',
    '20000000-0000-4000-8000-000000000004',
    'Chief Demo Officer', true, 'active', '2026-08-01', '2027-07-31'
  )
$$, 'marketplace order uses the end-client agreement without partner identifiers');

select is(
  (select count(*)::integer from core_revenue_forecast
    where order_id = '80000000-0000-4000-8000-000000000001'),
  12,
  'an annual order emits exactly twelve forecast months'
);
select is(
  (select sum(forecast_revenue_minor)::bigint from core_revenue_forecast
    where order_id = '80000000-0000-4000-8000-000000000001'),
  180000::bigint,
  'annual forecast rows sum exactly to the source quote total'
);
select is(
  (select count(*)::integer from core_revenue_forecast
    where order_id = 'f9130000-0000-4000-8000-000000000001'),
  3,
  'a three-month order does not emit its exclusive service-end month'
);
select is(
  (select sum(forecast_revenue_minor)::bigint from core_revenue_forecast
    where order_id = 'f9130000-0000-4000-8000-000000000001'),
  100::bigint,
  'residual allocation preserves every source minor unit'
);
select is(
  (select array_agg(forecast_revenue_minor order by forecast_month)::text
   from core_revenue_forecast
   where order_id = 'f9130000-0000-4000-8000-000000000001'),
  '{34,33,33}',
  'residual minor units are allocated deterministically to the earliest months'
);

-- A signed read-only member keeps account visibility but cannot mutate it or
-- manufacture commercial artifacts.
reset role;
select set_config('app.authorization_context', jsonb_build_object(
  'userId','20000000-0000-4000-8000-000000000002',
  'accountIds',jsonb_build_array('10000000-0000-4000-8000-000000000001'),
  'roles',jsonb_build_array('member'),
  'isInternalStaff',false,
  'requestId','integration-rls-member',
  'expiresAt',(clock_timestamp() + interval '5 minutes')::text
)::text, true);
select set_config('app.authorization_signature', encode(extensions.hmac(
  current_setting('app.authorization_context'),
  (select secret from private.authorization_secrets where active order by created_at desc limit 1),
  'sha256'
), 'hex'), true);
set local role clockwork_runtime;
set local search_path = public, extensions;

select is(
  (select count(*)::integer from accounts where id = '10000000-0000-4000-8000-000000000001'),
  1,
  'read-only member can still read its account'
);
select is_empty($$
  update accounts set legal_name = 'member bypass attempt'
  where id = '10000000-0000-4000-8000-000000000001'
  returning 1
$$,
  'read-only member cannot update its account through SQL'
);
select throws_ok($$
  insert into quotes(
    id, account_id, price_book_id, series_id, revision, status, currency,
    total_minor, margin_floor_result, expires_at, created_by
  ) values (
    'f9200000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000001',
    'f9210000-0000-4000-8000-000000000001',
    1, 'draft', 'USD', 100, 'pass', '2027-01-01T00:00:00Z',
    '20000000-0000-4000-8000-000000000002'
  )
$$, '42501', null, 'read-only member cannot insert a quote through SQL');
select is((select count(*)::integer from rate_cards), 0,
  'customer member cannot read rate-card floors or accounting mappings');
select is((select count(*)::integer from core_partner_transfer_tiers), 0,
  'customer member cannot read partner transfer tiers');

-- An owner may request termination, but cannot approve/advance it, forge a
-- certificate, or delete commerce state.
reset role;
select set_config('app.authorization_context', jsonb_build_object(
  'userId','20000000-0000-4000-8000-000000000002',
  'accountIds',jsonb_build_array('10000000-0000-4000-8000-000000000001'),
  'roles',jsonb_build_array('owner'),
  'isInternalStaff',false,
  'requestId','integration-rls-owner',
  'expiresAt',(clock_timestamp() + interval '5 minutes')::text
)::text, true);
select set_config('app.authorization_signature', encode(extensions.hmac(
  current_setting('app.authorization_context'),
  (select secret from private.authorization_secrets where active order by created_at desc limit 1),
  'sha256'
), 'hex'), true);
set local role clockwork_runtime;
set local search_path = public, extensions;

select is(
  (select count(*)::integer from core_revenue_forecast
    where account_id <> '10000000-0000-4000-8000-000000000001'),
  0,
  'customer report view applies underlying tenant RLS'
);
select is(
  (select source_record_ids->>'quoteId' from core_revenue_forecast
    where order_id = 'f9130000-0000-4000-8000-000000000001' limit 1),
  'f9100000-0000-4000-8000-000000000001',
  'customer revenue report traces each row to its source quote'
);
select throws_ok($$
  select * from core_capacity_planning
$$, '42501', null, 'customer cannot query the internal capacity report view');

select lives_ok($$
  insert into terminations(
    id, account_id, order_id, effective_at, final_billing_status, teardown_status
  ) values (
    'f9300000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000001',
    '2027-02-01T00:00:00Z', 'pending', 'pending_final_billing'
  )
$$, 'account owner can create a termination request');
select is_empty($$
  update terminations set teardown_status = 'teardown_confirmed'
  where id = 'f9300000-0000-4000-8000-000000000001'
  returning 1
$$,
  'termination requester cannot approve or advance teardown state'
);
select throws_ok($$
  insert into deletion_certificates(
    id, termination_id, document_id, scope, method, completed_at
  ) values (
    'f9310000-0000-4000-8000-000000000001',
    'f9300000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000026',
    'forged scope', 'forged method', '2027-02-02T00:00:00Z'
  )
$$, '42501', null, 'tenant owner cannot forge a deletion certificate');
select is_empty($$
  delete from terminations
  where id = 'f9300000-0000-4000-8000-000000000001'
  returning 1
$$,
  'tenant owner cannot delete a termination record'
);
select is((select count(*)::integer from rate_cards), 0,
  'customer owner cannot read rate-card floors or accounting mappings');
select is((select count(*)::integer from core_partner_transfer_tiers), 0,
  'customer owner cannot read partner transfer tiers');

-- Service delivery does not grant the end client visibility into a
-- distributor-owned commercial artifact. Marketplace purchases remain visible
-- to their buyer account because they do not carry partner economics.
reset role;
select set_config('app.authorization_context', jsonb_build_object(
  'userId','20000000-0000-4000-8000-000000000004',
  'accountIds',jsonb_build_array('10000000-0000-4000-8000-000000000004'),
  'roles',jsonb_build_array('member'),
  'isInternalStaff',false,
  'requestId','integration-rls-end-client',
  'expiresAt',(clock_timestamp() + interval '5 minutes')::text
)::text, true);
select set_config('app.authorization_signature', encode(extensions.hmac(
  current_setting('app.authorization_context'),
  (select secret from private.authorization_secrets where active order by created_at desc limit 1),
  'sha256'
), 'hex'), true);
set local role clockwork_runtime;
set local search_path = public, extensions;

select is(
  (select count(*)::integer from orders
    where id = 'f9420000-0000-4000-8000-000000000001'),
  0,
  'distributor end client cannot read the partner-owned order'
);
select is(
  (select count(*)::integer from core_order_commercial_profiles
    where order_id = 'f9420000-0000-4000-8000-000000000001'),
  0,
  'distributor end client cannot read partner commercial profiles'
);
select is(
  (select count(*)::integer from orders
    where id = 'f9520000-0000-4000-8000-000000000001'),
  1,
  'marketplace buyer can read its order'
);
select is(
  (select count(*)::integer from quotes
    where id = 'f9500000-0000-4000-8000-000000000001'),
  1,
  'marketplace buyer can read its quote'
);

-- Finance approval has explicit access to the private calculation inputs.
reset role;
select set_config('app.authorization_context', jsonb_build_object(
  'userId','20000000-0000-4000-8000-000000000001',
  'accountIds',jsonb_build_array(),
  'roles',jsonb_build_array('finance_approver'),
  'isInternalStaff',true,
  'requestId','integration-rls-finance',
  'expiresAt',(clock_timestamp() + interval '5 minutes')::text
)::text, true);
select set_config('app.authorization_signature', encode(extensions.hmac(
  current_setting('app.authorization_context'),
  (select secret from private.authorization_secrets where active order by created_at desc limit 1),
  'sha256'
), 'hex'), true);
set local role clockwork_runtime;
set local search_path = public, extensions;

select is((select count(*)::integer from rate_cards), 2,
  'finance approver can read private rate-card calculation inputs');
select is((select count(*)::integer from core_partner_transfer_tiers), 1,
  'finance approver can read private partner transfer tiers');

select * from finish();
rollback;
