begin;
select plan(12);

select has_table('public', 'system_exception_roster',
  'persisted exception roster exists');
select has_table('public', 'system_external_gate_activation_tasks',
  'durable external gate activation task store exists');
select has_column('public', 'system_external_gates', 'emergency_disabled_at',
  'external gates support audited emergency disable state');
select is((select relrowsecurity from pg_class where oid = 'public.system_exception_roster'::regclass), true,
  'exception roster enables RLS');
select is((select relforcerowsecurity from pg_class where oid = 'public.system_exception_roster'::regclass), true,
  'exception roster forces RLS');
select is((select relrowsecurity from pg_class where oid = 'public.system_external_gate_activation_tasks'::regclass), true,
  'activation tasks enable RLS');
select is((select relforcerowsecurity from pg_class where oid = 'public.system_external_gate_activation_tasks'::regclass), true,
  'activation tasks force RLS');

set local role clockwork_service;
set local search_path = public, extensions;
select is((select count(*)::integer from system_exception_roster), 0,
  'service starts with an empty roster rather than fabricated owners');
select throws_ok($$
  update system_external_gates
  set emergency_disabled_at = now()
  where gate_key = 'EXT-ACC-01'
$$, '23514', null, 'partial emergency state is rejected');
select throws_ok($$
  insert into system_exception_roster(
    account_id, queue, user_id, role, active,
    qualification_evidence_reference, qualified_until,
    absent_from, target_minutes, priority
  ) values (
    '10000000-0000-4000-8000-000000000001', 'reconciliation',
    '20000000-0000-4000-8000-000000000001', 'primary', true,
    'evidence://approvers/runtime-pgtap', now() + interval '30 days',
    now(), 60, 10
  )
$$, '23514', null, 'partial absence state is rejected');
select throws_ok($$
  insert into system_external_gate_activation_tasks(
    task_key, gate_key, provider, mode, status, attempt_count
  ) values (
    'pgtap:activation:invalid-lease', 'EXT-ACC-01', 'billing',
    'live', 'probing', 1
  )
$$, '23514', null, 'probing activation work requires a lease owner');
select lives_ok($$
  insert into system_external_gate_activation_tasks(
    task_key, gate_key, provider, mode, status
  ) values (
    'pgtap:activation:persisted-intent', 'EXT-ACC-01', 'billing',
    'live', 'pending'
  )
$$, 'activation intent can be persisted before the provider probe');

select * from finish();
rollback;
