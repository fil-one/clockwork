begin;
select plan(14);
set local role clockwork_service;
set local search_path = public, extensions;

select has_column(
  'public', 'price_books', 'row_version',
  'a price book carries a concurrency counter of its own'
);
select has_column(
  'public', 'price_books', 'updated_at',
  'a price book records when it last changed'
);

insert into price_books (
  id, name, currency, effective_from, status, version
) values (
  'c6000000-0000-4000-8000-000000000001',
  'Sterling activation fixture', 'GBP', '2026-01-01', 'draft', 9001
);
select is(
  (select row_version from price_books
    where id = 'c6000000-0000-4000-8000-000000000001'),
  1, 'a new price book starts at the first version'
);
select lives_ok($$
  update price_books set status = 'active'
  where id = 'c6000000-0000-4000-8000-000000000001'
$$, 'a price book activates');
select is(
  (select row_version from price_books
    where id = 'c6000000-0000-4000-8000-000000000001'),
  2, 'each persisted change advances the counter'
);

insert into core_price_book_activation_events (
  price_book_id, action, previous_status, resulting_status,
  effective_at, actor_user_id, reason, request_id
) values (
  'c6000000-0000-4000-8000-000000000001', 'activate', 'draft', 'active',
  '2026-08-01T16:00:00Z', '20000000-0000-4000-8000-000000000001',
  'Second finance authority confirmed the floors.', 'pgtap-price-activation'
);
select is(
  (select count(*)::integer from core_price_book_activation_events
    where price_book_id = 'c6000000-0000-4000-8000-000000000001'),
  1, 'the activation is recorded with its reason and deciding user'
);
select throws_ok($$
  insert into core_price_book_activation_events (
    price_book_id, action, previous_status, resulting_status,
    effective_at, actor_user_id, reason, request_id
  ) values (
    'c6000000-0000-4000-8000-000000000001', 'publish', 'draft', 'active',
    '2026-08-01T16:00:00Z', '20000000-0000-4000-8000-000000000001',
    'Unsupported action.', 'pgtap-price-activation-bad'
  )
$$, '23514', null, 'the recorded action stays within its vocabulary');

select throws_ok($$
  insert into approvals (
    action, object_type, object_id, requested_by, approved_by, status
  ) values (
    'price_book_activation', 'price_book',
    'c6000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    'approved'
  )
$$, '23514', null, 'one person cannot both request and approve an activation');

insert into price_books (
  id, name, currency, effective_from, status, version
) values (
  'c6000000-0000-4000-8000-000000000002',
  'Sterling draft fixture', 'GBP', '2026-01-01', 'draft', 9002
);
insert into rate_cards (
  id, price_book_id, sku, approved_claim, region, unit, unit_price_minor,
  floor_price_minor, overage_rate_minor, minimum_quantity, egress_treatment,
  commit_type, stripe_tax_code, qbo_income_account
) values (
  'c6100000-0000-4000-8000-000000000002',
  'c6000000-0000-4000-8000-000000000002',
  'LOCKED-STORAGE-TB', 'Fictional immutable storage capacity',
  'uk-south', 'TB-month', 15000, 10000, 18000, 1, 'metered',
  'term_drawdown', 'txcd_demo', '4000-Storage'
);

reset role;
select set_config('app.authorization_context', jsonb_build_object(
  'userId','20000000-0000-4000-8000-000000000001',
  'accountIds',jsonb_build_array(),
  'roles',jsonb_build_array('finance_approver'),
  'isInternalStaff',true,'requestId','price-book-finance-read',
  'expiresAt',(clock_timestamp() + interval '5 minutes')::text)::text, true);
select set_config('app.authorization_signature', encode(extensions.hmac(
  current_setting('app.authorization_context'),
  (select secret from private.authorization_secrets where active order by created_at desc limit 1),'sha256'),'hex'), true);

set local role clockwork_runtime;
set local search_path = public, extensions;
select is(
  (select count(*)::integer from price_books
    where id = 'c6000000-0000-4000-8000-000000000002'),
  1, 'finance reads a draft price book awaiting activation'
);
-- Row policy, not privilege: the write matches nothing and changes nothing.
update price_books set status = 'active'
where id = 'c6000000-0000-4000-8000-000000000002';
select is(
  (select status from price_books
    where id = 'c6000000-0000-4000-8000-000000000002'),
  'draft', 'finance reads price books and never writes them directly'
);
select is(
  (select count(*)::integer from rate_cards
    where price_book_id = 'c6000000-0000-4000-8000-000000000002'),
  1, 'finance reads the rate cards it is being asked to approve'
);

-- Every other role, internal included, sees no unpublished pricing at all.
reset role;
select set_config('app.authorization_context', jsonb_build_object(
  'userId','20000000-0000-4000-8000-000000000001',
  'accountIds',jsonb_build_array(),
  'roles',jsonb_build_array('internal_operator'),
  'isInternalStaff',true,'requestId','price-book-operator-read',
  'expiresAt',(clock_timestamp() + interval '5 minutes')::text)::text, true);
select set_config('app.authorization_signature', encode(extensions.hmac(
  current_setting('app.authorization_context'),
  (select secret from private.authorization_secrets where active order by created_at desc limit 1),'sha256'),'hex'), true);

set local role clockwork_runtime;
set local search_path = public, extensions;
select is(
  (select count(*)::integer from price_books
    where id = 'c6000000-0000-4000-8000-000000000002'),
  0, 'an internal operator without finance authority sees no draft price book'
);
-- The restrictive economics guard ANDs with every permissive policy, so the
-- new finance read cannot widen who sees a rate card.
select is(
  (select count(*)::integer from rate_cards),
  0, 'rate-card economics stay closed to every role but finance'
);
select is(
  (select count(*)::integer from core_price_book_activation_events
    where price_book_id = 'c6000000-0000-4000-8000-000000000002'),
  0, 'activation history of an unpublished book stays closed'
);

select * from finish();
rollback;
