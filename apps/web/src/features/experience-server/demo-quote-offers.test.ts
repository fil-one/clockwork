import { describe, expect, it, vi } from "vitest";

import { createPristineDemoAdapterState } from "@clockwork/testing/demo-state";

import {
  currentDemoPriceBooks,
  localizeDemoPriceBook,
} from "@/src/features/internal-ops/price-books/demo-price-books";
import { translatorFor } from "@/src/i18n/catalogs";

vi.mock("server-only", () => ({}));

import { demoCustomerQuoteOffers } from "./demo-quote-offers";

describe("the buy page's demo offers", () => {
  /**
   * The offer picker named each offer after the stored English fixture
   * ("Fictional immutable storage capacity · … · Direct commerce USD v2"), so
   * a Spanish buyer chose from English offers.
   */
  it("names each offer in the reader's language", () => {
    const state = createPristineDemoAdapterState();
    const offers = demoCustomerQuoteOffers(state, translatorFor("es"), "es");
    expect(offers.length).toBeGreaterThan(0);
    const books = currentDemoPriceBooks(state);
    for (const offer of offers) {
      const book = books.find(
        (candidate) => candidate.id === offer.priceBookId,
      );
      if (!book) throw new Error(`no book ${offer.priceBookId}`);
      const spanish = localizeDemoPriceBook(book, "es");
      const rate = spanish.rateCards.find(
        (candidate) =>
          candidate.sku === offer.sku && candidate.region === offer.region,
      );
      expect(offer.label).toBe(
        `${rate?.approvedClaim} · ${offer.sku} · ${offer.region} · ${spanish.name} v${spanish.version}`,
      );
      expect(offer.label).not.toMatch(/Fictional|commerce/u);
    }
  });

  it("keeps the English offer names for an English reader", () => {
    const offers = demoCustomerQuoteOffers(
      createPristineDemoAdapterState(),
      translatorFor("en"),
      "en",
    );
    expect(offers.map((offer) => offer.label)).toContain(
      "Fictional immutable storage capacity · LOCKED-STORAGE-TB · us-east-2 · Direct commerce USD v2",
    );
  });
});
