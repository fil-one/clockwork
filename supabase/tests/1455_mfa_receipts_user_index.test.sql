begin;
select plan(4);
set local search_path = public, extensions;

-- The team page reads each member's latest receipt by WorkOS user. The user
-- leads; verified_at follows newest first.
select has_index(
  'public', 'experience_mfa_receipts', 'experience_mfa_receipt_user_idx',
  array['workos_user_id', 'verified_at']::name[],
  'MFA receipts are reachable by user without a scan'
);
select ok(
  (select indexdef from pg_indexes
    where schemaname = 'public'
      and indexname = 'experience_mfa_receipt_user_idx')
    like '%(workos_user_id, verified_at DESC)',
  'the user index sorts the newest receipt first'
);
-- A concurrent build that failed part-way leaves an index the planner ignores.
select ok(
  (select indisvalid from pg_index
    where indexrelid = 'public.experience_mfa_receipt_user_idx'::regclass),
  'the user index is valid'
);

create temp table receipt_plan (line text) on commit drop;
set local enable_seqscan = off;
do $$
declare
  plan_line text;
begin
  for plan_line in execute $q$
    explain (costs off)
    select max(verified_at) from public.experience_mfa_receipts
     where workos_user_id = 'user_01TEAMPAGE'
  $q$ loop
    insert into receipt_plan values (plan_line);
  end loop;
end $$;
reset enable_seqscan;
select ok(
  exists (
    select 1 from receipt_plan
    where line like '%experience_mfa_receipt_user_idx%'
  ),
  'the latest-receipt lookup reads through the user index'
);

select * from finish();
rollback;
