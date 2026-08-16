/**
 * The two durable records a reconciliation close actually has.
 *
 * `docs/operations/billing-reconciliation.md` names `three_way_tie_out` and the
 * `core.reconciliation.*` tasks. Those are different things and the surface
 * keeps them apart, because only one of them is produced by a running system:
 *
 *   * `core_three_way_tie_outs` is a real table with a real view, and no
 *     application path writes it. `core.reconciliation.three-way.v1` computes
 *     variances in memory, opens an exception case, and records the run --
 *     `packages/workflows/src/core/engine.ts` -- and never inserts a tie-out
 *     row. So whatever rows exist came from a fixture or an operator, and the
 *     page says so rather than presenting them as the output of a close.
 *   * The reconciliation exception cases ARE produced: both reconciliation
 *     tasks route their variances to the `reconciliation` queue, which is why
 *     that queue exists in the vocabulary at all.
 *
 * The operator action therefore hangs off the exception case, which is the
 * record the platform creates, owns and tracks against a response target.
 */

/** The queue both `core.reconciliation.*` tasks route their variances to. */
export const reconciliationQueue = "reconciliation";

export const varianceClassifiedEvent =
  "system.reconciliation.variance_classified";

/** The classifications `## Variance handling` enumerates, in its order. */
export const varianceClassifications = [
  "delivery_timing",
  "period_cut_off",
  "currency",
  "tax",
  "account_mapping",
  "missing_or_duplicate_event",
  "usage_correction",
  "amendment_or_proration",
  "provider_fee",
  "unexplained",
] as const;

export type VarianceClassification = (typeof varianceClassifications)[number];

export const varianceClassificationLabels: Readonly<
  Record<VarianceClassification, string>
> = {
  delivery_timing: "Delivery timing",
  period_cut_off: "Period cut-off",
  currency: "Currency",
  tax: "Tax",
  account_mapping: "Account mapping",
  missing_or_duplicate_event: "Missing or duplicate event",
  usage_correction: "Usage correction",
  amendment_or_proration: "Amendment or proration",
  provider_fee: "Provider fee",
  unexplained: "Unexplained",
};

export function isVarianceClassification(
  value: string,
): value is VarianceClassification {
  return (varianceClassifications as readonly string[]).includes(value);
}

/**
 * A close requires zero unexplained variance. Classifying one as unexplained is
 * a legitimate and necessary act -- it is how the blocker gets recorded -- so
 * it is accepted and then reported as blocking, rather than refused.
 */
export function blocksClose(classification: VarianceClassification): boolean {
  return classification === "unexplained";
}

/** `YYYY-MM`, the grain the runbook's "expected clearing period" is stated in. */
export const clearingPeriodPattern = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface TieOutPeriod {
  id: string;
  periodStartsOn: string;
  periodEndsOn: string;
  currency: string;
  platformRevenueMinor: string;
  billingProviderRevenueMinor: string;
  accountingRevenueMinor: string;
  billingProviderVarianceMinor: string;
  accountingVarianceMinor: string;
  mathematicallyTied: boolean;
  status: string;
  varianceCount: number;
  reviewedAt: string | null;
}

export interface ReconciliationVariance {
  caseId: string;
  accountId: string;
  objectType: string;
  objectId: string;
  status: string;
  openedAt: string;
  targetAt: string;
  ownerUserId: string;
  ownerEmail: string | null;
  backupUserId: string | null;
  rowVersion: number;
  /** Last recorded disposition, read from the audit trail. */
  latestClassification: VarianceClassification | null;
  latestClassificationReason: string | null;
  latestClassificationAt: string | null;
  expectedClearingPeriod: string | null;
}

export interface ReconciliationWorkspace {
  periods: readonly TieOutPeriod[];
  variances: readonly ReconciliationVariance[];
  source: string;
  readable: boolean;
}

/** Variances still blocking a close: unclassified, or classified unexplained. */
export function blockingVariances(
  variances: readonly ReconciliationVariance[],
): readonly ReconciliationVariance[] {
  return variances.filter(
    (variance) =>
      variance.latestClassification === null ||
      blocksClose(variance.latestClassification),
  );
}

/** Periods whose stored totals do not tie, which no close may sign over. */
export function untiedPeriods(
  periods: readonly TieOutPeriod[],
): readonly TieOutPeriod[] {
  return periods.filter((period) => !period.mathematicallyTied);
}

export function formatMinor(minor: string, currency: string): string {
  const negative = minor.startsWith("-");
  const digits = (negative ? minor.slice(1) : minor).padStart(3, "0");
  const major = digits.slice(0, -2);
  const fraction = digits.slice(-2);
  return `${negative ? "-" : ""}${major}.${fraction} ${currency}`;
}
