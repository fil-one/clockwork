begin;
select plan(9);
select has_table('public', 'system_capability_requests', 'activation proposals are persisted');
select is((select relrowsecurity from pg_class where oid = 'public.system_capability_requests'::regclass), true, 'activation requests enforce RLS');
select is((select relforcerowsecurity from pg_class where oid = 'public.system_capability_requests'::regclass), true, 'activation requests force RLS');
set local role clockwork_runtime;
set local search_path = public, extensions;
select throws_ok($$select * from system_capability_requests$$, '42501', null, 'tenant runtime cannot inspect control-plane proposals');
reset role;
set local role clockwork_service;
set local search_path = public, extensions;
insert into system_capability_requests
(id, capability_key, base_version, enable_recovery, requested_by, requested_at, reason, evidence_reference)
values ('94230000-0000-4000-8000-000000000001', 'marketplace', 1, false,
'20000000-0000-4000-8000-000000000001', '2026-09-06T12:00:00Z', 'Reviewed isolated test evidence', 'evidence:activation-test');
select throws_ok($$update system_capability_requests set reason = 'Changed after proposal' where id = '94230000-0000-4000-8000-000000000001'$$,
'55000', null, 'proposed evidence cannot be changed');
select throws_ok($$update system_capability_requests set status = 'approved', decided_by = requested_by,
decided_at = '2026-09-06T13:00:00Z', decision_reason = 'Reviewed and approved' where id = '94230000-0000-4000-8000-000000000001'$$,
'23514', null, 'requester cannot approve their own activation');
select throws_ok($$update system_capability_requests set status = 'approved', decided_by = '20000000-0000-4000-8000-000000000002',
decided_at = '2026-09-07T13:00:00Z', decision_reason = 'Reviewed and approved' where id = '94230000-0000-4000-8000-000000000001'$$,
'55000', null, 'approval cannot use evidence older than 24 hours');
select lives_ok($$update system_capability_requests set status = 'canceled', decided_by = requested_by,
decided_at = '2026-09-06T13:00:00Z', decision_reason = 'Immediate shutdown cancels proposal' where id = '94230000-0000-4000-8000-000000000001'$$,
'operator can cancel their pending request during shutdown');
select throws_ok($$update system_capability_requests set status = 'pending', decided_by = null, decided_at = null, decision_reason = null
where id = '94230000-0000-4000-8000-000000000001'$$, '55000', null, 'canceled activation cannot be reopened');
select * from finish();
rollback;
