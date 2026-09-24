import "server-only";

import { resolveDemoText } from "@clockwork/testing/demo-localized-text";
import type { DemoAdapterState } from "@clockwork/testing/demo-state";

import type { QuoteOfferOption } from "@/src/features/customer-partner/commercial/workflow-model";
import { currentDemoPriceBooks } from "@/src/features/internal-ops/price-books/demo-price-books";
import type { Locale, Translator } from "@/src/i18n";

/**
 * The full demo exposes the same non-confidential offer vocabulary as the
 * database-backed loader, derived from its persisted active price books. Price
 * amounts remain server-side and are applied only by the demo command handler.
 *
 * The approved claim and the price-book name stand in for text staff typed, so
 * a fixture may carry them as demo-authored text; they are resolved here, at
 * this demo read boundary, for the reader.
 */
export function demoCustomerQuoteOffers(
  state: DemoAdapterState,
  t: Translator,
  locale: Locale,
): readonly QuoteOfferOption[] {
  return resolveDemoText(currentDemoPriceBooks(state), locale)
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
