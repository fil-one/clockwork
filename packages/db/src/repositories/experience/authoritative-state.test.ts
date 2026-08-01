import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

import type { RuntimeDatabase } from "../../client";
import {
  authoritativeAggregateTypes,
  DatabaseAuthoritativeStateError,
  DatabaseAuthoritativeStateLoader,
} from "./authoritative-state";

const aggregateId = "92000000-0000-4000-8000-000000000001";
const accountId = "10000000-0000-4000-8000-000000000001";
const now = new Date("2026-08-01T12:00:00.000Z");
const dialect = new PgDialect();

const tableByType = {
  account: "accounts",
  agreement: "agreements",
  quote: "quotes",
  order: "orders",
  amendment: "amendments",
  poc: "pocs",
  invoice: "invoices",
  exception_case: "exception_cases",
  approval: "approvals",
  provider_operation: "provider_operations",
  report_export: "report_exports",
  termination: "terminations",
} as const;

function databaseWithRows(rows: readonly Record<string, unknown>[]) {
  const queries: string[] = [];
  const execute = vi.fn((statement: SQL) => {
    const compiled = dialect.sqlToQuery(statement);
    queries.push(compiled.sql);
    return Promise.resolve(compiled.sql.includes("from public.") ? rows : []);
  });
  const transaction = { execute };
  const database = {
    transaction: <T>(operation: (tx: typeof transaction) => Promise<T>) =>
      operation(transaction),
  } as unknown as RuntimeDatabase;
  return { database, execute, queries };
}

function row(
  input: {
    account?: string | null;
    payload?: Record<string, unknown>;
    version?: number;
  } = {},
) {
  return {
    aggregate_id: aggregateId,
    account_id: input.account === undefined ? accountId : input.account,
    aggregate_version: input.version ?? 4,
    source_updated_at: now,
    safe_payload: input.payload ?? { status: "active", totalMinor: "42" },
  };
}

describe("database authoritative state loader", () => {
  it("routes every supported type to one explicit canonical table", async () => {
    for (const aggregateType of authoritativeAggregateTypes) {
      const noAccount = ["provider_operation", "report_export"].includes(
        aggregateType,
      );
      const { database, queries } = databaseWithRows([
        row({
          account:
            aggregateType === "account"
              ? aggregateId
              : noAccount
                ? null
                : accountId,
        }),
      ]);
      const loader = new DatabaseAuthoritativeStateLoader(database);
      await expect(
        loader.loadVersion({
          aggregateType,
          aggregateId,
          requestId: `authoritative-${aggregateType}`,
        }),
      ).resolves.toMatchObject({ aggregateType, aggregateId, version: 4 });
      const sourceQuery = queries.find((query) =>
        query.includes("from public."),
      );
      expect(sourceQuery).toContain(
        `from public.${tableByType[aggregateType]}`,
      );
      expect(sourceQuery).toContain("jsonb_build_object");
      expect(sourceQuery).toContain("limit 2");
    }
  });

  it("returns a stable hash independent of safe-payload key order", async () => {
    const first = new DatabaseAuthoritativeStateLoader(
      databaseWithRows([
        row({ payload: { status: "open", nested: { b: 2, a: 1 } } }),
      ]).database,
    );
    const second = new DatabaseAuthoritativeStateLoader(
      databaseWithRows([
        row({ payload: { nested: { a: 1, b: 2 }, status: "open" } }),
      ]).database,
    );
    const input = {
      aggregateType: "quote",
      aggregateId,
      minimumVersion: 4,
      requestId: "authoritative-stable-hash",
    };
    const [left, right] = await Promise.all([
      first.load(input),
      second.load(input),
    ]);
    expect(left?.sourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(left?.sourceHash).toBe(right?.sourceHash);
    expect(left).toMatchObject({
      accountId,
      version: 4,
      sourceUpdatedAt: now.toISOString(),
    });
  });

  it("rejects unknown types before opening a database transaction", async () => {
    const { database } = databaseWithRows([]);
    const transaction = vi.spyOn(database, "transaction");
    const loader = new DatabaseAuthoritativeStateLoader(database);
    await expect(
      loader.loadVersion({
        aggregateType: "projection_cache",
        aggregateId,
        requestId: "authoritative-unknown",
      }),
    ).rejects.toMatchObject({
      code: "AUTHORITATIVE_AGGREGATE_TYPE_UNKNOWN",
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("fails closed for ambiguous, malformed, stale, or unsafe rows", async () => {
    const cases = [
      {
        rows: [row(), row()],
        code: "AUTHORITATIVE_AGGREGATE_AMBIGUOUS",
        minimumVersion: 1,
      },
      {
        rows: [row({ account: null })],
        code: "AUTHORITATIVE_AGGREGATE_BINDING_INVALID",
        minimumVersion: 1,
      },
      {
        rows: [row({ version: 2 })],
        code: "AUTHORITATIVE_AGGREGATE_VERSION_BEHIND",
        minimumVersion: 3,
      },
      {
        rows: [row({ payload: { status: "open", accessToken: "forbidden" } })],
        code: "AUTHORITATIVE_AGGREGATE_PAYLOAD_INVALID",
        minimumVersion: 1,
      },
    ] as const;
    for (const scenario of cases) {
      const loader = new DatabaseAuthoritativeStateLoader(
        databaseWithRows(scenario.rows).database,
      );
      await expect(
        loader.load({
          aggregateType: "quote",
          aggregateId,
          minimumVersion: scenario.minimumVersion,
          requestId: `authoritative-${scenario.code}`,
        }),
      ).rejects.toEqual(new DatabaseAuthoritativeStateError(scenario.code));
    }
  });

  it("does not select credential or PII source columns", async () => {
    const forbidden =
      /legal_name|registered_address|tax_ids|billing_contact|ap_contact|invoice_delivery_email|domain|stripe_customer_id|crm_record_id|accepted_ip|accepted_user_agent|signer_user_id|authority_title|po_number|created_by|support_owner_id|owner_user_id|backup_user_id|requester_user_id|escalation_owner_user_id|decision_reason|requested_by|approved_by|parameters|idempotency_key|provider_reference|last_error/;
    for (const aggregateType of authoritativeAggregateTypes) {
      const noAccount = ["provider_operation", "report_export"].includes(
        aggregateType,
      );
      const { database, queries } = databaseWithRows([
        row({
          account:
            aggregateType === "account"
              ? aggregateId
              : noAccount
                ? null
                : accountId,
        }),
      ]);
      await new DatabaseAuthoritativeStateLoader(database).loadVersion({
        aggregateType,
        aggregateId,
        requestId: `authoritative-safe-${aggregateType}`,
      });
      const sourceQuery = queries.find((query) =>
        query.includes("from public."),
      );
      expect(sourceQuery).not.toMatch(forbidden);
    }
  });
});
