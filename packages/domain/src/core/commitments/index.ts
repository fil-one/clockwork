import type { Money } from "@clockwork/contracts";

import {
  formatDecimal,
  multiplyMinorByQuantity,
  parseDecimal,
} from "../decimal";

export interface CommitmentPeriod {
  id: string;
  startsAt: string;
  endsAt: string;
  allowance: string;
  partial: boolean;
}

export interface AllowanceAdjustment {
  id: string;
  effectiveAt: string;
  quantityDelta: string;
  reason: "amendment" | "renewal" | "correction";
}

export interface CommitmentContract {
  ledgerId: string;
  orderId: string;
  orderLineId: string;
  commitType: "period_allowance" | "term_drawdown";
  timeZone: string;
  periods: readonly CommitmentPeriod[];
  contractedOverageRate: Money;
  allowanceAdjustments: readonly AllowanceAdjustment[];
}

export interface LedgerUsageEvent {
  id: string;
  externalEventId: string;
  measuredAt: string;
  recordedAt: string;
  quantity: string;
  source: string;
  kind: "usage" | "correction";
  correctionOf?: string;
}

export interface LedgerEntry {
  eventId: string;
  externalEventId: string;
  periodId: string;
  measuredAt: string;
  recordedAt: string;
  quantity: string;
  overageDelta: string;
  overageAmountDelta: Money;
  late: boolean;
}

export interface LedgerPeriodBalance {
  periodId: string;
  allowance: string;
  consumed: string;
  overage: string;
  startsAt: string;
  endsAt: string;
}

export interface CommitmentLedgerDecision {
  authority: "commitment_ledger";
  ledgerId: string;
  entries: readonly LedgerEntry[];
  periods: readonly LedgerPeriodBalance[];
  totalConsumed: string;
  totalOverage: string;
  overageAmount: Money;
  duplicateExternalEventIds: readonly string[];
  rowVersion: number;
}

function instant(value: string): number {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed) || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value))
    throw new Error(`Instant must be RFC 3339 with offset: ${value}`);
  return parsed;
}

export function validateCommitmentContract(
  contract: CommitmentContract,
): CommitmentContract {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: contract.timeZone }).format(0);
  } catch {
    throw new Error(`Unknown IANA time zone: ${contract.timeZone}`);
  }
  if (contract.periods.length === 0)
    throw new Error("Commitment contract requires periods");
  if (contract.commitType === "term_drawdown" && contract.periods.length !== 1)
    throw new Error("Term drawdown uses exactly one term-scoped period");
  const ordered = [...contract.periods].sort(
    (left, right) => instant(left.startsAt) - instant(right.startsAt),
  );
  const ids = new Set<string>();
  ordered.forEach((period, index) => {
    if (ids.has(period.id))
      throw new Error("Commitment period IDs must be unique");
    ids.add(period.id);
    if (instant(period.endsAt) <= instant(period.startsAt))
      throw new Error("Commitment period must have positive duration");
    parseDecimal(period.allowance);
    const prior = ordered[index - 1];
    if (prior && instant(prior.endsAt) !== instant(period.startsAt))
      throw new Error(
        "Commitment periods must be contiguous and non-overlapping",
      );
  });
  contract.allowanceAdjustments.forEach((adjustment) => {
    instant(adjustment.effectiveAt);
    parseDecimal(adjustment.quantityDelta, true);
  });
  if (BigInt(contract.contractedOverageRate.minor) < 0n)
    throw new Error("Contracted overage rate cannot be negative");
  return { ...contract, periods: ordered };
}

function periodFor(
  contract: CommitmentContract,
  measuredAt: string,
): CommitmentPeriod {
  const at = instant(measuredAt);
  const period = contract.periods.find(
    (candidate) =>
      at >= instant(candidate.startsAt) && at < instant(candidate.endsAt),
  );
  if (!period)
    throw new Error(
      `Usage measured outside contracted boundaries: ${measuredAt}`,
    );
  return period;
}

function adjustedAllowance(
  contract: CommitmentContract,
  period: CommitmentPeriod,
): bigint {
  let allowance = parseDecimal(period.allowance);
  for (const adjustment of contract.allowanceAdjustments) {
    const effective = instant(adjustment.effectiveAt);
    if (contract.commitType === "term_drawdown") {
      if (effective < instant(period.endsAt))
        allowance += parseDecimal(adjustment.quantityDelta, true);
    } else if (
      effective >= instant(period.startsAt) &&
      effective < instant(period.endsAt)
    ) {
      allowance += parseDecimal(adjustment.quantityDelta, true);
    }
  }
  if (allowance < 0n)
    throw new Error(`Allowance adjustments make period ${period.id} negative`);
  return allowance;
}

/**
 * Replays the source stream from scratch on every decision. This makes late usage,
 * corrections, reordered delivery, and amendments deterministic and keeps this
 * ledger as the sole authority for invoiceable overage.
 */
export function decideCommitmentOverage(
  rawContract: CommitmentContract,
  events: readonly LedgerUsageEvent[],
  previousRowVersion = 0,
): CommitmentLedgerDecision {
  const contract = validateCommitmentContract(rawContract);
  const seenExternal = new Set<string>();
  const duplicateExternalEventIds: string[] = [];
  const unique = events.filter((event) => {
    if (seenExternal.has(event.externalEventId)) {
      duplicateExternalEventIds.push(event.externalEventId);
      return false;
    }
    seenExternal.add(event.externalEventId);
    return true;
  });
  const ids = new Set(unique.map((event) => event.id));
  unique.forEach((event) => {
    instant(event.measuredAt);
    instant(event.recordedAt);
    const quantity = parseDecimal(event.quantity, true);
    if (event.kind === "usage" && quantity < 0n)
      throw new Error("Usage events cannot be negative; use a correction");
    if (event.kind === "correction") {
      if (!event.correctionOf || !ids.has(event.correctionOf))
        throw new Error(
          "Correction must reference an event in the reconciled source set",
        );
      if (event.correctionOf === event.id)
        throw new Error("Correction cannot reference itself");
    }
    periodFor(contract, event.measuredAt);
  });
  const ordered = unique
    .slice()
    .sort(
      (left, right) =>
        instant(left.measuredAt) - instant(right.measuredAt) ||
        (left.kind === right.kind ? 0 : left.kind === "usage" ? -1 : 1) ||
        left.id.localeCompare(right.id),
    );
  const consumption = new Map<string, bigint>();
  const periodOverage = new Map<string, bigint>();
  const entries: LedgerEntry[] = [];
  let termConsumed = 0n;
  let termOverage = 0n;
  for (const event of ordered) {
    const period = periodFor(contract, event.measuredAt);
    const quantity = parseDecimal(event.quantity, true);
    const priorPeriodConsumption = consumption.get(period.id) ?? 0n;
    const nextPeriodConsumption = priorPeriodConsumption + quantity;
    if (nextPeriodConsumption < 0n)
      throw new Error(
        `Corrections make period ${period.id} consumption negative`,
      );
    consumption.set(period.id, nextPeriodConsumption);
    let overageDelta: bigint;
    if (contract.commitType === "period_allowance") {
      const allowance = adjustedAllowance(contract, period);
      const before = periodOverage.get(period.id) ?? 0n;
      const after =
        nextPeriodConsumption > allowance
          ? nextPeriodConsumption - allowance
          : 0n;
      periodOverage.set(period.id, after);
      overageDelta = after - before;
    } else {
      const termPeriod = contract.periods[0];
      if (!termPeriod) throw new Error("Term commitment period is missing");
      const allowance = adjustedAllowance(contract, termPeriod);
      const before = termOverage;
      termConsumed += quantity;
      if (termConsumed < 0n)
        throw new Error("Corrections make term consumption negative");
      termOverage = termConsumed > allowance ? termConsumed - allowance : 0n;
      periodOverage.set(termPeriod.id, termOverage);
      overageDelta = termOverage - before;
    }
    const overageQuantity = formatDecimal(overageDelta);
    const amountMinor =
      multiplyMinorByQuantity(
        BigInt(contract.contractedOverageRate.minor),
        formatDecimal(overageDelta < 0n ? -overageDelta : overageDelta),
      ) * (overageDelta < 0n ? -1n : 1n);
    entries.push({
      eventId: event.id,
      externalEventId: event.externalEventId,
      periodId: period.id,
      measuredAt: event.measuredAt,
      recordedAt: event.recordedAt,
      quantity: event.quantity,
      overageDelta: overageQuantity,
      overageAmountDelta: {
        currency: contract.contractedOverageRate.currency,
        minor: amountMinor.toString(),
      } as Money,
      late: instant(event.recordedAt) >= instant(period.endsAt),
    });
  }
  const periodBalances = contract.periods.map((period): LedgerPeriodBalance => {
    const allowance = adjustedAllowance(contract, period);
    const consumed = consumption.get(period.id) ?? 0n;
    return {
      periodId: period.id,
      allowance: formatDecimal(allowance),
      consumed: formatDecimal(consumed),
      overage: formatDecimal(periodOverage.get(period.id) ?? 0n),
      startsAt: period.startsAt,
      endsAt: period.endsAt,
    };
  });
  const totalConsumed = [...consumption.values()].reduce(
    (sum, value) => sum + value,
    0n,
  );
  const totalOverage =
    contract.commitType === "term_drawdown"
      ? termOverage
      : [...periodOverage.values()].reduce((sum, value) => sum + value, 0n);
  return {
    authority: "commitment_ledger",
    ledgerId: contract.ledgerId,
    entries,
    periods: periodBalances,
    totalConsumed: formatDecimal(totalConsumed),
    totalOverage: formatDecimal(totalOverage),
    overageAmount: {
      currency: contract.contractedOverageRate.currency,
      minor: multiplyMinorByQuantity(
        BigInt(contract.contractedOverageRate.minor),
        formatDecimal(totalOverage),
      ).toString(),
    } as Money,
    duplicateExternalEventIds,
    rowVersion: previousRowVersion + 1,
  };
}

export interface SourceUsageRecord {
  externalEventId: string;
  quantity: string;
}

export function reconcileCommitmentToSource(
  decision: CommitmentLedgerDecision,
  source: readonly SourceUsageRecord[],
): {
  matched: boolean;
  ledgerQuantity: string;
  sourceQuantity: string;
  missingFromLedger: string[];
  missingFromSource: string[];
  variance: string;
} {
  const ledgerIds = new Set(
    decision.entries.map((entry) => entry.externalEventId),
  );
  const sourceIds = new Set(source.map((record) => record.externalEventId));
  const ledgerQuantity = decision.entries.reduce(
    (sum, entry) => sum + parseDecimal(entry.quantity, true),
    0n,
  );
  const sourceQuantity = source.reduce(
    (sum, record) => sum + parseDecimal(record.quantity, true),
    0n,
  );
  const missingFromLedger = [...sourceIds]
    .filter((id) => !ledgerIds.has(id))
    .sort();
  const missingFromSource = [...ledgerIds]
    .filter((id) => !sourceIds.has(id))
    .sort();
  return {
    matched:
      ledgerQuantity === sourceQuantity &&
      missingFromLedger.length === 0 &&
      missingFromSource.length === 0,
    ledgerQuantity: formatDecimal(ledgerQuantity),
    sourceQuantity: formatDecimal(sourceQuantity),
    missingFromLedger,
    missingFromSource,
    variance: formatDecimal(ledgerQuantity - sourceQuantity),
  };
}
