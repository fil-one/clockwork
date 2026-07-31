begin;
select plan(5);

select is(
  (select prosecdef from pg_proc where oid = 'public.validate_commerce_chain()'::regprocedure),
  true,
  'commerce-chain trigger validation runs with its fixed definer privileges'
);
select is(
  has_function_privilege('clockwork_runtime', 'public.validate_commerce_chain()', 'EXECUTE'),
  false,
  'runtime sessions cannot invoke the definer function directly'
);

select set_config('app.authorization_context', jsonb_build_object(
  'userId','20000000-0000-4000-8000-000000000002',
  'accountIds',jsonb_build_array('10000000-0000-4000-8000-000000000001'),
  'roles',jsonb_build_array('owner'),
  'isInternalStaff',false,
  'requestId','secure-chain-owner',
  'expiresAt',(clock_timestamp() + interval '5 minutes')::text
)::text, true);
select set_config('app.authorization_signature', encode(extensions.hmac(
  current_setting('app.authorization_context'),
  (select secret from private.authorization_secrets where active order by created_at desc limit 1),
  'sha256'
), 'hex'), true);
set local role clockwork_runtime;
set local search_path = public, extensions;

select is((select count(*)::integer from rate_cards), 0,
  'owner still cannot read confidential rate-card economics');

select lives_ok($$
  insert into quotes(
    id, account_id, price_book_id, series_id, revision, status, currency,
    total_minor, margin_floor_result, expires_at, created_by
  ) values (
    'f9030000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000001',
    'f9030000-0000-4000-8000-000000000002',
    1, 'draft', 'USD', 180000, 'pass', '2027-12-31T00:00:00Z',
    '20000000-0000-4000-8000-000000000002'
  );
  insert into quote_lines(
    id, quote_id, rate_card_id, sku, quantity, term_months,
    unit_price_minor, overage_rate_minor, discount_bps, line_total_minor
  ) values (
    'f9030000-0000-4000-8000-000000000003',
    'f9030000-0000-4000-8000-000000000001',
    '61000000-0000-4000-8000-000000000001',
    'LOCKED-STORAGE-TB', 1, 12, 15000, 18000, 0, 180000
  )
$$, 'ordinary owner can persist a server-priced line through chain validation');

select throws_ok($$
  insert into quote_lines(
    id, quote_id, rate_card_id, sku, quantity, term_months,
    unit_price_minor, overage_rate_minor, discount_bps, line_total_minor
  ) values (
    'f9030000-0000-4000-8000-000000000004',
    'f9030000-0000-4000-8000-000000000001',
    '61000000-0000-4000-8000-000000000001',
    'MISMATCHED-SKU', 1, 12, 15000, 18000, 0, 180000
  )
$$, '23514', 'quote line must use the quote price book and rate-card SKU',
  'definer validation still rejects an invalid commercial chain');

select * from finish();
rollback;
