begin;
select plan(10);
set local role clockwork_service;
set local search_path = public, extensions;

select throws_ok(
  $$update agreements set executed_document_id = '40000000-0000-4000-8000-000000000003' where id = '51000000-0000-4000-8000-000000000001'$$,
  '55000', 'executed agreement evidence is immutable; create a version', 'executed agreement evidence cannot mutate'
);
select lives_ok(
  $$update agreements set status = 'terminated' where id = '51000000-0000-4000-8000-000000000001'$$,
  'agreement lifecycle status can advance without rewriting evidence'
);
select throws_ok(
  $$update quotes set total_minor = total_minor + 1 where id = '70000000-0000-4000-8000-000000000001'$$,
  '55000', 'issued quote commercial terms are immutable', 'issued quotes cannot mutate'
);
select throws_ok(
  $$update orders set po_number = 'CHANGED' where id = '80000000-0000-4000-8000-000000000001'$$,
  '55000', 'accepted order commercial terms are immutable; use an amendment', 'accepted order terms cannot mutate'
);
select throws_ok(
  $$delete from orders where id = '80000000-0000-4000-8000-000000000001'$$,
  '55000', 'accepted orders are immutable; use an amendment', 'accepted orders cannot be deleted'
);
select throws_ok(
  $$update order_lines set unit_price_minor = unit_price_minor + 1 where id = '81000000-0000-4000-8000-000000000001'$$,
  '55000', 'accepted order lines are immutable; use an amendment', 'accepted order line prices cannot mutate'
);
select throws_ok(
  $$delete from order_lines where id = '81000000-0000-4000-8000-000000000001'$$,
  '55000', 'accepted order lines are immutable; use an amendment', 'accepted order lines cannot be deleted'
);

reset role;
set local search_path = public, extensions;
select throws_ok(
  $$update audit_events set event_type = 'tampered' where id = '95000000-0000-4000-8000-000000000001'$$,
  '55000', 'audit_events is append-only/immutable', 'audit events cannot mutate even for the owner'
);
select throws_ok(
  $$delete from audit_events where id = '95000000-0000-4000-8000-000000000001'$$,
  '55000', 'audit_events is append-only/immutable', 'audit events cannot be deleted even for the owner'
);
select throws_ok(
  $$update documents set storage_version_id = 'tampered' where id = '40000000-0000-4000-8000-000000000001'$$,
  '55000', 'documents is append-only/immutable', 'immutable document identity cannot mutate'
);

select * from finish();
rollback;
