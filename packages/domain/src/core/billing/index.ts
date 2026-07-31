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
