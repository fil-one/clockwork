begin;
select plan(38);

set local role clockwork_service;
set local search_path = public, extensions;

select has_table('public', 'core_stripe_adjustment_operations',
  'Stripe adjustment commands have a durable service-owned ledger');
select has_function('public', 'core_create_stripe_adjustment_operation',
  array['uuid','text','text','text'],
  'runtime creation is constrained to the persisted-source derivation function');
select has_column('public', 'credit_notes', 'stripe_last_occurred_at',
  'each credit note has an independent signed-event watermark');
select has_column('public', 'refunds', 'stripe_last_occurred_at',
  'each refund has an independent signed-event watermark');
select ok((select is_nullable = 'YES'
  from information_schema.columns
  where table_schema = 'public' and table_name = 'credit_notes'
    and column_name = 'stripe_credit_note_id'),
  'credit-note provider identity is null before provider acceptance');
select ok((select is_nullable = 'YES'
  from information_schema.columns
  where table_schema = 'public' and table_name = 'refunds'
    and column_name = 'stripe_refund_id'),
  'refund provider identity is null before provider acceptance');
select ok(not has_table_privilege(
  'clockwork_runtime','public.core_partner_qbo_vendor_mappings','SELECT'),
  'runtime has no direct access to verified QBO vendor identity');
select ok(not has_table_privilege(
  'clockwork_runtime','public.core_stripe_adjustment_operations','SELECT'),
  'runtime cannot read provider adjustment commands');
select ok(not has_table_privilege(
  'clockwork_runtime','public.core_stripe_adjustment_operations','INSERT'),
  'runtime cannot forge provider adjustment commands');
select ok(has_table_privilege(
  'clockwork_service','public.core_stripe_adjustment_operations','UPDATE'),
  'only the service worker can advance leased provider operations');
select is((select count(*)::integer
  from core_account_commercial_profiles), 8,
  'reset fixtures persist one authoritative profile for each billing policy');
select is((select approved_credit_limit_minor
  from core_account_commercial_profiles
  where account_id = '10000000-0000-4000-8000-000000000001'),
  0::bigint, 'fixtures do not invent credit for a zero-limit account');
select is((select billing_model
  from core_account_commercial_profiles
  where account_id = '10000000-0000-4000-8000-000000000004'),
  'auto_charge', 'non-terms fixture billing stays independent of credit limits');

insert into credit_notes(
  id,invoice_id,order_id,stripe_credit_note_id,currency,amount_minor,
  reason_code,approved_by,status
) values
  ('c1800000-0000-4000-8000-000000000001',
   '90000000-0000-4000-8000-000000000001',
   '80000000-0000-4000-8000-000000000001',null,'USD',100000,
   'fixture-credit-one','20000000-0000-4000-8000-000000000001','approved'),
  ('c1800000-0000-4000-8000-000000000002',
   '90000000-0000-4000-8000-000000000001',
   '80000000-0000-4000-8000-000000000001',null,'USD',1,
   'fixture-credit-two','20000000-0000-4000-8000-000000000001','approved');

reset role;
select set_config('app.authorization_context', jsonb_build_object(
  'userId','20000000-0000-4000-8000-000000000001',
  'accountIds',jsonb_build_array('10000000-0000-4000-8000-000000000001'),
  'roles',jsonb_build_array('finance_approver'),'isInternalStaff',true,
  'requestId','pgtap-stripe-operation-finance',
  'expiresAt',(clock_timestamp() + interval '5 minutes')::text
)::text, true);
select set_config('app.authorization_signature', encode(extensions.hmac(
  current_setting('app.authorization_context'),
  (select secret from private.authorization_secrets where active
   order by created_at desc limit 1),
  'sha256'),'hex'), true);
set local role clockwork_runtime;
set local search_path = public, extensions;

select lives_ok($$
  select core_create_stripe_adjustment_operation(
    'c1800000-0000-4000-8000-000000000001','credit_note','duplicate',
    'fixture-credit-one'
  )
$$, 'signed finance creation derives the provider invoice and money binding');
select throws_ok($$
  select count(*) from core_stripe_adjustment_operations
$$, '42501', null, 'runtime cannot read the service-owned adjustment ledger');
select lives_ok($$
  select core_create_stripe_adjustment_operation(
    'c1800000-0000-4000-8000-000000000001','credit_note','duplicate',
    'fixture-credit-one'
  )
$$, 'an identical command replay returns the durable operation');
select throws_ok($$
  select core_create_stripe_adjustment_operation(
    'c1800000-0000-4000-8000-000000000001','credit_note','fraudulent',
    'fixture-credit-one'
  )
$$, '23505', 'Stripe adjustment replay conflicts with the durable operation',
  'a replay cannot change provider command facts');
select throws_ok($$
  insert into core_stripe_adjustment_operations(
    adjustment_id,kind,order_id,source_id,source_currency,
    provider_invoice_id,amount_minor,individual_cap_minor,
    aggregate_cap_minor,provider_reason,internal_reason_code,
    provider_idempotency_key,command_version
  ) values (
    'c1800000-0000-4000-8000-000000000002','credit_note',
    '80000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000001','USD','in_demo_overdue',
    1,180000,180000,'duplicate','fixture-credit-two',
    'stripe-adjustment:c1800000-0000-4000-8000-000000000002',1
  )
$$, '42501', null, 'runtime cannot bypass derivation with a direct insert');

reset role;
select set_config('app.authorization_context', jsonb_build_object(
  'userId','20000000-0000-4000-8000-000000000002',
  'accountIds',jsonb_build_array('10000000-0000-4000-8000-000000000001'),
  'roles',jsonb_build_array('owner'),'isInternalStaff',false,
  'requestId','pgtap-stripe-operation-owner',
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
  select core_create_stripe_adjustment_operation(
    'c1800000-0000-4000-8000-000000000002','credit_note','duplicate',
    'fixture-credit-two'
  )
$$, '42501', 'finance approval is required to create a Stripe adjustment operation',
  'ordinary account roles cannot submit provider adjustment operations');

reset role;
set local role clockwork_service;
set local search_path = public, extensions;
select is((select count(*)::integer from core_stripe_adjustment_operations
  where adjustment_id = 'c1800000-0000-4000-8000-000000000001'), 1,
  'operation replay creates exactly one provider command');
select throws_ok($$
  insert into core_stripe_adjustment_operations(
    adjustment_id,kind,order_id,source_id,source_currency,
    provider_invoice_id,amount_minor,individual_cap_minor,
    aggregate_cap_minor,provider_reason,internal_reason_code,
    provider_idempotency_key,command_version
  ) values (
    'c1800000-0000-4000-8000-000000000002','credit_note',
    '80000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000001','EUR','in_demo_overdue',
    1,180000,180000,'duplicate','fixture-credit-two',
    'stripe-adjustment:c1800000-0000-4000-8000-000000000002',1
  )
$$, '23514',
  'Stripe adjustment operation must match persisted source, order, currency, amount, caps, and reason',
  'service cannot forge an adjustment currency');
select throws_ok($$
  insert into core_stripe_adjustment_operations(
    adjustment_id,kind,order_id,source_id,source_currency,
    provider_invoice_id,amount_minor,individual_cap_minor,
    aggregate_cap_minor,provider_reason,internal_reason_code,
    provider_idempotency_key,command_version
  ) values (
    'c1800000-0000-4000-8000-000000000002','credit_note',
    '80000000-0000-4000-8000-000000000002',
    '90000000-0000-4000-8000-000000000001','USD','in_demo_overdue',
    1,180000,180000,'duplicate','fixture-credit-two',
    'stripe-adjustment:c1800000-0000-4000-8000-000000000002',1
  )
$$, '23514',
  'Stripe adjustment operation must match persisted source, order, currency, amount, caps, and reason',
  'service cannot forge an adjustment order');
select throws_ok($$
  insert into core_stripe_adjustment_operations(
    adjustment_id,kind,order_id,source_id,source_currency,
    provider_invoice_id,amount_minor,individual_cap_minor,
    aggregate_cap_minor,provider_reason,internal_reason_code,
    provider_idempotency_key,command_version
  ) values (
    'c1800000-0000-4000-8000-000000000002','credit_note',
    '80000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000001','USD','in_forged',
    1,180000,180000,'duplicate','fixture-credit-two',
    'stripe-adjustment:c1800000-0000-4000-8000-000000000002',1
  )
$$, '23514', 'credit note provider binding is not authoritative',
  'service cannot forge a provider invoice ID');
select throws_ok($$
  select core_create_stripe_adjustment_operation(
    'c1800000-0000-4000-8000-000000000002','credit_note','duplicate',
    'forged-internal-reason'
  )
$$, '23514', 'Stripe adjustment internal reason must match the approved adjustment',
  'creation cannot replace the approved internal reason');
select throws_ok($$
  select core_create_stripe_adjustment_operation(
    'c1800000-0000-4000-8000-000000000002','credit_note',
    'requested_by_customer','fixture-credit-two'
  )
$$, '23514', 'credit note provider binding is not authoritative',
  'credit-note provider reason is type constrained');

insert into refunds(
  id,payment_id,order_id,stripe_refund_id,currency,amount_minor,
  reason_code,status
) values (
  'c1810000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001',
  '80000000-0000-4000-8000-000000000001',null,'USD',80000,
  'fixture-refund-one','approved'
);
select lives_ok($$
  select core_create_stripe_adjustment_operation(
    'c1810000-0000-4000-8000-000000000001','refund',
    'requested_by_customer','fixture-refund-one'
  )
$$, 'refund operation derives its payment intent and invoice aggregate cap');
select is((select sum(amount_minor)::bigint
  from core_stripe_adjustment_operations
  where order_id = '80000000-0000-4000-8000-000000000001'
    and source_currency = 'USD'
    and state in ('approved','submitting','retrying','provider_accepted')),
  180000::bigint, 'credit notes and refunds share one order/currency ceiling');

insert into credit_notes(
  id,invoice_id,order_id,stripe_credit_note_id,currency,amount_minor,
  reason_code,approved_by,status
) values (
  'c1800000-0000-4000-8000-000000000003',
  '90000000-0000-4000-8000-000000000001',
  '80000000-0000-4000-8000-000000000001',null,'USD',1,
  'fixture-credit-three','20000000-0000-4000-8000-000000000001','approved'
);
select throws_ok($$
  select core_create_stripe_adjustment_operation(
    'c1800000-0000-4000-8000-000000000003','credit_note','duplicate',
    'fixture-credit-three'
  )
$$, '23514', 'Stripe adjustment aggregate ceiling exceeded',
  'a later contender cannot exceed capacity reserved by prior operations');
select is((select count(*)::integer
  from core_stripe_adjustment_operations
  where order_id = '80000000-0000-4000-8000-000000000001'), 2,
  'aggregate rejection leaves no partial provider command');
select ok(
  position('perform 1 from public.orders source_order' in lower(
    pg_get_functiondef(
      'public.core_create_stripe_adjustment_operation(uuid,text,text,text)'::regprocedure
    )
  )) > 0
  and position('for update' in lower(pg_get_functiondef(
    'public.core_create_stripe_adjustment_operation(uuid,text,text,text)'::regprocedure
  ))) > 0,
  'creation takes the order aggregate lock before enforcing capacity');

select lives_ok($$
  update core_stripe_adjustment_operations
  set state = 'submitting',
    lease_token = 'c1820000-0000-4000-8000-000000000001',
    lease_until = clock_timestamp() + interval '5 minutes'
  where adjustment_id = 'c1800000-0000-4000-8000-000000000001'
$$, 'service atomically claims an approved operation with a lease');
select lives_ok($$
  update core_stripe_adjustment_operations
  set state = 'provider_accepted', lease_token = null, lease_until = null,
    provider_object_id = 'cn_integrity_accepted', provider_status = 'issued'
  where adjustment_id = 'c1800000-0000-4000-8000-000000000001'
$$, 'provider acceptance binds the unique provider object to the lease');
select lives_ok($$
  update credit_notes
  set status = 'pending', stripe_credit_note_id = 'cn_integrity_accepted',
    version = version + 1
  where id = 'c1800000-0000-4000-8000-000000000001' and version = 1
$$, 'service projects provider acceptance with optimistic base versioning');
select throws_ok($$
  update core_stripe_adjustment_operations
  set provider_object_id = 'cn_integrity_rewritten'
  where adjustment_id = 'c1800000-0000-4000-8000-000000000001'
$$, '55000', 'Stripe adjustment execution facts require a valid state transition',
  'accepted provider identity cannot be rewritten');
select lives_ok($$
  update credit_notes
  set status = 'issued', stripe_last_occurred_at = '2026-07-31T16:10:00Z',
    stripe_last_event_id = 'evt_credit_integrity_2', version = version + 1
  where id = 'c1800000-0000-4000-8000-000000000001' and version = 2
$$, 'a newer signed event advances its own credit-note watermark');
select throws_ok($$
  update credit_notes
  set stripe_last_occurred_at = '2026-07-31T16:09:00Z',
    stripe_last_event_id = 'evt_credit_integrity_old', version = version + 1
  where id = 'c1800000-0000-4000-8000-000000000001' and version = 3
$$, '23514', 'credit note Stripe watermark cannot regress',
  'a reordered event cannot regress a credit-note projection');

update credit_notes set status = 'failed', version = version + 1
where id in (
  'c1800000-0000-4000-8000-000000000002',
  'c1800000-0000-4000-8000-000000000003'
);
insert into credit_notes(
  id,invoice_id,order_id,stripe_credit_note_id,currency,amount_minor,
  reason_code,approved_by,status
) values (
  'c1800000-0000-4000-8000-000000000004',
  '90000000-0000-4000-8000-000000000003',
  '80000000-0000-4000-8000-000000000003',null,'EUR',1,
  'fixture-credit-four','20000000-0000-4000-8000-000000000001','approved'
);
select core_create_stripe_adjustment_operation(
  'c1800000-0000-4000-8000-000000000004','credit_note','duplicate',
  'fixture-credit-four'
);
select lives_ok($$
  set constraints credit_notes_require_stripe_operation,
    refunds_require_stripe_operation immediate
$$, 'an approved command and derived operation satisfy the deferred atomic FK');
set constraints credit_notes_require_stripe_operation,
  refunds_require_stripe_operation deferred;

insert into credit_notes(
  id,invoice_id,order_id,stripe_credit_note_id,currency,amount_minor,
  reason_code,approved_by,status
) values (
  'c1800000-0000-4000-8000-000000000005',
  '90000000-0000-4000-8000-000000000003',
  '80000000-0000-4000-8000-000000000003',null,'EUR',1,
  'fixture-credit-orphan','20000000-0000-4000-8000-000000000001','approved'
);
select throws_ok($$
  set constraints credit_notes_require_stripe_operation immediate
$$, '23503', 'approved Stripe adjustment requires its durable operation',
  'an approved adjustment cannot commit without its provider operation');

select * from finish();
rollback;
