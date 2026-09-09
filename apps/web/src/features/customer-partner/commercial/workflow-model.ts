import { uuidV7 } from "@clockwork/contracts";

import { customerPartnerCopy } from "../copy";

export const quoteStageLabels = customerPartnerCopy.commercial.quoteStages;

export type QuoteStage = 1 | 2 | 3;
export type QuoteStatus = "draft" | "open" | "accepted" | "canceled";

export interface SelectorOption {
  id: string;
  label: string;
  description?: string;
}

export interface QuoteOfferOption extends SelectorOption {
  priceBookId: string;
  sku: string;
  region: string;
  currency: "USD" | "EUR" | "GBP";
}

export interface QuoteDraft {
  account: string;
  offer: string;
  region: string;
  capacity: string;
  termMonths: string;
  expiresAt: string;
}

export type QuoteField = keyof QuoteDraft;
export type QuoteErrors = Partial<Record<QuoteField, string>>;

/**
 * This intentionally supersedes the proposed five-route customer control. The
 * customer quote path can satisfy the direct-route boundary; partner resale and
 * distributor quotes derive their route from a persisted agreement, referral
 * has no quote to build, and marketplace purchasing has its own provider-backed
 * surface. Offering those routes here composed requests the server must refuse.
 */
export const customerQuoteRoute = "direct" as const;

/**
 * A draft carries no commercial facts of its own. Only the account, which the
 * session already fixes, and the region default is seeded; every priced
 * value is entered against the current price book.
 */
export function emptyQuoteDraft(accountName: string): QuoteDraft {
  return {
    account: accountName,
    offer: "",
    region: "",
    capacity: "",
    termMonths: "",
    expiresAt: "",
  };
}

export function prefilledQuoteDraft(
  accountName: string,
  initial: Partial<Pick<QuoteDraft, "capacity" | "termMonths">>,
): QuoteDraft {
  return { ...emptyQuoteDraft(accountName), ...initial };
}

export function resolveSelectorId(
  input: string,
  options: readonly SelectorOption[],
): string | undefined {
  const normalized = input.trim().toLocaleLowerCase();
  return options.find(
    (option) =>
      option.id.toLocaleLowerCase() === normalized ||
      option.label.toLocaleLowerCase() === normalized,
  )?.id;
}

export function validateQuoteStage(
  stage: QuoteStage,
  draft: QuoteDraft,
  accounts: readonly SelectorOption[],
  offers: readonly QuoteOfferOption[],
  now: Date = new Date(),
): QuoteErrors {
  const errors: QuoteErrors = {};
  if (stage === 1) {
    if (!resolveSelectorId(draft.account, accounts))
      errors.account = "Choose a customer from the available accounts.";
    if (!resolveSelectorId(draft.offer, offers))
      errors.offer = "Choose an offer from the current price book.";
  }
  if (stage === 2) {
    const capacity = Number(draft.capacity);
    if (!Number.isFinite(capacity) || capacity < 10)
      errors.capacity = "Enter a committed capacity of at least 10 TB.";
    const term = Number(draft.termMonths);
    if (!Number.isInteger(term) || term < 1 || term > 60)
      errors.termMonths = "Enter a term between 1 and 60 months.";
    const expiry = new Date(draft.expiresAt);
    if (!draft.expiresAt || Number.isNaN(expiry.valueOf()))
      errors.expiresAt = "Enter the date and time when this quote expires.";
    else if (expiry.getTime() <= now.getTime())
      errors.expiresAt = "Choose an expiry after the current time.";
  }
  return errors;
}

export function firstQuoteError(errors: QuoteErrors): QuoteField | undefined {
  const order: QuoteField[] = [
    "account",
    "offer",
    "region",
    "capacity",
    "termMonths",
    "expiresAt",
  ];
  return order.find((field) => Boolean(errors[field]));
}

export function quotePayload(
  draft: QuoteDraft,
  accounts: readonly SelectorOption[],
  offers: readonly QuoteOfferOption[],
) {
  const selectedOfferId = resolveSelectorId(draft.offer, offers);
  const offer = offers.find((candidate) => candidate.id === selectedOfferId);
  const accountId = resolveSelectorId(draft.account, accounts);
  return {
    accountId,
    payload: {
      priceBookId: offer?.priceBookId,
      seriesId: uuidV7(),
      route: customerQuoteRoute,
      lines: [
        {
          lineId: uuidV7(),
          sku: offer?.sku,
          region: offer?.region,
          quantity: draft.capacity,
          termMonths: Number(draft.termMonths),
        },
      ],
      expiresAt: new Date(draft.expiresAt).toISOString(),
    },
  };
}

export function validQuoteActions(status: QuoteStatus): readonly string[] {
  if (status === "draft") return ["edit", "issue", "cancel"];
  if (status === "open") return ["accept", "cancel"];
  if (status === "accepted") return ["create_order"];
  return [];
}

export interface OrderReviewSummary {
  quote: string;
  agreement: string;
  purchaseOrder: string;
  serviceStart: string;
  commitment: string;
}

export function orderReviewSummary(input: {
  quoteTitle: string;
  quoteVersion: string;
  agreementTitle: string;
  agreementVersion: string;
  poNumber?: string;
  serviceStart: string;
  scope: string;
  spend: string;
}): OrderReviewSummary {
  return {
    quote: `${input.quoteTitle} · version ${input.quoteVersion} · accepted`,
    agreement: `${input.agreementTitle} · version ${input.agreementVersion} · active`,
    purchaseOrder: input.poNumber || "No purchase order supplied",
    serviceStart: input.serviceStart || "Not selected",
    commitment: `${input.scope} · ${input.spend} estimated annual spend`,
  };
}
