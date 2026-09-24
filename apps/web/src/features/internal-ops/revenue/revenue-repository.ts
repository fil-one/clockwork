import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { withInternalTransaction, type RuntimeDatabase } from "@clockwork/db";

import { revenueSources, type RevenueWorkspace } from "./model";

const StageSchema = z.object({
  forecast_stage: z.enum(["committed_backlog", "pipeline"]),
  currency: z.string(),
  revenue_basis: z.string(),
  revenue_minor: z.coerce.string(),
  quote_count: z.coerce.number().int().nonnegative(),
  order_count: z.coerce.number().int().nonnegative(),
});
const ChannelSchema = z.object({
  channel: z.string(),
  merchant_of_record: z.string(),
  currency: z.string(),
  revenue_basis: z.string(),
  revenue_minor: z.coerce.string(),
  order_count: z.coerce.number().int().nonnegative(),
});
const MonthSchema = z.object({
  forecast_month: z.string(),
  currency: z.string(),
  revenue_basis: z.string(),
  revenue_minor: z.coerce.string(),
  order_count: z.coerce.number().int().nonnegative(),
});
const RecurringSchema = z.object({
  currency: z.string(),
  revenue_basis: z.string(),
  methodology_version: z.string(),
  mrr_minor: z.coerce.string(),
  arr_minor: z.coerce.string(),
  contract_count: z.coerce.number().int().nonnegative(),
});
const CountSchema = z.object({
  forecast_row_count: z.coerce.number().int().nonnegative(),
  remaining_backlog_row_count: z.coerce.number().int().nonnegative(),
  recurring_contract_count: z.coerce.number().int().nonnegative(),
});

export const unreadableRevenueWorkspace: RevenueWorkspace = {
  stages: [],
  channels: [],
  months: [],
  recurring: [],
  forecastRowCount: 0,
  remainingBacklogRowCount: 0,
  recurringContractCount: 0,
  source: revenueSources.unavailable,
  readable: false,
};

/** Reads the two §17 reporting views without recomputing any commercial money. */
export async function readRevenueWorkspace(
  database: RuntimeDatabase,
  input: { requestId: string },
): Promise<RevenueWorkspace> {
  return withInternalTransaction(
    database,
    input.requestId,
    async (transaction) => {
      const [stageRows, channelRows, monthRows, recurringRows, countRows] =
        await Promise.all([
          transaction.execute(sql`
          select forecast_stage, currency, revenue_basis,
                 sum(forecast_revenue_minor)::text as revenue_minor,
                 count(distinct quote_id)::int as quote_count,
                 count(distinct order_id)::int as order_count
          from public.core_revenue_forecast
          group by forecast_stage, currency, revenue_basis
          order by forecast_stage, currency, revenue_basis
        `),
          transaction.execute(sql`
          select channel, merchant_of_record, currency, revenue_basis,
                 sum(forecast_revenue_minor)::text as revenue_minor,
                 count(distinct order_id)::int as order_count
          from public.core_revenue_forecast
          where forecast_stage = 'committed_backlog'
            and forecast_month >= date_trunc('month', current_date)::date
          group by channel, merchant_of_record, currency, revenue_basis
          order by channel, currency, revenue_basis
        `),
          transaction.execute(sql`
          select forecast_month::text as forecast_month, currency, revenue_basis,
                 sum(forecast_revenue_minor)::text as revenue_minor,
                 count(distinct order_id)::int as order_count
          from public.core_revenue_forecast
          where forecast_stage = 'committed_backlog'
            and forecast_month >= date_trunc('month', current_date)::date
            and forecast_month < date_trunc('month', current_date)::date + interval '12 months'
          group by forecast_month, currency, revenue_basis
          order by forecast_month, currency, revenue_basis
        `),
          transaction.execute(sql`
          select currency, revenue_basis, methodology_version,
                 sum(mrr_minor)::text as mrr_minor,
                 sum(arr_minor)::text as arr_minor,
                 count(distinct order_id)::int as contract_count
          from public.core_arr_mrr
          group by currency, revenue_basis, methodology_version
          order by currency, revenue_basis, methodology_version
        `),
          transaction.execute(sql`
          select
            (select count(*) from public.core_revenue_forecast)::int as forecast_row_count,
            (select count(*) from public.core_revenue_forecast
              where forecast_stage = 'committed_backlog'
                and forecast_month >= date_trunc('month', current_date)::date)::int
              as remaining_backlog_row_count,
            (select count(distinct order_id) from public.core_arr_mrr)::int
              as recurring_contract_count
        `),
        ]);
      const counts = CountSchema.parse(countRows[0]);
      return {
        stages: stageRows.map((value) => {
          const row = StageSchema.parse(value);
          return {
            stage: row.forecast_stage,
            currency: row.currency,
            revenueBasis: row.revenue_basis,
            revenueMinor: row.revenue_minor,
            quoteCount: row.quote_count,
            orderCount: row.order_count,
          };
        }),
        channels: channelRows.map((value) => {
          const row = ChannelSchema.parse(value);
          return {
            channel: row.channel,
            merchantOfRecord: row.merchant_of_record,
            currency: row.currency,
            revenueBasis: row.revenue_basis,
            revenueMinor: row.revenue_minor,
            orderCount: row.order_count,
          };
        }),
        months: monthRows.map((value) => {
          const row = MonthSchema.parse(value);
          return {
            month: row.forecast_month,
            currency: row.currency,
            revenueBasis: row.revenue_basis,
            revenueMinor: row.revenue_minor,
            orderCount: row.order_count,
          };
        }),
        recurring: recurringRows.map((value) => {
          const row = RecurringSchema.parse(value);
          return {
            currency: row.currency,
            revenueBasis: row.revenue_basis,
            methodologyVersion: row.methodology_version,
            mrrMinor: row.mrr_minor,
            arrMinor: row.arr_minor,
            contractCount: row.contract_count,
          };
        }),
        forecastRowCount: counts.forecast_row_count,
        remainingBacklogRowCount: counts.remaining_backlog_row_count,
        recurringContractCount: counts.recurring_contract_count,
        source: revenueSources.live,
        readable: true,
      };
    },
  );
}
