begin;
select plan(76);

select volatility_is(
  'public',
  'app_context_is_valid',
  array[]::text[],
  'stable',
  'authorization context validation is correctly declared stable'
);

select ok(
  not public.app_context_is_valid(),
  'authorization context validation fails closed without signed context'
);

select ok(
  (select array_to_string(proconfig, ',') like
      '%search_path=pg_catalog, public, private, extensions%'
   from pg_proc
   where oid = 'public.app_context_is_valid()'::regprocedure),
  'authorization context validation uses a trusted pg_catalog-first search path'
);

select has_column(
  'public',
  'experience_portal_projections',
  'source_aggregate_version',
  'portal projections retain the authoritative source aggregate version'
);

select has_column(
  'public',
  'experience_projection_action_requests',
  'mfa_verified',
  'portal commands retain request-time MFA assurance'
);

select has_column(
  'public',
  'experience_projection_action_requests',
  'recent_authentication_verified',
  'portal commands retain request-time recent-auth assurance'
);

select ok(
  (select array_to_string(proconfig, ',') like '%search_path=pg_catalog, public%'
   from pg_proc
   where oid = 'public.validate_experience_projection_action()'::regprocedure),
  'projection action validation uses a trusted pg_catalog-first search path'
);

select ok(
  not exists (
    select 1
    from pg_proc procedure,
         aclexplode(coalesce(
           procedure.proacl,
           acldefault('f', procedure.proowner)
         )) privilege
    where procedure.oid =
      'public.validate_experience_projection_action()'::regprocedure
      and privilege.grantee = 0
      and privilege.privilege_type = 'EXECUTE'
  ),
  'projection action validation is not directly executable by PUBLIC'
);

select ok(
  (select array_to_string(proconfig, ',') like '%search_path=pg_catalog, public%'
   from pg_proc
   where oid = 'public.append_experience_projection_action_event()'::regprocedure),
  'projection action audit append uses a trusted pg_catalog-first search path'
);

select ok(
  (select position('impersonatedAccountId' in pg_get_functiondef(oid)) > 0
      and position('effectiveAccountId' in pg_get_functiondef(oid)) = 0
   from pg_proc
   where oid = 'public.append_experience_projection_action_event()'::regprocedure),
  'queued assisted-action audit actors use only the strict shared actor keys'
);

select has_column(
  'public',
  'experience_projection_action_requests',
  'result_code',
  'portal action requests retain the terminal result code'
);

select has_column(
  'public',
  'experience_projection_action_requests',
  'row_version',
  'portal action requests have an optimistic row version'
);

select has_table(
  'public',
  'experience_projection_action_claims',
  'portal action claims are persisted separately from immutable requests'
);

select has_table(
  'public',
  'experience_projection_materialization_receipts',
  'projection materialization receipts are persisted'
);

select ok(
  (select count(*) = 5
     from pg_constraint
    where conrelid = 'public.experience_projection_materialization_receipts'::regclass
      and conname in (
        'experience_projection_materialization_event_type_check',
        'experience_projection_materialization_aggregate_type_check',
        'experience_projection_materialization_aggregate_version_check',
        'experience_projection_materialization_source_hash_check',
        'experience_projection_materialization_projection_count_check'
      )
      and contype = 'c'),
  'materialization receipt checks retain their canonical Drizzle names'
);

select col_is_pk(
  'public',
  'experience_projection_action_claims',
  'action_request_id',
  'an action request has at most one recoverable claim record'
);

select col_is_unique(
  'public',
  'experience_projection_materialization_receipts',
  'event_id',
  'an authoritative event is materialized at most once'
);

select has_function(
  'public',
  'uuid_v7',
  array[]::name[],
  'the canonical database UUIDv7 generator exists'
);

select volatility_is(
  'public',
  'uuid_v7',
  array[]::text[],
  'volatile',
  'UUIDv7 generation is correctly declared volatile'
);

select ok(
  (select array_to_string(proconfig, ',') like '%search_path=pg_catalog, extensions%'
   from pg_proc
   where oid = 'public.uuid_v7()'::regprocedure),
  'UUIDv7 generation has a constrained trusted search path'
);

select ok(
  has_function_privilege('clockwork_runtime', 'public.uuid_v7()', 'EXECUTE')
    and has_function_privilege('clockwork_service', 'public.uuid_v7()', 'EXECUTE')
    and not has_function_privilege('anon', 'public.uuid_v7()', 'EXECUTE'),
  'UUIDv7 execute grants are limited to database runtime roles'
);

select ok(
  public.uuid_v7()::text ~
    '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
  'database-generated identifiers carry the UUIDv7 version nibble'
);

create temporary table uuid_v7_timestamp_sample as
select clock_timestamp() as observed_before,
       public.uuid_v7() as id,
       clock_timestamp() as observed_after;
select ok(
  (select
    (('x' || substring(replace(id::text, '-', '') from 1 for 12))::bit(48)::bigint)
      between floor(extract(epoch from observed_before) * 1000)::bigint
          and floor(extract(epoch from observed_after) * 1000)::bigint
   from uuid_v7_timestamp_sample),
  'database UUIDv7 encodes its observed Unix timestamp in milliseconds'
);

create temporary table uuid_v7_same_tick as
select replace(public.uuid_v7()::text, '-', '') as compact
from generate_series(1, 2048);
select ok(
  exists (
    select 1 from uuid_v7_same_tick
    group by substring(compact from 1 for 12)
    having count(*) > 1
  ),
  'database UUIDv7 sampling exercises more than one value in the same millisecond'
);
select ok(
  not exists (
    select 1 from uuid_v7_same_tick
    group by substring(compact from 1 for 12)
    having count(*) > 1
       and count(distinct substring(compact from 17 for 16)) <> count(*)
  ),
  'same-millisecond database UUIDv7 values retain independent random tails'
);

select is(
  (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and column_name = 'id'
      and column_default is not null
      and column_default <> 'uuid_v7()'
  ),
  0::bigint,
  'every defaulted public table identifier uses UUIDv7'
);

select is(
  (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and data_type = 'uuid'
      and column_default like '%gen_random_uuid()%'
      and column_name not in ('lock_token', 'claim_token', 'lease_token')
  ),
  0::bigint,
  'no persisted UUID default bypasses the UUIDv7 generator'
);

select is(
  (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and data_type = 'uuid'
      and column_default is not null
      and column_default not in ('uuid_v7()', 'gen_random_uuid()')
  ),
  0::bigint,
  'every public UUID default is an approved persisted-ID or fencing-token generator'
);

create temporary table representative_uuid_v7_insert (id uuid not null);
with inserted as (
  insert into public.audit_events (
    aggregate_type, aggregate_id, aggregate_version, event_type, event_version,
    actor, occurred_at, request_id, after, metadata
  ) values (
    'account', '10000000-0000-4000-8000-000000000001'::uuid, 991300,
    'test.uuid_v7.representative_insert', 1,
    '{"kind":"system","id":"pgtap-uuid-v7"}'::jsonb,
    clock_timestamp(), 'pgtap-uuid-v7-representative', '{}'::jsonb, '{}'::jsonb
  ) returning id
)
insert into representative_uuid_v7_insert select id from inserted;
select ok(
  (select id::text ~
    '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   from representative_uuid_v7_insert),
  'a representative persisted audit insert receives a UUIDv7 identifier'
);

create temporary table uuid_v7_ordering (
  sequence integer generated always as identity,
  id uuid not null default public.uuid_v7()
);
insert into uuid_v7_ordering default values;
select pg_sleep(0.002);
insert into uuid_v7_ordering default values;
select ok(
  (select bool_and(earlier.id < later.id)
   from uuid_v7_ordering earlier
   join uuid_v7_ordering later on later.sequence = earlier.sequence + 1),
  'database UUIDv7 values preserve generation-time ordering'
);

select has_column(
  'public',
  'experience_document_render_requests',
  'source_version',
  'render requests persist their authoritative source version'
);

select ok(
  (select is_nullable = 'YES'
   from information_schema.columns
   where table_schema = 'public'
     and table_name = 'experience_document_render_requests'
     and column_name = 'account_id'),
  'internal render requests support an explicitly accountless scope'
);

select has_table(
  'public',
  'core_invoice_document_snapshots',
  'invoice document lines have an immutable source snapshot table'
);

select col_is_pk(
  'public',
  'core_invoice_document_snapshots',
  'invoice_id',
  'each invoice has at most one immutable document snapshot'
);

select has_trigger(
  'public',
  'core_invoice_document_snapshots',
  'core_invoice_document_snapshot_immutable',
  'invoice document snapshots reject updates and deletes'
);

select has_trigger(
  'public',
  'core_invoice_document_snapshots',
  'core_invoice_document_snapshot_validate',
  'invoice snapshots validate authoritative bindings and canonical source hashes'
);

select ok(
  exists (
    select 1
    from pg_class index_relation
    join pg_index definition on definition.indexrelid = index_relation.oid
    where index_relation.relname = 'core_invoice_document_snapshot_source_unique'
      and definition.indrelid = 'public.core_invoice_document_snapshots'::regclass
      and definition.indisunique
      and not definition.indisprimary
  ),
  'invoice snapshot source hashes use the canonical named unique index'
);

select ok(
  (select count(*) = 5
     from pg_constraint
    where conrelid = 'public.core_invoice_document_snapshots'::regclass
      and conname in (
        'core_invoice_document_snapshot_currency_check',
        'core_invoice_document_snapshot_lines_check',
        'core_invoice_document_snapshot_amounts_check',
        'core_invoice_document_snapshot_hash_check',
        'core_invoice_document_snapshot_version_check'
      )
      and contype = 'c'),
  'invoice snapshot checks retain their canonical Drizzle names'
);

select ok(
  (select count(*) = 3 and bool_and(confupdtype = 'a' and confdeltype = 'a')
     from pg_constraint
    where conrelid = 'public.core_invoice_document_snapshots'::regclass
      and conname in (
        'core_invoice_document_snapshots_invoice_id_invoices_id_fk',
        'core_invoice_document_snapshots_order_id_orders_id_fk',
        'core_invoice_document_snapshots_quote_id_quotes_id_fk'
      )
      and contype = 'f'),
  'invoice snapshot foreign keys retain canonical names and no-action behavior'
);

select is(
  (select count(*) from public.core_invoice_document_snapshots),
  (select count(*) from public.invoices),
  'every populated invoice has authoritative document source evidence'
);

select ok(
  not exists (
    select 1 from public.core_invoice_document_snapshots
    where source_hash !~ '^[a-f0-9]{64}$'
  ),
  'seeded and backfilled invoice snapshot hashes are canonical SHA-256 values'
);

select ok(
  has_table_privilege('clockwork_runtime', 'public.core_invoice_document_snapshots', 'SELECT')
    and not has_table_privilege('clockwork_runtime', 'public.core_invoice_document_snapshots', 'INSERT')
    and has_table_privilege('clockwork_service', 'public.core_invoice_document_snapshots', 'SELECT')
    and has_table_privilege('clockwork_service', 'public.core_invoice_document_snapshots', 'INSERT')
    and not has_table_privilege('clockwork_service', 'public.core_invoice_document_snapshots', 'UPDATE')
    and not has_table_privilege('clockwork_service', 'public.core_invoice_document_snapshots', 'DELETE')
    and not has_table_privilege('anon', 'public.core_invoice_document_snapshots', 'SELECT'),
  'invoice snapshot grants are least privilege and immutable'
);

insert into public.invoices (
  id, order_id, account_id, currency, amount_minor, po_number, status, due_at
) values
('90900000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','USD',180000,'PO-DEMO-001','draft','2026-09-30T16:00:00Z'),
('90900000-0000-4000-8000-000000000002','80000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','USD',180000,'PO-DEMO-001','draft','2026-09-30T16:00:00Z'),
('90900000-0000-4000-8000-000000000003','80000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','USD',180000,'PO-DEMO-001','draft','2026-09-30T16:00:00Z'),
('90900000-0000-4000-8000-000000000004','80000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','USD',180000,'PO-DEMO-001','draft','2026-09-30T16:00:00Z'),
('90900000-0000-4000-8000-000000000005','80000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','USD',180000,'PO-DEMO-001','draft','2026-09-30T16:00:00Z'),
('90900000-0000-4000-8000-000000000006','80000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','USD',180000,'PO-DEMO-001','draft','2026-09-30T16:00:00Z'),
('90900000-0000-4000-8000-000000000007','80000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','USD',180000,'PO-DEMO-001','draft','2026-09-30T16:00:00Z'),
('90900000-0000-4000-8000-000000000008','80000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','USD',180000,'PO-DEMO-001','draft','2026-09-30T16:00:00Z'),
('90900000-0000-4000-8000-000000000009','80000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','USD',180000,'PO-DEMO-001','draft','2026-09-30T16:00:00Z'),
('90900000-0000-4000-8000-000000000010','80000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','USD',180000,'PO-DEMO-001','draft','2026-09-30T16:00:00Z'),
('90900000-0000-4000-8000-000000000011','80000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','USD',180000,'PO-DEMO-001','draft','2026-09-30T16:00:00Z');

select throws_ok($$
  insert into public.core_invoice_document_snapshots values (
    '90900000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001',
    '70000000-0000-4000-8000-000000000001','CAD','[{"id":"line"}]',180000,0,180000,
    repeat('1',64),'quote:fixture:r1',now()
  )
$$, '23514', null, 'invoice snapshots reject unsupported currency');

select throws_ok($$
  insert into public.core_invoice_document_snapshots values (
    '90900000-0000-4000-8000-000000000002','80000000-0000-4000-8000-000000000001',
    '70000000-0000-4000-8000-000000000001','USD','[]',180000,0,180000,
    repeat('2',64),'quote:fixture:r1',now()
  )
$$, '23514', null, 'invoice snapshots reject an empty line inventory');

select throws_ok($$
  insert into public.core_invoice_document_snapshots values (
    '90900000-0000-4000-8000-000000000003','80000000-0000-4000-8000-000000000001',
    '70000000-0000-4000-8000-000000000001','USD','[{"id":"line"}]',180000,1,180000,
    repeat('3',64),'quote:fixture:r1',now()
  )
$$, '23514', null, 'invoice snapshots reject inconsistent exact totals');

select throws_ok($$
  insert into public.core_invoice_document_snapshots values (
    '90900000-0000-4000-8000-000000000004','80000000-0000-4000-8000-000000000001',
    '70000000-0000-4000-8000-000000000001','USD','[{"id":"81000000-0000-4000-8000-000000000001","description":"LOCKED-STORAGE-TB","quantity":"1","unitPrice":{"currency":"USD","minorUnits":"15000"},"amount":{"currency":"USD","minorUnits":"180000"}}]',180000,0,180000,
    repeat('d',64),'quote:70000000-0000-4000-8000-000000000001:r1',now()
  )
$$, '23514', 'invoice snapshot canonical source hash mismatch',
  'invoice snapshots reject a false canonical source hash');

select throws_ok($$
  insert into public.core_invoice_document_snapshots values (
    '90900000-0000-4000-8000-000000000005','80000000-0000-4000-8000-000000000001',
    '70000000-0000-4000-8000-000000000001','USD','[{"id":"line"}]',180000,0,180000,
    repeat('5',64),'',now()
  )
$$, '23514', null, 'invoice snapshots reject an empty source version');

select throws_ok($$
  insert into public.core_invoice_document_snapshots values (
    '90900000-0000-4000-8000-000000000006','80000000-0000-4000-8000-000000000001',
    '70000000-0000-4000-8000-000000000001','USD','[{"id":"81000000-0000-4000-8000-000000000001","description":"LOCKED-STORAGE-TB","quantity":"1","unitPrice":{"currency":"USD","minorUnits":"15000"},"amount":{"currency":"USD","minorUnits":"180000"}}]',180000,0,180000,
    '491eb3ce605fe8f01771d4d29b6f856ff53d227967819305237a3dad1a6a193a',
    'quote:70000000-0000-4000-8000-000000000001:r1',now()
  )
$$, '23514', 'invoice snapshot canonical source hash mismatch',
  'an invoice snapshot cannot replay another invoice source binding');

select throws_ok($$
  insert into public.core_invoice_document_snapshots values (
    '90900000-0000-4000-8000-000000000007','80000000-0000-4000-8000-000000000002',
    '70000000-0000-4000-8000-000000000001','USD','[{"id":"line","description":"Line","quantity":"1","unitPrice":{"currency":"USD","minorUnits":"180000"},"amount":{"currency":"USD","minorUnits":"180000"}}]',180000,0,180000,
    repeat('7',64),'quote:70000000-0000-4000-8000-000000000001:r1',now()
  )
$$, '23514', 'invoice snapshot authoritative binding mismatch',
  'invoice snapshot order must match its invoice');

select throws_ok($$
  insert into public.core_invoice_document_snapshots values (
    '90900000-0000-4000-8000-000000000008','80000000-0000-4000-8000-000000000001',
    '70000000-0000-4000-8000-000000000002','USD','[{"id":"line","description":"Line","quantity":"1","unitPrice":{"currency":"USD","minorUnits":"180000"},"amount":{"currency":"USD","minorUnits":"180000"}}]',180000,0,180000,
    repeat('8',64),'quote:70000000-0000-4000-8000-000000000001:r1',now()
  )
$$, '23514', 'invoice snapshot authoritative binding mismatch',
  'invoice snapshot quote must match its order');

select throws_ok($$
  insert into public.core_invoice_document_snapshots values (
    '90900000-0000-4000-8000-000000000009','80000000-0000-4000-8000-000000000001',
    '70000000-0000-4000-8000-000000000001','USD','[{"id":"line","description":"Line","quantity":"1","unitPrice":{"currency":"EUR","minorUnits":"180000"},"amount":{"currency":"USD","minorUnits":"180000"}}]',180000,0,180000,
    repeat('9',64),'quote:70000000-0000-4000-8000-000000000001:r1',now()
  )
$$, '23514', 'invoice snapshot immutable line binding mismatch',
  'invoice snapshot line currencies must match the snapshot currency');

select throws_ok($$
  insert into public.core_invoice_document_snapshots values (
    '90900000-0000-4000-8000-000000000010','80000000-0000-4000-8000-000000000001',
    '70000000-0000-4000-8000-000000000001','USD','[{"id":"line","description":"Line","quantity":"1","unitPrice":{"currency":"USD","minorUnits":"180000"},"amount":{"currency":"USD","minorUnits":"179999"}}]',180000,0,180000,
    repeat('a',64),'quote:70000000-0000-4000-8000-000000000001:r1',now()
  )
$$, '23514', 'invoice snapshot immutable line binding mismatch',
  'invoice snapshot line amounts must sum to the exact subtotal');

select throws_ok($$
  insert into public.core_invoice_document_snapshots values (
    '90900000-0000-4000-8000-000000000011','80000000-0000-4000-8000-000000000001',
    '70000000-0000-4000-8000-000000000001','USD','[{"id":"invented-line","description":"Invented service","quantity":"1","unitPrice":{"currency":"USD","minorUnits":"180000"},"amount":{"currency":"USD","minorUnits":"180000"}}]',180000,0,180000,
    'c80bdebcd0f0443f00198150fdc9f084c6eff1a129eae53ac4f93cff59f9a706',
    'quote:70000000-0000-4000-8000-000000000001:r1',now()
  )
$$, '23514', 'invoice snapshot immutable line binding mismatch',
  'a correctly hashed but invented invoice presentation line is rejected');

select throws_ok($$
  update public.core_invoice_document_snapshots
  set source_version = 'tampered'
  where invoice_id = '90000000-0000-4000-8000-000000000001'
$$, '55000', 'invoice document snapshots are immutable',
  'invoice document snapshots reject mutation');

select throws_ok($$
  delete from public.core_invoice_document_snapshots
  where invoice_id = '90000000-0000-4000-8000-000000000001'
$$, '55000', 'invoice document snapshots are immutable',
  'invoice document snapshots reject deletion');

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.pocs'::regclass
      and conname = 'pocs_success_test_targets_check'
      and contype = 'c'
  ),
  'POC source evidence requires an explicit success-test target'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.lifecycle_offboarding_plans'::regclass
      and conname = 'lifecycle_offboarding_exclusion_reasons_check'
      and contype = 'c'
  ),
  'offboarding source evidence requires an exact retention reason'
);

select throws_ok(
  $$update public.pocs
    set success_tests = '[]'::jsonb
    where id = '85000000-0000-4000-8000-000000000001'$$,
  '23514', null,
  'POCs reject an empty success-test inventory'
);

select throws_ok(
  $$update public.pocs
    set success_tests = '[{"id":"missing","description":"Missing target","passedAt":null}]'::jsonb
    where id = '85000000-0000-4000-8000-000000000001'$$,
  '23514', null,
  'POC success tests reject a missing target'
);

select throws_ok(
  $$update public.pocs
    set success_tests = '[{"id":"blank","description":"Blank target","target":"   ","passedAt":null}]'::jsonb
    where id = '85000000-0000-4000-8000-000000000001'$$,
  '23514', null,
  'POC success-test targets reject whitespace-only strings'
);

select throws_ok(
  $$update public.pocs
    set success_tests = '[{"id":"numeric","description":"Numeric target","target":100,"passedAt":null}]'::jsonb
    where id = '85000000-0000-4000-8000-000000000001'$$,
  '23514', null,
  'POC success-test targets reject non-string values'
);

select throws_ok(
  $$update public.pocs
    set success_tests = '[{"id":"null","description":"Null target","target":null,"passedAt":null}]'::jsonb
    where id = '85000000-0000-4000-8000-000000000001'$$,
  '23514', null,
  'POC success-test targets reject JSON null'
);

select throws_ok(
  $$update public.lifecycle_offboarding_plans
    set plan = plan - 'lockedExclusions', row_version = row_version + 1
    where termination_id = '93600000-0000-4000-8000-000000000001'$$,
  '23514', null,
  'offboarding plans reject a missing locked-exclusion inventory'
);

select throws_ok(
  $$update public.lifecycle_offboarding_plans
    set plan = jsonb_set(
      plan,
      '{lockedExclusions,0,reason}',
      '"expired_policy"'::jsonb
    ), row_version = row_version + 1
    where termination_id = '93600000-0000-4000-8000-000000000001'$$,
  '23514', null,
  'offboarding exclusions reject an inexact retention reason'
);

select throws_ok(
  $$update public.lifecycle_offboarding_plans
    set plan = plan #- '{lockedExclusions,0,legalHold}',
        row_version = row_version + 1
    where termination_id = '93600000-0000-4000-8000-000000000001'$$,
  '23514', null,
  'offboarding exclusions require an explicit legal-hold boolean'
);

select throws_ok(
  $$update public.lifecycle_offboarding_plans
    set plan = jsonb_set(
      plan,
      '{lockedExclusions,0,legalHold}',
      '"false"'::jsonb
    ), row_version = row_version + 1
    where termination_id = '93600000-0000-4000-8000-000000000001'$$,
  '23514', null,
  'offboarding exclusions reject a non-boolean legal-hold value'
);

select throws_ok(
  $$update public.lifecycle_offboarding_plans
    set plan = jsonb_set(
      plan,
      '{lockedExclusions,0,legalHold}',
      'true'::jsonb
    ), row_version = row_version + 1
    where termination_id = '93600000-0000-4000-8000-000000000001'$$,
  '23514', null,
  'offboarding exclusion reason must match the legal-hold boolean'
);

insert into public.experience_document_render_requests (
  id, account_id, audience, audience_account_id, subject_type, subject_id,
  document_kind, input, source_hash, source_version, requested_by,
  retain_until, status, failure_code, row_version
) values
('90a00000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','customer','10000000-0000-4000-8000-000000000001','quote','70000000-0000-4000-8000-000000000001','direct_quote','{}',repeat('b',64),'quote:1','20000000-0000-4000-8000-000000000002','2033-07-31T16:00:00Z','failed','RENDER_FAILED',4),
('90a00000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','customer','10000000-0000-4000-8000-000000000001','quote','70000000-0000-4000-8000-000000000001','order_form','{}',repeat('c',64),'quote:1','20000000-0000-4000-8000-000000000002','2033-07-31T16:00:00Z','failed','RENDER_FAILED',4);

select lives_ok($$
  update public.experience_document_render_requests
  set status = 'rendering', failure_code = null,
      updated_at = now(), row_version = row_version + 1
  where id = '90a00000-0000-4000-8000-000000000001'
$$, 'a failed render request supports an explicit versioned redrive');

select is(
  (select failure_code from public.experience_document_render_requests
   where id = '90a00000-0000-4000-8000-000000000001'),
  null::text,
  'the redrive transition clears the prior downstream failure'
);

select throws_ok($$
  update public.experience_document_render_requests
  set status = 'pending', row_version = row_version + 1
  where id = '90a00000-0000-4000-8000-000000000001'
$$, '23514', 'invalid render request transition',
  'a rendering request cannot be rewritten to pending');

select throws_ok($$
  update public.experience_document_render_requests
  set status = 'stored', failure_code = null, row_version = row_version + 1
  where id = '90a00000-0000-4000-8000-000000000002'
$$, '23514', 'invalid render request transition',
  'a failed request cannot bypass rendering and become stored');

set local session_replication_role = replica;
select lives_ok($$
  insert into public.experience_projection_action_requests (
    id, projection_id, audience_account_id, subject_account_id,
    aggregate_type, aggregate_id, command_resource, action, expected_version,
    actor_user_id, effective_account_id, idempotency_key, request_payload,
    status, result_reference, result_code, authoritative_version,
    command_replayed, completed_at, audit_event_id, outbox_message_id
  ) values
  (
    '90b00000-0000-4000-8000-000000000001',
    '90b00000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'account','10000000-0000-4000-8000-000000000001',
    'core:accounts','update',1,
    '20000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    'legacy-terminal-null-proof-0001','{}','applied',
    'legacy-action:proof:applied','LEGACY_PORTAL_ACTION_APPLIED',null,null,
    now(),'90b00000-0000-4000-8000-000000000003',
    '90b00000-0000-4000-8000-000000000004'
  ),
  (
    '90b00000-0000-4000-8000-000000000008',
    '90b00000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'account','10000000-0000-4000-8000-000000000001',
    'core:accounts','update',1,
    '20000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    'legacy-terminal-null-proof-0003','{}','rejected',
    'legacy-action:proof:rejected','LEGACY_PORTAL_ACTION_REJECTED',null,null,
    now(),'90b00000-0000-4000-8000-000000000009',
    '90b00000-0000-4000-8000-00000000000a'
  ),
  (
    '90b00000-0000-4000-8000-00000000000b',
    '90b00000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'account','10000000-0000-4000-8000-000000000001',
    'core:accounts','update',1,
    '20000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    'legacy-terminal-null-proof-0004','{}','failed',
    'legacy-action:proof:failed','LEGACY_PORTAL_ACTION_FAILED',null,null,
    now(),'90b00000-0000-4000-8000-00000000000c',
    '90b00000-0000-4000-8000-00000000000d'
  ),
  (
    '90b00000-0000-4000-8000-00000000000e',
    '90b00000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'account','10000000-0000-4000-8000-000000000001',
    'core:accounts','update',1,
    '20000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    'legacy-terminal-null-proof-0005','{}','failed',
    'legacy-action:proof:unverified',
    'LEGACY_PROJECTION_VERSION_UNVERIFIED',null,null,
    now(),'90b00000-0000-4000-8000-00000000000f',
    '90b00000-0000-4000-8000-000000000010'
  )
$$, 'all exact migration terminal codes preserve unknown replay truth');

select throws_ok($$
  insert into public.experience_projection_action_requests (
    id, projection_id, audience_account_id, subject_account_id,
    aggregate_type, aggregate_id, command_resource, action, expected_version,
    actor_user_id, effective_account_id, idempotency_key, request_payload,
    status, result_reference, result_code, authoritative_version,
    command_replayed, completed_at, audit_event_id, outbox_message_id
  ) values (
    '90b00000-0000-4000-8000-000000000005',
    '90b00000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'account','10000000-0000-4000-8000-000000000001',
    'core:accounts','update',1,
    '20000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    'legacy-terminal-null-proof-0002','{}','applied',
    'legacy-action:proof:invalid','LEGACYX_PORTAL_ACTION_APPLIED',null,null,
    now(),'90b00000-0000-4000-8000-000000000006',
    '90b00000-0000-4000-8000-000000000007'
  )
$$, '23514', null,
  'a non-legacy result code cannot preserve null replay truth');

select throws_ok($$
  insert into public.experience_projection_action_requests (
    id, projection_id, audience_account_id, subject_account_id,
    aggregate_type, aggregate_id, command_resource, action, expected_version,
    actor_user_id, effective_account_id, idempotency_key, request_payload,
    status, result_reference, result_code, authoritative_version,
    command_replayed, completed_at, audit_event_id, outbox_message_id
  ) values (
    '90b00000-0000-4000-8000-000000000011',
    '90b00000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'account','10000000-0000-4000-8000-000000000001',
    'core:accounts','update',1,
    '20000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    'legacy-terminal-null-proof-0006','{}','failed',
    'legacy-action:proof:fake','LEGACY_FAKE',null,null,
    now(),'90b00000-0000-4000-8000-000000000012',
    '90b00000-0000-4000-8000-000000000013'
  )
$$, '23514', null,
  'a caller-minted legacy code cannot preserve null replay truth');

select throws_ok($$
  insert into public.experience_projection_action_requests (
    id, projection_id, audience_account_id, subject_account_id,
    aggregate_type, aggregate_id, command_resource, action, expected_version,
    actor_user_id, effective_account_id, idempotency_key, request_payload,
    status, result_reference, result_code, authoritative_version,
    command_replayed, completed_at, audit_event_id, outbox_message_id
  ) values (
    '90b00000-0000-4000-8000-000000000014',
    '90b00000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'account','10000000-0000-4000-8000-000000000001',
    'core:accounts','update',1,
    '20000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    'legacy-terminal-null-proof-0007','{}','applied',
    'legacy-action:proof:mismatch','LEGACY_PORTAL_ACTION_FAILED',null,null,
    now(),'90b00000-0000-4000-8000-000000000015',
    '90b00000-0000-4000-8000-000000000016'
  )
$$, '23514', null,
  'an exact migration code must match its synthesized terminal status');
set local session_replication_role = origin;

select is(
  (select command_replayed
   from public.experience_projection_action_requests
   where id = '90b00000-0000-4000-8000-000000000001'),
  null::boolean,
  'legacy terminal command replay truth remains unknown for reconciliation'
);

select * from finish();
rollback;
