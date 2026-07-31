begin;
select plan(8);

select has_table('public', 'system_external_gates', 'external gate register is canonical');
set local role clockwork_runtime;
set local search_path = public, extensions;
select is((select count(*)::integer from system_external_gates), 0,
  'unprivileged session cannot read gate status');
reset role;
select is((select relrowsecurity from pg_class where oid = 'public.system_external_gates'::regclass), true,
  'external gates enforce RLS');
select is((select relforcerowsecurity from pg_class where oid = 'public.system_external_gates'::regclass), true,
  'external gates force RLS');

set local role clockwork_service;
set local search_path = public, extensions;
select is((select count(*)::integer from system_external_gates), 12,
  'service role sees the complete gate register');
select throws_ok($$
  update system_external_gates
  set configured_status = 'active'
  where gate_key = 'EXT-ACC-01'
$$, '23514', null, 'database denies activation without passing evidence');
select lives_ok($$
  update system_external_gates set
    configured_status = 'active',
    last_activation_test_status = 'passed',
    last_activation_test_at = '2026-07-31T16:00:00Z',
    last_activation_tested_by = 'platform-owner@filone.test',
    activation_evidence_reference = 'evidence://activation/acc',
    review_on = '2026-08-31'
  where gate_key = 'EXT-ACC-01'
$$, 'database accepts a complete activation record');
select is((select row_version from system_external_gates where gate_key = 'EXT-ACC-01'), 2,
  'gate updates use optimistic row versions');

select * from finish();
rollback;
