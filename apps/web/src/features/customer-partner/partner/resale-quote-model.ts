import { uuidV7 } from "@clockwork/contracts";

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
export type QuoteValidation = Partial<Record<QuoteDraftField, string>>;

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
    errors.offerName = "Select an available offer by name.";
  if (stage >= 2) {
    // An empty field reads as zero here, which every bound below rejects.
    const capacity = Number(draft.capacity);
    if (!Number.isFinite(capacity) || capacity < 10)
      errors.capacity = "Enter at least 10 TB of committed capacity.";
    const termMonths = Number(draft.termMonths);
    if (!Number.isInteger(termMonths) || termMonths < 1)
      errors.termMonths = "Enter a whole term of at least one month.";
    const client = resolveOption(draft.endClientName, context.endClients);
    if (!client)
      errors.endClientName = "Select a registered end client by name.";
    // The server refuses a book whose currency is not the one this client is
    // billed in, so the mismatch is named here rather than at submission.
    else if (offer && offer.currency !== client.quoteCurrency)
      errors.offerName = `Select an offer priced in ${client.quoteCurrency}, the billing currency for ${client.name}.`;
    const expiry = Date.parse(draft.expiresAt);
    if (!Number.isFinite(expiry) || expiry <= now.getTime())
      errors.expiresAt = "Choose an expiry after the current time.";
    // A referral quote is billed by Fil One and carries no partner-set price;
    // the command rejects one that does.
    if (partnerPricedRoute(context.route)) {
      const resaleMinor = Math.round(Number(draft.resalePrice) * 100);
      if (!Number.isSafeInteger(resaleMinor) || resaleMinor <= 0)
        errors.resalePrice = "Enter a positive partner resale price.";
    }
  }
  return errors;
}

const routeLabels: Readonly<Record<QuoteRoute, string>> = {
  referral: "Referral",
  resale: "Resale",
  distributor: "Two-tier distributor",
};

export function quoteRouteLabel(route: QuoteRoute): string {
  return routeLabels[route];
}

export function partnerRouteConsequence(route: QuoteRoute): string {
  if (route === "referral")
    return "Fil One is merchant of record, contracts with and invoices the named end client, and pays commission under the persisted referral agreement.";
  if (route === "distributor")
    return "This route is available only because the account's saved transfer tier is distributor. The quote records the partner as merchant of record and Fil One prices it at that saved transfer tier.";
  return "The partner is merchant of record to the named end client. Fil One prices and invoices the partner account at its saved transfer tier; the partner sets the resale price.";
}

/** Who invoices the end client, as the command's own route rule decides it. */
export function merchantOfRecordName(
  context: Pick<PartnerQuoteContext, "route" | "partnerAccountName">,
): string {
  return partnerPricedRoute(context.route)
    ? context.partnerAccountName
    : "Fil One";
}

export function quoteReviewSummary(
  draft: ResaleQuoteDraft,
  context: Pick<
    PartnerQuoteContext,
    "route" | "partnerAccountName" | "offers" | "endClients"
  >,
): readonly string[] {
  const offer = resolveOption(draft.offerName, context.offers);
  const client = resolveOption(draft.endClientName, context.endClients);
  const currency = offer?.currency ?? client?.quoteCurrency ?? "";
  return [
    `${client?.name ?? "No end client selected"} · ${quoteRouteLabel(context.route)}`,
    `${draft.capacity || "No"} TB of ${offer?.sku ?? "no offer"} in ${offer?.region ?? "no region"} for ${draft.termMonths || "no"} months`,
    partnerPricedRoute(context.route)
      ? `Partner resale price: ${currency} ${Number(draft.resalePrice || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : "Fil One prices and invoices this referral; the partner sets no end-client price.",
    `Quote expires ${draft.expiresAt ? new Date(draft.expiresAt).toLocaleString("en-US") : "after selection"}`,
    `Merchant of record: ${merchantOfRecordName(context)}`,
    "The authoritative transfer price is calculated from the selected price book.",
  ];
}

export function resaleQuotePayload(
  draft: ResaleQuoteDraft,
  context: PartnerQuoteContext,
) {
  const offer = resolveOption(draft.offerName, context.offers);
  const client = resolveOption(draft.endClientName, context.endClients);
  if (!offer || !client)
    throw new Error("Quote selectors have not been resolved.");
  if (offer.currency !== client.quoteCurrency)
    throw new Error("Quote currency does not match the end client.");
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
            minor: String(Math.round(Number(draft.resalePrice) * 100)),
          },
        }
      : {}),
    expiresAt: new Date(draft.expiresAt).toISOString(),
  };
}
