import { uuidV7 } from "@clockwork/contracts";

import type { MessageId, Translator } from "@/src/i18n";

/** The three quote-creation stages, in order, as message IDs. */
export const quoteStageLabels = [
  "customer.commercial.builder.stage.offer",
  "customer.commercial.builder.stage.terms",
  "customer.commercial.builder.stage.review",
] as const satisfies readonly MessageId[];

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
/** Each invalid field and the message that says why, as a message ID. */
export type QuoteErrors = Partial<Record<QuoteField, MessageId>>;

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
  initial: Partial<Omit<QuoteDraft, "account">>,
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
      errors.account = "customer.commercial.quoteError.account";
    if (!resolveSelectorId(draft.offer, offers))
      errors.offer = "customer.commercial.quoteError.offer";
  }
  if (stage === 2) {
    const capacity = Number(draft.capacity);
    if (!Number.isFinite(capacity) || capacity < 10)
      errors.capacity = "customer.commercial.quoteError.capacity";
    const term = Number(draft.termMonths);
    if (!Number.isInteger(term) || term < 1 || term > 60)
      errors.termMonths = "customer.commercial.quoteError.term";
    const expiry = new Date(draft.expiresAt);
    if (!draft.expiresAt || Number.isNaN(expiry.valueOf()))
      errors.expiresAt = "customer.commercial.quoteError.expiry";
    else if (expiry.getTime() <= now.getTime())
      errors.expiresAt = "customer.commercial.quoteError.expiryFuture";
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

/**
 * What the acceptance panel shows the signer, one row per bound input.
 *
 * `agreement` is null when the account has no governing agreement on record;
 * the row then says exactly that rather than composing a title, version and
 * "active" around a sentence.
 */
export function orderReviewSummary(
  input: {
    quoteTitle: string;
    quoteVersion: string;
    agreement: { title: string; version: string } | null;
    poNumber?: string;
    serviceStart: string;
    scope: string;
    spend: string;
  },
  t: Translator,
): OrderReviewSummary {
  return {
    quote: t("customer.commercial.review.quote", {
      title: input.quoteTitle,
      version: input.quoteVersion,
    }),
    agreement: input.agreement
      ? t("customer.commercial.review.agreement", {
          title: input.agreement.title,
          version: input.agreement.version,
        })
      : t("customer.commercial.review.noAgreement"),
    purchaseOrder:
      input.poNumber || t("customer.commercial.review.noPurchaseOrder"),
    serviceStart:
      input.serviceStart || t("customer.commercial.accept.notSelected"),
    commitment: t("customer.commercial.review.commitment", {
      scope: input.scope,
      spend: input.spend,
    }),
  };
}
