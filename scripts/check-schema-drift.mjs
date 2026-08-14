// Guards ADR-0003: the reviewed Supabase SQL is canonical and the Drizzle model
// is a mirror of it. Nothing checked that the mirror still matched, so it drifted
// (`experience_esign_return_correlations.account_id` was modelled nullable against
// a `not null` column).
//
// The comparison is made against the LIVE APPLIED schema rather than against the
// migration text. The applied schema is by definition what the canonical
// migrations produce, and it needs no SQL parser, so the checker cannot disagree
// with Postgres about what a migration meant.
//
// SCOPE IS DELIBERATELY NARROW. It covers the two properties that have actually
// drifted in this repository - table presence and column presence, and column
// nullability - and nothing else. The limits below are not a to-do list; they are
// the honest statement of what a green run does and does not prove. In
// particular, a green run does NOT prove that indexes match: the second recorded
// drift (`notification_delivery_subject_idx` ordering `requested_at` ascending in
// the Drizzle model against `requested_at desc` in
// `supabase/migrations/001330_notification_deliveries.sql`) would NOT be caught
// here. Index comparison needs constraint-backed-index reconciliation, partial
// predicate normalisation and NULLS-order suppression before it reports fewer
// false positives than real findings, so it is left out rather than done badly.
//
// Run with tsx (it imports the TypeScript model): `pnpm check:schema-drift`.
// Needs a running database, which is why it is not part of `verify:static`.
import { createRequire } from "node:module";
import { resolve } from "node:path";
import process from "node:process";

const root = resolve(import.meta.dirname, "..");
const DEFAULT_DATABASE_URL =
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable";

/** What a green run proves, and - just as important - what it does not. */
export const COVERAGE = Object.freeze({
  covers: [
    "every table in the Drizzle runtime schema exists in the database",
    "every column of a modelled table exists in the database, and vice versa",
    "column nullability agrees between the model and the database",
    "every database table the model does not mirror is a recorded exception",
  ],
  doesNotCover: [
    "column data types, lengths, collations, identity and default expressions",
    "indexes: presence, column order, sort direction, NULLS ordering, partial predicates",
    "check constraints, foreign keys, unique constraints, exclusion constraints",
    "RLS policies, triggers, functions, grants, sequences, enums, extensions",
    "anything outside the public schema",
  ],
});

// Tables that exist in the database on purpose and that the model deliberately
// does not mirror. ADR-0003 already accepts partial coverage ("the Drizzle
// authoring artifact is 0004_nosy_valkyrie for 116 tables"), so an unmodelled
// table is not automatically a bug - but it has to be a decision someone wrote
// down, otherwise the count silently grows. Both directions are enforced: an
// unlisted unmodelled table fails, and a stale entry here fails too.
export const UNMIRRORED_TABLES = Object.freeze({
  core_order_acceptance_reservations:
    "Service-only acceptance reservation ledger (supabase/migrations/001000_commercial_database_integrity.sql). Every write goes through triggers and RLS-guarded service paths, never through the typed model.",
});

/**
 * Pure comparison. Both sides are `[{ name, columns: [{ name, notNull }] }]`,
 * which keeps the database and drizzle-orm reads out of the tested code path.
 */
export function compareSchemaShape({
  modelTables,
  databaseTables,
  unmirroredTables = UNMIRRORED_TABLES,
}) {
  const failures = [];
  const model = new Map(modelTables.map((table) => [table.name, table]));
  const database = new Map(databaseTables.map((table) => [table.name, table]));

  for (const tableName of [...model.keys()].sort()) {
    const modelTable = model.get(tableName);
    const databaseTable = database.get(tableName);
    if (!databaseTable) {
      failures.push({
        id: `SCHEMA_DRIFT_TABLE_MISSING:${tableName}`,
        detail:
          "the Drizzle model declares this table and the applied schema has no such table",
      });
      continue;
    }
    const modelColumns = new Map(
      modelTable.columns.map((column) => [column.name, column]),
    );
    const databaseColumns = new Map(
      databaseTable.columns.map((column) => [column.name, column]),
    );
    for (const columnName of [...modelColumns.keys()].sort()) {
      const modelColumn = modelColumns.get(columnName);
      const databaseColumn = databaseColumns.get(columnName);
      if (!databaseColumn) {
        failures.push({
          id: `SCHEMA_DRIFT_COLUMN_MISSING:${tableName}.${columnName}`,
          detail: "modelled column is absent from the applied schema",
        });
        continue;
      }
      if (modelColumn.notNull !== databaseColumn.notNull) {
        failures.push({
          id: `SCHEMA_DRIFT_NULLABILITY:${tableName}.${columnName}`,
          detail: `model says ${modelColumn.notNull ? "not null" : "nullable"}, applied schema says ${databaseColumn.notNull ? "not null" : "nullable"}`,
        });
      }
    }
    for (const columnName of [...databaseColumns.keys()].sort()) {
      if (!modelColumns.has(columnName))
        failures.push({
          id: `SCHEMA_DRIFT_COLUMN_UNMODELLED:${tableName}.${columnName}`,
          detail:
            "the applied schema has this column and the modelled table omits it",
        });
    }
  }

  const unmirrored = [];
  for (const tableName of [...database.keys()].sort()) {
    if (model.has(tableName)) continue;
    if (Object.hasOwn(unmirroredTables, tableName)) {
      unmirrored.push(tableName);
      continue;
    }
    failures.push({
      id: `SCHEMA_DRIFT_TABLE_UNMODELLED:${tableName}`,
      detail:
        "applied schema table has no Drizzle model and is not recorded in UNMIRRORED_TABLES",
    });
  }
  for (const tableName of Object.keys(unmirroredTables).sort()) {
    if (database.has(tableName) && !model.has(tableName)) continue;
    failures.push({
      id: `SCHEMA_DRIFT_UNMIRRORED_STALE:${tableName}`,
      detail: model.has(tableName)
        ? "recorded as deliberately unmodelled, but the model now declares it"
        : "recorded as deliberately unmodelled, but no such table exists in the applied schema",
    });
  }

  return {
    failures,
    modelTables: model.size,
    databaseTables: database.size,
    modelColumns: modelTables.reduce(
      (total, table) => total + table.columns.length,
      0,
    ),
    unmirroredTables: unmirrored,
  };
}

// The model and the driver both live in packages/db; the repository root only
// installs tooling, so neither bare specifier resolves from this directory.
// Resolving through the package that owns them keeps the checker in scripts/
// without adding a root dependency. Loaded lazily so the pure comparison above
// can be unit tested under plain `node --test`, with no database and no tsx.
async function loadModelTables() {
  const requireFromDb = createRequire(
    resolve(root, "packages/db/package.json"),
  );
  const { is } = await import(requireFromDb.resolve("drizzle-orm"));
  const { PgTable, getTableConfig } = await import(
    requireFromDb.resolve("drizzle-orm/pg-core")
  );
  const { runtimeSchema } = await import("../packages/db/src/schema/index.ts");
  return Object.values(runtimeSchema)
    .filter((value) => is(value, PgTable))
    .map((table) => {
      const config = getTableConfig(table);
      return {
        name: config.name,
        columns: config.columns.map((column) => ({
          name: column.name,
          notNull: column.notNull,
        })),
      };
    });
}

async function loadDatabaseTables(databaseUrl) {
  const module = await import(
    createRequire(resolve(root, "packages/db/package.json")).resolve("postgres")
  );
  const postgres = module.default ?? module;
  // Supavisor transaction mode forbids prepared statements and the local stack
  // has no TLS; both match how the rest of the repository connects.
  const sql = postgres(databaseUrl, { prepare: false, ssl: false });
  try {
    const rows = await sql`
      select
        columns.table_name,
        columns.column_name,
        columns.is_nullable
      from information_schema.columns as columns
      join information_schema.tables as tables
        on tables.table_schema = columns.table_schema
        and tables.table_name = columns.table_name
      where columns.table_schema = 'public'
        and tables.table_type = 'BASE TABLE'
      order by columns.table_name, columns.ordinal_position
    `;
    const tables = new Map();
    for (const row of rows) {
      if (!tables.has(row.table_name))
        tables.set(row.table_name, { name: row.table_name, columns: [] });
      tables.get(row.table_name).columns.push({
        name: row.column_name,
        notNull: row.is_nullable === "NO",
      });
    }
    return [...tables.values()];
  } finally {
    await sql.end();
  }
}

async function main() {
  const databaseUrl = process.env.DIRECT_DATABASE_URL ?? DEFAULT_DATABASE_URL;
  const [modelTables, databaseTables] = await Promise.all([
    loadModelTables(),
    loadDatabaseTables(databaseUrl),
  ]);
  const report = compareSchemaShape({ modelTables, databaseTables });
  console.log(
    JSON.stringify(
      {
        source:
          "packages/db/src/schema (runtimeSchema) vs applied public schema",
        direction:
          "ADR-0003: reviewed Supabase SQL is canonical, the Drizzle model is corrected to match it",
        ...report,
        coverage: COVERAGE,
      },
      null,
      2,
    ),
  );
  if (report.failures.length > 0)
    throw new Error(
      `SCHEMA_DRIFT_DETECTED:${report.failures.length}\n${report.failures
        .map((failure) => `${failure.id} (${failure.detail})`)
        .join("\n")}`,
    );
}

if (process.argv[1] === import.meta.filename) await main();
