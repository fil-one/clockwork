import "server-only";

import type { QuoteOfferOption } from "@/src/features/customer-partner/commercial/workflow-model";

/**
 * The quote command demo is an explicit echo simulator: it accepts and returns
 * these identifiers without consulting a database price book. Keeping that
 * vocabulary here, behind the demo adapter boundary, prevents a production
 * surface from mistaking fixture identifiers for active commercial data.
 */
export const simulatedCustomerQuoteOffers: readonly QuoteOfferOption[] = [
  {
    id: "44444444-4444-4444-8444-444444444444:FIL-ARCHIVE-CAPACITY:us-east",
    priceBookId: "44444444-4444-4444-8444-444444444444",
    sku: "FIL-ARCHIVE-CAPACITY",
    region: "us-east",
    currency: "USD",
    label: "Simulated enterprise archive capacity · us-east",
    description: "Demo simulator fixture · no authoritative price book",
  },
  {
    id: "44444444-4444-4444-8444-444444444445:FIL-REPLICA-CAPACITY:eu-west",
    priceBookId: "44444444-4444-4444-8444-444444444445",
    sku: "FIL-REPLICA-CAPACITY",
    region: "eu-west",
    currency: "USD",
    label: "Simulated compliance replica capacity · eu-west",
    description: "Demo simulator fixture · no authoritative price book",
  },
];
