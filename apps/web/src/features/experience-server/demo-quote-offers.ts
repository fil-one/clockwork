import "server-only";

import type { DemoAdapterState } from "@clockwork/testing/demo-state";

import type { QuoteOfferOption } from "@/src/features/customer-partner/commercial/workflow-model";
import { currentDemoPriceBooks } from "@/src/features/internal-ops/price-books/demo-price-books";

/**
 * The full demo exposes the same non-confidential offer vocabulary as the
 * database-backed loader, derived from its persisted active price books. Price
 * amounts remain server-side and are applied only by the demo command handler.
 */
export function demoCustomerQuoteOffers(
  state: DemoAdapterState,
): readonly QuoteOfferOption[] {
  return currentDemoPriceBooks(state)
    .filter((book) => book.status === "active")
    .flatMap((book) =>
      book.rateCards.map((rate) => ({
        id: `${book.id}:${rate.sku}:${rate.region}`,
        priceBookId: book.id,
        sku: rate.sku,
        region: rate.region,
        currency: book.currency as QuoteOfferOption["currency"],
        label: `${rate.approvedClaim} · ${rate.sku} · ${rate.region} · ${book.name} v${book.version}`,
        description: `${book.currency} · active price-book version ${book.version}`,
      })),
    );
}
