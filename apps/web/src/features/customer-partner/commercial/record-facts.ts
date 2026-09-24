import type { SupportedCurrency } from "@/src/features/shared/format";

/**
 * A commercial record's display facts: what the record says, with no language
 * in it.
 *
 * The collection and detail surfaces render these with the reader's
 * translator and formatting locale (`record-presentation.ts`). A record that
 * carries no facts -- a production projection, or a demo record written
 * before its fixture had them -- shows its own display strings as written.
 *
 * Dates are calendar dates (`YYYY-MM-DD`); amounts are integer minor units in
 * the record's currency. Nothing here is pre-rendered.
 */
export interface CommercialFacts {
  /**
   * The public status these facts describe. When a later action moves the
   * record to another status, the status-dependent facts (timing and next
   * action) no longer describe it and are not used.
   */
  readonly status: string;
  /**
   * The context line a person would have typed (demo-authored text, already
   * resolved to the reader's language by the demo read boundary). Absent when
   * the line is entirely product-written, as for a receipt.
   */
  readonly description?: string;
  /** The buyer's purchase-order reference, shown verbatim after the line. */
  readonly purchaseOrder?: string;
  /** A settled invoice's receipt and the account it was paid from. */
  readonly receipt?: { readonly reference: string; readonly last4: string };
  readonly value: CommercialValueFact;
  readonly valueLabel: CommercialValueLabel;
  readonly timing: CommercialTimingFact;
  readonly term: CommercialTermFact;
  readonly next: CommercialNextFact;
}

export type CommercialValueFact =
  | {
      readonly kind: "money";
      readonly currency: SupportedCurrency;
      readonly amountMinor: string;
    }
  | { readonly kind: "date"; readonly on: string }
  /** Share of committed capacity in use, 0 to 1. */
  | { readonly kind: "capacityUsed"; readonly ratio: number }
  /** Share of the provisioning checklist complete, 0 to 1. */
  | { readonly kind: "provisioningReady"; readonly ratio: number }
  | { readonly kind: "daysLeft"; readonly days: number }
  | { readonly kind: "readyToConvert" };

export const commercialValueLabels = [
  "termEnd",
  "responseDue",
  "estimatedAnnualSpend",
  "acceptedEstimatedSpend",
  "canceledEstimate",
  "committedAnnualSpend",
  "capacityUsage",
  "provisioning",
  "timeRemaining",
  "outcome",
  "invoicedAmount",
] as const;
export type CommercialValueLabel = (typeof commercialValueLabels)[number];

export const commercialTimingKinds = [
  "updated",
  "expires",
  "accepted",
  "canceled",
  "started",
  "starts",
  "metered",
  "completed",
  "due",
  "providerConfirmed",
] as const;
export interface CommercialTimingFact {
  readonly kind: (typeof commercialTimingKinds)[number];
  readonly on: string;
}

export type CommercialTermFact =
  | {
      readonly kind: "period";
      readonly start: string;
      readonly end: string;
      readonly noticeOn?: string;
      readonly autoRenews?: boolean;
    }
  | { readonly kind: "pendingExecution" }
  /** Ends with another agreement; `agreement` is that agreement's title. */
  | { readonly kind: "coterminous"; readonly agreement: string }
  | {
      readonly kind: "quote";
      readonly months: number;
      readonly expiresOn?: string;
      readonly acceptedOn?: string;
    }
  | { readonly kind: "canceledBeforeAcceptance" }
  | { readonly kind: "endsOn"; readonly on: string }
  | { readonly kind: "startsOn"; readonly on: string }
  | { readonly kind: "pocExpires"; readonly on: string }
  | { readonly kind: "evaluationComplete" }
  | {
      readonly kind: "servicePeriod";
      readonly start: string;
      readonly end: string;
    };

export const commercialNextKinds = [
  "noActionDue",
  "reviewNegotiatedTerms",
  "acceptOrCancelBeforeExpiry",
  "finishAndIssueQuote",
  "reviewAndAcceptOrder",
  "noActionsAvailable",
  "renewalNoticeOpens",
  "completeProvisioningChecklist",
  "confirmEncryptionKeyHandoff",
  "completeRestoreValidation",
  "reviewPaidConversion",
  "reviewAndPayBy",
] as const;
export interface CommercialNextFact {
  readonly kind: (typeof commercialNextKinds)[number];
  /** The date the action names, for the kinds that name one. */
  readonly on?: string;
}

const currencies: readonly string[] = ["USD", "EUR", "GBP"];
const calendarDate = /^\d{4}-\d{2}-\d{2}$/u;

type Json = Readonly<Record<string, unknown>>;

function object(value: unknown): Json | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : null;
}

function date(value: unknown): value is string {
  return typeof value === "string" && calendarDate.test(value);
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
): value is T {
  return (
    typeof value === "string" && (allowed as readonly string[]).includes(value)
  );
}

function ratio(value: unknown): value is number {
  return typeof value === "number" && value >= 0 && value <= 1;
}

function readValue(value: unknown): CommercialValueFact | null {
  const fact = object(value);
  if (!fact) return null;
  switch (fact.kind) {
    case "money":
      return oneOf(fact.currency, currencies) &&
        typeof fact.amountMinor === "string" &&
        /^-?\d+$/u.test(fact.amountMinor)
        ? {
            kind: "money",
            currency: fact.currency as SupportedCurrency,
            amountMinor: fact.amountMinor,
          }
        : null;
    case "date":
      return date(fact.on) ? { kind: "date", on: fact.on } : null;
    case "capacityUsed":
    case "provisioningReady":
      return ratio(fact.ratio) ? { kind: fact.kind, ratio: fact.ratio } : null;
    case "daysLeft":
      return Number.isInteger(fact.days) && Number(fact.days) >= 0
        ? { kind: "daysLeft", days: Number(fact.days) }
        : null;
    case "readyToConvert":
      return { kind: "readyToConvert" };
    default:
      return null;
  }
}

function readTerm(value: unknown): CommercialTermFact | null {
  const fact = object(value);
  if (!fact) return null;
  switch (fact.kind) {
    case "period":
      if (!date(fact.start) || !date(fact.end)) return null;
      if (fact.noticeOn !== undefined && !date(fact.noticeOn)) return null;
      return {
        kind: "period",
        start: fact.start,
        end: fact.end,
        ...(date(fact.noticeOn) ? { noticeOn: fact.noticeOn } : {}),
        ...(fact.autoRenews === true ? { autoRenews: true } : {}),
      };
    case "coterminous":
      return typeof fact.agreement === "string" && fact.agreement.trim()
        ? { kind: "coterminous", agreement: fact.agreement }
        : null;
    case "quote":
      if (!Number.isInteger(fact.months) || Number(fact.months) < 1)
        return null;
      if (fact.expiresOn !== undefined && !date(fact.expiresOn)) return null;
      if (fact.acceptedOn !== undefined && !date(fact.acceptedOn)) return null;
      return {
        kind: "quote",
        months: Number(fact.months),
        ...(date(fact.expiresOn) ? { expiresOn: fact.expiresOn } : {}),
        ...(date(fact.acceptedOn) ? { acceptedOn: fact.acceptedOn } : {}),
      };
    case "endsOn":
    case "startsOn":
    case "pocExpires":
      return date(fact.on) ? { kind: fact.kind, on: fact.on } : null;
    case "servicePeriod":
      return date(fact.start) && date(fact.end)
        ? { kind: "servicePeriod", start: fact.start, end: fact.end }
        : null;
    case "pendingExecution":
    case "canceledBeforeAcceptance":
    case "evaluationComplete":
      return { kind: fact.kind };
    default:
      return null;
  }
}

/**
 * Facts read back from projection data, which is untyped JSON. Anything that
 * does not match the shape exactly is treated as absent, so the record falls
 * back to its own display strings rather than rendering half a sentence.
 */
export function readCommercialFacts(
  value: unknown,
): CommercialFacts | undefined {
  const facts = object(value);
  if (!facts || typeof facts.status !== "string") return undefined;
  const display = readValue(facts.value);
  const term = readTerm(facts.term);
  const timing = object(facts.timing);
  const next = object(facts.next);
  if (
    !display ||
    !term ||
    !oneOf(facts.valueLabel, commercialValueLabels) ||
    !timing ||
    !oneOf(timing.kind, commercialTimingKinds) ||
    !date(timing.on) ||
    !next ||
    !oneOf(next.kind, commercialNextKinds) ||
    (next.on !== undefined && !date(next.on))
  )
    return undefined;
  const receipt = object(facts.receipt);
  const text = (value: unknown): value is string =>
    typeof value === "string" && value.trim().length > 0;
  return {
    status: facts.status,
    ...(text(facts.description) ? { description: facts.description } : {}),
    ...(text(facts.purchaseOrder)
      ? { purchaseOrder: facts.purchaseOrder }
      : {}),
    ...(receipt && text(receipt.reference) && text(receipt.last4)
      ? { receipt: { reference: receipt.reference, last4: receipt.last4 } }
      : {}),
    value: display,
    valueLabel: facts.valueLabel,
    timing: { kind: timing.kind, on: timing.on },
    term,
    next: { kind: next.kind, ...(date(next.on) ? { on: next.on } : {}) },
  };
}

/**
 * The `facts` member of a `CommercialRecord`, for the loader that maps a
 * projection row to one. Spread it: a row without facts adds nothing.
 */
export function commercialFactsField(data: Readonly<Record<string, unknown>>): {
  facts?: CommercialFacts;
} {
  const facts = readCommercialFacts(data.facts);
  return facts ? { facts } : {};
}
