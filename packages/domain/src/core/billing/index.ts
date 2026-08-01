import type { Currency, Money } from "@clockwork/contracts";

export type CollectionPolicy =
  | { kind: "prepay" }
  | { kind: "auto_charge"; retryPolicy: "stripe_smart_retries" }
  | { kind: "net_terms"; days: number; collectionsOwnerId: string };

export interface BillableOrder {
  orderId: string;
  accountId: string;
  invoicingAccountId: string;
  endClientAccountId: string;
  partnerAccountId?: string;
  sourcing: "direct" | "referral" | "resale" | "distributor" | "marketplace";
  poNumber?: string;
  amount: Money;
  taxCode: string;
  description: string;
}

export interface ConsolidatedInvoiceDraft {
  invoicingAccountId: string;
  currency: Currency;
  groups: readonly {
    endClientAccountId: string;
    lines: readonly BillableOrder[];
    subtotal: Money;
  }[];
  total: Money;
  poNumbers: readonly string[];
}

export function consolidateInvoices(
  orders: readonly BillableOrder[],
): ConsolidatedInvoiceDraft[] {
  const invoices = new Map<string, BillableOrder[]>();
  for (const order of orders) {
    if (
      (order.sourcing === "resale" || order.sourcing === "distributor") &&
      order.invoicingAccountId !== order.partnerAccountId
    )
      throw new Error(
        "Resale orders must invoice the partner, never its end client",
      );
    const key = `${order.invoicingAccountId}:${order.amount.currency}`;
    invoices.set(key, [...(invoices.get(key) ?? []), order]);
  }
  return [...invoices.values()].map((lines) => {
    const firstLine = lines[0];
    if (!firstLine) throw new Error("Invoice group unexpectedly empty");
    const currency = firstLine.amount.currency;
    const groups = new Map<string, BillableOrder[]>();
    lines.forEach((line) =>
      groups.set(line.endClientAccountId, [
        ...(groups.get(line.endClientAccountId) ?? []),
        line,
      ]),
    );
    const grouped = [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([endClientAccountId, group]) => ({
        endClientAccountId,
        lines: group,
        subtotal: {
          currency,
          minor: group
            .reduce((sum, line) => sum + BigInt(line.amount.minor), 0n)
            .toString(),
        } as Money,
      }));
    return {
      invoicingAccountId: firstLine.invoicingAccountId,
      currency,
      groups: grouped,
      total: {
        currency,
        minor: lines
          .reduce((sum, line) => sum + BigInt(line.amount.minor), 0n)
          .toString(),
      } as Money,
      poNumbers: [
        ...new Set(
          lines.flatMap((line) => (line.poNumber ? [line.poNumber] : [])),
        ),
      ].sort(),
    };
  });
}

export interface CreditExposureInput {
  currency: Currency;
  creditLimitMinor: bigint;
  openInvoiceMinor: bigint;
  uninvoicedProvisionedMinor: bigint;
  proposedNewServiceMinor: bigint;
}

export function partnerCreditDecision(input: CreditExposureInput): {
  currentExposure: Money;
  projectedExposure: Money;
  allowNewService: boolean;
  affectRunningServices: false;
} {
  if (
    input.creditLimitMinor < 0n ||
    input.openInvoiceMinor < 0n ||
    input.uninvoicedProvisionedMinor < 0n ||
    input.proposedNewServiceMinor < 0n
  )
    throw new Error("Credit exposure values cannot be negative");
  const current = input.openInvoiceMinor + input.uninvoicedProvisionedMinor;
  const projected = current + input.proposedNewServiceMinor;
  return {
    currentExposure: {
      currency: input.currency,
      minor: current.toString(),
    } as Money,
    projectedExposure: {
      currency: input.currency,
      minor: projected.toString(),
    } as Money,
    allowNewService: projected <= input.creditLimitMinor,
    affectRunningServices: false,
  };
}

export interface DunningInput {
  policy: CollectionPolicy;
  dueAt: string;
  now: string;
  firstThresholdDays: number;
  secondThresholdDays: number;
  maximumRetentionAt?: string;
  retentionLiabilityRule:
    "liable_through_retention" | "capped_at_paid_term" | "custom";
}

export function dunningDecision(input: DunningInput): {
  agingDays: number;
  actions: readonly (
    | "stripe_smart_retry"
    | "notify_collections_owner"
    | "pause_new_orders"
    | "pause_poc_conversions"
    | "human_suspension_review"
    | "write_suspension_only"
    | "retention_blocks_deletion"
  )[];
  collectionsOwnerId?: string;
} {
  const due = Date.parse(input.dueAt);
  const now = Date.parse(input.now);
  if (Number.isNaN(due) || Number.isNaN(now))
    throw new Error("Dunning instants are invalid");
  if (
    input.firstThresholdDays < 0 ||
    input.secondThresholdDays <= input.firstThresholdDays
  )
    throw new Error("Dunning thresholds must be ordered");
  const agingDays = Math.max(0, Math.floor((now - due) / 86_400_000));
  const actions: (
    | "stripe_smart_retry"
    | "notify_collections_owner"
    | "pause_new_orders"
    | "pause_poc_conversions"
    | "human_suspension_review"
    | "write_suspension_only"
    | "retention_blocks_deletion"
  )[] = [];
  if (input.policy.kind === "auto_charge") actions.push("stripe_smart_retry");
  if (input.policy.kind === "net_terms")
    actions.push("notify_collections_owner");
  if (agingDays >= input.firstThresholdDays)
    actions.push("pause_new_orders", "pause_poc_conversions");
  if (agingDays >= input.secondThresholdDays) {
    actions.push("human_suspension_review", "write_suspension_only");
    if (input.maximumRetentionAt && Date.parse(input.maximumRetentionAt) > now)
      actions.push("retention_blocks_deletion");
  }
  return {
    agingDays,
    actions,
    ...(input.policy.kind === "net_terms"
      ? { collectionsOwnerId: input.policy.collectionsOwnerId }
      : {}),
  };
}

export function creditAmount(input: {
  invoiceRemaining: Money;
  requested: Money;
  alreadyRefundedOrCredited: Money;
}): Money {
  if (
    input.invoiceRemaining.currency !== input.requested.currency ||
    input.requested.currency !== input.alreadyRefundedOrCredited.currency
  )
    throw new Error("Credit currencies differ");
  const requested = BigInt(input.requested.minor);
  const remaining = BigInt(input.invoiceRemaining.minor);
  const prior = BigInt(input.alreadyRefundedOrCredited.minor);
  if (requested <= 0n || prior < 0n || requested + prior > remaining)
    throw new Error("Credit exceeds the remaining invoice amount");
  return input.requested;
}

export interface StripeFinancialEvent {
  id: string;
  type: string;
  created: number;
  objectId: string;
  status: string;
  amountMinor?: string;
  currency?: Currency;
  invoiceId?: string;
  paymentIntentId?: string;
  receiptUrl?: string;
}

export function projectStripeTruth(events: readonly StripeFinancialEvent[]): {
  projections: Readonly<Record<string, StripeFinancialEvent>>;
  duplicates: readonly string[];
  ignoredOutOfOrder: readonly string[];
} {
  const eventIds = new Set<string>();
  const duplicates: string[] = [];
  const ignoredOutOfOrder: string[] = [];
  const projections: Record<string, StripeFinancialEvent> = {};
  for (const event of events) {
    if (eventIds.has(event.id)) {
      duplicates.push(event.id);
      continue;
    }
    eventIds.add(event.id);
    const current = projections[event.objectId];
    if (
      current &&
      (event.created < current.created ||
        (event.created === current.created && event.id < current.id))
    ) {
      ignoredOutOfOrder.push(event.id);
      continue;
    }
    projections[event.objectId] = event;
  }
  return { projections, duplicates, ignoredOutOfOrder };
}

export type StripeAdjustmentStatus = "pending" | "succeeded" | "failed";

export interface PersistedStripeAdjustment {
  adjustmentId: string;
  kind: "credit_note" | "refund";
  providerObjectId: string;
  sourceObjectId: string;
  amount: Money;
  status: StripeAdjustmentStatus;
  watermark?: { eventId: string; created: number };
}

export interface StripeAdjustmentProjection extends PersistedStripeAdjustment {
  watermark?: { eventId: string; created: number };
}

function adjustmentStatus(
  adjustment: PersistedStripeAdjustment,
  event: StripeFinancialEvent,
): StripeAdjustmentStatus | undefined {
  if (adjustment.kind === "refund") {
    // refund.created proves only that Stripe accepted creation; later signed
    // refund.updated events carry the authoritative pending/final status.
    if (event.type !== "refund.updated") return undefined;
    if (event.status === "pending" || event.status === "requires_action")
      return "pending";
    if (event.status === "succeeded") return "succeeded";
    if (event.status === "failed" || event.status === "canceled")
      return "failed";
    return undefined;
  }
  if (
    event.type !== "credit_note.created" &&
    event.type !== "credit_note.updated" &&
    event.type !== "credit_note.voided"
  )
    return undefined;
  if (event.status === "issued") return "succeeded";
  if (event.status === "void" || event.type === "credit_note.voided")
    return "failed";
  return event.status === "draft" ? "pending" : undefined;
}

function afterWatermark(
  event: StripeFinancialEvent,
  watermark: PersistedStripeAdjustment["watermark"],
): boolean {
  return (
    !watermark ||
    event.created > watermark.created ||
    (event.created === watermark.created && event.id > watermark.eventId)
  );
}

/**
 * Projects only signed, binding-matched adjustment events onto persisted
 * commands. Every adjustment has its own watermark, even when several refunds
 * share one payment intent or several credit notes share one invoice.
 */
export function projectStripeAdjustmentTruth(input: {
  adjustments: readonly PersistedStripeAdjustment[];
  events: readonly StripeFinancialEvent[];
}): {
  projections: Readonly<Record<string, StripeAdjustmentProjection>>;
  duplicates: readonly string[];
  ignored: readonly string[];
  rejected: readonly { eventId: string; reason: string }[];
} {
  const projections: Record<string, StripeAdjustmentProjection> = {};
  const byProviderObject = new Map<string, PersistedStripeAdjustment>();
  for (const adjustment of input.adjustments) {
    if (byProviderObject.has(adjustment.providerObjectId))
      throw new Error("Stripe adjustment provider binding must be unique");
    byProviderObject.set(adjustment.providerObjectId, adjustment);
    projections[adjustment.adjustmentId] = { ...adjustment };
  }
  const eventIds = new Set<string>();
  const duplicates: string[] = [];
  const ignored: string[] = [];
  const rejected: { eventId: string; reason: string }[] = [];
  for (const event of input.events) {
    if (eventIds.has(event.id)) {
      duplicates.push(event.id);
      continue;
    }
    eventIds.add(event.id);
    const persisted = byProviderObject.get(event.objectId);
    if (!persisted) {
      rejected.push({ eventId: event.id, reason: "provider_object_unbound" });
      continue;
    }
    const current = projections[persisted.adjustmentId];
    if (!current)
      throw new Error("Stripe adjustment projection was not seeded");
    const status = adjustmentStatus(persisted, event);
    if (!status) {
      ignored.push(event.id);
      continue;
    }
    const sourceObjectId =
      persisted.kind === "refund" ? event.paymentIntentId : event.invoiceId;
    if (sourceObjectId !== persisted.sourceObjectId) {
      rejected.push({ eventId: event.id, reason: "source_binding_mismatch" });
      continue;
    }
    if (
      event.amountMinor === undefined ||
      event.currency === undefined ||
      event.amountMinor !== persisted.amount.minor ||
      event.currency !== persisted.amount.currency
    ) {
      rejected.push({ eventId: event.id, reason: "money_binding_mismatch" });
      continue;
    }
    if (!afterWatermark(event, current.watermark)) {
      ignored.push(event.id);
      continue;
    }
    if (
      (current.status === "succeeded" || current.status === "failed") &&
      current.status !== status
    ) {
      rejected.push({ eventId: event.id, reason: "terminal_status_conflict" });
      continue;
    }
    projections[persisted.adjustmentId] = {
      ...current,
      status,
      watermark: { eventId: event.id, created: event.created },
    };
  }
  return { projections, duplicates, ignored, rejected };
}
