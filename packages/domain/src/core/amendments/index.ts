import type { Money } from "@clockwork/contracts";

import { divideRound, parseDecimal, formatDecimal } from "../decimal";
import type { AcceptedOrder, OrderLineSnapshot } from "../orders";

export type AmendmentKind =
  "upgrade" | "downgrade" | "term_extension" | "co_termination" | "mixed";

export interface AmendmentDelta {
  orderLineId?: string;
  sku: string;
  quantityDelta: string;
  fullPeriodPriceDelta: Money;
}

export interface CommercialAmendment {
  id: string;
  orderId: string;
  effectiveOn: string;
  kind: AmendmentKind;
  prorationMethod: "daily" | "monthly" | "none";
  deltas: readonly (AmendmentDelta & { proratedPriceDelta: Money })[];
  supersededLineIds: readonly string[];
  resultingServiceEndsOn?: string;
  documentId: string;
  acceptedAt: string;
}

function localDateMs(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new Error("Invalid contractual date");
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed)) throw new Error("Invalid contractual date");
  return parsed;
}

function wholeDays(from: string, to: string): bigint {
  const result = BigInt(
    Math.round((localDateMs(to) - localDateMs(from)) / 86_400_000),
  );
  if (result < 0n) throw new Error("Proration range is inverted");
  return result;
}

/**
 * The day-count convention and billable fraction one proration method resolves
 * to over one service period. `core_amendment_financial_terms` persists these
 * three values beside the amendment, so the fraction has to be the same object
 * `prorateMoney` divides by rather than a second reading of the same rule.
 */
export interface ProrationFraction {
  convention: "actual_actual" | "actual_365" | "thirty_360" | "none";
  numerator: bigint;
  denominator: bigint;
}

export function prorationFraction(input: {
  method: "daily" | "monthly" | "none";
  effectiveOn: string;
  periodStartsOn: string;
  periodEndsOn: string;
}): ProrationFraction {
  if (
    input.effectiveOn < input.periodStartsOn ||
    input.effectiveOn > input.periodEndsOn
  )
    throw new Error("Amendment effective date lies outside the service period");
  if (input.method === "none")
    return { convention: "none", numerator: 1n, denominator: 1n };
  if (input.method === "daily") {
    const total = wholeDays(input.periodStartsOn, input.periodEndsOn);
    const remaining = wholeDays(input.effectiveOn, input.periodEndsOn);
    // A same-day period bills whole: there is no denominator to divide by.
    if (total === 0n)
      return { convention: "actual_actual", numerator: 1n, denominator: 1n };
    return {
      convention: "actual_actual",
      numerator: remaining,
      denominator: total,
    };
  }
  const [startYear, startMonth] = input.periodStartsOn.split("-").map(Number);
  const [endYear, endMonth] = input.periodEndsOn.split("-").map(Number);
  const [effectiveYear, effectiveMonth] = input.effectiveOn
    .split("-")
    .map(Number);
  if (
    startYear === undefined ||
    startMonth === undefined ||
    endYear === undefined ||
    endMonth === undefined ||
    effectiveYear === undefined ||
    effectiveMonth === undefined
  )
    throw new Error("Invalid monthly proration date");
  const totalMonths = (endYear - startYear) * 12 + endMonth - startMonth;
  const remainingMonths =
    (endYear - effectiveYear) * 12 + endMonth - effectiveMonth;
  if (totalMonths <= 0)
    return { convention: "thirty_360", numerator: 1n, denominator: 1n };
  return {
    convention: "thirty_360",
    numerator: BigInt(Math.max(0, remainingMonths)),
    denominator: BigInt(totalMonths),
  };
}

export function prorateMoney(input: {
  amount: Money;
  method: "daily" | "monthly" | "none";
  effectiveOn: string;
  periodStartsOn: string;
  periodEndsOn: string;
}): Money {
  const fraction = prorationFraction({
    method: input.method,
    effectiveOn: input.effectiveOn,
    periodStartsOn: input.periodStartsOn,
    periodEndsOn: input.periodEndsOn,
  });
  if (fraction.numerator === fraction.denominator) return input.amount;
  return {
    currency: input.amount.currency,
    minor: divideRound(
      BigInt(input.amount.minor) * fraction.numerator,
      fraction.denominator,
    ).toString(),
  } as Money;
}

export function createAmendment(input: {
  id: string;
  order: AcceptedOrder;
  effectiveOn: string;
  kind: AmendmentKind;
  prorationMethod: "daily" | "monthly" | "none";
  deltas: readonly AmendmentDelta[];
  newServiceEndsOn?: string;
  documentId: string;
  acceptedAt: string;
}): CommercialAmendment {
  if (!input.order.serviceEndsOn)
    throw new Error("Termless orders cannot be amended with term proration");
  const serviceEndsOn = input.order.serviceEndsOn;
  if (
    input.effectiveOn < input.order.serviceStartsOn ||
    input.effectiveOn > serviceEndsOn
  )
    throw new Error("Amendment effective date is outside the order term");
  if (
    input.deltas.length === 0 &&
    input.kind !== "term_extension" &&
    input.kind !== "co_termination"
  )
    throw new Error("Commercial amendment requires a delta");
  const lineIds = new Set(input.order.lines.map((line) => line.id));
  const superseded = new Set<string>();
  const deltas = input.deltas.map((delta) => {
    const quantity = parseDecimal(delta.quantityDelta, true);
    if (quantity === 0n)
      throw new Error("Amendment quantity delta cannot be zero");
    if (delta.orderLineId) {
      if (!lineIds.has(delta.orderLineId))
        throw new Error("Amendment supersedes a line outside the parent order");
      if (superseded.has(delta.orderLineId))
        throw new Error("Order line may be superseded once per amendment");
      superseded.add(delta.orderLineId);
    }
    if (
      delta.fullPeriodPriceDelta.currency !==
      input.order.lines[0]?.unitPrice.currency
    )
      throw new Error("Amendment currency must match the order");
    return {
      ...delta,
      proratedPriceDelta: prorateMoney({
        amount: delta.fullPeriodPriceDelta,
        method: input.prorationMethod,
        effectiveOn: input.effectiveOn,
        periodStartsOn: input.order.serviceStartsOn,
        periodEndsOn: serviceEndsOn,
      }),
    };
  });
  if (
    input.kind === "upgrade" &&
    deltas.some((delta) => parseDecimal(delta.quantityDelta, true) < 0n)
  )
    throw new Error("Upgrade amendments cannot reduce quantity");
  if (
    input.kind === "downgrade" &&
    deltas.some((delta) => parseDecimal(delta.quantityDelta, true) > 0n)
  )
    throw new Error("Downgrade amendments cannot increase quantity");
  if (input.newServiceEndsOn && input.newServiceEndsOn < input.effectiveOn)
    throw new Error("Resulting term end precedes amendment effective date");
  return Object.freeze({
    id: input.id,
    orderId: input.order.id,
    effectiveOn: input.effectiveOn,
    kind: input.kind,
    prorationMethod: input.prorationMethod,
    deltas: Object.freeze(deltas),
    supersededLineIds: Object.freeze([...superseded]),
    ...(input.newServiceEndsOn
      ? { resultingServiceEndsOn: input.newServiceEndsOn }
      : {}),
    documentId: input.documentId,
    acceptedAt: input.acceptedAt,
  });
}

/**
 * What ONE delta does to the line it supersedes, applied to the line's CURRENT
 * state: quantity and full-period line total, both signed, with the floor that
 * a committed quantity cannot go negative.
 *
 * `applyAmendment` uses it to build the replacement snapshot a supersession
 * stores. The floor belongs here because `applyAmendment` is handed the order
 * as it stands now and one amendment being accepted against it, so the state it
 * produces is a state the order is actually about to be in.
 *
 * It is deliberately NOT the fold in `amendOrderState`. Applying it once per
 * already-accepted amendment, in some ordering of that set, judges intermediate
 * states the order was never in and nobody ever validated. See the fold below.
 */
function supersededLineState(
  line: OrderLineSnapshot,
  delta: AmendmentDelta,
): { quantity: string; lineTotal: Money } {
  const nextQuantity =
    parseDecimal(line.quantity) + parseDecimal(delta.quantityDelta, true);
  if (nextQuantity < 0n)
    throw new Error("Amendment would make committed quantity negative");
  return {
    quantity: formatDecimal(nextQuantity),
    lineTotal: {
      currency: line.lineTotal.currency,
      minor: (
        BigInt(line.lineTotal.minor) + BigInt(delta.fullPeriodPriceDelta.minor)
      ).toString(),
    } as Money,
  };
}

/**
 * One accepted amendment as the fold below reads it. `CommercialAmendment`
 * satisfies it structurally, and so does a set of delta lines read back from
 * `amendment_lines`, which is the only persisted record of the full-period
 * figures an amendment moved.
 *
 * `effectiveOn` is carried because callers have it and because the amendment is
 * not meaningful without it, not because the fold reads it. It does not: see
 * `amendOrderState`.
 */
export interface AmendmentDeltaSet {
  readonly id: string;
  readonly effectiveOn: string;
  readonly deltas: readonly AmendmentDelta[];
}

/**
 * The order's CURRENT committed state: the accepted-order snapshot with every
 * amendment already accepted for it folded back onto the lines those amendments
 * addressed.
 *
 * This exists because `core_order_line_snapshots` is immutable — correctly so,
 * it is the priced evidence the order was signed on — and therefore never
 * reflects an amendment. Validating a new amendment against it compares every
 * amendment to the ORIGINAL order rather than to what the order is now, so N
 * sequential downgrades each see the original quantity and none of them ever
 * runs out of it. The snapshot is not mutated here; the current state is
 * computed from it.
 *
 * Two floors, and the difference between them is deliberate:
 *
 *   * Quantity is floored per line. A line cannot commit a negative quantity;
 *     there is nothing to provision and nothing to meter.
 *   * Revenue is floored across the ORDER, not per line. An order whose total
 *     committed revenue is negative owes the customer money, which is a credit
 *     note and not an amendment — `mutateInvoice` already refuses to bill it.
 *     Flooring each line instead would refuse a legitimate amendment that moves
 *     money between lines, and a control that blocks a legitimate write is as
 *     serious as one that permits a wrong number.
 *
 * The returned lines are exactly the order's own lines, carrying their own
 * identifiers, because a subsequent amendment addresses a line by its
 * `order_lines` identity and nothing else. Lines an amendment ADDED are counted
 * in the revenue floor — leaving them out would understate committed revenue
 * and refuse a downgrade the added revenue plainly covers — but they are not
 * returned: they have no `order_lines` row, so no later amendment can supersede
 * one, and offering their synthetic identifiers as supersedable would turn a
 * clean domain refusal into a foreign-key violation.
 *
 * THAT MAKES THIS FUNCTION NON-IDEMPOTENT, AND CALLERS MUST FOLD ONCE.
 *
 * Added revenue is counted and the added line is not returned, so the result is
 * an order whose stated lines total LESS than the committed revenue this call
 * just approved. Feed that result back in as the base of a second fold and the
 * difference is simply gone: the second call re-derives committed revenue from
 * the order's own lines, sees only the negative half of a line swap, and
 * refuses. `mutateAmendment` composed exactly those two calls and bricked any
 * order that had swapped a line out for a more valuable replacement — every
 * later amendment refused for a negative committed revenue the order did not
 * have, down to a term extension carrying no deltas at all. The property this
 * function establishes holds within one call and is destroyed by composition,
 * so the whole history goes into one call:
 *
 *     amendOrderState(orderedSnapshot, [...persistedAmendments, newAmendment])
 *
 * Per-line sums are identical either way — addition is associative — and only
 * the single fold reaches the right total.
 *
 * KNOWN MODELLING GAP, recorded and not fixed here: an amendment-added line has
 * no `order_lines` row, so `createAmendment` cannot address it. A delta that
 * omits `orderLineId` is read as added revenue whatever its sign, positive or
 * negative, and there is no per-added-line quantity to floor. An added line can
 * therefore never be reduced or removed as a line — only offset in the
 * order-level total — and nothing checks that the offset stops at what was
 * added. Closing it needs a persisted identity for an amendment-added line,
 * which is larger than this function.
 *
 * THE FOLD IS UNORDERED, AND BOTH FLOORS JUDGE ONLY THE FINAL STATE.
 *
 * This function used to sort the set by `(effectiveOn, id)` and apply the
 * per-line quantity floor at every step of the resulting replay. Three separate
 * things were wrong with that, and the third is the one that brought an order
 * down:
 *
 *   * The sort is not the order the amendments were ACCEPTED in. Nothing here
 *     records acceptance order, and `amendments.id` is the caller's uuid, so
 *     for two amendments sharing an effective date the tiebreaker is
 *     effectively random and the same persisted history could fold two ways on
 *     two reads.
 *   * The fold does not need an order. A line's committed quantity is its
 *     ordered quantity plus the sum of the signed quantity deltas addressed to
 *     it, and its committed line total is its ordered total plus the sum of the
 *     signed full-period price deltas. Addition of signed values is commutative
 *     and associative, and `parseDecimal` scales to a fixed 18 places so the
 *     quantity sum is exact bigint arithmetic with no rounding to reorder. The
 *     total is therefore independent of the sequence, and sorting could only
 *     ever have changed which intermediate values were visited.
 *   * Those intermediate values are not states of the order. Effective-date
 *     order matters for BILLING — which period a delta lands in, what
 *     proration applies — and `core_amendment_financial_terms` is where that
 *     lives. It does not describe a sequence of committed states the order
 *     passed through. Each amendment was validated when it was ACCEPTED,
 *     against the state that existed then. An order can legitimately take an
 *     upgrade effective in January and then, later, accept a downgrade
 *     backdated to the previous August: replayed by effective date the
 *     downgrade folds first, against a quantity that had not yet been raised,
 *     and dips below zero. Refusing that dip refuses a state that never
 *     existed and was never anyone's commitment — and because the refusal
 *     happens while computing the BASELINE, it does not merely refuse one
 *     amendment: every subsequent amendment fails before it is even read, and
 *     the order is permanently unamendable while its persisted history is in
 *     fact perfectly consistent.
 *
 * So the floors judge the folded result and nothing else. The quantity floor
 * per line and the revenue floor across the order are exactly the two
 * conditions every acceptance already established for itself, which is why
 * refusing them here can never refuse a legitimately accepted history: after N
 * accepted amendments the folded state IS the state the Nth acceptance checked.
 * What survives is a genuine corruption check — persisted deltas that sum to a
 * negative committed quantity or a negative committed revenue cannot have come
 * from this write path, so the caller is right to refuse to judge anything
 * against them.
 */
export function amendOrderState(
  order: AcceptedOrder,
  amendments: readonly AmendmentDeltaSet[],
): AcceptedOrder {
  const lines = order.lines.map((line) => ({ ...line }));
  const lineIds = new Set(lines.map((line) => line.id));
  let addedRevenueMinor = 0n;
  const quantityDeltaByLine = new Map<string, bigint>();
  const revenueDeltaByLine = new Map<string, bigint>();
  for (const amendment of amendments)
    for (const delta of amendment.deltas) {
      if (!delta.orderLineId) {
        // `applyAmendment` refuses a new line that begins negative, so an added
        // line can only ever have raised committed quantity and revenue.
        addedRevenueMinor += BigInt(delta.fullPeriodPriceDelta.minor);
        continue;
      }
      const lineId = delta.orderLineId;
      if (!lineIds.has(lineId))
        throw new Error("Amendment supersedes a line outside the parent order");
      quantityDeltaByLine.set(
        lineId,
        (quantityDeltaByLine.get(lineId) ?? 0n) +
          parseDecimal(delta.quantityDelta, true),
      );
      revenueDeltaByLine.set(
        lineId,
        (revenueDeltaByLine.get(lineId) ?? 0n) +
          BigInt(delta.fullPeriodPriceDelta.minor),
      );
    }
  for (const line of lines) {
    const quantity =
      parseDecimal(line.quantity) + (quantityDeltaByLine.get(line.id) ?? 0n);
    if (quantity < 0n)
      throw new Error("Amendment would make committed quantity negative");
    line.quantity = formatDecimal(quantity);
    line.lineTotal = {
      currency: line.lineTotal.currency,
      minor: (
        BigInt(line.lineTotal.minor) + (revenueDeltaByLine.get(line.id) ?? 0n)
      ).toString(),
    } as Money;
  }
  const committedRevenueMinor =
    addedRevenueMinor +
    lines.reduce((total, line) => total + BigInt(line.lineTotal.minor), 0n);
  if (committedRevenueMinor < 0n)
    throw new Error(
      "Amendment would make the order's committed revenue negative",
    );
  return Object.freeze({
    ...order,
    lines: Object.freeze(lines),
  });
}

export function applyAmendment(
  order: AcceptedOrder,
  amendment: CommercialAmendment,
): AcceptedOrder {
  if (order.id !== amendment.orderId)
    throw new Error("Amendment belongs to another order");
  const deltasByLine = new Map<
    string,
    AmendmentDelta & { proratedPriceDelta: Money }
  >();
  amendment.deltas.forEach((delta) => {
    if (delta.orderLineId) deltasByLine.set(delta.orderLineId, delta);
  });
  const replacements: OrderLineSnapshot[] = [];
  const lines: OrderLineSnapshot[] = order.lines.map((line) => {
    const delta = deltasByLine.get(line.id);
    if (!delta) return line;
    const next = supersededLineState(line, delta);
    const lineSnapshot = { ...line };
    delete lineSnapshot.supersededByAmendmentId;
    replacements.push({
      ...lineSnapshot,
      id: `${amendment.id}:${line.id}`,
      quantity: next.quantity,
      lineTotal: next.lineTotal,
    });
    return {
      ...line,
      supersededByAmendmentId: amendment.id,
    };
  });
  lines.push(...replacements);
  for (const delta of amendment.deltas.filter(
    (candidate) => !candidate.orderLineId,
  )) {
    if (parseDecimal(delta.quantityDelta, true) < 0n)
      throw new Error(
        "A new amendment line cannot begin with negative quantity",
      );
    const template = order.lines.find((line) => line.sku === delta.sku);
    if (!template)
      throw new Error(
        `No order-line pricing snapshot for amendment SKU ${delta.sku}`,
      );
    const lineSnapshot = { ...template };
    delete lineSnapshot.supersededByAmendmentId;
    lines.push({
      ...lineSnapshot,
      id: `${amendment.id}:${delta.sku}`,
      quoteLineId: template.quoteLineId,
      quantity: delta.quantityDelta,
      lineTotal: delta.fullPeriodPriceDelta,
    });
  }
  return Object.freeze({
    ...order,
    status: "amended",
    lines: Object.freeze(lines),
    ...(amendment.resultingServiceEndsOn
      ? { serviceEndsOn: amendment.resultingServiceEndsOn }
      : {}),
  });
}

export function netForecast(
  baseMinor: bigint,
  amendments: readonly CommercialAmendment[],
): bigint {
  return amendments
    .slice()
    .sort(
      (left, right) =>
        left.effectiveOn.localeCompare(right.effectiveOn) ||
        left.id.localeCompare(right.id),
    )
    .reduce(
      (total, amendment) =>
        total +
        amendment.deltas.reduce(
          (sum, delta) => sum + BigInt(delta.proratedPriceDelta.minor),
          0n,
        ),
      baseMinor,
    );
}
