import type { Currency, Money } from "@clockwork/contracts";

import { divideRound } from "../decimal";

export type CommissionRevenueEvent = {
  id: string;
  invoiceId: string;
  partnerAccountId: string;
  occurredAt: string;
  type:
    "payment" | "credit_note" | "credit_note_void" | "refund" | "chargeback";
  amount: Money;
};

export interface CommissionAccrual {
  sourceEventId: string;
  invoiceId: string;
  partnerAccountId: string;
  period: string;
  netCollectedRevenue: Money;
  grossCommission: Money;
  holdback: Money;
  payable: Money;
  kind: "accrual" | "clawback";
}

function quarter(occurredAt: string): string {
  const date = new Date(occurredAt);
  if (Number.isNaN(date.valueOf()))
    throw new Error("Commission event time is invalid");
  return `${date.getUTCFullYear()}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
}

export function accrueCommission(input: {
  event: CommissionRevenueEvent;
  agreementType: "referral" | "resale" | "msp" | "embedded";
  rateBps: number;
  holdbackBps: number;
}): CommissionAccrual {
  if (input.agreementType !== "referral")
    throw new Error(
      "Commission accruals are permitted only on the referral path",
    );
  if (
    !Number.isInteger(input.rateBps) ||
    input.rateBps < 0 ||
    input.rateBps > 10_000 ||
    !Number.isInteger(input.holdbackBps) ||
    input.holdbackBps < 0 ||
    input.holdbackBps > 10_000
  )
    throw new Error("Commission and holdback rates must be basis points");
  const sourceMinor = BigInt(input.event.amount.minor);
  if (sourceMinor < 0n)
    throw new Error("Financial source events use positive absolute amounts");
  const sign = ["payment", "credit_note_void"].includes(input.event.type)
    ? 1n
    : -1n;
  const netMinor = sourceMinor * sign;
  const grossMinor = divideRound(netMinor * BigInt(input.rateBps), 10_000n);
  const holdbackMinor = divideRound(
    grossMinor * BigInt(input.holdbackBps),
    10_000n,
  );
  return {
    sourceEventId: input.event.id,
    invoiceId: input.event.invoiceId,
    partnerAccountId: input.event.partnerAccountId,
    period: quarter(input.event.occurredAt),
    netCollectedRevenue: {
      currency: input.event.amount.currency,
      minor: netMinor.toString(),
    } as Money,
    grossCommission: {
      currency: input.event.amount.currency,
      minor: grossMinor.toString(),
    } as Money,
    holdback: {
      currency: input.event.amount.currency,
      minor: holdbackMinor.toString(),
    } as Money,
    payable: {
      currency: input.event.amount.currency,
      minor: (grossMinor - holdbackMinor).toString(),
    } as Money,
    kind: sign > 0n ? "accrual" : "clawback",
  };
}

export function commissionStatement(
  partnerAccountId: string,
  period: string,
  accruals: readonly CommissionAccrual[],
): {
  partnerAccountId: string;
  period: string;
  currency: Currency;
  accruals: readonly CommissionAccrual[];
  payable: Money;
  settlementCsv: string;
} {
  const included = accruals.filter(
    (accrual) =>
      accrual.partnerAccountId === partnerAccountId &&
      accrual.period === period,
  );
  if (included.length === 0)
    throw new Error("Statement has no commission activity");
  const firstAccrual = included[0];
  if (!firstAccrual) throw new Error("Statement has no commission activity");
  const currency = firstAccrual.payable.currency;
  if (included.some((accrual) => accrual.payable.currency !== currency))
    throw new Error("Commission statement cannot mix currencies");
  const total = included.reduce(
    (sum, accrual) => sum + BigInt(accrual.payable.minor),
    0n,
  );
  const header =
    "source_event_id,invoice_id,kind,net_collected_minor,gross_commission_minor,holdback_minor,payable_minor,currency";
  const rows = included.map((accrual) =>
    [
      accrual.sourceEventId,
      accrual.invoiceId,
      accrual.kind,
      accrual.netCollectedRevenue.minor,
      accrual.grossCommission.minor,
      accrual.holdback.minor,
      accrual.payable.minor,
      accrual.payable.currency,
    ].join(","),
  );
  return {
    partnerAccountId,
    period,
    currency,
    accruals: included,
    payable: { currency, minor: total.toString() } as Money,
    settlementCsv: [header, ...rows].join("\n"),
  };
}
