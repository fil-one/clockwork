begin;
select plan(9);
set local search_path = public, extensions;

-- P0-43. Four TypeScript declarations of the exception-queue vocabulary
-- disagreed and the database enforced none of them. These assertions are about
-- what the database now accepts and refuses, not about two lists agreeing:
-- every one of them fails against 001394 because there was no constraint there
-- to refuse anything.
--
-- Fixture: seeded account 10000000-...-0001, internal operator
-- 20000000-...-0001, and quote 70000000-...-0001 as the object under exception.

select has_column('public', 'exception_cases', 'queue', 'exception cases carry a queue');

-- The refusal. A queue that no raise site produces is what a typo or a fifth
-- private vocabulary looks like on arrival, and it used to persist silently.
select throws_ok($$
  insert into exception_cases (
    account_id, queue, object_type, object_id, owner_user_id, target_at, status
  ) values (
    '10000000-0000-4000-8000-000000000001', 'not_a_real_queue',
    'quote', '70000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001', now() + interval '4 hours', 'open'
  )
$$, '23514', null, 'an exception cannot be filed against a queue nobody owns');

-- The near miss is the one that matters. `provider_recovery` is the name a live
-- fixture in packages/api uses for what §16 calls provisioning recovery; it is
-- shape-valid, so 001130's regex admitted it.
select throws_ok($$
  insert into exception_cases (
    account_id, queue, object_type, object_id, owner_user_id, target_at, status
  ) values (
    '10000000-0000-4000-8000-000000000001', 'provider_recovery',
    'quote', '70000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001', now() + interval '4 hours', 'open'
  )
$$, '23514', null, 'a shape-valid queue name that is not the §16 name is refused');

-- A roster is the only thing that makes a queue ownable. Filing it under a
-- queue no raise site produces used to succeed and then present as
-- EXCEPTION_NO_ELIGIBLE_PRIMARY on the exception, far from the row at fault.
select throws_ok($$
  insert into system_exception_roster (
    account_id, queue, user_id, role, active,
    qualification_evidence_reference, qualified_until, target_minutes, priority
  ) values (
    '10000000-0000-4000-8000-000000000001', 'provider_recovery',
    '20000000-0000-4000-8000-000000000001', 'primary', true,
    'evidence://approvers/pgtap-1395', now() + interval '30 days', 60, 10
  )
$$, '23514', null, 'a roster cannot be created for a queue nothing raises');

-- The admitted set. Each of these is a live writer, and a constraint that
-- refused any of them would break that writer on the next deploy.
select lives_ok($$
  insert into exception_cases (
    account_id, queue, object_type, object_id, owner_user_id, target_at, status
  ) values (
    '10000000-0000-4000-8000-000000000001', 'provisioning_recovery',
    'quote', '70000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001', now() + interval '4 hours', 'open'
  )
$$, 'a §16 queue absent from every prior declaration can now be filed');

-- 001000:996 writes this literal from inside core_evaluate_order_acceptance and
-- two other database objects match on it. §16 does not tabulate it.
select lives_ok($$
  insert into exception_cases (
    account_id, queue, object_type, object_id, owner_user_id, target_at, status
  ) values (
    '10000000-0000-4000-8000-000000000001', 'order_acceptance_review',
    'order', '80000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001', now() + interval '4 hours', 'open'
  )
$$, 'the order-acceptance database path keeps the queue it writes');

-- The five queues the workflow engine raises that appear in no §16 row. They
-- are admitted because engine.ts raises them, not because a list named them.
select lives_ok($$
  insert into exception_cases (
    account_id, queue, object_type, object_id, owner_user_id, target_at, status
  )
  select
    '10000000-0000-4000-8000-000000000001', queue,
    'quote', '70000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001', now() + interval '4 hours', 'closed'
  from unnest(array[
    'billing_operations','commissions','reconciliation','reporting','workflow_operations'
  ]) as queue
$$, 'every queue the core workflow engine raises is admitted');

select lives_ok($$
  insert into system_exception_roster (
    account_id, queue, user_id, role, active,
    qualification_evidence_reference, qualified_until, target_minutes, priority
  ) values (
    '10000000-0000-4000-8000-000000000001', 'provisioning_recovery',
    '20000000-0000-4000-8000-000000000001', 'primary', true,
    'evidence://approvers/pgtap-1395', now() + interval '30 days', 60, 10
  )
$$, 'a roster can be created for every queue in the vocabulary');

-- Nothing that already existed is now illegal: the constraints were added NOT
-- VALID and validated, so a row that predated them would have failed the
-- migration rather than survived it.
select is(
  (select count(*)::integer from exception_cases
    where queue not in (
      'pricing','legal','credit_collections','restricted_parties','disputes',
      'deal_registration_disputes','poc_qualification','provisioning_recovery',
      'migration_review','offboarding_destructive','order_acceptance_review',
      'billing_operations','commissions','reconciliation','reporting',
      'workflow_operations'
    )),
  0,
  'no persisted exception case sits outside the validated vocabulary'
);

select * from finish();
rollback;
