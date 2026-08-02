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
  readonly intent: string;
  readonly expectedFixtureId: string;
}

export interface DemoJourney {
  readonly persona: DemoPersonaKey;
  readonly title: string;
  readonly steps: readonly DemoJourneyStep[];
}

/**
 * Route-facing artifact links for mocked Playwright journeys. Assertions can
 * select the normalized seed by expectedFixtureId without creating API-shaped
 * response bodies that conflict with the generated contract.
 */
export const demoJourneys = {
  directBuyerRenewal: {
    persona: "directBuyer",
    title: "Direct buyer reviews and accepts a renewal",
    steps: [
      {
        route: "/dashboard",
        intent: "Open the renewal action from the account overview.",
        expectedFixtureId: "renewal-meridian-2026",
      },
      {
        route: "/quotes/quote-direct-renewal-v2",
        intent: "Review the issued version and proceed to acceptance.",
        expectedFixtureId: demoIds.quotes.directRenewal,
      },
    ],
  },
  referralDispute: {
    persona: "referralPartner",
    title: "Referral partner responds to a deal-registration dispute",
    steps: [
      {
        route: "/partner/registrations",
        intent: "Locate the protected deal whose attribution is disputed.",
        expectedFixtureId: "deal-northstar-lumen",
      },
      {
        route: "/partner/disputes",
        intent: "Review the decision clock and dispute owner.",
        expectedFixtureId: "deal-northstar-lumen",
      },
    ],
  },
  resellerAgreementAndQuote: {
    persona: "reseller",
    title: "Reseller acts on its agreement clock before quoting",
    steps: [
      {
        route: "/partner",
        intent: "Review the partner agreement before end-client activity.",
        expectedFixtureId: demoIds.agreements.reseller,
      },
      {
        route: "/partner/quotes/quote-resale-customer-v4",
        intent: "Complete the customer-priced version without transfer price.",
        expectedFixtureId: demoIds.quotes.resaleCustomer,
      },
    ],
  },
  distributorException: {
    persona: "distributor",
    title: "Distributor tracks a two-tier price exception",
    steps: [
      {
        route: "/partner/portfolio",
        intent: "Open the Cobalt Orchard end-client record.",
        expectedFixtureId: "deal-harborline-cobalt",
      },
      {
        route: "/partner/quotes/quote-distributor-exception-v1",
        intent: "Review the finance-approval state and expiry.",
        expectedFixtureId: demoIds.quotes.distributor,
      },
    ],
  },
  endClientUsage: {
    persona: "endClient",
    title: "End client reviews usage without partner commercials",
    steps: [
      {
        route: "/services",
        intent: "Review service usage and term dates.",
        expectedFixtureId: demoIds.services.endClient,
      },
    ],
  },
  billingRecovery: {
    persona: "billingUser",
    title: "Billing user recovers an overdue payment",
    steps: [
      {
        route: "/billing/invoice-meridian-overdue",
        intent: "Review the failed ACH attempt and choose recovery.",
        expectedFixtureId: "payment-meridian-failed",
      },
      {
        route: "/billing/invoice-meridian-paid",
        intent: "Download the deterministic paid-invoice receipt.",
        expectedFixtureId: "payment-meridian-paid",
      },
    ],
  },
  legalCustomerPaper: {
    persona: "legalApprover",
    title: "Legal approver handles a stale customer-paper review",
    steps: [
      {
        route: "/internal/queues/queue-legal-meridian",
        intent: "Restore focus to the newer document version before deciding.",
        expectedFixtureId: "queue-legal-meridian",
      },
    ],
  },
  financeApproval: {
    persona: "financeApprover",
    title: "Finance approver decides a below-floor quote",
    steps: [
      {
        route: "/internal/queues/queue-price-harborline",
        intent: "Review annual value, floor variance, and decision deadline.",
        expectedFixtureId: "queue-price-harborline",
      },
    ],
  },
  internalProvisioningRecovery: {
    persona: "internalOperator",
    title: "Internal operator retries provisioning in assisted mode",
    steps: [
      {
        route: "/internal/queues/queue-provision-cobalt",
        intent: "Enter assisted mode and record a retry reason.",
        expectedFixtureId: "queue-provision-cobalt",
      },
      {
        route: "/internal/accounts/cobalt-orchard",
        intent: "Verify actual and effective actors on the account timeline.",
        expectedFixtureId: "timeline-cobalt-1",
      },
    ],
  },
} as const satisfies Record<DemoJourneyKey, DemoJourney>;
