import { and, asc, eq, inArray } from "drizzle-orm";

import {
  decideCommitmentOverage,
  formatDecimal,
  parseDecimal,
  reconcileCommitmentToSource,
  type CommitmentContract,
  type CommitmentLedgerDecision,
  type LedgerUsageEvent,
  type SourceUsageRecord,
} from "@clockwork/domain/core";

import type { RuntimeTransaction } from "../../client";
import {
  commitmentEntries,
  commitmentLedgers,
  entitlements,
  orders,
  quotes,
  usageEvents,
} from "../../schema";
import {
  commitmentAllowanceAdjustments,
  commitmentLedgerCorrections,
  commitmentPeriods,
} from "../../schema/core/finance";

export interface CommitmentLedgerBinding {
  ledger: typeof commitmentLedgers.$inferSelect;
  entitlement: typeof entitlements.$inferSelect;
  periodRows: readonly (typeof commitmentPeriods.$inferSelect)[];
  contract: CommitmentContract;
}

export class CommitmentLedgerError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function rfc3339(value: Date): string {
  return value.toISOString();
}

/**
 * Rebuilds the contracted shape from persisted rows only. Every input the
 * decision depends on (periods, allowance amendments, the pinned overage rate)
 * is read here so a replay cannot be influenced by a caller's payload.
 */
export async function loadCommitmentLedger(
  transaction: RuntimeTransaction,
  ledgerId: string,
): Promise<CommitmentLedgerBinding> {
  const ledger = await transaction.query.commitmentLedgers.findFirst({
    where: eq(commitmentLedgers.id, ledgerId),
  });
  if (!ledger)
    throw new CommitmentLedgerError(
      "COMMITMENT_LEDGER_NOT_FOUND",
      "Commitment ledger was not found",
    );
  const entitlement = await transaction.query.entitlements.findFirst({
    where: eq(entitlements.orderLineId, ledger.orderLineId),
  });
  if (!entitlement)
    throw new CommitmentLedgerError(
      "COMMITMENT_ENTITLEMENT_NOT_FOUND",
      "Commitment ledger has no metered entitlement",
    );
  const order = await transaction.query.orders.findFirst({
    where: eq(orders.id, ledger.orderId),
  });
  if (!order)
    throw new CommitmentLedgerError(
      "COMMITMENT_ORDER_NOT_FOUND",
      "Commitment ledger order was not found",
    );
  const quote = await transaction.query.quotes.findFirst({
    where: eq(quotes.id, order.quoteId),
  });
  if (!quote)
    throw new CommitmentLedgerError(
      "COMMITMENT_QUOTE_NOT_FOUND",
      "Commitment ledger quote was not found",
    );
  const periods = await transaction.query.commitmentPeriods.findMany({
    where: eq(commitmentPeriods.ledgerId, ledger.id),
    orderBy: [asc(commitmentPeriods.sequence)],
  });
  if (periods.length === 0)
    throw new CommitmentLedgerError(
      "COMMITMENT_PERIODS_MISSING",
      "Commitment ledger has no contracted periods",
    );
  const [first] = periods;
  if (!first)
    throw new CommitmentLedgerError(
      "COMMITMENT_PERIODS_MISSING",
      "Commitment ledger has no contracted periods",
    );
  // One order line pins one overage rate and one contractual zone; a divergent
  // period would make the invoiceable amount ambiguous.
  for (const period of periods) {
    if (period.contractedOverageRateMinor !== first.contractedOverageRateMinor)
      throw new CommitmentLedgerError(
        "COMMITMENT_RATE_DIVERGED",
        "Commitment periods must share their contracted overage rate",
      );
    if (period.contractualTimeZone !== first.contractualTimeZone)
      throw new CommitmentLedgerError(
        "COMMITMENT_TIME_ZONE_DIVERGED",
        "Commitment periods must share their contractual time zone",
      );
  }
  const adjustments =
    await transaction.query.commitmentAllowanceAdjustments.findMany({
      where: eq(commitmentAllowanceAdjustments.ledgerId, ledger.id),
      orderBy: [
        asc(commitmentAllowanceAdjustments.effectiveAt),
        asc(commitmentAllowanceAdjustments.id),
      ],
    });
  return {
    ledger,
    entitlement,
    periodRows: periods,
    contract: {
      ledgerId: ledger.id,
      orderId: ledger.orderId,
      orderLineId: ledger.orderLineId,
      commitType:
        ledger.commitType === "term_drawdown"
          ? "term_drawdown"
          : "period_allowance",
      timeZone: first.contractualTimeZone,
      periods: periods.map((period) => ({
        id: period.id,
        startsAt: rfc3339(period.startsAt),
        endsAt: rfc3339(period.endsAt),
        allowance: period.allowanceQuantity,
        partial: false,
      })),
      contractedOverageRate: {
        currency: quote.currency,
        minor: first.contractedOverageRateMinor.toString(),
      } as CommitmentContract["contractedOverageRate"],
      allowanceAdjustments: adjustments.map((adjustment) => ({
        id: adjustment.id,
        effectiveAt: rfc3339(adjustment.effectiveAt),
        quantityDelta: adjustment.quantityDelta,
        reason: adjustment.reason as "amendment" | "renewal" | "correction",
      })),
    },
  };
}

export async function loadLedgerUsageEvents(
  transaction: RuntimeTransaction,
  entitlementId: string,
): Promise<readonly LedgerUsageEvent[]> {
  const rows = await transaction.query.usageEvents.findMany({
    where: eq(usageEvents.entitlementId, entitlementId),
    orderBy: [asc(usageEvents.measuredAt), asc(usageEvents.id)],
  });
  return rows.map((row) => ({
    id: row.id,
    externalEventId: row.externalEventId,
    measuredAt: rfc3339(row.measuredAt),
    recordedAt: rfc3339(row.createdAt),
    quantity: row.quantity,
    source: row.kind,
    kind: row.ledgerKind === "correction" ? "correction" : "usage",
    ...(row.correctsUsageEventId
      ? { correctionOf: row.correctsUsageEventId }
      : {}),
  }));
}

export interface CommitmentReplay {
  binding: CommitmentLedgerBinding;
  events: readonly LedgerUsageEvent[];
  decision: CommitmentLedgerDecision;
}

/**
 * The ledger, not a provider meter threshold, decides whether overage exists.
 * The source stream is replayed in full on every call so late delivery, an
 * out-of-order correction, and an allowance amendment all land on the same
 * balance regardless of the order the platform learned about them.
 */
export async function replayCommitmentLedger(
  transaction: RuntimeTransaction,
  ledgerId: string,
): Promise<CommitmentReplay> {
  const binding = await loadCommitmentLedger(transaction, ledgerId);
  const events = await loadLedgerUsageEvents(
    transaction,
    binding.entitlement.id,
  );
  const decision = decideCommitmentOverage(
    binding.contract,
    events,
    binding.ledger.rowVersion,
  );
  return { binding, events, decision };
}

export interface LedgerTrailCorrection {
  reasonCode: string;
  sourceReference: string;
  recordedBy: string;
  recordedAt: Date;
  /** "always" records an operator-declared correction even at zero drift. */
  append: "always" | "on_drift";
  quantityDelta?: string;
  periodId?: string;
  reversesEntryId?: string;
}

export interface AppliedCommitmentDecision {
  decision: CommitmentLedgerDecision;
  entriesAppended: number;
  correctionId?: string;
}

/**
 * Projects a decision onto the append-only trail and the materialized balances.
 * Entries already written are never rewritten; when late usage changes an
 * earlier position in the stream, the difference is booked as an explicit
 * correction so the trail always sums to the authoritative overage.
 */
export async function applyCommitmentDecision(
  transaction: RuntimeTransaction,
  replay: CommitmentReplay,
  trail: LedgerTrailCorrection,
  now: Date,
): Promise<AppliedCommitmentDecision> {
  const { binding, decision } = replay;
  const existingEntries = await transaction.query.commitmentEntries.findMany({
    where: eq(commitmentEntries.ledgerId, binding.ledger.id),
  });
  const recorded = new Set(existingEntries.map((entry) => entry.usageEventId));
  const pending = decision.entries.filter(
    (entry) => !recorded.has(entry.eventId),
  );
  if (pending.length > 0)
    await transaction.insert(commitmentEntries).values(
      pending.map((entry) => ({
        ledgerId: binding.ledger.id,
        usageEventId: entry.eventId,
        quantity: entry.quantity,
        overageQuantity: entry.overageDelta,
        recordedAt: new Date(entry.recordedAt),
      })),
    );

  const periodVersions = new Map(
    binding.periodRows.map((period) => [period.id, period]),
  );
  for (const balance of decision.periods) {
    const period = periodVersions.get(balance.periodId);
    if (!period)
      throw new CommitmentLedgerError(
        "COMMITMENT_PERIOD_NOT_LOADED",
        "Commitment period balance has no persisted period",
      );
    // A contractual window that has ended is closed here so the meter-and-true-up
    // schedule sees a settled period rather than an open one.
    const closing =
      period.status === "open" && period.endsAt.getTime() <= now.getTime();
    const [updated] = await transaction
      .update(commitmentPeriods)
      .set({
        consumedQuantity: balance.consumed,
        overageQuantity: balance.overage,
        ...(closing ? { status: "closed", closedAt: now } : {}),
      })
      .where(
        and(
          eq(commitmentPeriods.id, balance.periodId),
          eq(commitmentPeriods.rowVersion, period.rowVersion),
        ),
      )
      .returning({ id: commitmentPeriods.id });
    if (!updated)
      throw new CommitmentLedgerError(
        "STALE_COMMITMENT_PERIOD_VERSION",
        "Commitment period changed during this command",
      );
  }

  const [ledgerRow] = await transaction
    .update(commitmentLedgers)
    .set({
      consumedQuantity: decision.totalConsumed,
      overageQuantity: decision.totalOverage,
    })
    .where(
      and(
        eq(commitmentLedgers.id, binding.ledger.id),
        eq(commitmentLedgers.rowVersion, binding.ledger.rowVersion),
      ),
    )
    .returning();
  if (!ledgerRow)
    throw new CommitmentLedgerError(
      "STALE_COMMITMENT_LEDGER_VERSION",
      "Commitment ledger changed during this command",
    );

  const trailTotal = await ledgerTrailOverage(transaction, binding.ledger.id);
  const authoritative = parseDecimal(decision.totalOverage, true);
  const drift = authoritative - trailTotal;
  let correctionId: string | undefined;
  if (drift !== 0n || trail.append === "always") {
    const [correction] = await transaction
      .insert(commitmentLedgerCorrections)
      .values({
        ledgerId: binding.ledger.id,
        ...(trail.periodId ? { periodId: trail.periodId } : {}),
        ...(trail.reversesEntryId
          ? { reversesEntryId: trail.reversesEntryId }
          : {}),
        quantityDelta: trail.quantityDelta ?? "0",
        overageDelta: formatDecimal(drift),
        reasonCode: trail.reasonCode,
        sourceReference: trail.sourceReference,
        recordedBy: trail.recordedBy,
        recordedAt: trail.recordedAt,
      })
      .returning({ id: commitmentLedgerCorrections.id });
    if (!correction)
      throw new CommitmentLedgerError(
        "COMMITMENT_CORRECTION_WRITE_FAILED",
        "Ledger correction was not appended",
      );
    correctionId = correction.id;
  }
  return {
    decision,
    entriesAppended: pending.length,
    ...(correctionId ? { correctionId } : {}),
  };
}

async function ledgerTrailOverage(
  transaction: RuntimeTransaction,
  ledgerId: string,
): Promise<bigint> {
  const entries = await transaction.query.commitmentEntries.findMany({
    where: eq(commitmentEntries.ledgerId, ledgerId),
    columns: { overageQuantity: true },
  });
  const corrections =
    await transaction.query.commitmentLedgerCorrections.findMany({
      where: eq(commitmentLedgerCorrections.ledgerId, ledgerId),
      columns: { overageDelta: true },
    });
  return (
    entries.reduce(
      (sum, entry) => sum + parseDecimal(entry.overageQuantity, true),
      0n,
    ) +
    corrections.reduce(
      (sum, correction) => sum + parseDecimal(correction.overageDelta, true),
      0n,
    )
  );
}

export interface IngestedUsage {
  ingested: readonly string[];
  duplicates: readonly string[];
}

/**
 * Provider dedup is enforced by the persisted (entitlement, external event)
 * index, so the same event delivered twice contributes exactly once.
 */
export async function ingestUsageEvents(
  transaction: RuntimeTransaction,
  entitlementId: string,
  events: ReadonlyArray<{
    externalEventId: string;
    measuredAt: string;
    quantity: string;
    meter: string;
  }>,
): Promise<IngestedUsage> {
  if (events.length === 0)
    throw new CommitmentLedgerError(
      "USAGE_BATCH_EMPTY",
      "A usage batch must carry at least one event",
    );
  const unique = new Set(events.map((event) => event.externalEventId));
  if (unique.size !== events.length)
    throw new CommitmentLedgerError(
      "USAGE_BATCH_DUPLICATE_EVENT_ID",
      "A usage batch cannot repeat an external event id",
    );
  const inserted = await transaction
    .insert(usageEvents)
    .values(
      events.map((event) => ({
        entitlementId,
        externalEventId: event.externalEventId,
        measuredAt: new Date(event.measuredAt),
        quantity: event.quantity,
        kind: event.meter,
        ledgerKind: "usage",
      })),
    )
    .onConflictDoNothing({
      target: [usageEvents.entitlementId, usageEvents.externalEventId],
    })
    .returning({ externalEventId: usageEvents.externalEventId });
  const ingested = new Set(inserted.map((row) => row.externalEventId));
  const duplicates = [...unique].filter((id) => !ingested.has(id)).sort();
  if (duplicates.length > 0)
    await assertUnchanged(transaction, entitlementId, events, duplicates);
  return { ingested: [...ingested].sort(), duplicates };
}

/** A reused external event id must describe the same measurement. */
async function assertUnchanged(
  transaction: RuntimeTransaction,
  entitlementId: string,
  events: ReadonlyArray<{
    externalEventId: string;
    measuredAt: string;
    quantity: string;
  }>,
  duplicates: readonly string[],
): Promise<void> {
  const stored = await transaction.query.usageEvents.findMany({
    where: and(
      eq(usageEvents.entitlementId, entitlementId),
      inArray(usageEvents.externalEventId, [...duplicates]),
    ),
  });
  const byExternalId = new Map(stored.map((row) => [row.externalEventId, row]));
  for (const externalEventId of duplicates) {
    const row = byExternalId.get(externalEventId);
    const event = events.find(
      (candidate) => candidate.externalEventId === externalEventId,
    );
    if (!row || !event)
      throw new CommitmentLedgerError(
        "USAGE_EVENT_DEDUP_RACE",
        "Usage event dedup state could not be read back",
      );
    if (
      row.measuredAt.getTime() !== Date.parse(event.measuredAt) ||
      parseDecimal(row.quantity, true) !== parseDecimal(event.quantity, true)
    )
      throw new CommitmentLedgerError(
        "USAGE_EVENT_ID_REUSED_WITH_DIFFERENT_MEASUREMENT",
        "A usage event id was reused with a different measurement",
      );
  }
}

export interface CommitmentReconciliation {
  matched: boolean;
  ledgerQuantity: string;
  sourceQuantity: string;
  varianceQuantity: string;
  missingFromLedger: readonly string[];
  missingFromSource: readonly string[];
}

export function reconcileLedgerToSource(
  decision: CommitmentLedgerDecision,
  source: readonly SourceUsageRecord[],
): CommitmentReconciliation {
  const result = reconcileCommitmentToSource(decision, source);
  return {
    matched: result.matched,
    ledgerQuantity: result.ledgerQuantity,
    sourceQuantity: result.sourceQuantity,
    // core_usage_reconciliations stores variance as source minus ledger.
    varianceQuantity: formatDecimal(
      parseDecimal(result.sourceQuantity, true) -
        parseDecimal(result.ledgerQuantity, true),
    ),
    missingFromLedger: result.missingFromLedger,
    missingFromSource: result.missingFromSource,
  };
}
