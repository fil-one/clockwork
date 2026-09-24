import type { ProjectionRecord } from "@/src/features/experience-server/model";
import type { MessageId } from "@/src/i18n";

import {
  authoritative,
  daysSince,
  minorUnits,
  recordEvidence,
  risk,
  text,
  totalInDominantCurrency,
  type EvidenceEntry,
  type MinorAmount,
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
 *
 * Every field below is a fact -- dates as ISO strings, money as minor units
 * and a currency, status as the aggregate's code. The surface words and
 * formats them in the reader's language; nothing here pre-renders a phrase.
 */
export const renewalWindows = [
  "notice-passed",
  "30",
  "60-90",
  "180",
  "unscheduled",
] as const;

export type RenewalWindow = (typeof renewalWindows)[number];

export const renewalWindowLabels: Readonly<Record<RenewalWindow, MessageId>> = {
  "notice-passed": "operations.finance.renewals.window.passed",
  "30": "operations.finance.renewals.window.within30",
  "60-90": "operations.finance.renewals.window.within90",
  "180": "operations.finance.renewals.window.within180",
  unscheduled: "operations.finance.renewals.window.unscheduled",
};

export const renewalWindowDescriptions: Readonly<
  Record<RenewalWindow, MessageId>
> = {
  "notice-passed": "operations.finance.renewals.window.passed.description",
  "30": "operations.finance.renewals.window.within30.description",
  "60-90": "operations.finance.renewals.window.within90.description",
  "180": "operations.finance.renewals.window.within180.description",
  unscheduled: "operations.finance.renewals.window.unscheduled.description",
};

export interface RenewalOrder {
  id: string;
  orderId: string;
  accountId: string | null;
  reference: string;
  window: RenewalWindow;
  /** Days until the notice date; negative once it has passed. */
  daysToNotice: number | null;
  /** The contractual notice date (`orders.noticeOn`), as recorded. */
  noticeOn: string | null;
  /** `sourcing` on the order: direct, referral, resale, distributor, marketplace. */
  route: string | null;
  serviceStartsOn: string | null;
  serviceEndsOn: string | null;
  /** The public status the projection states. */
  status: string | null;
  /** The order's own status, which the order status set words. */
  orderStatus: string | null;
  /** The read boundary's label, used only when no status code is known. */
  statusLabel: string | null;
  risk: ProjectionRisk | null;
  /** Sum of invoices the collections channel reports against this order. */
  invoicedToDate: MinorAmount | null;
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

/**
 * Invoice totals per order, keyed by the `orderId` the invoice payload carries.
 * Invoices whose order is not in the renewal set are ignored rather than
 * dropped into an "other" bucket that no row would explain.
 */
export function invoiceTotalsByOrder(
  invoiceRecords: readonly ProjectionRecord[],
): ReadonlyMap<string, { total: MinorAmount; count: number }> {
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
  const totals = new Map<string, { total: MinorAmount; count: number }>();
  for (const [orderId, entries] of grouped) {
    const summed = totalInDominantCurrency(entries);
    if (summed.counted === 0) continue;
    totals.set(orderId, {
      total: { minor: summed.total, currency: summed.currency },
      count: summed.counted,
    });
  }
  return totals;
}

export function renewalOrderFromProjection(
  record: ProjectionRecord,
  invoiceTotals: ReadonlyMap<string, { total: MinorAmount; count: number }>,
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
    noticeOn,
    route,
    serviceStartsOn: text(order, "serviceStartsOn"),
    serviceEndsOn: text(order, "serviceEndsOn"),
    status: text(data, "status"),
    orderStatus: text(order, "status"),
    statusLabel: text(data, "statusLabel"),
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
