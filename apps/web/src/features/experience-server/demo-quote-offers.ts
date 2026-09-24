import "server-only";

import type { DemoAdapterState } from "@clockwork/testing/demo-state";

import type { QuoteOfferOption } from "@/src/features/customer-partner/commercial/workflow-model";
import {
  currentDemoPriceBooks,
  localizeDemoPriceBook,
} from "@/src/features/internal-ops/price-books/demo-price-books";
import type { Locale, Translator } from "@/src/i18n";

/**
 * The full demo exposes the same non-confidential offer vocabulary as the
 * database-backed loader, derived from its persisted active price books. Price
 * amounts remain server-side and are applied only by the demo command handler.
 *
 * The approved claim and the price-book name stand in for text staff typed.
 * The stored books keep the fixture's English (the pricing code reads them),
 * so they are put in the reader's language here, at this demo read boundary,
 * while they still hold the fixture's words; a name staff edited is kept.
 */
export function demoCustomerQuoteOffers(
  state: DemoAdapterState,
  t: Translator,
  locale: Locale,
): readonly QuoteOfferOption[] {
  return currentDemoPriceBooks(state)
    .map((book) => localizeDemoPriceBook(book, locale))
    .filter((book) => book.status === "active")
    .flatMap((book) =>
      book.rateCards.map((rate) => ({
        id: `${book.id}:${rate.sku}:${rate.region}`,
        priceBookId: book.id,
        sku: rate.sku,
        region: rate.region,
        currency: book.currency as QuoteOfferOption["currency"],
        label: `${rate.approvedClaim} · ${rate.sku} · ${rate.region} · ${book.name} v${book.version}`,
        description: t("experience.quoteOffer.description", {
          currency: book.currency,
          version: book.version,
        }),
      })),
    );
}
