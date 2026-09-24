import type { Route } from "next";

import type { CoreCommandInput } from "@/src/features/contracts/commerce-client";

import type { SupportedCurrency } from "../../shared/format";
import { CommercialStop } from "./failure-message";
import {
  quotePayload,
  type QuoteOfferOption,
  type SelectorOption,
} from "./workflow-model";

export const SELF_SERVE_CAPACITY_CEILING_TB = 100;
export const SELF_SERVE_TERM_MONTHS = 12;
export const SELF_SERVE_MINIMUM_TB = 10;

export interface BuyDraft {
  offerId: string;
  capacity: string;
}

export function initialBuyDraft(offers: readonly QuoteOfferOption[]): BuyDraft {
  return { offerId: offers[0]?.id ?? "", capacity: "" };
}

export function buyCapacity(draft: BuyDraft): number | null {
  const capacity = Number(draft.capacity);
  return Number.isFinite(capacity) && capacity >= SELF_SERVE_MINIMUM_TB
    ? capacity
    : null;
}

export function needsFullQuote(
  draft: BuyDraft,
  thresholdTb = SELF_SERVE_CAPACITY_CEILING_TB,
): boolean {
  const capacity = buyCapacity(draft);
  return capacity !== null && capacity >= thresholdTb;
}

export function quoteHandoff(draft: BuyDraft): Route {
  const capacity = buyCapacity(draft);
  const parameters = new URLSearchParams({
    ...(capacity === null ? {} : { capacity: String(capacity) }),
    term: String(SELF_SERVE_TERM_MONTHS),
  });
  return `/quotes/new?${parameters.toString()}` as Route;
}

export function buyQuoteExpiry(now: Date): string {
  return new Date(now.getTime() + 14 * 24 * 60 * 60 * 1_000).toISOString();
}

export function buildBuyQuoteCommand(input: {
  draft: BuyDraft;
  account: SelectorOption;
  offers: readonly QuoteOfferOption[];
  quoteId: string;
  now: Date;
  thresholdTb?: number;
}): CoreCommandInput {
  const capacity = buyCapacity(input.draft);
  if (capacity === null)
    throw new CommercialStop("customer.commercial.buy.error.capacityMinimum");
  if (needsFullQuote(input.draft, input.thresholdTb))
    throw new CommercialStop("customer.commercial.buy.error.fullQuote");
  const quoted = quotePayload(
    {
      account: input.account.label,
      offer: input.draft.offerId,
      region: "",
      capacity: String(capacity),
      termMonths: String(SELF_SERVE_TERM_MONTHS),
      expiresAt: buyQuoteExpiry(input.now),
    },
    [input.account],
    input.offers,
  );
  if (!quoted.accountId || !quoted.payload.priceBookId)
    throw new CommercialStop("customer.commercial.buy.error.offerUnavailable");
  return {
    resource: "quotes",
    id: input.quoteId,
    accountId: quoted.accountId,
    action: "create",
    payload: quoted.payload,
  };
}

/** The server's total for the draft, as facts; the page formats it. */
export interface ServerPrice {
  totalMinor: string;
  currency: SupportedCurrency;
}

function recordData(value: unknown): Readonly<Record<string, unknown>> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = (value as { record?: unknown }).record;
  if (!record || typeof record !== "object" || Array.isArray(record))
    return null;
  const data = (record as { data?: unknown }).data;
  return data && typeof data === "object" && !Array.isArray(data)
    ? (data as Readonly<Record<string, unknown>>)
    : null;
}

export function serverPrice(value: unknown): ServerPrice | null {
  const data = recordData(value);
  const totalMinor = data?.totalMinor;
  const currency = data?.currency;
  if (
    typeof totalMinor !== "string" ||
    !/^\d+$/.test(totalMinor) ||
    (currency !== "USD" && currency !== "EUR" && currency !== "GBP")
  )
    return null;
  return { totalMinor, currency };
}

export function createdRowVersion(value: unknown): number {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as { record?: unknown }).record
      : undefined;
  const rowVersion =
    record && typeof record === "object" && !Array.isArray(record)
      ? (record as { rowVersion?: unknown }).rowVersion
      : undefined;
  if (!Number.isInteger(rowVersion) || Number(rowVersion) < 1)
    throw new CommercialStop("customer.commercial.buy.error.responseInvalid");
  return Number(rowVersion);
}

export function requiresPricingReview(value: unknown): boolean {
  return recordData(value)?.marginFloorResult === "exception_required";
}
