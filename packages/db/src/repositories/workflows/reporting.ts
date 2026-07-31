import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";

import type { ProviderResult } from "@clockwork/contracts";

import type { RuntimeDatabase, RuntimeTransaction } from "../../client";
import { withInternalTransaction } from "../../transaction";

export type DatabaseReportType =
  | "revenue_forecast"
  | "capacity_planning"
  | "renewal_churn_exposure"
  | "partner_performance"
  | "funnel_cycle_time"
  | "margin_poc_cost"
  | "weekly_scorecard";

export type DatabaseReportScalar = string | number | boolean | null;
export type DatabaseReportRow = Readonly<Record<string, DatabaseReportScalar>>;

function scalar(value: unknown): DatabaseReportScalar {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number")
    return Number.isSafeInteger(value) ? value : value.toString();
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  throw new Error("REPORT_ROW_CONTAINS_NON_SCALAR_VALUE");
}

function reportRow(value: unknown): DatabaseReportRow {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("REPORT_ROW_INVALID");
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, scalar(item)]),
  );
}

async function queryRows(
  transaction: RuntimeTransaction,
  input: {
    reportType: DatabaseReportType;
    asOf: string;
    from?: string;
    to?: string;
    accountId?: string;
    partnerAccountId?: string;
  },
): Promise<DatabaseReportRow[]> {
  const asOf = input.asOf.slice(0, 10);
  const from = input.from ?? "0001-01-01";
  const to = input.to ?? asOf;
  const accountId = input.accountId ?? null;
  const partnerAccountId = input.partnerAccountId ?? null;
  let result: { row: unknown }[];
  switch (input.reportType) {
    case "revenue_forecast":
      result = await transaction.execute(sql<{ row: unknown }>`
        select to_jsonb(r) as row from core_revenue_forecast r
        where r.forecast_month between ${from}::date and ${to}::date
          and (${accountId}::uuid is null or r.account_id = ${accountId}::uuid)
          and (${partnerAccountId}::uuid is null or r.partner_account_id = ${partnerAccountId}::uuid)
        order by r.forecast_month, r.order_id, r.forecast_stage
      `);
      break;
    case "capacity_planning":
      if (accountId || partnerAccountId)
        throw new Error("CAPACITY_REPORT_DOES_NOT_SUPPORT_ACCOUNT_FILTERS");
      result = await transaction.execute(sql<{ row: unknown }>`
        select to_jsonb(r) as row from core_capacity_planning r
        where r.capacity_month between ${from}::date and ${to}::date
        order by r.capacity_month, r.region, r.sku
      `);
      break;
    case "renewal_churn_exposure":
      result = await transaction.execute(sql<{ row: unknown }>`
        select to_jsonb(r) as row from core_renewal_churn_exposure r
        where r.service_ends_on between ${from}::date and ${to}::date
          and (${accountId}::uuid is null or r.account_id = ${accountId}::uuid)
          and (${partnerAccountId}::uuid is null or r.partner_account_id = ${partnerAccountId}::uuid)
        order by r.service_ends_on, r.order_id
      `);
      break;
    case "partner_performance":
      if (accountId)
        throw new Error("PARTNER_REPORT_DOES_NOT_SUPPORT_ACCOUNT_FILTER");
      result = await transaction.execute(sql<{ row: unknown }>`
        select to_jsonb(r) as row from core_partner_performance r
        where (${partnerAccountId}::uuid is null or r.partner_account_id = ${partnerAccountId}::uuid)
        order by r.partner_account_id, r.currency nulls last
      `);
      break;
    case "funnel_cycle_time":
      result = await transaction.execute(sql<{ row: unknown }>`
        select to_jsonb(r) as row from core_funnel_cycle_time r
        where r.quote_created_at::date between ${from}::date and ${to}::date
          and (${accountId}::uuid is null or r.account_id = ${accountId}::uuid)
          and (${partnerAccountId}::uuid is null or r.partner_account_id = ${partnerAccountId}::uuid)
        order by r.quote_created_at, r.quote_id
      `);
      break;
    case "margin_poc_cost":
      result = await transaction.execute(sql<{ row: unknown }>`
        select to_jsonb(r) as row from core_margin_poc_cost r
        where (${accountId}::uuid is null or r.account_id = ${accountId}::uuid)
          and (${partnerAccountId}::uuid is null or r.partner_account_id = ${partnerAccountId}::uuid)
        order by r.record_type, r.record_id, r.currency
      `);
      break;
    case "weekly_scorecard":
      if (accountId || partnerAccountId)
        throw new Error("SCORECARD_DOES_NOT_SUPPORT_ACCOUNT_FILTERS");
      result = await transaction.execute(sql<{ row: unknown }>`
        select to_jsonb(r) as row from core_weekly_scorecard r
        where r.week_start between ${from}::date and ${to}::date
        order by r.week_start, r.currency
      `);
      break;
  }
  return result.map((item) => reportRow(item.row));
}

export class DatabaseReportingDataPort {
  public constructor(private readonly db: RuntimeDatabase) {}

  public async query(input: {
    reportType: DatabaseReportType;
    asOf: string;
    from?: string;
    to?: string;
    accountId?: string;
    partnerAccountId?: string;
  }): Promise<
    ProviderResult<{
      rows: readonly DatabaseReportRow[];
      sourceVersion: string;
    }>
  > {
    try {
      const rows = await withInternalTransaction(
        this.db,
        `report:${input.reportType}:${input.asOf}`,
        (transaction) => queryRows(transaction, input),
      );
      const sourceVersion = createHash("sha256")
        .update(JSON.stringify({ input, rows }))
        .digest("hex");
      return { ok: true, value: { rows, sourceVersion } };
    } catch {
      return {
        ok: false,
        kind: "transient",
        code: "REPORT_QUERY_FAILED",
        message: "The reporting projection could not be read",
      };
    }
  }
}
