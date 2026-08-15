begin;
select plan(16);
set local search_path = public, extensions;

-- The row-level half of the `create_signature_envelope` defect.
--
-- Every assertion in the first block fails against 001397 with
-- `42501 new row violates row-level security policy for table
-- "provider_operations"`, because `provider_operations_internal` admitted only
-- `app_is_internal()` and the two commands that write this table from a tenant
-- action run as `clockwork_runtime`. The refusals in the second and third
-- blocks are the point of the fix as much as the admission is: the append is
-- narrow, and the tenant connection still cannot advance, clear or remove a
-- claim.
--
-- Fixture: seeded account 10000000-...-0001 with owner 20000000-...-0002,
-- seeded document 40000000-...-0002 on that account, and seeded POC
-- 85000000-...-0001 on the DIFFERENT account 10000000-...-0004.

select set_config('app.authorization_context', jsonb_build_object(
  'userId','20000000-0000-4000-8000-000000000002',
  'accountIds',jsonb_build_array('10000000-0000-4000-8000-000000000001'),
  'roles',jsonb_build_array('owner'),'isInternalStaff',false,
  'requestId','pgtap-provider-operations-tenant-claim',
  'expiresAt',(clock_timestamp() + interval '5 minutes')::text
)::text, true);
select set_config('app.authorization_signature', encode(extensions.hmac(
  current_setting('app.authorization_context'),
  (select secret from private.authorization_secrets where active
   order by created_at desc limit 1),
  'sha256'),'hex'), true);

-- The second caller's context is signed here, before the role switch: the
-- signing secret lives in `private`, which `clockwork_runtime` cannot read --
-- which is the point of it.
select set_config('app.pgtap_1399_poc_context', jsonb_build_object(
  'userId','20000000-0000-4000-8000-000000000004',
  'accountIds',jsonb_build_array('10000000-0000-4000-8000-000000000004'),
  'roles',jsonb_build_array('owner'),'isInternalStaff',false,
  'requestId','pgtap-provider-operations-poc-claim',
  'expiresAt',(clock_timestamp() + interval '5 minutes')::text
)::text, true);
select set_config('app.pgtap_1399_poc_signature', encode(extensions.hmac(
  current_setting('app.pgtap_1399_poc_context'),
  (select secret from private.authorization_secrets where active
   order by created_at desc limit 1),
  'sha256'),'hex'), true);

set local role clockwork_runtime;

-- The counter-signed draft the envelope is created against. A tenant writes
-- this one today, through `upload_customer_paper`, on this same connection.
select lives_ok($$
  insert into lifecycle_agreement_drafts (
    id, account_id, customer_paper_document_id, paper, execution_mode,
    negotiation_status, jurisdiction, created_by
  ) values (
    'c1990000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000002',
    'theirs','counter_signed','agreed','US-DE',
    '20000000-0000-4000-8000-000000000002'
  )
$$, 'a tenant can still author the counter-signed draft an envelope binds');

-- A click-through draft on the same account, to prove the admission is keyed
-- on the execution mode and not merely on the account.
select lives_ok($$
  insert into lifecycle_agreement_drafts (
    id, account_id, template_id, paper, execution_mode,
    negotiation_status, jurisdiction, created_by
  ) values (
    'c1990000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    'ours','click_through','standard','US-DE',
    '20000000-0000-4000-8000-000000000002'
  )
$$, 'a click-through draft exists on the same account for contrast');

-- THE DEFECT. `createSignatureEnvelope` writes exactly this row.
select lives_ok($$
  insert into provider_operations (
    provider, operation, idempotency_key, aggregate_type, aggregate_id, status
  ) values (
    'esign','create_envelope','esign:pgtap-1399-envelope','agreement',
    'c1990000-0000-4000-8000-000000000001','pending'
  )
$$, 'the tenant connection can claim the e-sign envelope its own draft needs');

select throws_ok($$
  insert into provider_operations (
    provider, operation, idempotency_key, aggregate_type, aggregate_id, status
  ) values (
    'esign','create_envelope','esign:pgtap-1399-click','agreement',
    'c1990000-0000-4000-8000-000000000002','pending'
  )
$$, '42501', null,
  'a click-through draft cannot back a counter-signature envelope claim');

select throws_ok($$
  insert into provider_operations (
    provider, operation, idempotency_key, aggregate_type, aggregate_id, status
  ) values (
    'esign','create_envelope','esign:pgtap-1399-foreign','agreement',
    'c1990000-0000-4000-8000-0000000000ff','pending'
  )
$$, '42501', null,
  'an envelope claim against a draft the caller does not hold is refused');

-- The claim must be unstarted. A tenant must not be able to assert that a
-- provider call already ran, already failed, or is already scheduled.
select throws_ok($$
  insert into provider_operations (
    provider, operation, idempotency_key, aggregate_type, aggregate_id, status
  ) values (
    'esign','create_envelope','esign:pgtap-1399-running','agreement',
    'c1990000-0000-4000-8000-000000000001','running'
  )
$$, '42501', null, 'a tenant cannot append a claim that is already running');
select throws_ok($$
  insert into provider_operations (
    provider, operation, idempotency_key, aggregate_type, aggregate_id,
    status, attempt_count
  ) values (
    'esign','create_envelope','esign:pgtap-1399-attempted','agreement',
    'c1990000-0000-4000-8000-000000000001','pending',3
  )
$$, '42501', null, 'a tenant cannot append a claim that has already attempted');
select throws_ok($$
  insert into provider_operations (
    provider, operation, idempotency_key, aggregate_type, aggregate_id,
    status, provider_reference
  ) values (
    'esign','create_envelope','esign:pgtap-1399-bound','agreement',
    'c1990000-0000-4000-8000-000000000001','pending','envelope-already-real'
  )
$$, '42501', null,
  'a tenant cannot append a claim that already names a provider resource');
select throws_ok($$
  insert into provider_operations (
    provider, operation, idempotency_key, aggregate_type, aggregate_id,
    status, last_error
  ) values (
    'esign','create_envelope','esign:pgtap-1399-errored','agreement',
    'c1990000-0000-4000-8000-000000000001','pending','provider refused'
  )
$$, '42501', null, 'a tenant cannot append a claim that already carries an error');
select throws_ok($$
  insert into provider_operations (
    provider, operation, idempotency_key, aggregate_type, aggregate_id,
    status, next_attempt_at
  ) values (
    'esign','create_envelope','esign:pgtap-1399-scheduled','agreement',
    'c1990000-0000-4000-8000-000000000001','pending','2027-01-01T00:00:00Z'
  )
$$, '42501', null, 'a tenant cannot append a claim that is already scheduled');

-- The enumeration is the control. A provider call no tenant command makes must
-- fail here and be reviewed rather than inherit the admission.
select throws_ok($$
  insert into provider_operations (
    provider, operation, idempotency_key, aggregate_type, aggregate_id, status
  ) values (
    'stripe','create_invoice','stripe:pgtap-1399','agreement',
    'c1990000-0000-4000-8000-000000000001','pending'
  )
$$, '42501', null,
  'an unenumerated provider call is not admitted by the envelope arm');

-- A POC on another account is not this caller's to provision.
select throws_ok($$
  insert into provider_operations (
    provider, operation, idempotency_key, aggregate_type, aggregate_id, status
  ) values (
    'provisioning','sandbox','poc:pgtap-1399-foreign','poc',
    '85000000-0000-4000-8000-000000000001','pending'
  )
$$, '42501', null,
  'a sandbox claim for another account''s POC is refused');

-- Appending is the whole grant. Reading, advancing and removing are not.
select is(
  (select count(*)::integer from provider_operations
   where idempotency_key = 'esign:pgtap-1399-envelope'),
  0,
  'the tenant connection still cannot read the claim it just appended');
select throws_ok($$
  update provider_operations set status = 'succeeded'
  where provider = 'esign'
$$, '42501', null, 'the tenant connection cannot advance a provider operation');
select throws_ok($$
  delete from provider_operations where provider = 'esign'
$$, '42501', null, 'the tenant connection cannot delete a provider operation');

-- The POC arm, from the account that actually owns the seeded POC.
select set_config('app.authorization_context',
  current_setting('app.pgtap_1399_poc_context'), true);
select set_config('app.authorization_signature',
  current_setting('app.pgtap_1399_poc_signature'), true);

select lives_ok($$
  insert into provider_operations (
    provider, operation, idempotency_key, aggregate_type, aggregate_id, status
  ) values (
    'provisioning','sandbox','poc:pgtap-1399-sandbox','poc',
    '85000000-0000-4000-8000-000000000001','pending'
  )
$$, 'the POC owner can claim the sandbox provisioning its approval enqueues');

select * from finish();
rollback;
