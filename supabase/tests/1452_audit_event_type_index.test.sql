begin;
select plan(4);
set local search_path = public, extensions;

-- The owner console security feed filters on event_type and orders by
-- occurred_at desc, id desc. The type leads; time and id follow in feed order.
select has_index(
  'public', 'audit_events', 'audit_event_type_timeline_idx',
  array['event_type', 'occurred_at', 'id']::name[],
  'audit events are reachable by type without a scan'
);
select ok(
  (select indexdef from pg_indexes
    where schemaname = 'public'
      and indexname = 'audit_event_type_timeline_idx')
    like '%(event_type, occurred_at DESC, id DESC)',
  'the type index sorts newest first with id as the tie-breaker'
);
-- A concurrent build that failed part-way leaves an index the planner ignores.
select ok(
  (select indisvalid from pg_index
    where indexrelid = 'public.audit_event_type_timeline_idx'::regclass),
  'the type index is valid'
);

create temp table feed_plan (line text) on commit drop;
set local enable_seqscan = off;
do $$
declare
  plan_line text;
begin
  for plan_line in execute $q$
    explain (costs off)
    select id from public.audit_events
     where event_type in ('staff.invited', 'staff.deactivated')
     order by occurred_at desc, id desc
     limit 50
  $q$ loop
    insert into feed_plan values (plan_line);
  end loop;
end $$;
reset enable_seqscan;
select ok(
  exists (
    select 1 from feed_plan
    where line like '%audit_event_type_timeline_idx%'
  ),
  'the security feed reads through the type index'
);

select * from finish();
rollback;
