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

export function prorateMoney(input: {
  amount: Money;
  method: "daily" | "monthly" | "none";
  effectiveOn: string;
  periodStartsOn: string;
  periodEndsOn: string;
}): Money {
  if (
    input.effectiveOn < input.periodStartsOn ||
    input.effectiveOn > input.periodEndsOn
  )
    throw new Error("Amendment effective date lies outside the service period");
  if (input.method === "none") return input.amount;
  if (input.method === "daily") {
    const total = wholeDays(input.periodStartsOn, input.periodEndsOn);
    const remaining = wholeDays(input.effectiveOn, input.periodEndsOn);
    if (total === 0n) return input.amount;
    return {
      currency: input.amount.currency,
      minor: divideRound(
        BigInt(input.amount.minor) * remaining,
        total,
      ).toString(),
    } as Money;
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
  if (totalMonths <= 0) return input.amount;
  return {
    currency: input.amount.currency,
    minor: divideRound(
      BigInt(input.amount.minor) * BigInt(Math.max(0, remainingMonths)),
      BigInt(totalMonths),
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
    const nextQuantity =
      parseDecimal(line.quantity) + parseDecimal(delta.quantityDelta, true);
    if (nextQuantity < 0n)
      throw new Error("Amendment would make committed quantity negative");
    const lineSnapshot = { ...line };
    delete lineSnapshot.supersededByAmendmentId;
    replacements.push({
      ...lineSnapshot,
      id: `${amendment.id}:${line.id}`,
      quantity: formatDecimal(nextQuantity),
      lineTotal: {
        currency: line.lineTotal.currency,
        minor: (
          BigInt(line.lineTotal.minor) +
          BigInt(delta.fullPeriodPriceDelta.minor)
        ).toString(),
      } as Money,
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
