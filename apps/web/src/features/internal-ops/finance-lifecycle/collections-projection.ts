import type { ProjectionRecord } from "@/src/features/experience-server/model";

import {
  allowedActions,
  authoritative,
  daysSince,
  formatMinorUnits,
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
 * One invoice as collections work.
 *
 * The internal `collections` channel is the invoice aggregate
 * (`aggregateConfiguration.invoice.internal` in the materializer), so every
 * field below is either an allowlisted invoice column or a display value
 * derived from one. Three things the retired fixture showed have no source in
 * that payload and are therefore absent rather than guessed: the dispute state,
 * the collections owner, and the last customer contact. Dispute holds are
 * enforced by the server on the command, not by this presentation.
 *
 * Money, dates and status are carried as facts (minor units and currency, ISO
 * instants, the invoice's status code); the surface formats and words them in
 * the reader's language.
 */
export interface CollectionCase {
  /** Projection record key: `invoice-<aggregateId>`. */
  id: string;
  /** Projection row identity, which the action pipeline binds a command to. */
  projectionId: string;
  /** Invoice aggregate identity. This is what a credit note is issued against. */
  invoiceId: string;
  /** The order this invoice bills, from the invoice payload. */
  orderId: string | null;
  /**
   * The account a correction must be bound to.
   *
   * It is not on the projection row: `listProjections` selects
   * `audience_account_id`, which is null for every internal record, and the
   * invoice payload carries no account either. `invoices.accountId` is set from
   * `orders.invoicingAccountId` when the invoice is drafted, and the order
   * payload does carry that column, so the account is joined through the order.
   * `null` means the order is outside this session's orders channel and no
   * correction can be bound to the invoice.
   */
  billingAccountId: string | null;
  reference: string;
  amountMinor: bigint | null;
  currency: string | null;
  /** The public status the projection states. */
  status: string | null;
  /** The invoice's own status, which the invoice status set words. */
  invoiceStatus: string | null;
  /** The read boundary's label, used only when no status code is known. */
  statusLabel: string | null;
  risk: ProjectionRisk | null;
  overdue: boolean;
  /** Whole days past the due date; `null` when no due date is recorded. */
  overdueDays: number | null;
  dueAt: string | null;
  paidAt: string | null;
  /** Only present when the payload names someone other than the record itself. */
  owner: string | null;
  nextAction: string | null;
  evidence: readonly EvidenceEntry[];
  permittedActions: readonly string[];
  version: number;
  updatedAt: string;
}

/**
 * Billing account per order, read from the internal `orders` channel.
 *
 * `orders.invoicingAccountId` is the column `invoices.accountId` is written
 * from, so this map resolves exactly the account `assertBillingAccount`
 * compares against. An order the session cannot read contributes no entry
 * rather than a placeholder.
 */
export function billingAccountsByOrder(
  orderRecords: readonly ProjectionRecord[],
): ReadonlyMap<string, string> {
  const accounts = new Map<string, string>();
  for (const record of orderRecords) {
    const invoicingAccountId = text(
      authoritative(record),
      "invoicingAccountId",
    );
    if (invoicingAccountId)
      accounts.set(record.aggregateId, invoicingAccountId);
  }
  return accounts;
}

export function collectionCaseFromProjection(
  record: ProjectionRecord,
  billingAccounts: ReadonlyMap<string, string> = new Map(),
  now: Date = new Date(),
): CollectionCase {
  const data = record.data;
  const invoice = authoritative(record);
  const owner = text(data, "owner");
  const reference = text(data, "reference") ?? record.recordKey;
  const dueAt = text(invoice, "dueAt");
  const paidAt = text(invoice, "paidAt");
  const dueDays = daysSince(dueAt, now);
  const orderId = text(invoice, "orderId");
  return {
    id: record.recordKey,
    projectionId: record.id,
    invoiceId: record.aggregateId,
    orderId,
    billingAccountId:
      (orderId ? billingAccounts.get(orderId) : undefined) ?? null,
    reference,
    amountMinor: minorUnits(text(invoice, "amountMinor")),
    currency: text(invoice, "currency"),
    status: text(data, "status"),
    invoiceStatus: text(invoice, "status"),
    statusLabel: text(data, "statusLabel"),
    risk: risk(data),
    overdue: !paidAt && dueDays !== null && dueDays > 0,
    overdueDays: !paidAt && dueDays !== null && dueDays > 0 ? dueDays : null,
    dueAt,
    paidAt,
    owner: owner && owner !== reference ? owner : null,
    nextAction: text(data, "nextAction"),
    evidence: recordEvidence(record),
    permittedActions: allowedActions(data),
    version: record.version,
    updatedAt: record.sourceUpdatedAt,
  };
}

/**
 * The operator brief's reading order for this surface: exposure first, then
 * age, then the record reference so the order is total and stable. Amounts in
 * a currency other than the row being compared are not converted -- an unknown
 * amount sorts last rather than being treated as zero, which would rank the
 * largest unreadable invoice as the smallest exposure.
 */
export function prioritizeCollectionCases(
  cases: readonly CollectionCase[],
): readonly CollectionCase[] {
  return [...cases].sort((left, right) => {
    if (left.amountMinor === null || right.amountMinor === null) {
      if (left.amountMinor !== right.amountMinor)
        return left.amountMinor === null ? 1 : -1;
    } else if (left.amountMinor !== right.amountMinor)
      return right.amountMinor > left.amountMinor ? 1 : -1;
    return (
      (right.overdueDays ?? -1) - (left.overdueDays ?? -1) ||
      left.reference.localeCompare(right.reference)
    );
  });
}

export interface CollectionsSummary {
  /** Total of every open invoice in the dominant currency. */
  openAmount: MinorAmount | null;
  openCount: number;
  overdueAmount: MinorAmount | null;
  overdueCount: number;
  /**
   * `openAmount` pre-formatted in English.
   *
   * @deprecated The operations home still reads these two strings; format the
   * `MinorAmount` fields with the reader's locale instead.
   */
  openTotal: string | null;
  /** @deprecated See `openTotal`. */
  overdueTotal: string | null;
  /** Invoices held in a currency the totals above could not include. */
  excludedByCurrency: number;
  oldestOverdueDays: number | null;
}

export function summarizeCollectionCases(
  cases: readonly CollectionCase[],
): CollectionsSummary {
  const open = cases.filter((entry) => !entry.paidAt);
  const overdue = cases.filter((entry) => entry.overdue);
  const openTotal = totalInDominantCurrency(
    open.map((entry) => ({
      minor: entry.amountMinor,
      currency: entry.currency,
    })),
  );
  const overdueTotal = totalInDominantCurrency(
    overdue.map((entry) => ({
      minor: entry.amountMinor,
      currency: entry.currency,
    })),
  );
  const ages = overdue
    .map((entry) => entry.overdueDays)
    .filter((days): days is number => days !== null);
  return {
    openAmount:
      openTotal.counted > 0
        ? { minor: openTotal.total, currency: openTotal.currency }
        : null,
    openCount: open.length,
    overdueAmount:
      overdueTotal.counted > 0
        ? { minor: overdueTotal.total, currency: overdueTotal.currency }
        : null,
    overdueCount: overdue.length,
    openTotal:
      openTotal.counted > 0
        ? formatMinorUnits(openTotal.total, openTotal.currency)
        : null,
    overdueTotal:
      overdueTotal.counted > 0
        ? formatMinorUnits(overdueTotal.total, overdueTotal.currency)
        : null,
    excludedByCurrency: openTotal.excluded,
    oldestOverdueDays: ages.length > 0 ? Math.max(...ages) : null,
  };
}
