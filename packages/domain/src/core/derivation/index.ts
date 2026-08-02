import {
  addQuantities,
  compareQuantities,
  formatDecimal,
  multiplyMinorByQuantity,
  parseDecimal,
} from "../decimal";

/**
 * Read-only reconstruction of a billed amount from the rows that produced it.
 *
 * Every input is a persisted snapshot: the quote revision the order was priced
 * from, the order line as ordered, the amendment that replaced it, the
 * entitlement it provisioned, the reconciled usage, the commitment period, and
 * the contracted rate. Nothing here recomputes the authority. The commitment
 * ledger stays the authority for invoiceable overage; this module reports what
 * each row contributed and names the difference when two rows disagree.
 */

export interface DerivationInvoice {
  id: string;
  reference: string;
  orderId: string;
  accountId: string;
  currency: string;
  amountMinor: string;
  status: string;
  issuedAt: string | null;
}

export interface DerivationOrder {
  id: string;
  reference: string;
  accountId: string;
  quoteId: string;
  status: string;
  serviceStartsOn: string;
  serviceEndsOn: string | null;
}

export interface DerivationOrderLine {
  id: string;
  sku: string;
  quantity: string;
  unitPriceMinor: string;
  overageRateMinor: string;
  supersededByAmendmentId: string | null;
  snapshotHash: string | null;
  snapshotCapturedAt: string | null;
}

export interface DerivationQuoteSnapshot {
  quoteId: string;
  revision: number;
  snapshotHash: string;
  issuedAt: string;
}

export interface DerivationEntitlement {
  id: string;
  orderLineId: string;
  sku: string;
  committedQuantity: string;
  region: string;
  status: string;
  activatedAt: string | null;
}

export interface DerivationUsageReconciliation {
  id: string;
  entitlementId: string;
  periodStartsAt: string;
  periodEndsAt: string;
  sourceSystem: string;
  sourceQuantity: string;
  ledgerQuantity: string;
  varianceQuantity: string;
  status: string;
  resolution: string | null;
}

export interface DerivationCommitmentPeriod {
  id: string;
  ledgerId: string;
  orderLineId: string;
  sequence: number;
  startsAt: string;
  endsAt: string;
  allowanceQuantity: string;
  consumedQuantity: string;
  overageQuantity: string;
  contractedOverageRateMinor: string;
  status: string;
}

export interface DerivationAllowanceAdjustment {
  id: string;
  ledgerId: string;
  periodId: string | null;
  effectiveAt: string;
  quantityDelta: string;
  reason: string;
  sourceReference: string;
}

export interface DerivationSupersession {
  id: string;
  amendmentId: string;
  supersededOrderLineId: string;
  effectiveOn: string;
  netQuantityDelta: string;
  netRevenueDeltaMinor: string;
}

export interface InvoiceDerivationInput {
  invoice: DerivationInvoice;
  order: DerivationOrder;
  orderLines: readonly DerivationOrderLine[];
  quoteSnapshot: DerivationQuoteSnapshot | null;
  entitlements: readonly DerivationEntitlement[];
  usageReconciliations: readonly DerivationUsageReconciliation[];
  commitmentPeriods: readonly DerivationCommitmentPeriod[];
  allowanceAdjustments: readonly DerivationAllowanceAdjustment[];
  supersessions: readonly DerivationSupersession[];
}

export const derivationStepKeys = [
  "quote",
  "order_line",
  "entitlement",
  "usage",
  "commitment",
  "rate",
  "invoice_line",
] as const;
export type DerivationStepKey = (typeof derivationStepKeys)[number];

export const derivationNoteCodes = [
  "QUOTE_SNAPSHOT_MISSING",
  "ORDER_LINE_SNAPSHOT_MISSING",
  "LINE_SUPERSEDED",
  "ENTITLEMENT_MISSING",
  "USAGE_RECONCILIATION_MISSING",
  "USAGE_VARIANCE_OPEN",
  "COMMITMENT_PERIOD_MISSING",
  "COMMITMENT_OVERAGE_VARIANCE",
  "INVOICE_TOTAL_VARIANCE",
] as const;
export type DerivationNoteCode = (typeof derivationNoteCodes)[number];

export interface DerivationNote {
  code: DerivationNoteCode;
  orderLineId: string | null;
  message: string;
}

export interface DerivationFact {
  label: string;
  value: string;
}

export interface DerivationStep {
  key: DerivationStepKey;
  label: string;
  /** Table the step reads, so a reader can go straight to the rows. */
  source: string;
  reference: string | null;
  summary: string;
  facts: readonly DerivationFact[];
  amountMinor: string | null;
  notes: readonly DerivationNote[];
}

export interface InvoiceDerivationLine {
  orderLineId: string;
  sku: string;
  quantity: string;
  superseded: boolean;
  amountMinor: string;
  steps: readonly DerivationStep[];
}

export interface InvoiceDerivation {
  invoiceId: string;
  reference: string;
  accountId: string;
  orderId: string;
  orderReference: string;
  currency: string;
  status: string;
  lines: readonly InvoiceDerivationLine[];
  derivedTotalMinor: string;
  invoicedTotalMinor: string;
  varianceMinor: string;
  notes: readonly DerivationNote[];
}

const noteMessages: Readonly<Record<DerivationNoteCode, string>> = {
  QUOTE_SNAPSHOT_MISSING:
    "No quote snapshot is stored for this order, so the priced source cannot be shown",
  ORDER_LINE_SNAPSHOT_MISSING:
    "No order line snapshot is stored, so the line is read from its current row",
  LINE_SUPERSEDED: "An amendment replaced this line and changed its revenue",
  ENTITLEMENT_MISSING:
    "No entitlement is provisioned for this line, so usage and commitment are empty",
  USAGE_RECONCILIATION_MISSING:
    "No usage reconciliation covers this entitlement, so metered quantity is unconfirmed",
  USAGE_VARIANCE_OPEN:
    "Source usage and ledger usage differ and the variance is unresolved",
  COMMITMENT_PERIOD_MISSING:
    "No commitment period covers this line, so overage uses the order line rate",
  COMMITMENT_OVERAGE_VARIANCE:
    "Recorded overage differs from consumption above the adjusted allowance",
  INVOICE_TOTAL_VARIANCE: "Line amounts do not sum to the invoiced total",
};

function note(
  code: DerivationNoteCode,
  orderLineId: string | null = null,
): DerivationNote {
  return { code, orderLineId, message: noteMessages[code] };
}

function minor(value: string): bigint {
  if (!/^-?\d+$/.test(value)) throw new Error(`Invalid minor amount: ${value}`);
  return BigInt(value);
}

function amountFor(rateMinor: string, quantity: string): bigint {
  const rate = minor(rateMinor);
  const negativeQuantity = quantity.startsWith("-");
  const magnitude = negativeQuantity ? quantity.slice(1) : quantity;
  const product = multiplyMinorByQuantity(rate < 0n ? -rate : rate, magnitude);
  const sign = (rate < 0n ? -1n : 1n) * (negativeQuantity ? -1n : 1n);
  return product * sign;
}

/** Allowance after every adjustment recorded against the period or its ledger. */
function adjustedAllowance(
  period: DerivationCommitmentPeriod,
  adjustments: readonly DerivationAllowanceAdjustment[],
): string {
  return adjustments.reduce(
    (allowance, adjustment) =>
      addQuantities(allowance, adjustment.quantityDelta),
    period.allowanceQuantity,
  );
}

function expectedOverage(consumed: string, allowance: string): string {
  const difference =
    parseDecimal(consumed, true) - parseDecimal(allowance, true);
  return formatDecimal(difference > 0n ? difference : 0n);
}

function quoteStep(
  snapshot: DerivationQuoteSnapshot | null,
  order: DerivationOrder,
): DerivationStep {
  if (!snapshot)
    return {
      key: "quote",
      label: "Priced source",
      source: "core_quote_snapshots",
      reference: order.quoteId,
      summary: "Quote snapshot not stored",
      facts: [{ label: "Quote", value: order.quoteId }],
      amountMinor: null,
      notes: [note("QUOTE_SNAPSHOT_MISSING")],
    };
  return {
    key: "quote",
    label: "Priced source",
    source: "core_quote_snapshots",
    reference: snapshot.quoteId,
    summary: `Quote revision ${snapshot.revision} issued ${snapshot.issuedAt}`,
    facts: [
      { label: "Quote", value: snapshot.quoteId },
      { label: "Revision", value: String(snapshot.revision) },
      { label: "Snapshot hash", value: snapshot.snapshotHash },
    ],
    amountMinor: null,
    notes: [],
  };
}

function orderLineStep(
  line: DerivationOrderLine,
  supersessions: readonly DerivationSupersession[],
  contractedMinor: bigint,
  supersessionMinor: bigint,
): DerivationStep {
  const facts: DerivationFact[] = [
    { label: "SKU", value: line.sku },
    { label: "Ordered quantity", value: line.quantity },
    { label: "Unit price (minor)", value: line.unitPriceMinor },
    {
      label: "Snapshot hash",
      value: line.snapshotHash ?? "Not stored",
    },
  ];
  const notes: DerivationNote[] = [];
  if (!line.snapshotHash)
    notes.push(note("ORDER_LINE_SNAPSHOT_MISSING", line.id));
  for (const supersession of supersessions) {
    facts.push({
      label: `Amendment ${supersession.amendmentId} effective ${supersession.effectiveOn}`,
      value: `${supersession.netQuantityDelta} quantity, ${supersession.netRevenueDeltaMinor} minor`,
    });
    notes.push(note("LINE_SUPERSEDED", line.id));
  }
  return {
    key: "order_line",
    label: "Ordered line",
    source: "core_order_line_snapshots",
    reference: line.id,
    summary:
      supersessions.length > 0
        ? `${line.quantity} ${line.sku} as ordered, adjusted by ${supersessions.length} amendment ${supersessions.length === 1 ? "line" : "lines"}`
        : `${line.quantity} ${line.sku} as ordered`,
    facts,
    amountMinor: (contractedMinor + supersessionMinor).toString(),
    notes,
  };
}

function entitlementStep(
  line: DerivationOrderLine,
  entitlement: DerivationEntitlement | undefined,
): DerivationStep {
  if (!entitlement)
    return {
      key: "entitlement",
      label: "Entitlement",
      source: "entitlements",
      reference: null,
      summary: "No entitlement provisioned",
      facts: [],
      amountMinor: null,
      notes: [note("ENTITLEMENT_MISSING", line.id)],
    };
  return {
    key: "entitlement",
    label: "Entitlement",
    source: "entitlements",
    reference: entitlement.id,
    summary: `${entitlement.committedQuantity} ${entitlement.sku} in ${entitlement.region}, ${entitlement.status}`,
    facts: [
      { label: "Committed quantity", value: entitlement.committedQuantity },
      { label: "Region", value: entitlement.region },
      { label: "Status", value: entitlement.status },
      {
        label: "Activated",
        value: entitlement.activatedAt ?? "Not activated",
      },
    ],
    amountMinor: null,
    notes: [],
  };
}

function usageStep(
  line: DerivationOrderLine,
  entitlement: DerivationEntitlement | undefined,
  reconciliations: readonly DerivationUsageReconciliation[],
): DerivationStep {
  if (!entitlement || reconciliations.length === 0)
    return {
      key: "usage",
      label: "Reconciled usage",
      source: "core_usage_reconciliations",
      reference: null,
      summary: "No reconciliation recorded",
      facts: [],
      amountMinor: null,
      notes: entitlement ? [note("USAGE_RECONCILIATION_MISSING", line.id)] : [],
    };
  const facts = reconciliations.flatMap((reconciliation) => [
    {
      label: `${reconciliation.sourceSystem} source`,
      value: reconciliation.sourceQuantity,
    },
    {
      label: `${reconciliation.sourceSystem} ledger`,
      value: reconciliation.ledgerQuantity,
    },
    {
      label: `${reconciliation.sourceSystem} variance`,
      value: `${reconciliation.varianceQuantity} (${reconciliation.status})`,
    },
  ]);
  const open = reconciliations.filter(
    (reconciliation) =>
      reconciliation.status !== "matched" && !reconciliation.resolution,
  );
  const latest = reconciliations[
    reconciliations.length - 1
  ] as DerivationUsageReconciliation;
  return {
    key: "usage",
    label: "Reconciled usage",
    source: "core_usage_reconciliations",
    reference: latest.id,
    summary: `${latest.ledgerQuantity} metered against ${latest.sourceQuantity} at source, ${latest.periodStartsAt} to ${latest.periodEndsAt}`,
    facts,
    amountMinor: null,
    notes: open.length > 0 ? [note("USAGE_VARIANCE_OPEN", line.id)] : [],
  };
}

function commitmentStep(
  line: DerivationOrderLine,
  period: DerivationCommitmentPeriod | undefined,
  adjustments: readonly DerivationAllowanceAdjustment[],
): DerivationStep {
  if (!period)
    return {
      key: "commitment",
      label: "Commitment period",
      source: "core_commitment_periods",
      reference: null,
      summary: "No commitment period covers this line",
      facts: [],
      amountMinor: null,
      notes: [note("COMMITMENT_PERIOD_MISSING", line.id)],
    };
  const allowance = adjustedAllowance(period, adjustments);
  const overage = expectedOverage(period.consumedQuantity, allowance);
  const facts: DerivationFact[] = [
    { label: "Period", value: `${period.startsAt} to ${period.endsAt}` },
    { label: "Contracted allowance", value: period.allowanceQuantity },
    ...adjustments.map((adjustment) => ({
      label: `Allowance ${adjustment.reason} ${adjustment.effectiveAt}`,
      value: adjustment.quantityDelta,
    })),
    { label: "Adjusted allowance", value: allowance },
    { label: "Consumed", value: period.consumedQuantity },
    { label: "Recorded overage", value: period.overageQuantity },
  ];
  return {
    key: "commitment",
    label: "Commitment period",
    source: "core_commitment_periods",
    reference: period.id,
    summary: `${period.consumedQuantity} consumed against ${allowance} allowed, ${period.overageQuantity} over`,
    facts,
    amountMinor: null,
    notes:
      compareQuantities(overage, period.overageQuantity) === 0
        ? []
        : [note("COMMITMENT_OVERAGE_VARIANCE", line.id)],
  };
}

function rateStep(
  line: DerivationOrderLine,
  period: DerivationCommitmentPeriod | undefined,
  currency: string,
  contractedMinor: bigint,
  overageMinor: bigint,
): DerivationStep {
  const overageRate =
    period?.contractedOverageRateMinor ?? line.overageRateMinor;
  return {
    key: "rate",
    label: "Applied rates",
    source: period ? "core_commitment_periods" : "order_lines",
    reference: period?.id ?? line.id,
    summary: `${line.unitPriceMinor} per unit and ${overageRate} per overage unit, ${currency}`,
    facts: [
      { label: "Unit price (minor)", value: line.unitPriceMinor },
      { label: "Overage rate (minor)", value: overageRate },
      { label: "Contracted amount (minor)", value: contractedMinor.toString() },
      { label: "Overage amount (minor)", value: overageMinor.toString() },
    ],
    amountMinor: (contractedMinor + overageMinor).toString(),
    notes: [],
  };
}

function invoiceLineStep(
  line: DerivationOrderLine,
  currency: string,
  total: bigint,
): DerivationStep {
  return {
    key: "invoice_line",
    label: "Invoice line",
    source: "invoices",
    reference: line.id,
    summary: `${total.toString()} minor ${currency} billed for ${line.sku}`,
    facts: [{ label: "Line amount (minor)", value: total.toString() }],
    amountMinor: total.toString(),
    notes: [],
  };
}

/**
 * Rebuilds one invoice from its persisted inputs. A missing link never throws:
 * the step reports what is absent and the amount falls back to the rows that
 * are present, so the view answers the question even when the chain is partial.
 */
export function deriveInvoice(
  input: InvoiceDerivationInput,
): InvoiceDerivation {
  const lines = input.orderLines.map((line) => {
    const entitlement = input.entitlements.find(
      (candidate) => candidate.orderLineId === line.id,
    );
    const reconciliations = entitlement
      ? input.usageReconciliations
          .filter((candidate) => candidate.entitlementId === entitlement.id)
          .toSorted((left, right) =>
            left.periodStartsAt.localeCompare(right.periodStartsAt),
          )
      : [];
    const period = input.commitmentPeriods
      .filter((candidate) => candidate.orderLineId === line.id)
      .toSorted((left, right) => left.sequence - right.sequence)
      .at(-1);
    const adjustments = period
      ? input.allowanceAdjustments.filter(
          (candidate) =>
            candidate.periodId === period.id ||
            (candidate.periodId === null &&
              candidate.ledgerId === period.ledgerId),
        )
      : [];
    const supersessions = input.supersessions.filter(
      (candidate) => candidate.supersededOrderLineId === line.id,
    );

    const contractedMinor = amountFor(line.unitPriceMinor, line.quantity);
    const supersessionMinor = supersessions.reduce(
      (total, supersession) => total + minor(supersession.netRevenueDeltaMinor),
      0n,
    );
    const overageMinor = amountFor(
      period?.contractedOverageRateMinor ?? line.overageRateMinor,
      period?.overageQuantity ?? "0",
    );
    const lineMinor = contractedMinor + supersessionMinor + overageMinor;

    const steps: DerivationStep[] = [
      quoteStep(input.quoteSnapshot, input.order),
      orderLineStep(line, supersessions, contractedMinor, supersessionMinor),
      entitlementStep(line, entitlement),
      usageStep(line, entitlement, reconciliations),
      commitmentStep(line, period, adjustments),
      rateStep(
        line,
        period,
        input.invoice.currency,
        contractedMinor + supersessionMinor,
        overageMinor,
      ),
      invoiceLineStep(line, input.invoice.currency, lineMinor),
    ];

    return {
      orderLineId: line.id,
      sku: line.sku,
      quantity: line.quantity,
      superseded: supersessions.length > 0,
      amountMinor: lineMinor.toString(),
      steps,
    };
  });

  const derivedTotal = lines.reduce(
    (total, line) => total + minor(line.amountMinor),
    0n,
  );
  const invoicedTotal = minor(input.invoice.amountMinor);
  const variance = derivedTotal - invoicedTotal;
  const lineNotes = lines.flatMap((line) =>
    line.steps.flatMap((step) => step.notes),
  );

  return {
    invoiceId: input.invoice.id,
    reference: input.invoice.reference,
    accountId: input.invoice.accountId,
    orderId: input.order.id,
    orderReference: input.order.reference,
    currency: input.invoice.currency,
    status: input.invoice.status,
    lines,
    derivedTotalMinor: derivedTotal.toString(),
    invoicedTotalMinor: invoicedTotal.toString(),
    varianceMinor: variance.toString(),
    notes:
      variance === 0n
        ? lineNotes
        : [...lineNotes, note("INVOICE_TOTAL_VARIANCE")],
  };
}
