import type { PriceBookAdministrationRecord } from "@clockwork/db";
import type { RateCard } from "@clockwork/domain/core";

function values(rate: RateCard): Record<string, string> {
  const amount = (value: { currency: string; minor: string } | undefined) =>
    value
      ? `${value.currency} ${BigInt(value.minor) / 100n}.${(BigInt(value.minor) % 100n).toString().padStart(2, "0")}`
      : "Not configured";
  return {
    "List price": amount(rate.unitPrice),
    "Floor price": amount(rate.floorPrice),
    "Overage rate": amount(rate.overageRate),
    "Minimum quantity": rate.minimumQuantity,
    Unit: rate.unit,
    "Commitment model": rate.commitType,
    "Approved claim": rate.approvedClaim,
    "Egress treatment": rate.egressTreatment,
    "Tax code": rate.stripeTaxCode,
    "Income account": rate.qboIncomeAccount,
    "Legacy trial quantity": rate.trialLimit ?? "Not configured",
    "Transfer prices":
      Object.entries(rate.partnerTransferPrices)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([tier, value]) => `${tier}: ${amount(value)}`)
        .join("; ") || "None",
  };
}

/** Compare economic content, excluding surrogate rate identifiers. */
export function priceBookEconomicDiff(
  candidate: PriceBookAdministrationRecord,
  active: PriceBookAdministrationRecord,
): { field: string; before: string; after: string }[] {
  const changes: { field: string; before: string; after: string }[] = [];
  const previous = new Map(
    (active.rateCards ?? []).map((rate) => [
      `${rate.sku} / ${rate.region}`,
      values(rate),
    ]),
  );
  const next = new Map(
    (candidate.rateCards ?? []).map((rate) => [
      `${rate.sku} / ${rate.region}`,
      values(rate),
    ]),
  );
  for (const key of new Set([...previous.keys(), ...next.keys()])) {
    const before = previous.get(key);
    const after = next.get(key);
    for (const field of new Set([
      ...Object.keys(before ?? {}),
      ...Object.keys(after ?? {}),
    ])) {
      const oldValue = before?.[field] ?? "Rate absent";
      const newValue = after?.[field] ?? "Rate removed";
      if (oldValue !== newValue)
        changes.push({
          field: `${key} · ${field}`,
          before: oldValue,
          after: newValue,
        });
    }
  }
  const beforeMatrix = JSON.stringify(
    active.discountMatrix ?? { defaultMaxDiscountBps: 0, rules: [] },
  );
  const afterMatrix = JSON.stringify(
    candidate.discountMatrix ?? { defaultMaxDiscountBps: 0, rules: [] },
  );
  if (beforeMatrix !== afterMatrix)
    changes.push({
      field: "Discount authority",
      before: beforeMatrix,
      after: afterMatrix,
    });
  return changes;
}
