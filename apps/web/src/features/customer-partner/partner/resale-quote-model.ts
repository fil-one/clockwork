import type { EditableQuoteLine } from "../commercial/quote-lines";
import { uuidV7 } from "@clockwork/contracts";

import type { MessageId, MessageValues, Translator } from "@/src/i18n";

/**
 * The commercial route a partner quote is written under.
 *
 * It is never a seller choice. `assertQuoteCommercialContext` in the core
 * finance repository rejects a quote whose route disagrees with the persisted
 * partner agreement type, and rejects `distributor` unless the persisted
 * transfer tier is `distributor`, so the route is resolved from those two
 * persisted facts before the form is rendered.
 */
export type QuoteRoute = "referral" | "resale" | "distributor";

/**
 * Whether the partner sets the end-client price and is merchant of record.
 *
 * It is also what decides whether this surface can write at all:
 * `core_partner_can_append_commercial_audit` admits a partner-written quote
 * audit only where `merchant_of_record = 'partner'`, so the route page stops a
 * referral partner here rather than composing a submission the database
 * refuses. The referral shape stays modelled because the command accepts it and
 * only the audit policy does not.
 */
export function partnerPricedRoute(route: QuoteRoute): boolean {
  return route === "resale" || route === "distributor";
}

/**
 * One quotable line of an activated price book: a rate card the acting partner
 * can actually be priced against.
 *
 * `sku` and `region` are the rate-card identity `priceQuote` looks up. A quote
 * that names neither -- the surface used to send a literal
 * `FIL-ARCHIVE-CAPACITY` in a region slug no rate card carried -- fails with
 * "No active rate for <sku>/<region>", which reaches the seller as a 500. No
 * price is carried here: the transfer economics stay on the internal surface
 * that owns them.
 */
export interface OfferOption {
  /** Stable key for this rate card within its book; not a persisted id. */
  id: string;
  name: string;
  priceBookId: string;
  sku: string;
  region: string;
  currency: string;
}

/**
 * An end client the acting partner holds an approved, currently protected deal
 * registration for.
 *
 * That registration is not a presentation detail: the command refuses a partner
 * quote without one, and `quotes_partner_registration_insert_guard`
 * (supabase/migrations/000934) repeats the same test as a row policy. Offering
 * any other account here would offer a quote the server cannot write.
 */
export interface EndClientOption {
  id: string;
  name: string;
  /**
   * The currency this client's quote has to be priced in. Fil One bills a
   * referral end client in the buyer's own currency and a resale end client in
   * the partner's, and the command rejects a price book that disagrees.
   */
  quoteCurrency: string;
}

/**
 * Everything this surface states that the seller did not type comes from here:
 * which partner is acting, what their agreement lets them write, which rate
 * cards they may quote from, and which end clients are theirs. The route
 * resolves all of it from the session and persisted truth, so no other party's
 * merchant boundary, price book, or client list can reach the page as a
 * checked-in constant.
 */
export interface PartnerQuoteContext {
  revision?: {
    quoteId: string;
    version: number;
    seriesId: string;
    action: "edit" | "revise";
    initialDraft: Partial<ResaleQuoteDraft>;
    lines: readonly EditableQuoteLine[];
  };
  partnerAccountId: string;
  partnerAccountName: string;
  route: QuoteRoute;
  offers: readonly OfferOption[];
  endClients: readonly EndClientOption[];
}

export interface ResaleQuoteDraft {
  offerName: string;
  capacity: string;
  termMonths: string;
  endClientName: string;
  expiresAt: string;
  resalePrice: string;
}

export type QuoteDraftField = keyof ResaleQuoteDraft;
/** A validation failure as a message the form renders in the reader's language. */
export interface QuoteProblem {
  readonly id: MessageId;
  readonly values?: MessageValues;
}
export type QuoteValidation = Partial<Record<QuoteDraftField, QuoteProblem>>;

/**
 * A money amount as a seller types it, in whole currency units.
 *
 * A German or Brazilian seller writes "1.500,50" and a British one "1,500.50";
 * both mean the same price. The last separator followed by one or two digits is
 * the decimal mark and every other separator is grouping; a lone separator
 * followed by exactly three digits is grouping ("1.500" is fifteen hundred,
 * which is the only reading a two-decimal currency allows). Anything else is
 * not an amount.
 */
export function parseDecimalAmount(input: string): number | undefined {
  const compact = input.trim().replace(/[\s\u00a0\u202f'’]/gu, "");
  if (!/^\d[\d.,]*$/u.test(compact)) return undefined;
  const last = Math.max(compact.lastIndexOf("."), compact.lastIndexOf(","));
  let normalized = compact;
  if (last >= 0) {
    const whole = compact.slice(0, last);
    const fraction = compact.slice(last + 1);
    // Grouping uses the other separator from the decimal mark, and one kind.
    const groupedBy = (mark: "." | ",") =>
      mark === "." ? /^\d{1,3}(?:\.\d{3})*$/u : /^\d{1,3}(?:,\d{3})*$/u;
    const groupMark = compact[last] === "." ? "," : ".";
    if (
      /^\d{1,2}$/u.test(fraction) &&
      (/^\d+$/u.test(whole) || groupedBy(groupMark).test(whole))
    )
      normalized = `${whole.replaceAll(groupMark, "")}.${fraction}`;
    else if (
      fraction.length === 3 &&
      (groupedBy(".").test(compact) || groupedBy(",").test(compact))
    )
      normalized = compact.replace(/[.,]/gu, "");
    else return undefined;
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? value : undefined;
}

/** The typed resale amount in minor units, or undefined when it is not one. */
export function resaleMinorUnits(input: string): number | undefined {
  const value = parseDecimalAmount(input);
  if (value === undefined) return undefined;
  const minor = Math.round(value * 100);
  return Number.isSafeInteger(minor) ? minor : undefined;
}

/**
 * How far ahead an untouched draft proposes to expire. A fixed calendar date
 * would validate until it passed and then fail every first submission, so the
 * default is always measured from the clock the form is opened against.
 */
export const quoteExpiryLeadDays = 30;

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * `datetime-local` carries wall-clock time with no zone, and both the validator
 * and the payload read it back as local time, so the default is formatted in
 * the same local terms rather than as an ISO instant.
 */
export function defaultQuoteExpiry(now: Date): string {
  const expiry = new Date(now.getTime() + quoteExpiryLeadDays * 86_400_000);
  return localQuoteExpiry(expiry);
}

export function localQuoteExpiry(expiry: Date): string {
  return (
    `${expiry.getFullYear()}-${twoDigits(expiry.getMonth() + 1)}-` +
    `${twoDigits(expiry.getDate())}T${twoDigits(expiry.getHours())}:` +
    twoDigits(expiry.getMinutes())
  );
}

/**
 * A draft carries no commercial facts of its own. Only the derived expiry is
 * seeded; the offer, end client, commitment, and resale price are the seller's
 * to enter against their own price book.
 */
export function emptyResaleQuoteDraft(now: Date): ResaleQuoteDraft {
  return {
    offerName: "",
    capacity: "",
    termMonths: "",
    endClientName: "",
    expiresAt: defaultQuoteExpiry(now),
    resalePrice: "",
  };
}

export function resolveOption<T extends { name: string }>(
  name: string,
  options: readonly T[],
): T | undefined {
  const normalized = name.trim().toLocaleLowerCase();
  return options.find(
    (option) => option.name.toLocaleLowerCase() === normalized,
  );
}

export function resolveSelectorId(
  name: string,
  options: readonly { id: string; name: string }[],
): string | undefined {
  return resolveOption(name, options)?.id;
}

/**
 * The offers that can price the selected client's quote.
 *
 * Before a client is named every offer the partner holds is selectable; once
 * one is, only the books in that client's billing currency are, because
 * `assertQuoteCommercialContext` refuses any other with "Commercial billing
 * currency does not match the price book".
 */
export function quotableOffers(
  context: Pick<PartnerQuoteContext, "offers" | "endClients">,
  endClientName: string,
): readonly OfferOption[] {
  const client = resolveOption(endClientName, context.endClients);
  if (!client) return context.offers;
  return context.offers.filter(
    (offer) => offer.currency === client.quoteCurrency,
  );
}

export function validateResaleQuoteStage(
  stage: 1 | 2 | 3,
  draft: ResaleQuoteDraft,
  context: Pick<PartnerQuoteContext, "offers" | "endClients" | "route">,
  now = new Date(),
): QuoteValidation {
  const errors: QuoteValidation = {};
  const offer = resolveOption(draft.offerName, context.offers);
  if (stage >= 1 && !offer)
    errors.offerName = { id: "partner.quote.new.error.offer" };
  if (stage >= 2) {
    // An empty field reads as zero here, which every bound below rejects.
    const capacity = Number(draft.capacity);
    if (!Number.isFinite(capacity) || capacity < 10)
      errors.capacity = { id: "partner.quote.new.error.capacity" };
    const termMonths = Number(draft.termMonths);
    if (!Number.isInteger(termMonths) || termMonths < 1)
      errors.termMonths = { id: "partner.quote.new.error.term" };
    const client = resolveOption(draft.endClientName, context.endClients);
    if (!client)
      errors.endClientName = { id: "partner.quote.new.error.endClient" };
    // The server refuses a book whose currency is not the one this client is
    // billed in, so the mismatch is named here rather than at submission.
    else if (offer && offer.currency !== client.quoteCurrency)
      errors.offerName = {
        id: "partner.quote.new.error.currency",
        values: { currency: client.quoteCurrency, client: client.name },
      };
    const expiry = Date.parse(draft.expiresAt);
    if (!Number.isFinite(expiry) || expiry <= now.getTime())
      errors.expiresAt = { id: "partner.quote.new.error.expiry" };
    // A referral quote is billed by Fil One and carries no partner-set price;
    // the command rejects one that does.
    if (partnerPricedRoute(context.route)) {
      const resaleMinor = resaleMinorUnits(draft.resalePrice);
      if (resaleMinor === undefined || resaleMinor <= 0)
        errors.resalePrice = { id: "partner.quote.new.error.resalePrice" };
    }
  }
  return errors;
}

const routeLabels = {
  referral: "partner.route.referral",
  resale: "partner.route.resale",
  distributor: "partner.route.distributor",
} as const satisfies Record<QuoteRoute, MessageId>;

export function quoteRouteLabel(route: QuoteRoute): MessageId {
  return routeLabels[route];
}

const routeConsequences = {
  referral: "partner.route.consequence.referral",
  resale: "partner.route.consequence.resale",
  distributor: "partner.route.consequence.distributor",
} as const satisfies Record<QuoteRoute, MessageId>;

export function partnerRouteConsequence(route: QuoteRoute): MessageId {
  return routeConsequences[route];
}

/** Who invoices the end client, as the command's own route rule decides it. */
export function merchantOfRecordName(
  context: Pick<PartnerQuoteContext, "route" | "partnerAccountName">,
): string {
  return partnerPricedRoute(context.route)
    ? context.partnerAccountName
    : "Fil One"; // i18n-exempt: company name, never translated
}

/**
 * The stage-three review, one sentence per line, in the reader's language.
 * Amounts and the expiry are formatted with `formatting` before they are
 * placed into a message.
 */
export function quoteReviewSummary(
  draft: ResaleQuoteDraft,
  context: Pick<
    PartnerQuoteContext,
    "route" | "partnerAccountName" | "offers" | "endClients"
  >,
  t: Translator,
  formatting: string,
): readonly string[] {
  const offer = resolveOption(draft.offerName, context.offers);
  const client = resolveOption(draft.endClientName, context.endClients);
  const currency = offer?.currency ?? client?.quoteCurrency;
  const route = t(quoteRouteLabel(context.route));
  const termMonths = Number(draft.termMonths);
  const resale = parseDecimalAmount(draft.resalePrice || "0") ?? 0;
  const expiry = draft.expiresAt ? new Date(draft.expiresAt) : undefined;
  return [
    client
      ? t("partner.quote.review.client", { client: client.name, route })
      : t("partner.quote.review.noClient", { route }),
    offer && draft.capacity && Number.isInteger(termMonths) && termMonths > 0
      ? t("partner.quote.review.line", {
          capacity: new Intl.NumberFormat(formatting, {
            style: "unit",
            unit: "terabyte",
            maximumFractionDigits: 3,
          }).format(Number(draft.capacity)),
          sku: offer.sku,
          region: offer.region,
          term: t("partner.term.months", { count: termMonths }),
        })
      : t("partner.quote.review.lineIncomplete"),
    partnerPricedRoute(context.route)
      ? t("partner.quote.review.resalePrice", {
          amount: currency
            ? new Intl.NumberFormat(formatting, {
                style: "currency",
                currency,
              }).format(resale)
            : new Intl.NumberFormat(formatting, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              }).format(resale),
        })
      : t("partner.quote.review.referralPrice"),
    expiry && Number.isFinite(expiry.getTime())
      ? t("partner.quote.review.expiry", {
          time: new Intl.DateTimeFormat(formatting, {
            dateStyle: "medium",
            timeStyle: "short",
          }).format(expiry),
        })
      : t("partner.quote.review.expiryUnset"),
    t("partner.quote.review.merchant", {
      merchant: merchantOfRecordName(context),
    }),
    t("partner.quote.review.transferNote"),
  ];
}

export function resaleQuotePayload(
  draft: ResaleQuoteDraft,
  context: PartnerQuoteContext,
) {
  const offer = resolveOption(draft.offerName, context.offers);
  const client = resolveOption(draft.endClientName, context.endClients);
  // Invariants the stage validation already enforced; never shown to a reader.
  if (!offer || !client)
    throw new Error("Quote selectors have not been resolved."); // i18n-exempt: internal invariant, not rendered
  if (offer.currency !== client.quoteCurrency)
    throw new Error("Quote currency does not match the end client."); // i18n-exempt: internal invariant, not rendered
  const partnerPriced = partnerPricedRoute(context.route);
  return {
    priceBookId: offer.priceBookId,
    seriesId: uuidV7(),
    route: context.route,
    endClientAccountId: client.id,
    // The server rejects a quote whose partner is not the acting account, so
    // this is read from the session rather than named on the client.
    partnerAccountId: context.partnerAccountId,
    lines: [
      {
        lineId: uuidV7(),
        // The rate card the selected offer is, not a literal the price book
        // has never carried.
        sku: offer.sku,
        region: offer.region,
        quantity: draft.capacity,
        termMonths: Number(draft.termMonths),
      },
    ],
    // `partnerTier` is deliberately absent: the repository takes the transfer
    // tier from the persisted partner and rejects a caller-supplied one that
    // disagrees, so asserting it here could only ever break a valid quote.
    ...(partnerPriced
      ? {
          partnerResaleTotal: {
            currency: offer.currency,
            minor: String(resaleMinorUnits(draft.resalePrice) ?? 0),
          },
        }
      : {}),
    expiresAt: new Date(draft.expiresAt).toISOString(),
  };
}
