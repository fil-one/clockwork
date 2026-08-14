begin;
select plan(17);
set local role clockwork_service;
set local search_path = public, extensions;

-- The four parent keys every commerce read walks.
select has_index(
  'public', 'quote_lines', 'quote_lines_quote_idx',
  array['quote_id']::name[],
  'quote lines are reachable from their quote without a scan'
);
select has_index(
  'public', 'order_lines', 'order_lines_order_idx',
  array['order_id']::name[],
  'order lines are reachable from their order without a scan'
);
select has_index(
  'public', 'payments', 'payments_invoice_idx',
  array['invoice_id']::name[],
  'payments are reachable from the invoice they settle'
);
select has_index(
  'public', 'entitlements', 'entitlements_order_idx',
  array['order_id']::name[],
  'entitlements are reachable from their order'
);

-- Cursor pages: the account leads and id follows, in that order. A one-column
-- index or the reverse order sends the pager back to a primary-key walk.
select has_index(
  'public', 'quotes', 'quotes_account_page_idx',
  array['account_id', 'id']::name[],
  'a quote page reads one account in id order'
);
select has_index(
  'public', 'orders', 'orders_account_page_idx',
  array['account_id', 'id']::name[],
  'an order page reads one account in id order'
);
select has_index(
  'public', 'invoices', 'invoices_account_page_idx',
  array['account_id', 'id']::name[],
  'an invoice page reads one account in id order'
);
select has_index(
  'public', 'deal_registrations', 'deal_registrations_partner_page_idx',
  array['partner_account_id', 'id']::name[],
  'a registration page reads one partner in id order'
);
select has_index(
  'public', 'commission_accruals', 'commission_accruals_partner_page_idx',
  array['partner_account_id', 'id']::name[],
  'a commission page reads one partner in id order'
);

-- Coverage that already existed and that the new indexes deliberately do not
-- duplicate. Dropping any of these would reopen a scan the pager or the
-- entitlement lookup depends on.
select has_index(
  'public', 'entitlements', 'entitlements_order_line_unique',
  array['order_line_id']::name[],
  'the order-line side of an entitlement stays covered by its unique index'
);
select has_index(
  'public', 'quotes', 'quotes_account_timeline_idx',
  array['account_id', 'created_at']::name[],
  'the quote timeline index is not redundant with the page index'
);
select has_index(
  'public', 'orders', 'orders_account_timeline_idx',
  array['account_id', 'created_at']::name[],
  'the order timeline index is not redundant with the page index'
);
select has_index(
  'public', 'invoices', 'invoices_account_aging_idx',
  array['account_id', 'status', 'due_at']::name[],
  'the invoice aging index is not redundant with the page index'
);

-- payments has two parents and only one of them is read by a predicate. Every
-- order_id reference is anchored on the primary key
-- (`where p.id = new.payment_id and p.order_id = new.order_id`), so an index
-- there would be built, maintained on every write, and never planned.
select ok(
  not exists (
    select 1
    from pg_index i
    join pg_attribute a
      on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
    where i.indrelid = 'public.payments'::regclass and a.attname = 'order_id'
  ),
  'payments.order_id stays unindexed because nothing leads a lookup with it'
);

-- The dead-letter dispatch lookup joins the audit log on the aggregate the
-- attempt was raised for. `audit_aggregate_version_unique` leads on
-- aggregate_type, so the join has to bind it, and it has to bind it from the
-- attempt scope rather than to a literal: `lifecycle_provisioning_scope_check`
-- makes poc_id and order_id mutually exclusive and the emitter writes 'poc' for
-- the first and 'order' for the second.
insert into audit_events (
  id, account_id, aggregate_type, aggregate_id, aggregate_version, event_type,
  event_version, actor, occurred_at, request_id
) values (
  'd3800000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000004', 'poc',
  '85000000-0000-4000-8000-000000000001', 9001,
  'order.provisioning_requested', 1,
  '{"kind":"system","id":"pgtap-dispatch"}'::jsonb,
  '2026-08-01T09:00:00Z', 'pgtap-hot-path-poc'
), (
  'd3800000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000001', 'order',
  '80000000-0000-4000-8000-000000000001', 9001,
  'order.provisioning_requested', 1,
  '{"kind":"system","id":"pgtap-dispatch"}'::jsonb,
  '2026-08-01T09:00:00Z', 'pgtap-hot-path-order'
);
insert into outbox_messages (id, event_id, topic, payload) values (
  'd3810000-0000-4000-8000-000000000001',
  'd3800000-0000-4000-8000-000000000001',
  'lifecycle.sandbox.provisioning_requested', '{}'::jsonb
), (
  'd3810000-0000-4000-8000-000000000002',
  'd3800000-0000-4000-8000-000000000002',
  'lifecycle.order.provisioning_requested', '{}'::jsonb
);
insert into lifecycle_provisioning_attempts (
  id, command_id, account_id, order_id, poc_id, organization_id, operation,
  state, attempt
) values (
  'd3820000-0000-4000-8000-000000000001', 'pgtap-hot-path-sandbox',
  '10000000-0000-4000-8000-000000000004', null,
  '85000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000003', 'sandbox', 'dead_letter',
  '{"attempts":5,"state":"dead_letter"}'::jsonb
), (
  'd3820000-0000-4000-8000-000000000002', 'pgtap-hot-path-order',
  '10000000-0000-4000-8000-000000000001',
  '80000000-0000-4000-8000-000000000001', null,
  '30000000-0000-4000-8000-000000000001', 'provision', 'dead_letter',
  '{"attempts":5,"state":"dead_letter"}'::jsonb
);

-- The shipped shape, verbatim from dead-letter-dispatch.ts.
select is(
  (select message.topic
     from lifecycle_provisioning_attempts attempt
     join audit_events event
       on event.aggregate_type
            = case when attempt.order_id is not null then 'order' else 'poc' end
      and event.aggregate_id = coalesce(attempt.order_id, attempt.poc_id)
      and event.event_type = 'order.provisioning_requested'
     join outbox_messages message on message.event_id = event.id
    where attempt.id = 'd3820000-0000-4000-8000-000000000001'
    order by event.occurred_at desc
    limit 1),
  'lifecycle.sandbox.provisioning_requested',
  'a sandbox attempt finds the poc-scoped dispatch it was delivered from'
);
select is(
  (select message.topic
     from lifecycle_provisioning_attempts attempt
     join audit_events event
       on event.aggregate_type
            = case when attempt.order_id is not null then 'order' else 'poc' end
      and event.aggregate_id = coalesce(attempt.order_id, attempt.poc_id)
      and event.event_type = 'order.provisioning_requested'
     join outbox_messages message on message.event_id = event.id
    where attempt.id = 'd3820000-0000-4000-8000-000000000002'
    order by event.occurred_at desc
    limit 1),
  'lifecycle.order.provisioning_requested',
  'an order attempt finds the order-scoped dispatch it was delivered from'
);

-- A plan assertion, not a timing one: sequential scans are disabled so the
-- shape is judged on whether the planner can bind aggregate_type at all. On the
-- unbound join the leading column is free and no such index condition exists at
-- any row count, because PostgreSQL 17 has no index skip scan.
create temporary table dispatch_plan (line text);
set local enable_seqscan = off;
do $$
declare plan_line text;
begin
  for plan_line in execute $q$
    explain (costs off)
    select message.id::text, message.topic, message.payload
      from public.lifecycle_provisioning_attempts attempt
      join public.audit_events event
        on event.aggregate_type
             = case when attempt.order_id is not null then 'order' else 'poc' end
       and event.aggregate_id = coalesce(attempt.order_id, attempt.poc_id)
       and event.event_type = 'order.provisioning_requested'
      join public.outbox_messages message on message.event_id = event.id
     where attempt.id = 'd3820000-0000-4000-8000-000000000001'::uuid
     order by event.occurred_at desc
     limit 1
  $q$ loop
    insert into dispatch_plan values (plan_line);
  end loop;
end $$;
reset enable_seqscan;
select ok(
  exists (
    select 1 from dispatch_plan
    where line like '%audit_aggregate_version_unique%'
  )
  and exists (
    select 1 from dispatch_plan
    where line like '%Index Cond:%' and line like '%aggregate_type%'
  ),
  'the dispatch lookup binds aggregate_type as the leading index column'
);

select * from finish();
rollback;
