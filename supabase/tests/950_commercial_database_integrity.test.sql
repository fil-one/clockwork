begin;
select plan(79);

set local role clockwork_service;
set local search_path = public, extensions;

select has_table('public', 'system_capabilities',
  'software capabilities are persisted independently');
select has_table('public', 'core_order_acceptance_reservations',
  'order acceptance reservations are durable');
select has_table('public', 'core_partner_qbo_vendor_mappings',
  'verified partner QBO mappings are durable');
select has_function('public', 'core_reserve_order_acceptance',
  array['uuid','integer','uuid','text'],
  'order reservation derives persisted source facts');
select has_function('public', 'system_capability_is_enabled',
  array['text','boolean'],
  'capability checks expose normal and recovery modes');
select has_column('public', 'core_order_commercial_profiles',
  'buyer_agreement_id', 'orders pin a buyer agreement');
select has_column('public', 'core_order_commercial_profiles',
  'partner_agreement_id', 'orders independently pin a partner agreement');
select has_index('public', 'core_commission_settlement_exports',
  'core_commission_settlement_statement_unique',
  'one commission statement can bind only one provider posting');

select is((select input_provenance from system_external_gates
  where gate_key = 'EXT-COMMERCIAL-01'), 'repository_fixture',
  'commercial simulator evidence is marked as a repository fixture');
select is((select input_provenance from system_external_gates
  where gate_key = 'EXT-TAX-01'), 'repository_fixture',
  'tax simulator evidence is marked as a repository fixture');
select throws_ok($$
  update system_external_gates set configured_status = 'active'
  where gate_key = 'EXT-COMMERCIAL-01'
$$, '23514', null,
  'repository commercial fixtures cannot activate the external gate');
select throws_ok($$
  update system_external_gates set configured_status = 'active'
  where gate_key = 'EXT-TAX-01'
$$, '23514', null,
  'repository tax fixtures cannot activate the external gate');

select ok(system_capability_is_enabled('new_business'),
  'repository new-business commands begin enabled');
select ok(not system_capability_is_enabled('marketplace'),
  'new marketplace enrollment begins disabled');
select ok(system_capability_is_enabled('marketplace', true),
  'marketplace recovery remains independently enabled');
select ok(not system_capability_is_enabled('teardown'),
  'automated teardown begins disabled');
select ok(system_capability_is_enabled('teardown', true),
  'teardown recovery remains independently enabled');
select ok(not system_capability_is_enabled('not-a-capability'),
  'an unknown capability fails closed');

reset role;
delete from public.system_capabilities where capability_key = 'marketplace';
set local role clockwork_service;
set local search_path = public, extensions;
select ok(not system_capability_is_enabled('marketplace', true),
  'a missing capability row fails closed even for recovery');
select lives_ok($$
  insert into system_capabilities(
    capability_key,enabled,recovery_enabled,change_reason,changed_by
  ) values (
    'marketplace',false,true,'pgTAP restore missing row','pgtap:950'
  )
$$, 'missing capability fixture is restored explicitly');

select is((select buyer_agreement_id from core_order_commercial_profiles
  where order_id = '80000000-0000-4000-8000-000000000003'),
  '51000000-0000-4000-8000-000000000007'::uuid,
  'resale seed pins the authoritative buyer agreement');
select is((select partner_agreement_id from core_order_commercial_profiles
  where order_id = '80000000-0000-4000-8000-000000000003'),
  '51000000-0000-4000-8000-000000000003'::uuid,
  'resale seed pins the authoritative partner agreement');
select is((select partner_agreement_id from core_order_commercial_profiles
  where order_id = '80000000-0000-4000-8000-000000000002'),
  '51000000-0000-4000-8000-000000000008'::uuid,
  'referral seed independently pins its partner governing agreement');
select is((select partner_agreement_id from core_order_commercial_profiles
  where order_id = '80000000-0000-4000-8000-000000000001'),
  null::uuid, 'direct orders cannot carry a partner agreement');
select is((select partner_transfer_prices -> 'distributor' ->> 'minor'
  from rate_cards where id = '61000000-0000-4000-8000-000000000001'),
  '11000', 'USD distributor transfer price is persisted in the rate card');
select is((select partner_transfer_prices -> 'silver' ->> 'minor'
  from rate_cards where id = '61000000-0000-4000-8000-000000000002'),
  '14000', 'EUR silver transfer price matches the seeded resale quote line');

-- Direct accepted-order fixture with enough persisted credit to reserve.
update core_account_commercial_profiles
set billing_model = 'net_terms', payment_terms_days = 30,
  credit_status = 'approved', approved_credit_limit_minor = 500000,
  current_exposure_minor = 0, new_service_blocked = false,
  block_reason = null,
  collections_owner_id = '20000000-0000-4000-8000-000000000001'
where account_id = '10000000-0000-4000-8000-000000000001';
insert into quotes(
  id, account_id, price_book_id, series_id, revision, status, currency,
  total_minor, margin_floor_result, expires_at, created_by
) values (
  'b1000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000002', 1, 'accepted', 'USD',
  100000, 'pass', '2027-12-31T00:00:00Z',
  '20000000-0000-4000-8000-000000000002'
);
insert into core_quote_commercial_profiles(
  quote_id, channel_shape, merchant_of_record, pricing_authority,
  billing_account_id, pricing_inputs, pricing_calculated_at
) values (
  'b1000000-0000-4000-8000-000000000001','direct','fil_one','fil_one',
  '10000000-0000-4000-8000-000000000001','{}','2026-07-31T16:00:00Z'
);
insert into orders(
  id, quote_id, agreement_id, account_id, invoicing_account_id, sourcing,
  signer_user_id, authority_title, authority_attested, status,
  service_starts_on, service_ends_on
) values (
  'b1010000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001','direct',
  '20000000-0000-4000-8000-000000000002','Owner',true,'accepted',
  '2026-08-01','2027-07-31'
);
insert into core_order_commercial_profiles(
  order_id, merchant_of_record, billing_shape,
  provisioning_idempotency_key, governing_agreement_version, accepted_at
) values (
  'b1010000-0000-4000-8000-000000000001','fil_one','direct',
  'integrity:provision:b101:1',1,'2026-07-31T16:00:00Z'
);

select is((select decision from core_reserve_order_acceptance(
  'b1010000-0000-4000-8000-000000000001', 1,
  '20000000-0000-4000-8000-000000000001','integrity-reserve-1'
)), 'approved', 'valid persisted order state reserves credit');
select is((select current_exposure_minor from core_account_commercial_profiles
  where account_id = '10000000-0000-4000-8000-000000000001'),
  100000::bigint, 'approved reservation increments exposure once');
select is((select decision from core_reserve_order_acceptance(
  'b1010000-0000-4000-8000-000000000001', 1,
  '20000000-0000-4000-8000-000000000001','integrity-reserve-replay'
)), 'approved', 'reservation replay returns the durable decision');
select is((select current_exposure_minor from core_account_commercial_profiles
  where account_id = '10000000-0000-4000-8000-000000000001'),
  100000::bigint, 'reservation replay cannot double-count exposure');
select throws_ok($$
  select core_reserve_order_acceptance(
    'b1010000-0000-4000-8000-000000000001', 99,
    '20000000-0000-4000-8000-000000000001','integrity-stale')
$$, '40001', 'stale order acceptance version',
  'stale acceptance commands fail closed');

reset role;
select set_config('app.authorization_context', jsonb_build_object(
  'userId','20000000-0000-4000-8000-000000000004',
  'accountIds',jsonb_build_array('10000000-0000-4000-8000-000000000004'),
  'roles',jsonb_build_array('owner'),'isInternalStaff',false,
  'requestId','pgtap-integrity-resale-acceptance-forgery',
  'expiresAt',(clock_timestamp() + interval '5 minutes')::text
)::text, true);
select set_config('app.authorization_signature', encode(extensions.hmac(
  current_setting('app.authorization_context'),
  (select secret from private.authorization_secrets where active
   order by created_at desc limit 1),
  'sha256'),'hex'), true);
set local role clockwork_runtime;
set local search_path = public, extensions;
select throws_ok($$
  select core_reserve_order_acceptance(
    '80000000-0000-4000-8000-000000000003', 1,
    '20000000-0000-4000-8000-000000000001',
    'integrity-forged-resale-buyer-acceptance')
$$, '42501', 'order acceptance actor is outside the persisted party chain',
  'resale end client cannot exercise the partner acceptance authority');
reset role;
set local role clockwork_service;
set local search_path = public, extensions;

insert into audit_events(
  id, account_id, aggregate_type, aggregate_id, aggregate_version,
  event_type, event_version, actor, occurred_at, request_id
) values (
  'b1020000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001','order',
  'b1010000-0000-4000-8000-000000000001',1,
  'order.provisioning_requested',1,
  '{"kind":"system","id":"integrity-test"}',clock_timestamp(),
  'integrity-approved-outbox'
);
select lives_ok($$
  insert into outbox_messages(id,event_id,topic,payload)
  values (
    'b1030000-0000-4000-8000-000000000001',
    'b1020000-0000-4000-8000-000000000001',
    'order.provisioning_requested',
    '{"data":{"orderId":"b1010000-0000-4000-8000-000000000001"}}'
  )
$$, 'approved reservations may enqueue provisioning');

-- A second order is rejected while the billing account is held.
update core_account_commercial_profiles
set new_service_blocked = true, block_reason = 'integrity collections hold'
where account_id = '10000000-0000-4000-8000-000000000001';
insert into quotes(
  id, account_id, price_book_id, series_id, revision, status, currency,
  total_minor, margin_floor_result, expires_at, created_by
) values (
  'b1100000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000001',
  'b1100000-0000-4000-8000-000000000002', 1, 'accepted', 'USD',
  90000, 'pass', '2027-12-31T00:00:00Z',
  '20000000-0000-4000-8000-000000000002'
);
insert into core_quote_commercial_profiles(
  quote_id, channel_shape, merchant_of_record, pricing_authority,
  billing_account_id, pricing_inputs, pricing_calculated_at
) values (
  'b1100000-0000-4000-8000-000000000001','direct','fil_one','fil_one',
  '10000000-0000-4000-8000-000000000001','{}','2026-07-31T16:00:00Z'
);
insert into orders(
  id, quote_id, agreement_id, account_id, invoicing_account_id, sourcing,
  signer_user_id, authority_title, authority_attested, status,
  service_starts_on, service_ends_on
) values (
  'b1110000-0000-4000-8000-000000000001',
  'b1100000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001','direct',
  '20000000-0000-4000-8000-000000000002','Owner',true,'accepted',
  '2026-08-01','2027-07-31'
);
insert into core_order_commercial_profiles(
  order_id, merchant_of_record, billing_shape,
  provisioning_idempotency_key, governing_agreement_version, accepted_at
) values (
  'b1110000-0000-4000-8000-000000000001','fil_one','direct',
  'integrity:provision:b111:1',1,'2026-07-31T16:00:00Z'
);
select is((select decision from core_reserve_order_acceptance(
  'b1110000-0000-4000-8000-000000000001',1,
  '20000000-0000-4000-8000-000000000001','integrity-held'
)), 'rejected', 'a persisted new-service hold rejects acceptance');
select isnt((select review_case_id from core_order_acceptance_reservations
  where order_id = 'b1110000-0000-4000-8000-000000000001'),
  null::uuid, 'rejection creates an owned review');
select is((select current_exposure_minor from core_account_commercial_profiles
  where account_id = '10000000-0000-4000-8000-000000000001'),
  100000::bigint, 'rejected orders do not reserve exposure');
insert into audit_events(
  id, account_id, aggregate_type, aggregate_id, aggregate_version,
  event_type, event_version, actor, occurred_at, request_id
) values (
  'b1120000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001','order',
  'b1110000-0000-4000-8000-000000000001',1,
  'order.provisioning_requested',1,
  '{"kind":"system","id":"integrity-test"}',clock_timestamp(),
  'integrity-rejected-outbox'
);
select throws_ok($$
  insert into outbox_messages(id,event_id,topic,payload)
  values (
    'b1130000-0000-4000-8000-000000000001',
    'b1120000-0000-4000-8000-000000000001',
    'order.provisioning_requested',
    '{"data":{"orderId":"b1110000-0000-4000-8000-000000000001"}}'
  )
$$, '23514', 'provisioning requires an approved order acceptance reservation',
  'rejected orders cannot enqueue provisioning');
select is((select count(*)::integer from entitlements where status = 'active'),
  7, 'existing services remain active while new service is blocked');

-- A third order demonstrates reservation source facts cannot be forged.
update core_account_commercial_profiles
set new_service_blocked = false
where account_id = '10000000-0000-4000-8000-000000000001';
insert into quotes(
  id, account_id, price_book_id, series_id, revision, status, currency,
  total_minor, margin_floor_result, expires_at, created_by
) values (
  'b1200000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000001',
  'b1200000-0000-4000-8000-000000000002', 1, 'accepted', 'USD',
  80000, 'pass', '2027-12-31T00:00:00Z',
  '20000000-0000-4000-8000-000000000002'
);
insert into core_quote_commercial_profiles(
  quote_id, channel_shape, merchant_of_record, pricing_authority,
  billing_account_id, pricing_inputs, pricing_calculated_at
) values (
  'b1200000-0000-4000-8000-000000000001','direct','fil_one','fil_one',
  '10000000-0000-4000-8000-000000000001','{}','2026-07-31T16:00:00Z'
);
insert into orders(
  id, quote_id, agreement_id, account_id, invoicing_account_id, sourcing,
  signer_user_id, authority_title, authority_attested, status,
  service_starts_on, service_ends_on
) values (
  'b1210000-0000-4000-8000-000000000001',
  'b1200000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001','direct',
  '20000000-0000-4000-8000-000000000002','Owner',true,'accepted',
  '2026-08-01','2027-07-31'
);
insert into agreements(
  id,account_id,template_id,paper,execution_mode,executed_document_id,
  evidence_document_id,envelope_id,negotiation_status,effective_on,
  term_months,renewal_type,notice_days,status,superseded_by_id,
  signer_user_id,authority_title,authority_attested,accepted_ip,
  accepted_user_agent,text_hash,created_at,version
)
select
  'b1290000-0000-4000-8000-000000000001',account_id,template_id,paper,
  execution_mode,executed_document_id,evidence_document_id,envelope_id,
  negotiation_status,'2025-01-01',term_months,renewal_type,notice_days,
  'active',null,signer_user_id,authority_title,authority_attested,
  accepted_ip,accepted_user_agent,repeat('9',64),'2025-01-01T00:00:00Z',99
from agreements
where id = '51000000-0000-4000-8000-000000000001';
select throws_ok($$
  insert into core_order_commercial_profiles(
    order_id,merchant_of_record,billing_shape,provisioning_idempotency_key,
    governing_agreement_version,buyer_agreement_id,buyer_agreement_version,
    accepted_at
  ) values (
    'b1210000-0000-4000-8000-000000000001','fil_one','direct',
    'integrity:provision:b121:forged',99,
    'b1290000-0000-4000-8000-000000000001',99,
    '2026-07-31T16:00:00Z'
  )
$$, '23514', 'order must pin the authoritative buyer agreement',
  'an older parallel active agreement cannot be forged as canonical');
select throws_ok($$
  insert into core_order_acceptance_reservations(
    order_id,buyer_account_id,billing_account_id,currency,amount_minor,
    decision,reason
  ) values (
    'b1210000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001','USD',1,
    'approved','forged amount'
  )
$$, '23514',
  'order acceptance reservation must match persisted order amount, currency, and parties',
  'reservation amount cannot be caller-forged');

select lives_ok($$
  update system_capabilities
  set enabled = false, change_reason = 'pgTAP disable check',
    changed_by = 'pgtap:950'
  where capability_key = 'new_business'
$$, 'software capabilities can be disabled durably');

reset role;
select set_config('app.authorization_context', jsonb_build_object(
  'userId','20000000-0000-4000-8000-000000000002',
  'accountIds',jsonb_build_array('10000000-0000-4000-8000-000000000001'),
  'roles',jsonb_build_array('owner'),'isInternalStaff',false,
  'requestId','pgtap-integrity-capability',
  'expiresAt',(clock_timestamp() + interval '5 minutes')::text
)::text, true);
select set_config('app.authorization_signature', encode(extensions.hmac(
  current_setting('app.authorization_context'),
  (select secret from private.authorization_secrets where active order by created_at desc limit 1),
  'sha256'),'hex'), true);
set local role clockwork_runtime;
set local search_path = public, extensions;
select throws_ok($$
  insert into quotes(
    id,account_id,price_book_id,series_id,revision,status,currency,
    total_minor,margin_floor_result,expires_at,created_by
  ) values (
    'b1300000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000001',
    'b1300000-0000-4000-8000-000000000002',1,'draft','USD',1,'pass',
    '2027-12-31','20000000-0000-4000-8000-000000000002'
  )
$$, '42501', null, 'disabled new business cannot be bypassed by direct SQL');
select ok(system_capability_is_enabled('billing', true),
  'billing recovery stays available while new business is disabled');
select ok(not system_capability_is_enabled('new_business'),
  'runtime observes the disabled persisted capability');

reset role;
set local role clockwork_service;
set local search_path = public, extensions;
select lives_ok($$
  update system_capabilities
  set enabled = true, change_reason = 'pgTAP restore',
    changed_by = 'pgtap:950'
  where capability_key = 'new_business'
$$, 'test restores the new-business capability');

-- Marketplace remains disabled even while ordinary new business is enabled.
insert into quotes(
  id,account_id,price_book_id,series_id,revision,status,currency,total_minor,
  margin_floor_result,expires_at,created_by
) values (
  'b1400000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000004',
  '60000000-0000-4000-8000-000000000001',
  'b1400000-0000-4000-8000-000000000002',1,'accepted','USD',50000,
  'pass','2027-12-31','20000000-0000-4000-8000-000000000004'
);
insert into core_quote_commercial_profiles(
  quote_id,channel_shape,merchant_of_record,pricing_authority,
  billing_account_id,marketplace_provider,pricing_inputs,pricing_calculated_at
) values (
  'b1400000-0000-4000-8000-000000000001','marketplace','marketplace',
  'marketplace','10000000-0000-4000-8000-000000000004','aws','{}',
  '2026-07-31T16:00:00Z'
);
reset role;
select set_config('app.authorization_context', jsonb_build_object(
  'userId','20000000-0000-4000-8000-000000000004',
  'accountIds',jsonb_build_array('10000000-0000-4000-8000-000000000004'),
  'roles',jsonb_build_array('owner'),'isInternalStaff',false,
  'requestId','pgtap-integrity-marketplace',
  'expiresAt',(clock_timestamp() + interval '5 minutes')::text
)::text, true);
select set_config('app.authorization_signature', encode(extensions.hmac(
  current_setting('app.authorization_context'),
  (select secret from private.authorization_secrets where active order by created_at desc limit 1),
  'sha256'),'hex'), true);
set local role clockwork_runtime;
set local search_path = public, extensions;
select throws_ok($$
  insert into orders(
    id,quote_id,agreement_id,account_id,invoicing_account_id,sourcing,
    signer_user_id,authority_title,authority_attested,status,service_starts_on
  ) values (
    'b1410000-0000-4000-8000-000000000001',
    'b1400000-0000-4000-8000-000000000001',
    '51000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000004','marketplace',
    '20000000-0000-4000-8000-000000000004','Owner',true,'accepted','2026-08-01'
  )
$$, '42501', null, 'disabled marketplace cannot be bypassed by direct SQL');

-- Relationship-derived POC/evidence access.
reset role;
set local role clockwork_service;
set local search_path = public, extensions;
insert into lifecycle_poc_evidence(
  id,poc_id,kind,source_id,payload,evidence_hash,recorded_at
) values (
  'b1500000-0000-4000-8000-000000000001',
  '85000000-0000-4000-8000-000000000001','success_snapshot',
  'integrity-poc-evidence','{}',repeat('7',64),'2026-07-31T16:00:00Z'
);
reset role;
select set_config('app.authorization_context', jsonb_build_object(
  'userId','20000000-0000-4000-8000-000000000003',
  'accountIds',jsonb_build_array('10000000-0000-4000-8000-000000000002'),
  'roles',jsonb_build_array('partner_admin'),'isInternalStaff',false,
  'requestId','pgtap-integrity-poc-valid',
  'expiresAt',(clock_timestamp() + interval '5 minutes')::text
)::text, true);
select set_config('app.authorization_signature', encode(extensions.hmac(
  current_setting('app.authorization_context'),
  (select secret from private.authorization_secrets where active order by created_at desc limit 1),
  'sha256'),'hex'), true);
set local role clockwork_runtime;
set local search_path = public, extensions;
select is((select count(*)::integer from pocs
  where id = '85000000-0000-4000-8000-000000000001'), 1,
  'approved related partner sees its POC');
select is((select count(*)::integer from lifecycle_poc_evidence
  where id = 'b1500000-0000-4000-8000-000000000001'), 1,
  'approved related partner sees POC evidence');

reset role;
select set_config('app.authorization_context', jsonb_build_object(
  'userId','20000000-0000-4000-8000-000000000008',
  'accountIds',jsonb_build_array('10000000-0000-4000-8000-000000000003'),
  'roles',jsonb_build_array('partner_admin'),'isInternalStaff',false,
  'requestId','pgtap-integrity-poc-forged',
  'expiresAt',(clock_timestamp() + interval '5 minutes')::text
)::text, true);
select set_config('app.authorization_signature', encode(extensions.hmac(
  current_setting('app.authorization_context'),
  (select secret from private.authorization_secrets where active order by created_at desc limit 1),
  'sha256'),'hex'), true);
set local role clockwork_runtime;
set local search_path = public, extensions;
select is((select count(*)::integer from pocs
  where id = '85000000-0000-4000-8000-000000000001'), 0,
  'unapproved partner cannot see another tenant POC');
select is((select count(*)::integer from lifecycle_poc_evidence
  where id = 'b1500000-0000-4000-8000-000000000001'), 0,
  'unapproved partner cannot see another tenant POC evidence');
select throws_ok($$
  insert into pocs(
    id,account_id,organization_id,partner_account_id,workload,
    permitted_data_class,success_tests,commercial_range,capacity_cap,
    egress_cap,duration_days,named_keys,expires_at,support_owner_id,
    kickoff_at,midpoint_at,final_report_at,currency,status
  ) values (
    'b1510000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000004',
    '30000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000003','forged','synthetic-only',
    '[]','{}',1,1,1,array['forged-key'],clock_timestamp()+interval '1 day',
    '20000000-0000-4000-8000-000000000001',clock_timestamp(),
    clock_timestamp(),clock_timestamp(),'USD','proposed'
  )
$$, '42501', null, 'partner cannot forge a POC relationship');

reset role;
select set_config('app.authorization_context', jsonb_build_object(
  'userId','20000000-0000-4000-8000-000000000004',
  'accountIds',jsonb_build_array('10000000-0000-4000-8000-000000000004'),
  'roles',jsonb_build_array('owner'),'isInternalStaff',false,
  'requestId','pgtap-integrity-registration-buyer',
  'expiresAt',(clock_timestamp() + interval '5 minutes')::text
)::text, true);
select set_config('app.authorization_signature', encode(extensions.hmac(
  current_setting('app.authorization_context'),
  (select secret from private.authorization_secrets where active order by created_at desc limit 1),
  'sha256'),'hex'), true);
set local role clockwork_runtime;
set local search_path = public, extensions;
select is((select count(*)::integer from deal_registrations
  where id = '94000000-0000-4000-8000-000000000001'), 1,
  'end client can resolve its approved partner relationship');
select is((select count(*)::integer from deal_registrations
  where id = '94000000-0000-4000-8000-000000000002'), 0,
  'end client cannot resolve a disputed relationship');

-- Financial source locks enforce order, currency, and aggregate ceilings.
reset role;
set local role clockwork_service;
set local search_path = public, extensions;
select lives_ok($$
  insert into refunds(
    id,payment_id,order_id,stripe_refund_id,currency,amount_minor,
    reason_code,status
  ) values (
    'b1600000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000002',
    '80000000-0000-4000-8000-000000000002','re_integrity_1','USD',
    70000,'requested','pending'
  )
$$, 'valid refund is bounded by its persisted payment');
select throws_ok($$
  insert into refunds(
    id,payment_id,order_id,stripe_refund_id,currency,amount_minor,
    reason_code,status
  ) values (
    'b1600000-0000-4000-8000-000000000002',
    '91000000-0000-4000-8000-000000000002',
    '80000000-0000-4000-8000-000000000002','re_integrity_forged','EUR',
    1,'requested','pending'
  )
$$, '23514', 'refund must match its persisted payment order and currency',
  'refund currency cannot be forged');
select throws_ok($$
  insert into refunds(
    id,payment_id,order_id,stripe_refund_id,currency,amount_minor,
    reason_code,status
  ) values (
    'b1600000-0000-4000-8000-000000000003',
    '91000000-0000-4000-8000-000000000002',
    '80000000-0000-4000-8000-000000000002','re_integrity_over','USD',
    60000,'requested','pending'
  )
$$, '23514', 'financial adjustment exceeds its persisted source amount',
  'aggregate refunds cannot exceed the payment');
select lives_ok($$
  insert into refunds(
    id,payment_id,order_id,stripe_refund_id,currency,amount_minor,
    reason_code,status
  ) values (
    'b1600000-0000-4000-8000-000000000004',
    '91000000-0000-4000-8000-000000000002',
    '80000000-0000-4000-8000-000000000002','re_integrity_2','USD',
    50000,'requested','succeeded'
  )
$$, 'aggregate refund may reach the exact source ceiling');
select is((select sum(amount_minor)::bigint from refunds
  where payment_id = '91000000-0000-4000-8000-000000000002'),
  120000::bigint, 'refund aggregate equals but never exceeds source');

-- Finance sees and mutates only cases it owns; audit visibility is actor or
-- applicable-adjustment scoped.
insert into core_collection_cases(
  id,invoice_id,account_id,owner_user_id,aging_bucket,next_action_at,status
) values
  ('b1700000-0000-4000-8000-000000000001',
   '90000000-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-000000000001',
   '20000000-0000-4000-8000-000000000001','90_plus',clock_timestamp(),'open'),
  ('b1700000-0000-4000-8000-000000000002',
   '90000000-0000-4000-8000-000000000003',
   '10000000-0000-4000-8000-000000000003',
   '20000000-0000-4000-8000-000000000008','30_60',clock_timestamp(),'open');
insert into audit_events(
  id,account_id,aggregate_type,aggregate_id,aggregate_version,event_type,
  event_version,actor,occurred_at,request_id
) values
  ('b1710000-0000-4000-8000-000000000001',null,'system',
   'b1710000-0000-4000-8000-000000000011',1,'integrity.finance.own',1,
   '{"kind":"user","id":"20000000-0000-4000-8000-000000000001"}',
   clock_timestamp(),'integrity-finance-own'),
  ('b1710000-0000-4000-8000-000000000002',null,'system',
   'b1710000-0000-4000-8000-000000000012',1,'integrity.finance.other',1,
   '{"kind":"user","id":"20000000-0000-4000-8000-000000000008"}',
   clock_timestamp(),'integrity-finance-other'),
  ('b1710000-0000-4000-8000-000000000003',null,'refund',
   'b1600000-0000-4000-8000-000000000001',1,'integrity.refund',1,
   '{"kind":"provider","id":"stripe-fixture"}',clock_timestamp(),
   'integrity-refund-audit');

reset role;
select set_config('app.authorization_context', jsonb_build_object(
  'userId','20000000-0000-4000-8000-000000000001',
  'accountIds',jsonb_build_array(),
  'roles',jsonb_build_array('finance_approver'),'isInternalStaff',true,
  'requestId','pgtap-integrity-finance',
  'expiresAt',(clock_timestamp() + interval '5 minutes')::text
)::text, true);
select set_config('app.authorization_signature', encode(extensions.hmac(
  current_setting('app.authorization_context'),
  (select secret from private.authorization_secrets where active order by created_at desc limit 1),
  'sha256'),'hex'), true);
set local role clockwork_runtime;
set local search_path = public, extensions;
select is((select count(*)::integer from core_collection_cases
  where id in ('b1700000-0000-4000-8000-000000000001',
               'b1700000-0000-4000-8000-000000000002')), 1,
  'finance user sees only its owned collection case');
select throws_ok($$
  insert into core_collection_cases(
    id,invoice_id,account_id,owner_user_id,aging_bucket,next_action_at,status
  ) values (
    'b1700000-0000-4000-8000-000000000003',
    '90000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000005',
    '20000000-0000-4000-8000-000000000008','30_60',clock_timestamp(),'open'
  )
$$, '42501', null, 'finance user cannot assign a case to another actor');
select lives_ok($$
  insert into core_collection_cases(
    id,invoice_id,account_id,owner_user_id,aging_bucket,next_action_at,status
  ) values (
    'b1700000-0000-4000-8000-000000000004',
    '90000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000004',
    '20000000-0000-4000-8000-000000000001','current',clock_timestamp(),'open'
  )
$$, 'finance user can create only its owned collection case');
select is((select count(*)::integer from audit_events
  where id in (
    'b1710000-0000-4000-8000-000000000001',
    'b1710000-0000-4000-8000-000000000002',
    'b1710000-0000-4000-8000-000000000003'
  )), 2, 'finance audit visibility is actor or adjustment scoped');
select is((select count(*)::integer from audit_events
  where id = 'b1710000-0000-4000-8000-000000000002'), 0,
  'finance user cannot see another actor generic audit');

-- Verified QBO mappings preserve partner identity and cannot be rewritten.
reset role;
set local role clockwork_service;
set local search_path = public, extensions;
select lives_ok($$
  insert into core_partner_qbo_vendor_mappings(
    partner_account_id,realm_reference_hash,vendor_id,verification_status,
    verified_at,verified_by,source_reference
  ) values (
    '10000000-0000-4000-8000-000000000003',repeat('8',64),
    'vendor-fixture-blue-harbor','verified','2026-07-31T16:00:00Z',
    '20000000-0000-4000-8000-000000000001','repository-verification-fixture'
  )
$$, 'verified partner can bind a QBO vendor mapping');
select throws_ok($$
  insert into core_partner_qbo_vendor_mappings(
    partner_account_id,realm_reference_hash,vendor_id,verification_status,
    verified_at,verified_by,source_reference
  ) values (
    '10000000-0000-4000-8000-000000000001',repeat('9',64),
    'vendor-forged-nonpartner','verified','2026-07-31T16:00:00Z',
    '20000000-0000-4000-8000-000000000001','forged'
  )
$$, '23514', 'QBO vendor mapping requires the persisted partner identity',
  'non-partner cannot receive a vendor mapping');
select throws_ok($$
  update core_partner_qbo_vendor_mappings
  set vendor_id = 'vendor-rewritten'
  where partner_account_id = '10000000-0000-4000-8000-000000000003'
$$, '55000', 'verified QBO vendor identity is immutable',
  'verified vendor identity cannot be rewritten');
select lives_ok($$
  update core_partner_qbo_vendor_mappings
  set verification_status = 'revoked', revoked_at = clock_timestamp()
  where partner_account_id = '10000000-0000-4000-8000-000000000003'
$$, 'verified QBO mappings can be durably revoked');
select throws_ok($$
  update core_partner_qbo_vendor_mappings
  set verification_status = 'verified', revoked_at = null
  where partner_account_id = '10000000-0000-4000-8000-000000000003'
$$, '23514', 'invalid QBO vendor verification transition',
  'revoked QBO mappings cannot be silently reactivated');

reset role;
select set_config('app.authorization_context', jsonb_build_object(
  'userId','20000000-0000-4000-8000-000000000008',
  'accountIds',jsonb_build_array('10000000-0000-4000-8000-000000000003'),
  'roles',jsonb_build_array('partner_admin'),'isInternalStaff',false,
  'requestId','pgtap-integrity-qbo-rls',
  'expiresAt',(clock_timestamp() + interval '5 minutes')::text
)::text, true);
select set_config('app.authorization_signature', encode(extensions.hmac(
  current_setting('app.authorization_context'),
  (select secret from private.authorization_secrets where active order by created_at desc limit 1),
  'sha256'),'hex'), true);
set local role clockwork_runtime;
set local search_path = public, extensions;
select throws_ok($$
  select count(*) from core_partner_qbo_vendor_mappings
$$, '42501', null,
  'partner runtime has no permission to read its provider vendor mapping');

reset role;
set local role clockwork_service;
set local search_path = public, extensions;
insert into core_commission_statements(
  id,partner_account_id,period_starts_on,period_ends_on,currency,
  gross_accrued_minor,clawback_minor,holdback_minor,payable_minor,status
) values (
  'b1900000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002','2026-07-01','2026-07-31',
  'USD',0,0,0,0,'exported'
);
select lives_ok($$
  insert into core_commission_settlement_exports(
    id,statement_id,export_key,format,status
  ) values (
    'b1910000-0000-4000-8000-000000000001',
    'b1900000-0000-4000-8000-000000000001',
    'commission-integrity-primary','qbo_bill','pending'
  )
$$, 'commission statement binds its first replay-safe provider posting');
select throws_ok($$
  insert into core_commission_settlement_exports(
    id,statement_id,export_key,format,status
  ) values (
    'b1910000-0000-4000-8000-000000000002',
    'b1900000-0000-4000-8000-000000000001',
    'commission-integrity-alternate','qbo_bill','pending'
  )
$$, '23505', null,
  'alternate export keys cannot bind a second provider posting');
select throws_ok($$
  update core_commission_statements set status = 'void'
  where id = 'b1900000-0000-4000-8000-000000000001'
$$, '23514', 'invalid commission statement transition',
  'an in-flight exported statement cannot be voided under a provider call');
select lives_ok($$
  update core_commission_settlement_exports
  set status = 'succeeded', provider_reference = 'Bill-pgtap-integrity'
  where id = 'b1910000-0000-4000-8000-000000000001'
$$, 'pending commission settlement can bind provider success once');
select throws_ok($$
  update core_commission_settlement_exports
  set provider_reference = 'Bill-pgtap-forged-overwrite'
  where id = 'b1910000-0000-4000-8000-000000000001'
$$, '55000', 'commission settlement provider binding is immutable',
  'accepted provider bill identity cannot be overwritten');
select lives_ok($$
  update core_commission_statements set status = 'paid'
  where id = 'b1900000-0000-4000-8000-000000000001'
$$, 'an exported statement becomes paid only after provider success');
select throws_ok($$
  update core_commission_statements set status = 'approved'
  where id = 'b1900000-0000-4000-8000-000000000001'
$$, '23514', 'invalid commission statement transition',
  'a paid statement cannot be replayed into a pre-provider state');

select throws_ok($$
  insert into core_marketplace_events(
    provider,provider_event_id,event_type,provider_account_reference,
    account_id,order_id,occurred_at,currency,gross_minor,fee_minor,
    tax_minor,net_minor,payload_hash,normalized_payload
  ) values (
    'aws','integrity-market-forged','settlement','buyer-forged',
    '10000000-0000-4000-8000-000000000008',
    '80000000-0000-4000-8000-000000000006',clock_timestamp(),
    'USD',100,10,0,90,repeat('a',64),'{}'
  )
$$, '23514',
  'marketplace event must name the persisted buyer and marketplace merchant of record',
  'marketplace event cannot forge the buyer identity');
select lives_ok($$
  insert into core_marketplace_events(
    provider,provider_event_id,event_type,provider_account_reference,
    account_id,order_id,occurred_at,currency,gross_minor,fee_minor,
    tax_minor,net_minor,payload_hash,normalized_payload
  ) values (
    'aws','integrity-market-valid','settlement','buyer-valid',
    '10000000-0000-4000-8000-000000000004',
    '80000000-0000-4000-8000-000000000006',clock_timestamp(),
    'USD',100,10,0,90,repeat('b',64),'{}'
  )
$$, 'marketplace event binds the persisted buyer identity');

insert into quotes(
  id,account_id,end_client_account_id,partner_account_id,price_book_id,
  series_id,revision,status,currency,total_minor,margin_floor_result,
  expires_at,created_by
) values (
  'b1800000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000004',
  '10000000-0000-4000-8000-000000000004',
  '10000000-0000-4000-8000-000000000005',
  '60000000-0000-4000-8000-000000000001',
  'b1800000-0000-4000-8000-000000000002',1,'accepted','USD',100,
  'pass','2027-12-31','20000000-0000-4000-8000-000000000005'
);
select throws_ok($$
  insert into core_quote_commercial_profiles(
    quote_id,channel_shape,merchant_of_record,pricing_authority,
    billing_account_id,distributor_account_id,pricing_inputs,
    pricing_calculated_at
  ) values (
    'b1800000-0000-4000-8000-000000000001','distributor','partner',
    'partner','10000000-0000-4000-8000-000000000005',
    '10000000-0000-4000-8000-000000000003','{}',clock_timestamp()
  )
$$, '23514',
  'distributor quote buyer and merchant-of-record identities are inconsistent',
  'distributor identity cannot be forged');

select * from finish();
rollback;
