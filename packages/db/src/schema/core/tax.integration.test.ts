import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import type { PgTable } from "drizzle-orm/pg-core";
import { afterAll, describe, expect, it } from "vitest";

import { createRuntimeDatabase } from "../../client";
import {
  invoiceTaxDeterminations,
  invoiceTaxLines,
  legalEntities,
  orderSupplierBindings,
  sellingEntityAssignments,
  taxRates,
  taxRegistrations,
  taxRuleBookActivationEvents,
  taxRuleBooks,
} from "./tax";

/**
 * ADR-0003 makes the reviewed SQL canonical and the Drizzle model a mirror of
 * it. `pnpm check:schema-drift` guards that mirror, but it says plainly what it
 * does not guard: column data types, indexes, check constraints, unique
 * constraints and foreign keys. Those are exactly where the five tax tables
 * carry their meaning — a bigint parts-per-million rate, two partial unique
 * indexes that are real constraints, a frozen jsonb header and two ordered
 * effective-date windows — so a model that satisfied the drift checker could
 * still misrepresent every one of them.
 *
 * This file closes that gap for these five tables only, and it closes it by
 * reading the applied catalog rather than by restating the migration in a
 * second place. The pgTAP suites (supabase/tests/1410-1413) already prove the
 * constraints BEHAVE; this proves the model SAYS what the database holds.
 */

const databaseUrl =
  process.env.DIRECT_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable";

const { client } = createRuntimeDatabase({
  url: databaseUrl,
  maxConnections: 2,
  role: "clockwork_service",
  ssl: false,
});

afterAll(async () => {
  await client.end();
});

const taxTables: PgTable[] = [
  legalEntities,
  taxRegistrations,
  taxRuleBooks,
  taxRates,
  taxRuleBookActivationEvents,
  sellingEntityAssignments,
  orderSupplierBindings,
  invoiceTaxDeterminations,
  invoiceTaxLines,
];
const tableNames = taxTables.map((table) => getTableName(table));

const sorted = (values: string[]) => [...values].sort();

describe("tax schema mirrors the applied migrations 001410-001417", () => {
  it("declares the tables the tax migrations create", () => {
    expect(sorted(tableNames)).toEqual([
      "core_invoice_tax_determinations",
      "core_invoice_tax_lines",
      "core_legal_entities",
      "core_order_supplier_bindings",
      "core_selling_entity_assignments",
      "core_tax_rates",
      "core_tax_registrations",
      "core_tax_rule_book_activation_events",
      "core_tax_rule_books",
    ]);
  });

  it("agrees with the applied schema on column type and nullability", async () => {
    const rows = await client<
      {
        table_name: string;
        column_name: string;
        data_type: string;
        is_nullable: string;
      }[]
    >`
      -- format_type rather than information_schema.data_type, which reports
      -- every array as the bare word ARRAY and so could not tell text[] from
      -- uuid[]. The catalog says what the column actually is, which is what a
      -- mirror has to agree with.
      select rel.relname as table_name,
             att.attname as column_name,
             format_type(att.atttypid, att.atttypmod) as data_type,
             case when att.attnotnull then 'NO' else 'YES' end as is_nullable
      from pg_attribute att
      join pg_class rel on rel.oid = att.attrelid
      join pg_namespace nsp on nsp.oid = rel.relnamespace
      where nsp.nspname = 'public'
        and rel.relname = any(${tableNames})
        and att.attnum > 0
        and not att.attisdropped
    `;
    const applied = new Map(
      rows.map((row) => [
        `${row.table_name}.${row.column_name}`,
        `${row.data_type} ${row.is_nullable === "NO" ? "not null" : "null"}`,
      ]),
    );
    const modelled = new Map<string, string>();
    for (const table of taxTables) {
      const config = getTableConfig(table);
      for (const column of config.columns)
        modelled.set(
          `${config.name}.${column.name}`,
          `${column.getSQLType()} ${column.notNull ? "not null" : "null"}`,
        );
    }
    // Both directions: a column the model invents and a column it drops are the
    // same failure of the mirror.
    expect(sorted([...modelled.keys()])).toEqual(sorted([...applied.keys()]));
    for (const [column, declaration] of modelled)
      expect(`${column}: ${declaration}`).toBe(
        `${column}: ${applied.get(column)}`,
      );
  });

  it("declares every check constraint the applied schema holds, and no others", async () => {
    const rows = await client<{ table_name: string; conname: string }[]>`
      select rel.relname as table_name, con.conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace nsp on nsp.oid = rel.relnamespace
      where nsp.nspname = 'public'
        and con.contype = 'c'
        and rel.relname = any(${tableNames})
    `;
    for (const table of taxTables) {
      const config = getTableConfig(table);
      expect({
        table: config.name,
        checks: sorted(config.checks.map((check) => check.name)),
      }).toEqual({
        table: config.name,
        checks: sorted(
          rows
            .filter((row) => row.table_name === config.name)
            .map((row) => row.conname),
        ),
      });
    }
  });

  it("declares every unique constraint and foreign key the applied schema holds", async () => {
    const rows = await client<
      {
        table_name: string;
        contype: string;
        conname: string;
        columns: string[];
        foreign_table: string | null;
        foreign_columns: string[] | null;
      }[]
    >`
      select
        rel.relname as table_name,
        con.contype::text as contype,
        con.conname,
        (
          select array_agg(att.attname order by key.ord)
          from unnest(con.conkey) with ordinality as key(attnum, ord)
          join pg_attribute att
            on att.attrelid = rel.oid and att.attnum = key.attnum
        ) as columns,
        fre.relname as foreign_table,
        (
          select array_agg(att.attname order by key.ord)
          from unnest(con.confkey) with ordinality as key(attnum, ord)
          join pg_attribute att
            on att.attrelid = fre.oid and att.attnum = key.attnum
        ) as foreign_columns
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace nsp on nsp.oid = rel.relnamespace
      left join pg_class fre on fre.oid = con.confrelid
      where nsp.nspname = 'public'
        and con.contype in ('u', 'f')
        and rel.relname = any(${tableNames})
    `;
    for (const table of taxTables) {
      const config = getTableConfig(table);
      expect({
        table: config.name,
        unique: sorted(
          config.uniqueConstraints.map(
            (constraint) =>
              `${constraint.name}(${constraint.columns
                .map((column) => column.name)
                .join(",")})`,
          ),
        ),
        // Names are compared for unique constraints because the migrations name
        // them; foreign keys are compared by what they point at, because those
        // names are generated by Postgres and carry no decision.
        foreignKeys: sorted(
          config.foreignKeys.map((foreignKey) => {
            const reference = foreignKey.reference();
            return `${reference.columns
              .map((column) => column.name)
              .join(",")} -> ${getTableName(
              reference.foreignTable,
            )}(${reference.foreignColumns
              .map((column) => column.name)
              .join(",")})`;
          }),
        ),
      }).toEqual({
        table: config.name,
        unique: sorted(
          rows
            .filter(
              (row) => row.table_name === config.name && row.contype === "u",
            )
            .map((row) => `${row.conname}(${(row.columns ?? []).join(",")})`),
        ),
        foreignKeys: sorted(
          rows
            .filter(
              (row) => row.table_name === config.name && row.contype === "f",
            )
            .map(
              (row) =>
                `${(row.columns ?? []).join(",")} -> ${row.foreign_table}(${(
                  row.foreign_columns ?? []
                ).join(",")})`,
            ),
        ),
      });
    }
  });

  it("declares every index the applied schema holds, with its columns, uniqueness and partiality", async () => {
    const rows = await client<
      {
        table_name: string;
        index_name: string;
        is_unique: boolean;
        columns: string[];
        predicate: string | null;
        backs_constraint: boolean;
      }[]
    >`
      select
        rel.relname as table_name,
        idx.relname as index_name,
        ind.indisunique as is_unique,
        (
          select array_agg(att.attname order by key.ord)
          from unnest(ind.indkey::int2[]) with ordinality as key(attnum, ord)
          join pg_attribute att
            on att.attrelid = rel.oid and att.attnum = key.attnum
        ) as columns,
        pg_get_expr(ind.indpred, rel.oid) as predicate,
        con.oid is not null as backs_constraint
      from pg_index ind
      join pg_class rel on rel.oid = ind.indrelid
      join pg_class idx on idx.oid = ind.indexrelid
      join pg_namespace nsp on nsp.oid = rel.relnamespace
      left join pg_constraint con
        on con.conindid = ind.indexrelid and con.contype in ('p', 'u')
      where nsp.nspname = 'public' and rel.relname = any(${tableNames})
    `;
    for (const table of taxTables) {
      const config = getTableConfig(table);
      expect({
        table: config.name,
        indexes: sorted(
          config.indexes.map((index) => {
            const declaration = index.config;
            const columns = declaration.columns
              .map((column) => ("name" in column ? column.name : "<sql>"))
              .join(",");
            return `${declaration.name}(${columns})${
              declaration.unique ? " unique" : ""
            }${declaration.where ? " partial" : ""}`;
          }),
        ),
      }).toEqual({
        table: config.name,
        // Primary keys and unique constraints are compared as constraints
        // above; their backing indexes are not separately modelled.
        indexes: sorted(
          rows
            .filter(
              (row) => row.table_name === config.name && !row.backs_constraint,
            )
            .map(
              (row) =>
                `${row.index_name}(${(row.columns ?? []).join(",")})${
                  row.is_unique ? " unique" : ""
                }${row.predicate ? " partial" : ""}`,
            ),
        ),
      });
    }
  });

  it("holds one active rule book per jurisdiction and one active registration per entity, jurisdiction and scheme", async () => {
    const rows = await client<{ indexname: string; indexdef: string }[]>`
      select indexname, indexdef
      from pg_indexes
      where schemaname = 'public'
        and indexname in (
          'core_tax_rule_books_active_jurisdiction_unique',
          'core_tax_registrations_active_unique'
        )
      order by indexname
    `;
    expect(rows.map((row) => row.indexdef)).toEqual([
      "CREATE UNIQUE INDEX core_tax_registrations_active_unique ON public.core_tax_registrations USING btree (legal_entity_id, jurisdiction, scheme) WHERE (status = 'active'::text)",
      "CREATE UNIQUE INDEX core_tax_rule_books_active_jurisdiction_unique ON public.core_tax_rule_books USING btree (jurisdiction) WHERE (status = 'active'::text)",
    ]);
    // The generic comparison above records only THAT an index is partial. The
    // two indexes that carry a rule are pinned here with the predicate the
    // database actually holds, and re-asserted on the model, because a total
    // unique index in their place would be a different and much stricter rule
    // that happens to look the same in a summary.
    const bookIndex = getTableConfig(taxRuleBooks).indexes.find(
      (index) =>
        index.config.name === "core_tax_rule_books_active_jurisdiction_unique",
    );
    const registrationIndex = getTableConfig(taxRegistrations).indexes.find(
      (index) => index.config.name === "core_tax_registrations_active_unique",
    );
    expect(bookIndex?.config.unique).toBe(true);
    expect(bookIndex?.config.where).toBeDefined();
    expect(registrationIndex?.config.unique).toBe(true);
    expect(registrationIndex?.config.where).toBeDefined();
  });

  it("keeps rate_ppm a bigint parts-per-million and does not narrow it", async () => {
    const ratePpm = getTableConfig(taxRates).columns.find(
      (column) => column.name === "rate_ppm",
    );
    // `bigint({ mode: "number" })` would read this column as a JS number and
    // `integer` would narrow it further; both are silent until a rate does not
    // fit. The unit is parts per million precisely so that 8.875% is the exact
    // integer 88750 rather than 887.5 basis points, so the width has to hold.
    expect(ratePpm?.getSQLType()).toBe("bigint");
    expect(ratePpm?.dataType).toBe("bigint");
    expect(ratePpm?.notNull).toBe(true);

    const [row] = await client<{ definition: string }[]>`
      select pg_get_constraintdef(con.oid) as definition
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      where rel.relname = 'core_tax_rates' and con.conname = 'core_tax_rates_rate_ppm_check'
    `;
    expect(row?.definition).toBe("CHECK ((rate_ppm >= 0))");

    // The two worked examples in 001411, checked in integers only, because a
    // float is exactly what this unit exists to keep out of the calculation.
    // One basis point is 100 parts per million, so a rate is expressible in
    // whole basis points only when its ppm value divides by 100.
    const twentyPercent = 200_000; // 20%
    const newYorkCity = 88_750; // 8.875%
    expect(twentyPercent % 100).toBe(0); // 2000 bps, exact either way
    expect(newYorkCity % 100).toBe(50); // 887.5 bps, which bps cannot hold
  });

  it("keeps rule_parameters a not-null jsonb object on the header", async () => {
    const ruleParameters = getTableConfig(taxRuleBooks).columns.find(
      (column) => column.name === "rule_parameters",
    );
    expect(ruleParameters?.getSQLType()).toBe("jsonb");
    expect(ruleParameters?.notNull).toBe(true);
    const [row] = await client<{ column_default: string }[]>`
      select column_default
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'core_tax_rule_books'
        and column_name = 'rule_parameters'
    `;
    expect(row?.column_default).toBe("'{}'::jsonb");
  });

  it("orders both effective-dated windows strictly", async () => {
    const rows = await client<{ conname: string; definition: string }[]>`
      select con.conname, pg_get_constraintdef(con.oid) as definition
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      where con.conname in (
        'core_tax_rule_books_window_check',
        'core_tax_registrations_window_check'
      )
      order by con.conname
    `;
    // Half-open and strict: effective_to is the date the successor takes over,
    // so `>=` would let a supply on that date fall in two windows at once.
    expect(rows.map((row) => `${row.conname} ${row.definition}`)).toEqual([
      "core_tax_registrations_window_check CHECK (((effective_to IS NULL) OR (effective_to > effective_from)))",
      "core_tax_rule_books_window_check CHECK (((effective_to IS NULL) OR (effective_to > effective_from)))",
    ]);
    for (const table of [taxRuleBooks, taxRegistrations]) {
      const config = getTableConfig(table);
      const effectiveTo = config.columns.find(
        (column) => column.name === "effective_to",
      );
      const effectiveFrom = config.columns.find(
        (column) => column.name === "effective_from",
      );
      expect(effectiveFrom?.notNull).toBe(true);
      expect(effectiveTo?.notNull).toBe(false);
    }
  });
});
