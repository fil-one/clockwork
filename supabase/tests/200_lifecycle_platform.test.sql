begin;
select plan(33);

select has_table('public', 'lifecycle_partner_domains', 'partner domains are canonical');
select has_table('public', 'lifecycle_agreement_template_texts', 'canonical legal text is persisted');
select has_table('public', 'lifecycle_agreement_drafts', 'agreement drafts are canonical');
select has_table('public', 'lifecycle_click_acceptances', 'click evidence is canonical');
select has_table('public', 'lifecycle_signature_envelopes', 'signature envelopes are canonical');
select has_table('public', 'lifecycle_pass_through_acceptances', 'pass-through evidence is canonical');
select has_table('public', 'lifecycle_poc_evidence', 'POC evidence is canonical');
select has_table('public', 'lifecycle_provisioning_attempts', 'provisioning attempts are canonical');
select has_table('public', 'lifecycle_renewal_actions', 'renewal actions are canonical');
select has_table('public', 'lifecycle_offboarding_plans', 'offboarding plans are canonical');
select has_table('public', 'lifecycle_migration_runs', 'migration runs are canonical');
select has_table('public', 'lifecycle_migration_matches', 'migration decisions are canonical');
select has_table('public', 'lifecycle_domain_events', 'provider ordering ledger is canonical');
select has_table('public', 'lifecycle_feature_gate_approvals', 'feature gate approvals are canonical');
select has_table('public', 'lifecycle_idempotency_records', 'tenant idempotency leases are canonical');

select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class
    where oid = 'public.lifecycle_partner_domains'::regclass),
  'tenant lifecycle table forces RLS'
);
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class
    where oid = 'public.lifecycle_domain_events'::regclass),
  'provider event ledger forces RLS'
);
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class
    where oid = 'public.lifecycle_migration_runs'::regclass),
  'migration state forces RLS'
);

set local role clockwork_service;
set local search_path = public, extensions;

select lives_ok($$
  insert into documents(
    id, kind, storage_key, content_hash, mime_type, byte_length,
    object_lock_mode, retain_until, storage_version_id
  ) values (
    '42000000-0000-4000-8000-000000000200', 'canonical_text',
    'legal/lifecycle-canonical.txt',
    encode(extensions.digest(convert_to('Canonical lifecycle terms.', 'UTF8'), 'sha256'), 'hex'),
    'text/plain', 26, 'COMPLIANCE', '2036-01-01T00:00:00Z', 'legal-v200'
  );
  insert into agreement_templates(
    id, type, semantic_version, jurisdiction, effective_on,
    canonical_document_id, text_hash, execution_mode, approval_status, approved_by
  ) values (
    '52000000-0000-4000-8000-000000000200', 'tos', '1.0.0', 'US', '2026-01-01',
    '42000000-0000-4000-8000-000000000200',
    encode(extensions.digest(convert_to('Canonical lifecycle terms.', 'UTF8'), 'sha256'), 'hex'),
    'click_through', 'approved', '20000000-0000-4000-8000-000000000006'
  );
  insert into lifecycle_agreement_template_texts(template_id, exact_text, exact_text_hash)
  values (
    '52000000-0000-4000-8000-000000000200', 'Canonical lifecycle terms.',
    encode(extensions.digest(convert_to('Canonical lifecycle terms.', 'UTF8'), 'sha256'), 'hex')
  )
$$, 'canonical text and its immutable document hash agree');

select throws_ok($$
  insert into lifecycle_agreement_template_texts(template_id, exact_text, exact_text_hash)
  values (
    '50000000-0000-4000-8000-000000000001', 'tampered text', repeat('a', 64)
  )
$$, '23514', null, 'database rejects a canonical legal-text hash mismatch');

select is_empty($$
  update lifecycle_agreement_template_texts
  set exact_text = 'mutated' where template_id = '52000000-0000-4000-8000-000000000200'
  returning 1
$$, 'issued canonical legal text cannot be mutated through the service role');

select throws_ok($$
  insert into lifecycle_feature_gate_approvals(
    gate, requester_id, approver_id, approved, approved_at,
    evidence_document_id, authentication_evidence_hash
  ) values (
    'existing_customer_migration:test',
    '20000000-0000-4000-8000-000000000006',
    '20000000-0000-4000-8000-000000000006', true, now(),
    '42000000-0000-4000-8000-000000000200', repeat('b',64)
  )
$$, '23514', null, 'migration gate approval cannot self-approve');

select lives_ok($$
  insert into lifecycle_partner_domains(
    id, account_id, domain, verification_token_hash, verified_at,
    brand_name, primary_color, communication_owner
  ) values
  ('e2000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
   'lifecycle-northstar.test',repeat('1',64),now(),'Northstar','#112233','fil_one'),
  ('e2000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000004',
   'lifecycle-direct.test',repeat('2',64),now(),'Direct Buyer','#445566','fil_one')
$$, 'service can persist two account-scoped partner-domain records');

select lives_ok($$
  insert into lifecycle_domain_events(
    id, provider, provider_event_id, aggregate_type, aggregate_id,
    sequence, event_type, payload_hash, payload, occurred_at
  ) values (
    'e2100000-0000-4000-8000-000000000001','esign','evt-lifecycle-1',
    'agreement_envelope','e2000000-0000-4000-8000-000000000001',1,
    'envelope.sent',repeat('3',64),'{}','2026-01-01T00:00:00Z'
  )
$$, 'first provider sequence is accepted');

select lives_ok($$
  insert into lifecycle_provisioning_attempts(
    id, command_id, account_id, order_id, organization_id,
    operation, state, attempt
  ) values (
    'e2200000-0000-4000-8000-000000000001', 'provisioning-rls-test',
    '10000000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'provision', 'pending', '{}'
  )
$$, 'service can persist the durable provisioning command');

select throws_ok($$
  insert into lifecycle_domain_events(
    provider, provider_event_id, aggregate_type, aggregate_id,
    sequence, event_type, payload_hash, payload, occurred_at
  ) values (
    'esign','evt-lifecycle-2','agreement_envelope',
    'e2000000-0000-4000-8000-000000000001',1,
    'envelope.viewed',repeat('4',64),'{}','2026-01-01T00:01:00Z'
  )
$$, '23505', null, 'provider sequence replay cannot fork aggregate state');

reset role;
select set_config('app.authorization_context', jsonb_build_object(
  'userId','20000000-0000-4000-8000-000000000002',
  'accountIds',jsonb_build_array('10000000-0000-4000-8000-000000000001'),
  'roles',jsonb_build_array('owner'),
  'isInternalStaff',false,
  'requestId','lifecycle-rls-owner',
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
  (select count(*)::integer from lifecycle_partner_domains), 1,
  'tenant sees only its lifecycle partner-domain record'
);
select is(
  (select domain from lifecycle_partner_domains limit 1),
  'lifecycle-northstar.test',
  'tenant cannot substitute a cross-account lifecycle row'
);
select is(
  (select exact_text from lifecycle_agreement_template_texts
    where template_id = '52000000-0000-4000-8000-000000000200'),
  'Canonical lifecycle terms.',
  'approved canonical agreement text is readable without provider access'
);
select throws_ok($$
  insert into lifecycle_partner_domains(
    account_id, domain, verification_token_hash, verified_at,
    brand_name, primary_color, communication_owner
  ) values (
    '10000000-0000-4000-8000-000000000004','cross-account-write.test',
    repeat('5',64),now(),'Cross Account','#778899','fil_one'
  )
$$, '42501', null, 'RLS blocks a cross-account lifecycle write');
select is(
  (select count(*)::integer from lifecycle_domain_events), 0,
  'tenant cannot read provider event payloads'
);
select is(
  (select count(*)::integer from lifecycle_migration_runs), 0,
  'tenant cannot read migration checkpoints'
);
select throws_ok($$
  update lifecycle_provisioning_attempts
  set attempt = '{"tampered":true}'
  where id = 'e2200000-0000-4000-8000-000000000001'
$$, '42501', null, 'tenant cannot tamper with a durable provisioning command');

select * from finish();
rollback;
