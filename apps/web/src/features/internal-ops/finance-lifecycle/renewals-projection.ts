import type { ProjectionRecord } from "@/src/features/experience-server/model";

import {
  authoritative,
  daysSince,
  formatMinorUnits,
  minorUnits,
  recordEvidence,
  risk,
  text,
  totalInDominantCurrency,
  type EvidenceEntry,
  type ProjectionRisk,
} from "./projection-fields";

/**
 * Renewal work, read from the internal `orders` channel.
 *
 * No aggregate routes to an internal `renewals` channel -- `renewals` is
 * declared in `projectionChannels` with no producer anywhere in
 * `aggregateConfiguration` -- so this surface is a filtered presenter over the
 * orders every operator session can already read. The order payload carries
 * `noticeOn`, `serviceStartsOn`, `serviceEndsOn`, `sourcing` and `status`,
 * which is the whole timing half of renewal work.
 *
 * It carries no amount. The retired fixture printed an "estimated exposure"
 * per account; nothing in any projection can produce one, so no exposure
 * estimate is shown. What is shown instead is invoice truth: the sum of the
 * invoices the `collections` channel reports against the same order.
 */
export const renewalWindows = [
  "notice-passed",
  "30",
  "60-90",
  "180",
  "unscheduled",
] as const;

export type RenewalWindow = (typeof renewalWindows)[number];

export const renewalWindowLabels: Readonly<Record<RenewalWindow, string>> = {
  "notice-passed": "Notice date passed",
  "30": "Notice within 30 days",
  "60-90": "Notice in 31–90 days",
  "180": "Notice in 91–180 days",
  unscheduled: "No notice date recorded",
};

export const renewalWindowDescriptions: Readonly<
  Record<RenewalWindow, string>
> = {
  "notice-passed":
    "The contractual notice date is behind us. Whatever the renewal decision is, it is now late.",
  "30": "Notice must be given inside a month.",
  "60-90": "Planning window. Route and owner should be settled here.",
  "180": "Visible but not yet actionable.",
  unscheduled:
    "The order records no notice date, so no renewal deadline can be derived from it.",
};

export interface RenewalOrder {
  id: string;
  orderId: string;
  accountId: string | null;
  reference: string;
  window: RenewalWindow;
  /** Days until the notice date; negative once it has passed. */
  daysToNotice: number | null;
  noticeLabel: string;
  /** `sourcing` on the order: direct, referral, resale, distributor, marketplace. */
  route: string | null;
  serviceTerm: string;
  status: string | null;
  statusLabel: string;
  risk: ProjectionRisk | null;
  /** Sum of invoices the collections channel reports against this order. */
  invoicedToDate: string | null;
  invoiceCount: number;
  evidence: readonly EvidenceEntry[];
  version: number;
  updatedAt: string;
}

function windowFor(daysToNotice: number | null): RenewalWindow {
  if (daysToNotice === null) return "unscheduled";
  if (daysToNotice < 0) return "notice-passed";
  if (daysToNotice <= 30) return "30";
  if (daysToNotice <= 90) return "60-90";
  return "180";
}

function noticeLabel(noticeOn: string | null, days: number | null): string {
  if (!noticeOn || days === null) return "No notice date recorded";
  if (days < 0) return `${noticeOn} · ${Math.abs(days)} days ago`;
  if (days === 0) return `${noticeOn} · today`;
  return `${noticeOn} · in ${days} days`;
}

/**
 * Invoice totals per order, keyed by the `orderId` the invoice payload carries.
 * Invoices whose order is not in the renewal set are ignored rather than
 * dropped into an "other" bucket that no row would explain.
 */
export function invoiceTotalsByOrder(
  invoiceRecords: readonly ProjectionRecord[],
): ReadonlyMap<string, { total: string; count: number }> {
  const grouped = new Map<
    string,
    { minor: bigint | null; currency: string | null }[]
  >();
  for (const record of invoiceRecords) {
    const invoice = authoritative(record);
    const orderId = text(invoice, "orderId");
    if (!orderId) continue;
    const entries = grouped.get(orderId) ?? [];
    entries.push({
      minor: minorUnits(text(invoice, "amountMinor")),
      currency: text(invoice, "currency"),
    });
    grouped.set(orderId, entries);
  }
  const totals = new Map<string, { total: string; count: number }>();
  for (const [orderId, entries] of grouped) {
    const summed = totalInDominantCurrency(entries);
    if (summed.counted === 0) continue;
    totals.set(orderId, {
      total: formatMinorUnits(summed.total, summed.currency),
      count: summed.counted,
    });
  }
  return totals;
}

export function renewalOrderFromProjection(
  record: ProjectionRecord,
  invoiceTotals: ReadonlyMap<string, { total: string; count: number }>,
  now: Date = new Date(),
): RenewalOrder {
  const data = record.data;
  const order = authoritative(record);
  const noticeOn = text(order, "noticeOn");
  const elapsed = daysSince(noticeOn, now);
  const daysToNotice = elapsed === null ? null : -elapsed;
  const invoiced = invoiceTotals.get(record.aggregateId);
  const route = text(order, "sourcing");
  return {
    id: record.recordKey,
    orderId: record.aggregateId,
    accountId: record.accountId,
    reference: text(data, "reference") ?? record.recordKey,
    window: windowFor(daysToNotice),
    daysToNotice,
    noticeLabel: noticeLabel(noticeOn, daysToNotice),
    route,
    serviceTerm: text(data, "term") ?? "Term not yet set",
    status: text(data, "status"),
    statusLabel: text(data, "statusLabel") ?? "Not recorded",
    risk: risk(data),
    invoicedToDate: invoiced?.total ?? null,
    invoiceCount: invoiced?.count ?? 0,
    evidence: recordEvidence(record),
    version: record.version,
    updatedAt: record.sourceUpdatedAt,
  };
}

export function groupRenewalOrders(
  orders: readonly RenewalOrder[],
): Readonly<Record<RenewalWindow, readonly RenewalOrder[]>> {
  const grouped = Object.fromEntries(
    renewalWindows.map((window) => [window, [] as RenewalOrder[]]),
  ) as Record<RenewalWindow, RenewalOrder[]>;
  for (const order of orders) grouped[order.window].push(order);
  for (const window of renewalWindows)
    grouped[window].sort(
      (left, right) =>
        (left.daysToNotice ?? Number.MAX_SAFE_INTEGER) -
          (right.daysToNotice ?? Number.MAX_SAFE_INTEGER) ||
        left.reference.localeCompare(right.reference),
    );
  return grouped;
}
