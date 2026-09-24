import type { DemoPersonaKey } from "../personas/catalog";
import { demoIds } from "./seed";

export type DemoJourneyKey =
  | "billingRecovery"
  | "directBuyerRenewal"
  | "distributorException"
  | "endClientUsage"
  | "financeApproval"
  | "internalProvisioningRecovery"
  | "legalCustomerPaper"
  | "referralDispute"
  | "resellerAgreementAndQuote";

export interface DemoJourneyStep {
  readonly route: `/${string}`;
  readonly expectedFixtureId: string;
}

export interface DemoJourney {
  readonly persona: DemoPersonaKey;
  readonly steps: readonly DemoJourneyStep[];
}

/**
 * Route-facing artifact links for mocked Playwright journeys. Assertions can
 * select the normalized seed by expectedFixtureId without creating API-shaped
 * response bodies that conflict with the generated contract.
 *
 * A journey carries routes and fixtures only. Its heading and the text of each
 * step are interface copy in every language, so the web app keeps them as
 * message IDs keyed by journey and step route (`demoJourneyCopy` in
 * `apps/web/src/auth/demo-persona.ts`); this package cannot import them.
 * Routes are unique within a journey, which is what makes them a step's key.
 */
export const demoJourneys = {
  directBuyerRenewal: {
    persona: "directBuyer",
    steps: [
      {
        route: "/dashboard",
        expectedFixtureId: "renewal-meridian-2026",
      },
      {
        route: "/quotes/quote-direct-renewal-v2",
        expectedFixtureId: demoIds.quotes.directRenewal,
      },
    ],
  },
  referralDispute: {
    persona: "referralPartner",
    steps: [
      {
        route: "/partner/registrations",
        expectedFixtureId: "deal-northstar-lumen",
      },
      {
        route: "/partner/disputes",
        expectedFixtureId: "deal-northstar-lumen",
      },
    ],
  },
  resellerAgreementAndQuote: {
    persona: "reseller",
    steps: [
      {
        route: "/partner",
        expectedFixtureId: demoIds.agreements.reseller,
      },
      {
        route: "/partner/quotes/quote-resale-customer-v4",
        expectedFixtureId: demoIds.quotes.resaleCustomer,
      },
    ],
  },
  distributorException: {
    persona: "distributor",
    steps: [
      {
        route: "/partner/portfolio",
        expectedFixtureId: "deal-harborline-cobalt",
      },
      {
        route: "/partner/quotes/quote-distributor-exception-v1",
        expectedFixtureId: demoIds.quotes.distributor,
      },
    ],
  },
  endClientUsage: {
    persona: "endClient",
    steps: [
      {
        route: "/services",
        expectedFixtureId: demoIds.services.endClient,
      },
    ],
  },
  billingRecovery: {
    persona: "billingUser",
    steps: [
      {
        route: "/billing/invoice-meridian-overdue",
        expectedFixtureId: "payment-meridian-failed",
      },
      {
        route: "/billing/invoice-meridian-paid",
        expectedFixtureId: "payment-meridian-paid",
      },
    ],
  },
  legalCustomerPaper: {
    persona: "legalApprover",
    steps: [
      {
        route: "/internal/queues/queue-legal-meridian",
        expectedFixtureId: "queue-legal-meridian",
      },
    ],
  },
  financeApproval: {
    persona: "financeApprover",
    steps: [
      {
        route: "/internal/queues/queue-price-harborline",
        expectedFixtureId: "queue-price-harborline",
      },
    ],
  },
  internalProvisioningRecovery: {
    persona: "internalOperator",
    steps: [
      {
        route: "/internal/queues/queue-provision-cobalt",
        expectedFixtureId: "queue-provision-cobalt",
      },
      {
        route: "/internal/accounts/cobalt-orchard",
        expectedFixtureId: "timeline-cobalt-1",
      },
    ],
  },
} as const satisfies Record<DemoJourneyKey, DemoJourney>;
