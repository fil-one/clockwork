import type { QuoteOfferOption } from "./workflow-model";

export const authoritativeQuoteOffer: QuoteOfferOption = {
  id: "60000000-0000-4000-8000-000000000001:LOCKED-STORAGE-TB:us-east-2",
  priceBookId: "60000000-0000-4000-8000-000000000001",
  sku: "LOCKED-STORAGE-TB",
  region: "us-east-2",
  currency: "USD",
  label:
    "Fictional immutable storage capacity · LOCKED-STORAGE-TB · us-east-2 · Demo USD 2026 v1",
  description: "USD · active price-book version 1",
};

export const authoritativeQuoteOffers = [authoritativeQuoteOffer] as const;
