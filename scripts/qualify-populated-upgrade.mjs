import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const EXACT_NODE_VERSION = "v24.18.1";
const EXACT_PNPM_VERSION = "10.34.5";
const PRE_UPGRADE_VERSION = "001230";
const PROJECT_ID =
  process.env.CLOCKWORK_POPULATED_UPGRADE_PROJECT_ID ?? "clockwork-commerce";
const DATABASE_CONTAINER = `supabase_db_${PROJECT_ID}`;
const supabaseWorkdir = process.env.CLOCKWORK_POPULATED_UPGRADE_WORKDIR;
const PROJECTION_ID = "91390000-0000-4000-8000-000000000001";
const ACTION_ID = "91390000-0000-4000-8000-000000000002";
const TERMINAL_ACTION_ID = "91390000-0000-4000-8000-000000000003";
const TERMINAL_LEGACY_AUDIT_ID = "91390000-0000-4000-8000-000000000004";
const TERMINAL_LEGACY_OUTBOX_ID = "91390000-0000-4000-8000-000000000005";
const ACCOUNT_ID = "10000000-0000-4000-8000-000000000001";
const USER_ID = "20000000-0000-4000-8000-000000000002";
const AUDIT_EVENT_ID = "91390000-0000-4000-8000-000000000006";
const OUTBOX_MESSAGE_ID = "91390000-0000-4000-8000-000000000007";
// Measured on this migration against PRE_UPGRADE_VERSION: 001300 takes ACCESS
// EXCLUSIVE on every relation it rewrites, including the hot commerce tables,
// and never sets lock_timeout. Asserting the footprint keeps a later migration
// from widening it silently.
const LOCKED_COMMERCE_TABLES = [
  "accounts",
  "audit_events",
  "invoices",
  "orders",
  "outbox_messages",
  "payments",
  "quotes",
];
const ACCESS_EXCLUSIVE_RELATIONS = 140;
// pg_prove exits 0 when it finds nothing to run, so the drill floors what the
// canonical suite must actually execute. Floors, not equalities, so adding a
// pgTAP test does not fail the drill.
const CANONICAL_PGTAP_FILES = 22;
const CANONICAL_PGTAP_TESTS = 488;
const migrationPath = path.resolve(
  "supabase/migrations/001300_release_integrity.sql",
);
const migrationSql = readFileSync(migrationPath, "utf8");
const stages = [];

function run(command, args, options = {}) {
  const startedAt = Date.now();
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: 5 * 60 * 1000,
    ...options,
  });
  const durationMs = Date.now() - startedAt;
  const invocation = [command, ...args].join(" ");
  stages.push({ invocation, durationMs, exitCode: result.status });
  if (result.error) throw result.error;
  return { ...result, durationMs, invocation };
}

function requireSuccess(command, args, options = {}) {
  const result = run(command, args, options);
  if (result.status !== 0) {
    throw new Error(
      `${result.invocation} failed with exit ${result.status}\n${result.stdout ?? ""}${result.stderr ?? ""}`,
    );
  }
  return result;
}

function reset(version) {
  const args = ["exec", "supabase", "db", "reset", "--local"];
  if (version) args.push("--version", version);
  if (supabaseWorkdir) args.push("--workdir", supabaseWorkdir);
  const result = requireSuccess("pnpm", args);
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
}

function psql(sql, { expectFailure = false } = {}) {
  const result = run(
    "docker",
    [
      "exec",
      "-i",
      DATABASE_CONTAINER,
      "psql",
      "-X",
      "-A",
      "-t",
      "-q",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { input: sql },
  );
  if (!expectFailure && result.status !== 0) {
    throw new Error(
      `psql failed with exit ${result.status}\n${result.stdout ?? ""}${result.stderr ?? ""}`,
    );
  }
  return result;
}

function loadLegacyFixture(sourceUpdatedAt) {
  psql(`
begin;
set local session_replication_role = replica;
update public.accounts
set row_version = 7,
    updated_at = '2026-07-31 16:00:00.123456+00'
where id = '${ACCOUNT_ID}';
insert into public.experience_portal_projections (
  id, audience, audience_account_id, subject_account_id, channel, record_key,
  aggregate_type, aggregate_id, command_resource, payload, source_hash,
  source_updated_at, projected_at, row_version
) values (
  '${PROJECTION_ID}', 'customer', '${ACCOUNT_ID}', '${ACCOUNT_ID}',
  'dashboard', 'p0-39-upgrade', 'account', '${ACCOUNT_ID}', 'core:accounts',
  '{"allowedActions":["update"],"preserved":"legacy-payload"}', repeat('a', 64),
  '${sourceUpdatedAt}', '2026-07-31 16:00:01+00', 4
);
insert into public.audit_events (
  id, account_id, aggregate_type, aggregate_id, aggregate_version,
  event_type, event_version, actor, occurred_at, request_id, after, metadata
) values (
  '${AUDIT_EVENT_ID}', '${ACCOUNT_ID}',
  'experience_action_request', '${ACTION_ID}', 1,
  'experience.projection_action.queued', 1,
  '{"kind":"user","id":"${USER_ID}","effectiveAccountId":"${ACCOUNT_ID}"}',
  '2026-07-31 16:00:02+00', 'p0-39-legacy-action',
  '{"status":"queued"}', '{}'
);
insert into public.outbox_messages (id, event_id, topic, payload) values (
  '${OUTBOX_MESSAGE_ID}', '${AUDIT_EVENT_ID}',
  'experience.projection_action.queued', '{"legacy":true}'
);
insert into public.experience_projection_action_requests (
  id, projection_id, audience_account_id, subject_account_id,
  aggregate_type, aggregate_id, command_resource, action, expected_version,
  actor_user_id, effective_account_id, idempotency_key, request_payload, status,
  created_at, audit_event_id, outbox_message_id
) values (
  '${ACTION_ID}', '${PROJECTION_ID}', '${ACCOUNT_ID}', '${ACCOUNT_ID}',
  'account', '${ACCOUNT_ID}', 'core:accounts', 'update', 4, '${USER_ID}',
  '${ACCOUNT_ID}', 'p0-39-legacy-action-0001',
  '{"preserved":"request-payload"}', 'queued',
  '2026-07-31 16:00:02+00', '${AUDIT_EVENT_ID}', '${OUTBOX_MESSAGE_ID}'
);
insert into public.audit_events (
  id, account_id, aggregate_type, aggregate_id, aggregate_version,
  event_type, event_version, actor, occurred_at, request_id, after, metadata
) values (
  '${TERMINAL_LEGACY_AUDIT_ID}', '${ACCOUNT_ID}',
  'experience_action_request', '${TERMINAL_ACTION_ID}', 1,
  'experience.projection_action.queued', 1,
  '{"kind":"user","id":"${USER_ID}","effectiveAccountId":"${ACCOUNT_ID}","assistedSessionId":"legacy-invalid-actor"}',
  '2026-07-31 16:00:03+00', 'p0-39-legacy-terminal',
  '{"status":"queued"}', '{}'
);
insert into public.outbox_messages (id, event_id, topic, payload) values (
  '${TERMINAL_LEGACY_OUTBOX_ID}', '${TERMINAL_LEGACY_AUDIT_ID}',
  'experience.projection_action.queued', '{"legacy":true}'
);
insert into public.experience_projection_action_requests (
  id, projection_id, audience_account_id, subject_account_id,
  aggregate_type, aggregate_id, command_resource, action, expected_version,
  actor_user_id, effective_account_id, idempotency_key, request_payload, status,
  result_reference, created_at, completed_at, audit_event_id, outbox_message_id
) values (
  '${TERMINAL_ACTION_ID}', '${PROJECTION_ID}', '${ACCOUNT_ID}', '${ACCOUNT_ID}',
  'account', '${ACCOUNT_ID}', 'core:accounts', 'update', 4, '${USER_ID}',
  '${ACCOUNT_ID}', 'p0-39-legacy-terminal-0001',
  '{"preserved":"terminal-request-payload"}', 'applied',
  'legacy-applied-reference', '2026-07-31 16:00:03+00',
  '2026-07-31 16:00:04+00', '${TERMINAL_LEGACY_AUDIT_ID}',
  '${TERMINAL_LEGACY_OUTBOX_ID}'
);
commit;
`);
}

// A backend sees its own locks, so the footprint is read from inside the
// migration's own transaction: no second session, no sleep, nothing to race.
// psql -1 cannot do this because the transaction ends with the input, so the
// transaction is opened explicitly instead and psql still rolls it back on a
// failed statement under ON_ERROR_STOP.
const lockFootprintSql = `
select jsonb_build_object(
  'lockTimeout', current_setting('lock_timeout'),
  'accessExclusiveRelations', count(distinct held.relation) filter (
    where held.mode = 'AccessExclusiveLock'
  ),
  'accessExclusiveCommerceTables', coalesce(
    jsonb_agg(distinct locked.relname order by locked.relname) filter (
      where held.mode = 'AccessExclusiveLock'
        and locked.relname = any (array[${LOCKED_COMMERCE_TABLES.map((table) => `'${table}'`).join(", ")}])
    ), '[]'::jsonb
  )
)
from pg_locks held
join pg_class locked on locked.oid = held.relation
where held.pid = pg_backend_pid() and held.locktype = 'relation';
`;

function applyMigration({ expectFailure = false } = {}) {
  const result = psql(
    `begin;\n${migrationSql}\n${lockFootprintSql}\ncommit;\n`,
    {
      expectFailure,
    },
  );
  if (result.status !== 0) return { result };
  const emitted = result.stdout
    .split("\n")
    .filter((line) => line.trim() !== "");
  return { result, locks: JSON.parse(emitted.at(-1)) };
}

function queryJson(sql) {
  const result = psql(sql);
  const output = result.stdout.trim();
  assert.notEqual(output, "", "qualification query returned no rows");
  return JSON.parse(output);
}

// The drill only proves anything if the seed actually replayed against
// PRE_UPGRADE_VERSION and stopped there. amount_paid_minor arrives in
// 001340_invoice_partial_payments.sql, four migrations later, so its absence
// names the schema under test out loud instead of trusting the reset.
function assertPreUpgradeSchema() {
  const state = queryJson(`
select jsonb_build_object(
  'appliedVersion', (select max(version) from supabase_migrations.schema_migrations),
  'releaseMigrationRecorded', exists (
    select 1 from supabase_migrations.schema_migrations where version = '001300'
  ),
  'partialPaymentColumnExists', exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'invoices'
      and column_name = 'amount_paid_minor'
  ),
  'seededAccountCount', (select count(*) from public.accounts),
  'seededInvoiceCount', (select count(*) from public.invoices)
);
`);
  assert.deepEqual(
    {
      appliedVersion: state.appliedVersion,
      releaseMigrationRecorded: state.releaseMigrationRecorded,
      partialPaymentColumnExists: state.partialPaymentColumnExists,
    },
    {
      appliedVersion: PRE_UPGRADE_VERSION,
      releaseMigrationRecorded: false,
      partialPaymentColumnExists: false,
    },
  );
  assert.ok(
    state.seededAccountCount > 0 && state.seededInvoiceCount > 0,
    `populated upgrade needs a seeded database, saw ${JSON.stringify(state)}`,
  );
}

// P0-39 claims this upgrade is safe on a populated database; elapsed wall-clock
// on a seven-row fixture does not say that. Record what the transaction holds
// so a widened blast radius has to be a deliberate edit here.
function assertUpgradeLockFootprint(locks) {
  assert.deepEqual(locks, {
    lockTimeout: "0",
    accessExclusiveRelations: ACCESS_EXCLUSIVE_RELATIONS,
    accessExclusiveCommerceTables: LOCKED_COMMERCE_TABLES,
  });
}

// pg_prove reports NOTESTS and exits 0 on an empty or unmounted tests
// directory, which would otherwise be accepted as a passing stage.
function assertCanonicalPgTap(output) {
  const counts = output.match(/Files=(\d+),\s*Tests=(\d+)/);
  assert.ok(counts, `pg_prove printed no Files=/Tests= summary\n${output}`);
  const outcome = output.match(/^Result:\s*(\w+)/m);
  assert.ok(outcome, `pg_prove printed no Result line\n${output}`);
  assert.equal(outcome[1], "PASS", "canonical pgTAP suite did not report PASS");
  const files = Number(counts[1]);
  const tests = Number(counts[2]);
  assert.ok(
    files >= CANONICAL_PGTAP_FILES,
    `canonical pgTAP ran ${files} files, expected at least ${CANONICAL_PGTAP_FILES}`,
  );
  assert.ok(
    tests >= CANONICAL_PGTAP_TESTS,
    `canonical pgTAP ran ${tests} assertions, expected at least ${CANONICAL_PGTAP_TESTS}`,
  );
  return { files, tests };
}

function assertMatchedUpgrade() {
  const projection = queryJson(`
select jsonb_build_object(
  'sourceAggregateVersion', source_aggregate_version,
  'rowVersion', row_version,
  'commandResource', command_resource,
  'allowedActions', payload->'allowedActions',
  'preserved', payload->>'preserved'
)
from public.experience_portal_projections where id = '${PROJECTION_ID}';
`);
  assert.deepEqual(projection, {
    sourceAggregateVersion: 7,
    rowVersion: 5,
    commandResource: null,
    allowedActions: [],
    preserved: "legacy-payload",
  });

  const action = queryJson(`
select jsonb_build_object(
  'status', status,
  'resultReference', result_reference,
  'resultCode', result_code,
  'commandReplayed', command_replayed,
  'completed', completed_at is not null,
  'expectedVersion', expected_version,
  'mfaVerified', mfa_verified,
  'recentAuthenticationVerified', recent_authentication_verified,
  'rowVersion', row_version,
  'preserved', request_payload->>'preserved'
)
from public.experience_projection_action_requests where id = '${ACTION_ID}';
`);
  assert.deepEqual(action, {
    status: "failed",
    resultReference: `legacy-action:${ACTION_ID}:version-unverified`,
    resultCode: "LEGACY_PROJECTION_VERSION_UNVERIFIED",
    commandReplayed: false,
    completed: true,
    expectedVersion: 4,
    mfaVerified: false,
    recentAuthenticationVerified: false,
    rowVersion: 2,
    preserved: "request-payload",
  });

  const evidence = queryJson(`
select jsonb_build_object(
  'queuedTerminalAuditCount', count(*) filter (
    where event.aggregate_id = '${ACTION_ID}'::uuid
  ),
  'queuedTerminalOutboxCount', count(message.id) filter (
    where event.aggregate_id = '${ACTION_ID}'::uuid
  ),
  'queuedAggregateVersion', max(event.aggregate_version) filter (
    where event.aggregate_id = '${ACTION_ID}'::uuid
  ),
  'queuedActor', max(event.actor::text) filter (
    where event.aggregate_id = '${ACTION_ID}'::uuid
  )::jsonb,
  'queuedMigrationCommandReplayed', bool_and(
    (event.after->>'migrationCommandReplayed')::boolean = false
  ) filter (where event.aggregate_id = '${ACTION_ID}'::uuid),
  'queuedHistoricalProviderIssuance', max(
    event.after->>'historicalProviderIssuance'
  ) filter (where event.aggregate_id = '${ACTION_ID}'::uuid),
  'queuedReconciliationRequired', bool_and(
    (event.after->>'reconciliationRequired')::boolean
  ) filter (where event.aggregate_id = '${ACTION_ID}'::uuid),
  'queuedTopic', max(message.topic) filter (
    where event.aggregate_id = '${ACTION_ID}'::uuid
  ),
  'queuedIdsAreRfcV5', bool_and(
    event.id::text ~ '^[0-9a-f-]{14}5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and message.id::text ~ '^[0-9a-f-]{14}5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ) filter (where event.aggregate_id = '${ACTION_ID}'::uuid),
  'normalizedTerminalAuditCount', count(*) filter (
    where event.aggregate_id = '${TERMINAL_ACTION_ID}'::uuid
  ),
  'normalizedTerminalOutboxCount', count(message.id) filter (
    where event.aggregate_id = '${TERMINAL_ACTION_ID}'::uuid
  ),
  'normalizedActor', max(event.actor::text) filter (
    where event.aggregate_id = '${TERMINAL_ACTION_ID}'::uuid
  )::jsonb,
  'normalizedStatus', (
    select status from public.experience_projection_action_requests
    where id = '${TERMINAL_ACTION_ID}'::uuid
  ),
  'normalizedRowVersion', (
    select row_version from public.experience_projection_action_requests
    where id = '${TERMINAL_ACTION_ID}'::uuid
  ),
  'normalizedCommandReplayed', (
    select command_replayed from public.experience_projection_action_requests
    where id = '${TERMINAL_ACTION_ID}'::uuid
  ),
  'normalizedTopic', max(message.topic) filter (
    where event.aggregate_id = '${TERMINAL_ACTION_ID}'::uuid
  )
)
from public.audit_events event
left join public.outbox_messages message on message.event_id = event.id
where event.aggregate_type = 'experience_action_request'
  and event.aggregate_version = 2
  and event.aggregate_id in ('${ACTION_ID}'::uuid, '${TERMINAL_ACTION_ID}'::uuid);
`);
  assert.deepEqual(evidence, {
    queuedTerminalAuditCount: 1,
    queuedTerminalOutboxCount: 1,
    queuedAggregateVersion: 2,
    queuedActor: { kind: "user", id: USER_ID },
    queuedMigrationCommandReplayed: true,
    queuedHistoricalProviderIssuance: "unknown",
    queuedReconciliationRequired: true,
    queuedTopic: "experience.projection_action.failed",
    queuedIdsAreRfcV5: true,
    normalizedTerminalAuditCount: 1,
    normalizedTerminalOutboxCount: 1,
    normalizedActor: { kind: "user", id: USER_ID },
    normalizedStatus: "applied",
    normalizedRowVersion: 2,
    normalizedCommandReplayed: null,
    normalizedTopic: "experience.projection_action.applied",
  });
}

function assertFailedUpgradeRolledBack() {
  const state = queryJson(`
select jsonb_build_object(
  'sourceVersionColumnExists', exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'experience_portal_projections'
      and column_name = 'source_aggregate_version'
  ),
  'projectionRowVersion', projection.row_version,
  'commandResource', projection.command_resource,
  'allowedActions', projection.payload->'allowedActions',
  'actionStatus', action.status,
  'actionCompletedAt', action.completed_at
)
from public.experience_portal_projections projection
join public.experience_projection_action_requests action
  on action.projection_id = projection.id
where projection.id = '${PROJECTION_ID}' and action.id = '${ACTION_ID}';
`);
  assert.deepEqual(state, {
    sourceVersionColumnExists: false,
    projectionRowVersion: 4,
    commandResource: "core:accounts",
    allowedActions: ["update"],
    actionStatus: "queued",
    actionCompletedAt: null,
  });
}

function verifyCanonicalState() {
  const state = queryJson(`
select jsonb_build_object(
  'releaseMigrationRecorded', exists (
    select 1 from supabase_migrations.schema_migrations where version = '001300'
  ),
  'sourceVersionRequired', exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'experience_portal_projections'
      and column_name = 'source_aggregate_version'
      and is_nullable = 'NO'
  ),
  'fixtureProjectionCount', (
    select count(*) from public.experience_portal_projections where id = '${PROJECTION_ID}'
  ),
  'fixtureActionCount', (
    select count(*) from public.experience_projection_action_requests
    where id in ('${ACTION_ID}'::uuid, '${TERMINAL_ACTION_ID}'::uuid)
  )
);
`);
  assert.deepEqual(state, {
    releaseMigrationRecorded: true,
    sourceVersionRequired: true,
    fixtureProjectionCount: 0,
    fixtureActionCount: 0,
  });
}

const startedAt = Date.now();
let qualificationError;
let observedPnpmVersion;
let databaseVerified = false;

try {
  assert.equal(
    process.version,
    EXACT_NODE_VERSION,
    `qualification requires Node ${EXACT_NODE_VERSION}`,
  );
  observedPnpmVersion = requireSuccess("pnpm", ["--version"]).stdout.trim();
  assert.equal(
    observedPnpmVersion,
    EXACT_PNPM_VERSION,
    `qualification requires pnpm ${EXACT_PNPM_VERSION}`,
  );
  const projectLabel = requireSuccess("docker", [
    "inspect",
    "--format",
    '{{ index .Config.Labels "com.supabase.cli.project" }}',
    DATABASE_CONTAINER,
  ]).stdout.trim();
  assert.equal(
    projectLabel,
    PROJECT_ID,
    "refusing to reset an unexpected database",
  );
  databaseVerified = true;

  reset(PRE_UPGRADE_VERSION);
  assertPreUpgradeSchema();
  loadLegacyFixture("2026-07-31 16:00:00.123+00");
  const { locks } = applyMigration();
  assertUpgradeLockFootprint(locks);
  assertMatchedUpgrade();
  process.stdout.write(
    "P0-39 same-millisecond populated upgrade: passed (.123456 source vs .123 projection)\n",
  );
  process.stdout.write(
    `P0-39 upgrade lock footprint: ACCESS EXCLUSIVE on ${locks.accessExclusiveRelations} relations including ${locks.accessExclusiveCommerceTables.join(", ")}, lock_timeout=${locks.lockTimeout}\n`,
  );

  reset(PRE_UPGRADE_VERSION);
  assertPreUpgradeSchema();
  loadLegacyFixture("2026-07-31 16:00:00.124+00");
  const { result: failedMigration } = applyMigration({ expectFailure: true });
  assert.notEqual(
    failedMigration.status,
    0,
    "1 ms mismatch unexpectedly upgraded",
  );
  assert.match(
    `${failedMigration.stdout}${failedMigration.stderr}`,
    /portal projection source versions require an authoritative rebuild/,
  );
  assertFailedUpgradeRolledBack();
  process.stdout.write(
    "P0-39 one-millisecond mismatch fail-closed rollback: passed (.123456 source vs .124 projection)\n",
  );
} catch (error) {
  qualificationError = error;
} finally {
  if (databaseVerified) {
    try {
      reset();
      verifyCanonicalState();
    } catch (error) {
      qualificationError ??= error;
    }
  }
}

if (!qualificationError) {
  try {
    const pgTap = supabaseWorkdir
      ? requireSuccess("pnpm", [
          "exec",
          "supabase",
          "test",
          "db",
          "--workdir",
          supabaseWorkdir,
        ])
      : requireSuccess("pnpm", ["db:test"]);
    process.stdout.write(pgTap.stdout);
    process.stderr.write(pgTap.stderr);
    const suite = assertCanonicalPgTap(`${pgTap.stdout}${pgTap.stderr}`);
    process.stdout.write(
      `Canonical zero-reset pgTAP: passed (${suite.files} files, ${suite.tests} assertions)\n`,
    );
  } catch (error) {
    qualificationError = error;
  } finally {
    try {
      reset();
      verifyCanonicalState();
    } catch (error) {
      qualificationError ??= error;
    }
  }
}

const report = {
  accepted: qualificationError === undefined,
  nodeVersion: process.version,
  pnpmVersion: observedPnpmVersion,
  durationMs: Date.now() - startedAt,
  stages,
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (qualificationError) throw qualificationError;
