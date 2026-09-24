import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { withInternalTransaction, type RuntimeDatabase } from "@clockwork/db";

import {
  isVarianceClassification,
  reconciliationQueue,
  reconciliationSources,
  varianceClassifiedEvent,
  type ReconciliationVariance,
  type ReconciliationWorkspace,
  type TieOutPeriod,
} from "./model";

export const unreadableReconciliationWorkspace: ReconciliationWorkspace = {
  periods: [],
  variances: [],
  source: reconciliationSources.unavailable,
  readable: false,
};

const PeriodSchema = z
  .object({
    id: z.string(),
    period_starts_on: z.string(),
    period_ends_on: z.string(),
    currency: z.string(),
    platform_revenue_minor: z.coerce.string(),
    stripe_revenue_minor: z.coerce.string(),
    qbo_revenue_minor: z.coerce.string(),
    stripe_variance_minor: z.coerce.string(),
    qbo_variance_minor: z.coerce.string(),
    mathematically_tied: z.boolean(),
    status: z.string(),
    variance_count: z.coerce.number().int().nonnegative(),
    reviewed_at: z.coerce.date().nullable(),
  })
  .strict();

const VarianceSchema = z
  .object({
    case_id: z.string(),
    account_id: z.string(),
    object_type: z.string(),
    object_id: z.string(),
    status: z.string(),
    opened_at: z.coerce.date(),
    target_at: z.coerce.date(),
    owner_user_id: z.string(),
    owner_email: z.string().nullable(),
    backup_user_id: z.string().nullable(),
    row_version: z.coerce.number().int().positive(),
    classification: z.string().nullable(),
    classification_reason: z.string().nullable(),
    classified_at: z.coerce.date().nullable(),
    expected_clearing_period: z.string().nullable(),
  })
  .strict();

function period(row: z.infer<typeof PeriodSchema>): TieOutPeriod {
  return {
    id: row.id,
    periodStartsOn: row.period_starts_on,
    periodEndsOn: row.period_ends_on,
    currency: row.currency,
    platformRevenueMinor: row.platform_revenue_minor,
    billingProviderRevenueMinor: row.stripe_revenue_minor,
    accountingRevenueMinor: row.qbo_revenue_minor,
    billingProviderVarianceMinor: row.stripe_variance_minor,
    accountingVarianceMinor: row.qbo_variance_minor,
    mathematicallyTied: row.mathematically_tied,
    status: row.status,
    varianceCount: row.variance_count,
    reviewedAt: row.reviewed_at?.toISOString() ?? null,
  };
}

function variance(row: z.infer<typeof VarianceSchema>): ReconciliationVariance {
  const classification =
    row.classification && isVarianceClassification(row.classification)
      ? row.classification
      : null;
  return {
    caseId: row.case_id,
    accountId: row.account_id,
    objectType: row.object_type,
    objectId: row.object_id,
    status: row.status,
    openedAt: row.opened_at.toISOString(),
    targetAt: row.target_at.toISOString(),
    ownerUserId: row.owner_user_id,
    ownerEmail: row.owner_email,
    backupUserId: row.backup_user_id,
    rowVersion: row.row_version,
    latestClassification: classification,
    latestClassificationReason: row.classification_reason,
    latestClassificationAt: row.classified_at?.toISOString() ?? null,
    expectedClearingPeriod: row.expected_clearing_period,
  };
}

/**
 * Reads both halves of the close.
 *
 * Neither half falls back to a sample. A tie-out list that is empty because the
 * table is empty and one that is empty because the read failed lead a finance
 * operator to opposite conclusions, and the second of those signs a close.
 */
export async function readReconciliationWorkspace(
  database: RuntimeDatabase,
  input: { requestId: string; limit?: number },
): Promise<ReconciliationWorkspace> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  return withInternalTransaction(
    database,
    input.requestId,
    async (transaction) => {
      const periodRows = await transaction.execute(sql`
          select id::text as id,
                 period_starts_on::text as period_starts_on,
                 period_ends_on::text as period_ends_on,
                 currency,
                 platform_revenue_minor::text as platform_revenue_minor,
                 stripe_revenue_minor::text as stripe_revenue_minor,
                 qbo_revenue_minor::text as qbo_revenue_minor,
                 stripe_variance_minor::text as stripe_variance_minor,
                 qbo_variance_minor::text as qbo_variance_minor,
                 mathematically_tied,
                 status,
                 jsonb_array_length(variances) as variance_count,
                 reviewed_at
          from public.core_three_way_tie_out
          order by period_ends_on desc, currency
          limit ${limit}
        `);
      const varianceRows = await transaction.execute(sql`
          select kase.id::text as case_id,
                 kase.account_id::text as account_id,
                 kase.object_type,
                 kase.object_id::text as object_id,
                 kase.status,
                 kase.created_at as opened_at,
                 kase.target_at,
                 kase.owner_user_id::text as owner_user_id,
                 owner_user.email as owner_email,
                 kase.backup_user_id::text as backup_user_id,
                 kase.row_version,
                 disposition.after->>'classification' as classification,
                 disposition.after->>'reason' as classification_reason,
                 disposition.occurred_at as classified_at,
                 disposition.after->>'expectedClearingPeriod'
                   as expected_clearing_period
          from public.exception_cases kase
          left join public.commerce_users owner_user
            on owner_user.id = kase.owner_user_id
          left join lateral (
            select record.after, record.occurred_at
            from public.audit_events record
            where record.aggregate_type = 'exception_case'
              and record.aggregate_id = kase.id
              and record.event_type = ${varianceClassifiedEvent}
            order by record.aggregate_version desc
            limit 1
          ) disposition on true
          where kase.queue = ${reconciliationQueue}
            and kase.status = 'open'
          order by kase.target_at asc
          limit ${limit}
        `);
      return {
        periods: periodRows.map((row) => period(PeriodSchema.parse(row))),
        variances: varianceRows.map((row) =>
          variance(VarianceSchema.parse(row)),
        ),
        source: reconciliationSources.live,
        readable: true,
      };
    },
  );
}
