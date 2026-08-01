begin;
select plan(33);

set local role clockwork_service;
set local search_path = public, extensions;

select has_table('public', 'core_commitment_periods', 'core commitment periods are canonical');
select is(
  (select relrowsecurity from pg_class where oid = 'public.core_account_commercial_profiles'::regclass),
  true, 'core account commercial profiles enforce RLS'
);
select has_view('public', 'core_revenue_forecast', 'revenue forecast report is installed');

select lives_ok($$
  update core_account_commercial_profiles
  set billing_model = 'net_terms', payment_terms_days = 30,
    credit_status = 'approved', approved_credit_limit_minor = 500000,
    current_exposure_minor = 125000,
    contractual_time_zone = 'America/New_York'
  where account_id = '10000000-0000-4000-8000-000000000001'
$$, 'a valid net-terms commercial profile is accepted');

select throws_ok($$
  update core_account_commercial_profiles
  set legal_entity_fingerprint = (
    select source_profile.legal_entity_fingerprint
    from core_account_commercial_profiles source_profile
    where source_profile.account_id = '10000000-0000-4000-8000-000000000001'
  )
  where account_id = '10000000-0000-4000-8000-000000000004'
$$, '23505', null, 'one-entity fingerprint blocks a duplicate account signal');

select throws_ok($$
  update core_account_commercial_profiles
  set billing_model = 'auto_charge', payment_terms_days = 30
  where account_id = '10000000-0000-4000-8000-000000000004'
$$, '23514', null, 'non-terms billing cannot carry net terms');

select lives_ok($$
  update core_account_commercial_profiles set current_exposure_minor = 150000
  where account_id = '10000000-0000-4000-8000-000000000001' and row_version = 2
$$, 'credit exposure updates optimistically');
select is(
  (select row_version from core_account_commercial_profiles where account_id = '10000000-0000-4000-8000-000000000001'),
  3, 'optimistic update increments the row version'
);

select lives_ok($$
  update accounts set relationship_roles = array_append(relationship_roles, 'direct_client')
  where id = '10000000-0000-4000-8000-000000000004'
$$, 'the unified account records a second relationship role');
select lives_ok($$
  insert into core_account_relationship_roles(account_id, role)
  values ('10000000-0000-4000-8000-000000000004','direct_client')
$$, 'an account can add a second normalized relationship role');
select lives_ok($$
  insert into core_account_contacts(account_id, kind, name, email, is_primary, receives_invoices)
  values ('10000000-0000-4000-8000-000000000001','accounts_payable','Alex AP','ap@northstar.test',true,true)
$$, 'procurement contacts are normalized and typed');

select is(
  (select concat_ws(':', channel_shape, merchant_of_record, pricing_authority)
   from core_quote_commercial_profiles
   where quote_id = '70000000-0000-4000-8000-000000000003'),
  'resale:partner:partner',
  'a resale quote preserves partner pricing authority and MoR'
);
select throws_ok($$
  insert into quotes(
    id, account_id, end_client_account_id, partner_account_id, price_book_id,
    series_id, revision, status, currency, total_minor, margin_floor_result,
    expires_at, created_by
  ) values (
    'a1100000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000003',
    '60000000-0000-4000-8000-000000000002',
    'a1100000-0000-4000-8000-000000000002', 1, 'accepted', 'EUR',
    168000, 'pass', '2027-01-01T00:00:00Z',
    '20000000-0000-4000-8000-000000000008'
  );
  insert into core_quote_commercial_profiles(
    quote_id, channel_shape, merchant_of_record, pricing_authority, billing_account_id,
    pricing_inputs, pricing_calculated_at
  ) values (
    'a1100000-0000-4000-8000-000000000001','resale','fil_one','fil_one',
    '10000000-0000-4000-8000-000000000003','{}','2026-07-20T16:00:00Z'
  )
$$, '23514', 'quote channel, pricing authority, and merchant of record are inconsistent',
  'resale cannot be rewritten as Fil One merchant of record');

select lives_ok($$
  insert into core_quote_snapshots(id, quote_id, revision, snapshot, snapshot_hash, issued_at, created_by)
  values ('a1000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000003',1,
    '{"currency":"EUR","totalMinor":"168000"}',repeat('a',64),'2026-07-21T16:00:00Z','20000000-0000-4000-8000-000000000008')
$$, 'an issued quote snapshot pins immutable commercial evidence');
select throws_ok($$
  update core_quote_snapshots set snapshot = '{}' where id = 'a1000000-0000-4000-8000-000000000001'
$$, '55000', 'core_quote_snapshots is append-only/immutable', 'quote snapshots are immutable');

select is(
  (select concat_ws(':', merchant_of_record, billing_shape,
    governing_agreement_version::text)
   from core_order_commercial_profiles
   where order_id = '80000000-0000-4000-8000-000000000003'),
  'partner:resale:1',
  'an accepted resale order pins MoR, agreement version, and provisioning key'
);
select throws_ok($$
  insert into quotes(
    id, account_id, price_book_id, series_id, revision, status, currency,
    total_minor, margin_floor_result, expires_at, created_by
  ) values (
    'a1200000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000001',
    'a1200000-0000-4000-8000-000000000002', 1, 'accepted', 'USD',
    180000, 'pass', '2027-01-01T00:00:00Z',
    '20000000-0000-4000-8000-000000000002'
  );
  insert into core_quote_commercial_profiles(
    quote_id, channel_shape, merchant_of_record, pricing_authority,
    billing_account_id, pricing_inputs, pricing_calculated_at
  ) values (
    'a1200000-0000-4000-8000-000000000001','direct','fil_one','fil_one',
    '10000000-0000-4000-8000-000000000001','{}','2026-07-20T16:00:00Z'
  );
  insert into orders(
    id, quote_id, agreement_id, account_id, invoicing_account_id,
    sourcing, signer_user_id, authority_title, authority_attested, status,
    service_starts_on
  ) values (
    'a1200000-0000-4000-8000-000000000003',
    'a1200000-0000-4000-8000-000000000001',
    '51000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001','direct',
    '20000000-0000-4000-8000-000000000002','Owner',true,'accepted','2026-08-01'
  );
  insert into core_order_commercial_profiles(
    order_id, merchant_of_record, billing_shape, provisioning_idempotency_key,
    governing_agreement_version, accepted_at
  ) values (
    'a1200000-0000-4000-8000-000000000003','fil_one','direct',
    'bad-agreement-version',99,'2026-07-20T16:00:00Z'
  )
$$, '23514', 'order must pin the governing agreement version', 'an order cannot pin a nonexistent agreement version');

select ok(
  exists (
    select 1 from core_order_line_snapshots
    where id = '81100000-0000-4000-8000-000000000003'
      and order_line_id = '81000000-0000-4000-8000-000000000003'
  ),
  'accepted order line pricing is snapshotted'
);
select throws_ok($$
  delete from core_order_line_snapshots where id = '81100000-0000-4000-8000-000000000003'
$$, '55000', 'core_order_line_snapshots is append-only/immutable', 'order line snapshots cannot be deleted');

select lives_ok($$
  insert into commitment_ledgers(
    id, order_id, order_line_id, commit_type, committed_quantity,
    period_starts_at, period_ends_at
  ) values (
    'a3100000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001','period_allowance',6,
    '2026-01-01T00:00:00Z','2026-07-01T00:00:00Z'
  );
  insert into core_commitment_periods(
    id, ledger_id, sequence, starts_at, ends_at, contractual_time_zone,
    allowance_quantity, contracted_overage_rate_minor
  ) values (
    'a3000000-0000-4000-8000-000000000001','a3100000-0000-4000-8000-000000000001',1,
    '2026-01-01T00:00:00Z','2026-07-01T00:00:00Z','America/New_York',6,18000
  )
$$, 'a partial commitment period is recorded with timezone and contracted rate');
select throws_ok($$
  insert into core_commitment_periods(
    ledger_id, sequence, starts_at, ends_at, contractual_time_zone,
    allowance_quantity, contracted_overage_rate_minor
  ) values (
    'a3100000-0000-4000-8000-000000000001',2,'2026-06-30T00:00:00Z','2027-01-01T00:00:00Z','America/New_York',6,18000
  )
$$, '23P01', 'commitment periods cannot overlap', 'commitment allowance periods cannot overlap');

select lives_ok($$
  insert into commitment_ledgers(id, order_id, order_line_id, commit_type, committed_quantity, period_starts_at, period_ends_at)
  values ('a4000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000002',
    '81000000-0000-4000-8000-000000000002','period_allowance',1,'2026-08-01T00:00:00Z','2026-09-01T00:00:00Z')
$$, 'a second ledger fixture preserves its own order line');
select lives_ok($$
  insert into core_commitment_periods(
    id, ledger_id, sequence, starts_at, ends_at, contractual_time_zone,
    allowance_quantity, contracted_overage_rate_minor
  ) values (
    'a5000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000001',1,
    '2026-08-01T00:00:00Z','2026-09-01T00:00:00Z','UTC',1,18000
  )
$$, 'the second ledger owns its period');
select throws_ok($$
  insert into core_commitment_ledger_corrections(
    ledger_id, period_id, quantity_delta, overage_delta, reason_code, source_reference, recorded_by, recorded_at
  ) values (
    '84000000-0000-4000-8000-000000000001','a5000000-0000-4000-8000-000000000001',-1,0,
    'source_correction','wrong-ledger-period','20000000-0000-4000-8000-000000000001','2026-07-31T16:00:00Z'
  )
$$, '23514', 'ledger correction period must belong to its ledger', 'a correction cannot cross commitment ledgers');

select lives_ok($$
  insert into core_marketplace_events(
    id, provider, provider_event_id, event_type, provider_account_reference, account_id, order_id,
    occurred_at, currency, gross_minor, fee_minor, tax_minor, net_minor, payload_hash, normalized_payload
  ) values (
    'a6000000-0000-4000-8000-000000000001','aws','aws-fixture-1','settlement','aws-customer-1',
    '10000000-0000-4000-8000-000000000004','80000000-0000-4000-8000-000000000006',
    '2026-07-31T16:00:00Z','USD',10000,1000,0,9000,repeat('c',64),'{"provider":"aws"}'
  )
$$, 'AWS settlement normalizes with gross, fee, tax, and net');
select throws_ok($$
  insert into core_marketplace_events(
    provider, provider_event_id, event_type, provider_account_reference, occurred_at, payload_hash, normalized_payload
  ) values ('aws','aws-fixture-1','settlement','aws-customer-1','2026-07-31T16:00:00Z',repeat('d',64),'{}')
$$, '23505', null, 'marketplace provider event IDs are replay-safe');

select throws_ok($$
  insert into core_accounting_exports(
    export_type, period_starts_on, period_ends_on, currency, idempotency_key, status, total_debit_minor, total_credit_minor
  ) values ('ar_issuance','2026-07-01','2026-07-31','USD','unbalanced-export','generated',100,99)
$$, '23514', null, 'accounting exports must balance');
select throws_ok($$
  insert into core_three_way_tie_outs(
    period_starts_on, period_ends_on, currency, platform_revenue_minor, stripe_revenue_minor, qbo_revenue_minor,
    stripe_variance_minor, qbo_variance_minor, status
  ) values ('2026-07-01','2026-07-31','USD',100,90,80,0,0,'matched')
$$, '23514', null, 'three-way tie-out variances must equal their source differences');

select is(
  (select forecast_revenue_minor from core_revenue_forecast where order_id = '80000000-0000-4000-8000-000000000001' and forecast_month = '2026-01-01'),
  15000::numeric, 'revenue forecast ties the direct order total to its 12-month source quote'
);
select is(
  (select actual_quantity from core_capacity_planning where capacity_month = '2026-07-01' and region = 'us-east-2' and sku = 'LOCKED-STORAGE-TB'),
  8::numeric, 'capacity planning ties actual quantity to source usage events'
);

-- Resale isolation: the partner sees the profile; the provisioned end client
-- does not see its partner's commercial terms.
reset role;
select set_config('app.authorization_context', jsonb_build_object(
  'userId','20000000-0000-4000-8000-000000000008',
  'accountIds',jsonb_build_array('10000000-0000-4000-8000-000000000003'),
  'roles',jsonb_build_array('partner_admin'),'isInternalStaff',false,'requestId','core-rls-partner',
  'expiresAt',(clock_timestamp() + interval '5 minutes')::text)::text, true);
select set_config('app.authorization_signature', encode(extensions.hmac(
  current_setting('app.authorization_context'),
  (select secret from private.authorization_secrets where active order by created_at desc limit 1),'sha256'),'hex'), true);
set local role clockwork_runtime;
set local search_path = public, extensions;
select is((select count(*)::integer from core_quote_commercial_profiles where quote_id = '70000000-0000-4000-8000-000000000003'), 1,
  'resale partner sees its commercial profile');

reset role;
select set_config('app.authorization_context', jsonb_build_object(
  'userId','20000000-0000-4000-8000-000000000004',
  'accountIds',jsonb_build_array('10000000-0000-4000-8000-000000000004'),
  'roles',jsonb_build_array('owner'),'isInternalStaff',false,'requestId','core-rls-end-client',
  'expiresAt',(clock_timestamp() + interval '5 minutes')::text)::text, true);
select set_config('app.authorization_signature', encode(extensions.hmac(
  current_setting('app.authorization_context'),
  (select secret from private.authorization_secrets where active order by created_at desc limit 1),'sha256'),'hex'), true);
set local role clockwork_runtime;
set local search_path = public, extensions;
select is((select count(*)::integer from core_quote_commercial_profiles where quote_id = '70000000-0000-4000-8000-000000000003'), 0,
  'resale end client cannot see partner commercial terms');
select throws_ok($$
  update core_account_commercial_profiles set approved_credit_limit_minor = 999999999
  where account_id = '10000000-0000-4000-8000-000000000004'
$$, '42501', 'permission denied for table core_account_commercial_profiles',
  'tenant runtime cannot grant itself credit');

select * from finish();
rollback;
