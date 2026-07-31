begin;
select plan(24);

set local role clockwork_service;
set local search_path = public, extensions;

-- Exercise the ordinary draft -> issued -> accepted lifecycle without relying on
-- the seed's already-accepted quotes.
insert into quotes (
  id, account_id, price_book_id, series_id, revision, status, currency,
  total_minor, margin_floor_result, expires_at, created_by
) values (
  'f0000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000001',
  'f1000000-0000-4000-8000-000000000001',
  1, 'draft', 'USD', 15000, 'pass',
  '2026-08-31T16:00:00Z',
  '20000000-0000-4000-8000-000000000002'
);

select lives_ok(
  $$update quotes set status = 'issued' where id = 'f0000000-0000-4000-8000-000000000001'$$,
  'a draft quote can be issued'
);
select lives_ok(
  $$update quotes set status = 'accepted' where id = 'f0000000-0000-4000-8000-000000000001'$$,
  'an issued quote can be accepted without rewriting its commercial terms'
);

select throws_ok(
  $$update orders set status = 'submitted' where id = '80000000-0000-4000-8000-000000000002'$$,
  '23514', 'invalid order status transition',
  'an active order cannot return to submitted and unlock its terms'
);

select throws_ok(
  $$update price_books set name = 'Rewritten published book' where id = '60000000-0000-4000-8000-000000000001'$$,
  '55000', 'published price books are immutable; create a version',
  'a published price book cannot be rewritten'
);
select throws_ok(
  $$update rate_cards set unit_price_minor = unit_price_minor + 1 where id = '61000000-0000-4000-8000-000000000001'$$,
  '55000', 'published rate cards are immutable; create a price book version',
  'a rate card in a published price book cannot be rewritten'
);

select throws_ok(
  $$update agreements set created_at = '2000-01-01T00:00:00Z' where id = '51000000-0000-4000-8000-000000000001'$$,
  '55000', 'executed agreement evidence is immutable; create a version',
  'agreement evidence timestamps are immutable'
);
select throws_ok(
  $$update orders set created_at = '2000-01-01T00:00:00Z' where id = '80000000-0000-4000-8000-000000000002'$$,
  '55000', 'accepted order evidence timestamps are immutable',
  'accepted order creation timestamps are immutable'
);
select throws_ok(
  $$update orders set immutable_at = '2000-01-01T00:00:00Z' where id = '80000000-0000-4000-8000-000000000002'$$,
  '55000', 'accepted order evidence timestamps are immutable',
  'accepted order immutability timestamps are immutable'
);

-- The usage event belongs to the referral entitlement, not the direct order's
-- commitment ledger.
insert into usage_events (
  id, entitlement_id, external_event_id, measured_at, quantity, kind
) values (
  'f2000000-0000-4000-8000-000000000001',
  '83000000-0000-4000-8000-000000000002',
  'chain-test-cross-entitlement',
  '2026-07-31T15:30:00Z', 1, 'storage_tb_month'
);
select throws_ok(
  $$insert into commitment_entries (id, ledger_id, usage_event_id, quantity, overage_quantity, recorded_at) values ('f3000000-0000-4000-8000-000000000001', '84000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001', 1, 0, '2026-07-31T16:00:00Z')$$,
  '23514', 'usage event must belong to the commitment ledger order line',
  'usage from another entitlement cannot consume a commitment ledger'
);

select throws_ok(
  $$insert into amendment_lines (id, amendment_id, order_line_id, sku, quantity_delta, price_delta_minor) values ('f4000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000002', 'LOCKED-STORAGE-TB', 1, 1000)$$,
  '23514', 'amendment line must belong to the amended order',
  'an amendment cannot supersede a line from another order'
);

select throws_ok(
  $$insert into quotes (id, account_id, price_book_id, series_id, revision, status, currency, total_minor, margin_floor_result, expires_at, created_by) values ('f0000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000002', 1, 'draft', 'EUR', 15000, 'pass', '2026-08-31T16:00:00Z', '20000000-0000-4000-8000-000000000002')$$,
  '23514', 'quote currency must match its price book',
  'quote currency must match the pinned price book'
);

-- Referral partner context: the partner sees its structurally attributed quote
-- and POC, but cannot see a different partner's resale commercial artifact.
reset role;
select set_config(
  'app.authorization_context',
  jsonb_build_object(
    'userId', '20000000-0000-4000-8000-000000000003',
    'accountIds', jsonb_build_array('10000000-0000-4000-8000-000000000002'),
    'roles', jsonb_build_array('partner_admin'),
    'isInternalStaff', false,
    'requestId', 'pgtap-chain-referral',
    'expiresAt', (clock_timestamp() + interval '5 minutes')::text
  )::text,
  true
);
select set_config(
  'app.authorization_signature',
  encode(extensions.hmac(
    current_setting('app.authorization_context'),
    (select secret from private.authorization_secrets where active order by created_at desc limit 1),
    'sha256'
  ), 'hex'),
  true
);
set local role clockwork_runtime;
set local search_path = public, extensions;

select is(
  (select count(*)::integer from quotes where id = '70000000-0000-4000-8000-000000000002'),
  1, 'referral partner sees its attributed end-client quote'
);
select is(
  (select count(*)::integer from pocs where id = '85000000-0000-4000-8000-000000000001'),
  1, 'referral partner sees its attributed end-client POC'
);
select is(
  (select count(*)::integer from quotes where id = '70000000-0000-4000-8000-000000000003'),
  0, 'referral partner cannot see another partner resale quote'
);

-- Resale partner context sees its own quote and not the referral partner quote.
reset role;
select set_config(
  'app.authorization_context',
  jsonb_build_object(
    'userId', '20000000-0000-4000-8000-000000000008',
    'accountIds', jsonb_build_array('10000000-0000-4000-8000-000000000003'),
    'roles', jsonb_build_array('partner_admin'),
    'isInternalStaff', false,
    'requestId', 'pgtap-chain-resale',
    'expiresAt', (clock_timestamp() + interval '5 minutes')::text
  )::text,
  true
);
select set_config(
  'app.authorization_signature',
  encode(extensions.hmac(
    current_setting('app.authorization_context'),
    (select secret from private.authorization_secrets where active order by created_at desc limit 1),
    'sha256'
  ), 'hex'),
  true
);
set local role clockwork_runtime;
set local search_path = public, extensions;

select is(
  (select count(*)::integer from quotes where id = '70000000-0000-4000-8000-000000000003'),
  1, 'resale partner sees its own resale quote'
);
select is(
  (select count(*)::integer from quotes where id = '70000000-0000-4000-8000-000000000002'),
  0, 'resale partner cannot see another partner referral quote'
);

-- The end client sees the referral quote it contracts on directly, but the
-- resale path suppresses the partner's commercial artifact.
reset role;
select set_config(
  'app.authorization_context',
  jsonb_build_object(
    'userId', '20000000-0000-4000-8000-000000000004',
    'accountIds', jsonb_build_array('10000000-0000-4000-8000-000000000004'),
    'roles', jsonb_build_array('owner'),
    'isInternalStaff', false,
    'requestId', 'pgtap-chain-end-client',
    'expiresAt', (clock_timestamp() + interval '5 minutes')::text
  )::text,
  true
);
select set_config(
  'app.authorization_signature',
  encode(extensions.hmac(
    current_setting('app.authorization_context'),
    (select secret from private.authorization_secrets where active order by created_at desc limit 1),
    'sha256'
  ), 'hex'),
  true
);
set local role clockwork_runtime;
set local search_path = public, extensions;

select is(
  (select count(*)::integer from quotes where id = '70000000-0000-4000-8000-000000000002'),
  1, 'end client sees its direct referral quote'
);
select is(
  (select count(*)::integer from quotes where id = '70000000-0000-4000-8000-000000000003'),
  0, 'end client cannot see its resale partner commercial quote'
);

select throws_ok(
  $$update memberships set role = 'internal_operator' where id = '31000000-0000-4000-8000-000000000004'$$,
  '42501', 'permission denied for table memberships',
  'tenant runtime cannot promote its commerce membership'
);
select throws_ok(
  $$update commerce_users set is_internal_staff = true where id = '20000000-0000-4000-8000-000000000004'$$,
  '42501', 'permission denied for table commerce_users',
  'tenant runtime cannot classify itself as internal staff'
);
select lives_ok(
  $$insert into audit_events (id, account_id, aggregate_type, aggregate_id, aggregate_version, event_type, event_version, actor, occurred_at, request_id) values ('97000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000004','account','10000000-0000-4000-8000-000000000004',1,'test.tenant.write',1,'{"kind":"user","id":"20000000-0000-4000-8000-000000000004"}',clock_timestamp(),'pgtap-tenant-append')$$,
  'tenant runtime can append an account-scoped audit event'
);
select lives_ok(
  $$insert into outbox_messages (id, event_id, topic, payload) values ('98000000-0000-4000-8000-000000000001','97000000-0000-4000-8000-000000000001','test.tenant.write','{}')$$,
  'tenant runtime can atomically append an outbox row for its visible audit event'
);

reset role;
set local role clockwork_service;
set local search_path = public, extensions;
select lives_ok(
  $$update price_books set status = 'retired', effective_to = '2026-12-31' where id = '60000000-0000-4000-8000-000000000002'$$,
  'an active price book can retire before its replacement activates'
);
select lives_ok(
  $$update agreement_templates set approval_status = 'retired' where id = '50000000-0000-4000-8000-000000000001'$$,
  'an approved agreement template can retire without rewriting evidence'
);

select * from finish();
rollback;
