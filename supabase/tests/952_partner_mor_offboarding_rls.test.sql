begin;
select plan(36);

select set_config('app.authorization_context', jsonb_build_object(
  'userId','20000000-0000-4000-8000-000000000008',
  'accountIds',jsonb_build_array('10000000-0000-4000-8000-000000000003'),
  'roles',jsonb_build_array('partner_admin'),'isInternalStaff',false,
  'requestId','pgtap-partner-mor-offboarding',
  'expiresAt',(clock_timestamp() + interval '5 minutes')::text
)::text, true);
select set_config('app.authorization_signature', encode(extensions.hmac(
  current_setting('app.authorization_context'),
  (select secret from private.authorization_secrets where active
   order by created_at desc limit 1),
  'sha256'),'hex'), true);
set local role clockwork_runtime;
set local search_path = public, extensions;

select ok(core_partner_is_order_mor(
  '80000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000004'
), 'the exact persisted resale merchant of record resolves its order');
select ok(not core_partner_is_order_mor(
  '80000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000004'
), 'a referral is not reclassified as partner merchant of record');
select is((select count(*)::integer from organizations
  where id = '30000000-0000-4000-8000-000000000003'), 1,
  'partner can resolve only the organization used by its offboarded service');
select is((select count(*)::integer from documents
  where id = '40000000-0000-4000-8000-000000000012'), 0,
  'partner cannot read an end-client quote document during offboarding');

select lives_ok($$
  insert into lifecycle_renewal_actions(
    id,order_id,account_id,action,actor_user_id,evidence_document_id,
    payload,evidence_hash
  ) values (
    'c1900000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000004','decline',
    '20000000-0000-4000-8000-000000000008',
    '40000000-0000-4000-8000-000000000013',
    '{"partnerLegalEvidence":"confidential"}',repeat('d',64)
  ) returning id
$$, 'exact partner can persist and return its confidential renewal decline');
select is((select count(*)::integer from lifecycle_renewal_actions
  where id = 'c1900000-0000-4000-8000-000000000001'), 1,
  'partner can reread its own persisted decline');

select lives_ok($$
  insert into terminations(
    id,account_id,order_id,effective_at,final_billing_status,teardown_status
  ) values (
    'c1910000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000004',
    '80000000-0000-4000-8000-000000000003',
    '2027-07-31T00:00:00Z','pending','pending_final_billing'
  ) returning id
$$, 'exact partner can create a recoverable termination for its resale order');
select throws_ok($$
  insert into lifecycle_offboarding_plans(
    termination_id,account_id,organization_id,requested_by,reason,plan
  ) values (
    'c1910000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000004',
    '30000000-0000-4000-8000-000000000003',
    '20000000-0000-4000-8000-000000000008','non_renewal',
    jsonb_build_object(
      'terminationId','c1910000-0000-4000-8000-000000000001',
      'accountId','10000000-0000-4000-8000-000000000004',
      'orderId','80000000-0000-4000-8000-000000000003',
      'organizationId','30000000-0000-4000-8000-000000000003',
      'requestedBy','20000000-0000-4000-8000-000000000004',
      'reason','non_renewal','finalBillingStatus','pending',
      'status','pending_final_billing','approvals',jsonb_build_array(),
      'teardownOperationId',null,'teardownConfirmedAt',null
    )
  )
$$, '23514', null, 'offboarding plan rejects a forged requester identity');
select lives_ok($$
  insert into lifecycle_offboarding_plans(
    termination_id,account_id,organization_id,requested_by,reason,plan
  ) values (
    'c1910000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000004',
    '30000000-0000-4000-8000-000000000003',
    '20000000-0000-4000-8000-000000000008','non_renewal',
    jsonb_build_object(
      'terminationId','c1910000-0000-4000-8000-000000000001',
      'accountId','10000000-0000-4000-8000-000000000004',
      'orderId','80000000-0000-4000-8000-000000000003',
      'organizationId','30000000-0000-4000-8000-000000000003',
      'reason','non_renewal',
      'requestedBy','20000000-0000-4000-8000-000000000008',
      'effectiveAt','2027-07-31T00:00:00.000Z',
      'finalBillingStatus','pending',
      'retrievalStartsAt','2027-07-31T00:00:00.000Z',
      'retrievalEndsAt','2027-08-30T00:00:00.000Z',
      'maximumRetentionAt',null,
      'status','pending_final_billing',
      'lockedExclusions',jsonb_build_array(),
      'deletionScheduledAt','2027-08-30T00:00:00.000Z',
      'approvals',jsonb_build_array(),
      'teardownOperationId',null,
      'teardownConfirmedAt',null,
      'teardownExcludedObjectIds',jsonb_build_array(),
      'partnerOnly',true
    )
  ) returning termination_id
$$, 'partner can persist the recoverable offboarding plan atomically');
select is((select count(*)::integer from lifecycle_offboarding_plans
  where termination_id = 'c1910000-0000-4000-8000-000000000001'), 1,
  'partner can reread only its partner-authored offboarding plan');

select lives_ok($$
  insert into audit_events(
    id,account_id,aggregate_type,aggregate_id,aggregate_version,
    event_type,event_version,actor,occurred_at,request_id,after
  ) values (
    'c1920000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000004','order',
    '80000000-0000-4000-8000-000000000003',1,
    'renewal.declined',1,
    '{"kind":"user","id":"20000000-0000-4000-8000-000000000008"}',
    '2026-07-31T16:00:00Z','pgtap-partner-mor-offboarding',
    '{"declineId":"c1900000-0000-4000-8000-000000000001"}'
  ) returning id
$$, 'partner audit append is bound to its current persisted order and actor');
select throws_ok($$
  insert into outbox_messages(id,event_id,topic,payload) values (
    'c1930000-0000-4000-8000-000000000001',
    'c1920000-0000-4000-8000-000000000001','renewal.declined',
    '{"eventId":"c1920000-0000-4000-8000-000000000001","eventType":"forged"}'
  )
$$, '42501', null,
  'partner cannot attach a forged payload to an authorized audit event');
select lives_ok($$
  insert into outbox_messages(id,event_id,topic,payload) values (
    'c1930000-0000-4000-8000-000000000001',
    'c1920000-0000-4000-8000-000000000001','renewal.declined',
    jsonb_build_object(
      'eventId','c1920000-0000-4000-8000-000000000001',
      'eventType','renewal.declined','aggregateType','order',
      'aggregateId','80000000-0000-4000-8000-000000000003',
      'aggregateVersion',1,'requestId','pgtap-partner-mor-offboarding'
    )
  )
$$, 'matching partner audit and outbox records append atomically');
select is((select count(*)::integer from audit_events
  where id = 'c1920000-0000-4000-8000-000000000001'), 1,
  'acting partner can read its own applicable audit row');

reset role;
select set_config('app.authorization_context', jsonb_build_object(
  'userId','20000000-0000-4000-8000-000000000004',
  'accountIds',jsonb_build_array('10000000-0000-4000-8000-000000000004'),
  'roles',jsonb_build_array('owner'),'isInternalStaff',false,
  'requestId','pgtap-end-client-partner-confidentiality',
  'expiresAt',(clock_timestamp() + interval '5 minutes')::text
)::text, true);
select set_config('app.authorization_signature', encode(extensions.hmac(
  current_setting('app.authorization_context'),
  (select secret from private.authorization_secrets where active
   order by created_at desc limit 1),
  'sha256'),'hex'), true);
set local role clockwork_runtime;
set local search_path = public, extensions;

select is((select count(*)::integer from lifecycle_renewal_actions
  where id = 'c1900000-0000-4000-8000-000000000001'), 0,
  'end client cannot read partner-confidential renewal evidence');
select is((select count(*)::integer from lifecycle_offboarding_plans
  where termination_id = 'c1910000-0000-4000-8000-000000000001'), 0,
  'end client cannot read the partner-authored offboarding plan');
select is((select count(*)::integer from audit_events
  where id = 'c1920000-0000-4000-8000-000000000001'), 0,
  'end client cannot read the partner-authored audit payload');
select is((select count(*)::integer from documents
  where id = '40000000-0000-4000-8000-000000000013'), 0,
  'end client cannot read the partner evidence document');
select is((select count(*)::integer from documents
  where id = '40000000-0000-4000-8000-000000000012'), 1,
  'end client retains access to its own commercial document');

reset role;
set local role clockwork_service;
delete from memberships
where user_id = '20000000-0000-4000-8000-000000000008'
  and organization_id = '30000000-0000-4000-8000-000000000004';
reset role;
set local role clockwork_runtime;
set local search_path = public, extensions;
select is((select count(*)::integer from lifecycle_renewal_actions
  where id = 'c1900000-0000-4000-8000-000000000001'), 0,
  'partner confidentiality survives later membership removal');
select is((select count(*)::integer from audit_events
  where id = 'c1920000-0000-4000-8000-000000000001'), 0,
  'partner audit confidentiality survives later membership removal');

-- A tenant-authored plan remains visible to segregated runtime approvers. It
-- uses the seeded draft direct invoice so final-billing guards are exercised.
insert into terminations(
  id,account_id,order_id,effective_at,final_billing_status,teardown_status
) values (
  'c1960000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000004',
  '80000000-0000-4000-8000-000000000007',
  '2027-07-31T00:00:00Z','pending','pending_final_billing'
);
insert into lifecycle_offboarding_plans(
  termination_id,account_id,organization_id,requested_by,reason,plan
) values (
  'c1960000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000004',
  '30000000-0000-4000-8000-000000000003',
  '20000000-0000-4000-8000-000000000004','customer_request',
  jsonb_build_object(
    'terminationId','c1960000-0000-4000-8000-000000000001',
    'accountId','10000000-0000-4000-8000-000000000004',
    'orderId','80000000-0000-4000-8000-000000000007',
    'organizationId','30000000-0000-4000-8000-000000000003',
    'reason','customer_request',
    'requestedBy','20000000-0000-4000-8000-000000000004',
    'effectiveAt','2027-07-31T00:00:00.000Z',
    'finalBillingStatus','pending',
    'retrievalStartsAt','2027-07-31T00:00:00.000Z',
    'retrievalEndsAt','2027-08-30T00:00:00.000Z',
    'maximumRetentionAt',null,
    'status','pending_final_billing',
    'lockedExclusions',jsonb_build_array(),
    'deletionScheduledAt','2027-08-30T00:00:00.000Z',
    'approvals',jsonb_build_array(),
    'teardownOperationId',null,
    'teardownConfirmedAt',null,
    'teardownExcludedObjectIds',jsonb_build_array()
  )
);

reset role;
select set_config('app.authorization_context', jsonb_build_object(
  'userId','20000000-0000-4000-8000-000000000008',
  'accountIds',jsonb_build_array('10000000-0000-4000-8000-000000000003'),
  'roles',jsonb_build_array('partner_admin'),'isInternalStaff',false,
  'requestId','pgtap-partner-mor-forgery',
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
  insert into lifecycle_renewal_actions(
    id,order_id,account_id,action,actor_user_id,payload,evidence_hash
  ) values (
    'c1900000-0000-4000-8000-000000000002',
    '80000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000004','renew',
    '20000000-0000-4000-8000-000000000008','{}',repeat('e',64)
  )
$$, '42501', null, 'unrelated partner cannot forge a referral renewal');
select throws_ok($$
  insert into terminations(
    id,account_id,order_id,effective_at,final_billing_status,teardown_status
  ) values (
    'c1910000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000004',
    '80000000-0000-4000-8000-000000000004',
    '2027-07-31T00:00:00Z','pending','not_started'
  )
$$, '42501', null, 'unrelated partner cannot terminate a distributor order');
select throws_ok($$
  insert into audit_events(
    id,account_id,aggregate_type,aggregate_id,aggregate_version,
    event_type,event_version,actor,occurred_at,request_id
  ) values (
    'c1920000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000004','order',
    '80000000-0000-4000-8000-000000000002',1,
    'renewal.requested',1,
    '{"kind":"user","id":"20000000-0000-4000-8000-000000000008"}',
    '2026-07-31T16:00:00Z','pgtap-partner-mor-forged-audit'
  )
$$, '42501', null, 'unrelated partner cannot append an end-client audit event');

reset role;
select set_config('app.authorization_context', jsonb_build_object(
  'userId','20000000-0000-4000-8000-000000000001',
  'accountIds',jsonb_build_array('10000000-0000-4000-8000-000000000004'),
  'roles',jsonb_build_array('destructive_action_approver'),
  'isInternalStaff',true,'requestId','pgtap-offboarding-approver-one',
  'expiresAt',(clock_timestamp() + interval '5 minutes')::text
)::text, true);
select set_config('app.authorization_signature', encode(extensions.hmac(
  current_setting('app.authorization_context'),
  (select secret from private.authorization_secrets where active
   order by created_at desc limit 1),
  'sha256'),'hex'), true);
set local role clockwork_service;
insert into approvals(
  id,account_id,action,object_type,object_id,requested_by,approved_by,
  status,requested_at,decided_at
) values
  (
    'c1940000-0000-4000-8000-000000000009',
    '10000000-0000-4000-8000-000000000004','termination_teardown',
    'termination','c1960000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000004',
    '20000000-0000-4000-8000-000000000002','approved',
    '2027-07-31T00:00:00Z','2026-07-31T16:06:00Z'
  ),
  (
    'c1940000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000004','termination_teardown',
    'termination','c1960000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000004',
    '20000000-0000-4000-8000-000000000001','approved',
    '2027-07-31T00:00:00Z','2026-07-31T16:10:00Z'
  );
reset role;
set local role clockwork_runtime;
set local search_path = public, extensions;

select throws_ok($$
  update lifecycle_offboarding_plans
  set row_version = row_version
  where termination_id = 'c1960000-0000-4000-8000-000000000001'
$$, '55000', null, 'stale offboarding versions cannot be replayed');
select throws_ok($$
  update lifecycle_offboarding_plans
  set plan = jsonb_set(
    jsonb_set(plan,'{approvals}',(plan -> 'approvals') || jsonb_build_array(
      jsonb_build_object(
        'approvalId','c1940000-0000-4000-8000-000000000004',
        'approverId','20000000-0000-4000-8000-000000000004',
        'decision','approved','reason','Requester cannot approve teardown',
        'decidedAt','2026-07-31T16:05:00.000Z',
        'evidenceHash',repeat('8',64),
        'recentAuthentication',jsonb_build_object(
          'authenticatedAt','2026-07-31T16:05:00.000Z',
          'evidenceHash',repeat('9',64)
        )
      )
    )),'{status}','"pending_approval"'),
    row_version = row_version + 1
  where termination_id = 'c1960000-0000-4000-8000-000000000001'
$$, '23514', null, 'the offboarding requester cannot self-approve teardown');
select throws_ok($$
  update lifecycle_offboarding_plans
  set plan = jsonb_set(
    jsonb_set(plan,'{approvals}',(plan -> 'approvals') || jsonb_build_array(
      jsonb_build_object(
        'approvalId','c1940000-0000-4000-8000-000000000009',
        'approverId','20000000-0000-4000-8000-000000000002',
        'decision','approved','reason','Forged acting approver is rejected',
        'decidedAt','2026-07-31T16:06:00.000Z',
        'evidenceHash',repeat('a',64),
        'recentAuthentication',jsonb_build_object(
          'authenticatedAt','2026-07-31T16:06:00.000Z',
          'evidenceHash',repeat('b',64)
        )
      )
    )),'{status}','"pending_approval"'),
    row_version = row_version + 1
  where termination_id = 'c1960000-0000-4000-8000-000000000001'
$$, '42501', null, 'a runtime update cannot forge another acting approver');
select lives_ok($$
  update lifecycle_offboarding_plans
  set plan = jsonb_set(
    jsonb_set(plan,'{approvals}',(plan -> 'approvals') || jsonb_build_array(
      jsonb_build_object(
        'approvalId','c1940000-0000-4000-8000-000000000001',
        'approverId','20000000-0000-4000-8000-000000000001',
        'decision','approved','reason','First segregated teardown approval',
        'decidedAt','2026-07-31T16:10:00.000Z',
        'evidenceHash',repeat('c',64),
        'recentAuthentication',jsonb_build_object(
          'authenticatedAt','2026-07-31T16:10:00.000Z',
          'evidenceHash',repeat('d',64)
        )
      )
    )),'{status}','"pending_approval"'),
    row_version = row_version + 1
  where termination_id = 'c1960000-0000-4000-8000-000000000001';
  update terminations
  set teardown_status = 'pending_approval', row_version = row_version + 1
  where id = 'c1960000-0000-4000-8000-000000000001'
$$, 'the first distinct durable approval advances plan and summary together');

reset role;
select set_config('app.authorization_context', jsonb_build_object(
  'userId','20000000-0000-4000-8000-000000000002',
  'accountIds',jsonb_build_array('10000000-0000-4000-8000-000000000004'),
  'roles',jsonb_build_array('destructive_action_approver'),
  'isInternalStaff',true,'requestId','pgtap-offboarding-approver-two',
  'expiresAt',(clock_timestamp() + interval '5 minutes')::text
)::text, true);
select set_config('app.authorization_signature', encode(extensions.hmac(
  current_setting('app.authorization_context'),
  (select secret from private.authorization_secrets where active
   order by created_at desc limit 1),
  'sha256'),'hex'), true);
set local role clockwork_service;
insert into approvals(
  id,account_id,action,object_type,object_id,requested_by,approved_by,
  status,requested_at,decided_at
) values
  (
    'c1940000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000004','termination_teardown',
    'termination','c1960000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000004',
    '20000000-0000-4000-8000-000000000002','approved',
    '2027-07-31T00:00:00Z','2026-07-31T16:25:00Z'
  ),
  (
    'c1940000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000004','termination_teardown',
    'termination','c1960000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000004',
    '20000000-0000-4000-8000-000000000002','approved',
    '2027-07-31T00:00:00Z','2026-07-31T16:26:00Z'
  );
reset role;
set local role clockwork_runtime;
set local search_path = public, extensions;

select throws_ok($$
  update lifecycle_offboarding_plans
  set plan = jsonb_set(
    jsonb_set(plan,'{approvals}',(plan -> 'approvals') || jsonb_build_array(
      jsonb_build_object(
        'approvalId','c1940000-0000-4000-8000-000000000002',
        'approverId','20000000-0000-4000-8000-000000000002',
        'decision','approved','reason','Second segregated teardown approval',
        'decidedAt','2026-07-31T16:20:00.000Z',
        'evidenceHash',repeat('e',64),
        'recentAuthentication',jsonb_build_object(
          'authenticatedAt','2026-07-31T16:20:00.000Z',
          'evidenceHash',repeat('f',64)
        )
      )
    )),'{status}','"ready_for_teardown"'),
    row_version = row_version + 1
  where termination_id = 'c1960000-0000-4000-8000-000000000001'
$$, '23514', null,
  'two approvals cannot bypass unsettled final billing');

reset role;
set local role clockwork_service;
set local search_path = public, extensions;
select throws_ok($$
  update lifecycle_offboarding_plans
  set plan = jsonb_set(plan,'{finalBillingStatus}','"settled"'),
      row_version = row_version + 1
  where termination_id = 'c1960000-0000-4000-8000-000000000001';
  set constraints lifecycle_offboarding_termination_convergence_guard immediate
$$, '23514', null, 'a plan-only status transition cannot commit divergent state');
select throws_ok($$
  update terminations
  set final_billing_status = 'settled', row_version = row_version + 1
  where id = 'c1960000-0000-4000-8000-000000000001';
  set constraints terminations_offboarding_convergence_guard immediate
$$, '23514', null,
  'a termination-only transition cannot commit divergent offboarding state');
select lives_ok($$
  update invoices
  set stripe_invoice_id = 'in_pgtap_direct_void', status = 'void'
  where id = '90000000-0000-4000-8000-000000000007';
  update lifecycle_offboarding_plans
  set plan = jsonb_set(
    jsonb_set(
      jsonb_set(plan,'{approvals}',(plan -> 'approvals') || jsonb_build_array(
        jsonb_build_object(
          'approvalId','c1940000-0000-4000-8000-000000000002',
          'approverId','20000000-0000-4000-8000-000000000002',
          'decision','approved','reason','Second segregated teardown approval',
          'decidedAt','2026-07-31T16:25:00.000Z',
          'evidenceHash',repeat('e',64),
          'recentAuthentication',jsonb_build_object(
            'authenticatedAt','2026-07-31T16:25:00.000Z',
            'evidenceHash',repeat('f',64)
          )
        )
      )),'{status}','"ready_for_teardown"'
    ),'{finalBillingStatus}','"settled"'
  ), row_version = row_version + 1
  where termination_id = 'c1960000-0000-4000-8000-000000000001';
  update terminations
  set teardown_status = 'ready_for_teardown', final_billing_status = 'settled',
      row_version = row_version + 1
  where id = 'c1960000-0000-4000-8000-000000000001';
  set constraints lifecycle_offboarding_termination_convergence_guard immediate;
  set constraints lifecycle_offboarding_termination_convergence_guard deferred
$$, 'settled billing and a second distinct durable approval advance atomically');
select is((
  select jsonb_array_length(plan -> 'approvals')::text || ':' ||
         (plan ->> 'status') || ':' || (plan ->> 'finalBillingStatus')
  from lifecycle_offboarding_plans
  where termination_id = 'c1960000-0000-4000-8000-000000000001'
), '2:ready_for_teardown:settled',
  'offboarding persists exactly two approvals in the ready settled state');
select throws_ok($$
  update lifecycle_offboarding_plans
  set plan = jsonb_set(plan,'{status}','"teardown_requested"'),
      row_version = row_version + 1
  where termination_id = 'c1960000-0000-4000-8000-000000000001';
  update terminations
  set teardown_status = 'teardown_requested', row_version = row_version + 1
  where id = 'c1960000-0000-4000-8000-000000000001'
$$, '23514', 'teardown request requires its enabled durable provider command',
  'two approvals cannot forge a teardown request without a provider command');

reset role;
set local role clockwork_runtime;
set local search_path = public, extensions;
select throws_ok($$
  update lifecycle_offboarding_plans
  set plan = jsonb_set(plan,'{approvals}',(plan -> 'approvals') ||
    jsonb_build_array(jsonb_build_object(
      'approvalId','c1940000-0000-4000-8000-000000000003',
      'approverId','20000000-0000-4000-8000-000000000002',
      'decision','approved','reason','Replayed approval must be rejected',
      'decidedAt','2026-07-31T16:26:00.000Z',
      'evidenceHash',repeat('1',64),
      'recentAuthentication',jsonb_build_object(
        'authenticatedAt','2026-07-31T16:26:00.000Z',
        'evidenceHash',repeat('2',64)
      )
    ))), row_version = row_version + 1
  where termination_id = 'c1960000-0000-4000-8000-000000000001'
$$, '23514', null, 'the same approver cannot replay a second approval');
select throws_ok($$
  update terminations
  set teardown_status = 'teardown_requested', row_version = row_version + 1
  where id = 'c1960000-0000-4000-8000-000000000001'
$$, '23514', null,
  'a forged termination transition cannot diverge from its durable plan');

select * from finish();
rollback;
