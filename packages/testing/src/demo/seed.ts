import { demoAccountIds } from "../personas/catalog";

/** The shared foundation clock. Never derive demo state from wall-clock time. */
export const DEMO_NOW = "2026-07-31T16:00:00Z" as const;
export const DEMO_SEED_VERSION = "experience-2026-07-31.1" as const;
export const DEMO_ORIGIN = "https://commerce.clockwork.test" as const;

export type DemoCurrency = "EUR" | "GBP" | "USD";

export interface DemoMoney {
  readonly currency: DemoCurrency;
  /** Signed integer minor units, following ADR 0008. */
  readonly minor: string;
}

export interface DemoAccount {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly relationship:
    "direct" | "distributor" | "end_client" | "referral_partner" | "reseller";
  readonly legalEntity: string;
  readonly locale: "en-GB" | "en-US";
  readonly currency: DemoCurrency;
  readonly country: "DE" | "GB" | "US";
  readonly taxLabel: "EIN" | "VAT";
  readonly taxIdMasked: string;
  readonly lifecycleState:
    "active" | "attention" | "onboarding" | "offboarding";
  readonly parentAccountId?: string;
  readonly billingEmail: `${string}@${string}.test`;
  readonly demoNote: string;
}

export interface DemoAgreement {
  readonly id: string;
  readonly accountId: string;
  readonly title: string;
  readonly kind:
    | "csa"
    | "customer_paper"
    | "dpa"
    | "partner_distributor"
    | "partner_referral"
    | "partner_resale";
  readonly version: number;
  readonly executionState:
    | "active"
    | "awaiting_counter_signature"
    | "awaiting_legal_review"
    | "superseded";
  readonly startsOn: string;
  readonly endsOn: string;
  readonly noticeStartsOn: string;
  readonly renewalState:
    "auto_renews" | "notice_due" | "renewal_in_review" | "superseded";
  readonly signatory: string;
  readonly documentId: string;
  readonly documentHash: string;
  readonly customerPaper: boolean;
}

export interface DemoQuote {
  readonly id: string;
  readonly accountId: string;
  readonly endClientAccountId?: string;
  readonly governingAgreementId: string;
  readonly displayNumber: string;
  readonly path:
    | "direct"
    | "distributor"
    | "referral"
    | "resale_customer"
    | "resale_transfer";
  readonly version: number;
  readonly state:
    "accepted" | "awaiting_finance_approval" | "draft" | "expired" | "issued";
  readonly total: DemoMoney;
  readonly annualizedTotal: DemoMoney;
  readonly issuedAt?: string;
  readonly expiresAt: string;
  readonly priceBookVersion: string;
  readonly documentId?: string;
  readonly exceptionReason?: string;
}

export interface DemoOrder {
  readonly id: string;
  readonly accountId: string;
  readonly quoteId: string;
  readonly agreementId: string;
  readonly displayNumber: string;
  readonly state: "active" | "awaiting_signature" | "provisioning_recovery";
  readonly startsOn: string;
  readonly endsOn: string;
  readonly noticeStartsOn: string;
  readonly purchaseOrderNumber?: string;
  readonly invoicingPartyAccountId: string;
  readonly annualValue: DemoMoney;
}

export interface DemoService {
  readonly id: string;
  readonly accountId: string;
  readonly orderId: string;
  readonly name: string;
  readonly region: "eu-west-2" | "us-east-1" | "us-west-2";
  readonly state:
    "live" | "offboarding_retention_locked" | "provisioning_recovery";
  readonly capacityBytes: string;
  readonly usedBytes: string;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly noticeStartsOn: string;
  readonly maxRetentionDate?: string;
}

export interface DemoAmendment {
  readonly id: string;
  readonly orderId: string;
  readonly displayNumber: string;
  readonly kind: "coterm_upgrade" | "region_change";
  readonly state: "applied" | "pending_approval";
  readonly effectiveOn: string;
  readonly delta: DemoMoney;
  readonly summary: string;
}

export interface DemoPoc {
  readonly id: string;
  readonly accountId: string;
  readonly sponsorAccountId?: string;
  readonly name: string;
  readonly state: "converted" | "expired" | "running";
  readonly startsAt: string;
  readonly expiresAt: string;
  readonly capacityBytes: string;
  readonly usedBytes: string;
  readonly successTestsPassed: number;
  readonly successTestsTotal: number;
  readonly permittedDataClass: "business_confidential" | "public_only";
  readonly convertedQuoteId?: string;
}

export interface DemoInvoice {
  readonly id: string;
  readonly accountId: string;
  readonly displayNumber: string;
  readonly state: "disputed" | "due" | "overdue" | "paid";
  readonly issuedOn: string;
  readonly dueOn: string;
  readonly amount: DemoMoney;
  readonly balance: DemoMoney;
  readonly consolidatedEndClientCount: number;
  readonly purchaseOrderNumber?: string;
}

export interface DemoPayment {
  readonly id: string;
  readonly invoiceId: string;
  readonly state: "failed_recoverable" | "pending" | "succeeded";
  readonly amount: DemoMoney;
  readonly methodLabel: string;
  readonly recordedAt: string;
  readonly receiptDocumentId?: string;
}

export interface DemoDealRegistration {
  readonly id: string;
  readonly partnerAccountId: string;
  readonly endClientAccountId: string;
  readonly displayNumber: string;
  readonly path: "distributor" | "referral" | "resale";
  readonly state: "approved" | "disputed" | "expiring";
  readonly registeredAt: string;
  readonly protectedUntil: string;
  readonly decisionDueAt: string;
  readonly attribution: "influenced" | "sourced";
  readonly disputeOwner?: string;
}

export interface DemoCommission {
  readonly id: string;
  readonly partnerAccountId: string;
  readonly statementNumber: string;
  readonly period: string;
  readonly state: "held" | "issued" | "payable";
  readonly netCollectedRevenue: DemoMoney;
  readonly commission: DemoMoney;
  readonly holdback: DemoMoney;
  readonly clawback: DemoMoney;
  readonly documentId?: string;
}

export interface DemoRenewal {
  readonly id: string;
  readonly accountId: string;
  readonly orderId?: string;
  readonly agreementId: string;
  readonly state: "action_required" | "declined" | "quote_issued" | "scheduled";
  readonly endsOn: string;
  readonly noticeStartsOn: string;
  readonly owner: string;
  readonly riskSignals: readonly string[];
  readonly quoteId?: string;
}

export interface DemoSandbox {
  readonly id: string;
  readonly partnerAccountId: string;
  readonly name: string;
  readonly state: "active" | "expiring";
  readonly expiresAt: string;
  readonly capacityBytes: string;
  readonly usedBytes: string;
}

export interface DemoMarketplaceConnection {
  readonly id: string;
  readonly accountId: string;
  readonly provider: "aws" | "azure" | "gcp";
  readonly state: "action_required" | "connected" | "pending_provider";
  readonly externalReference: string;
  readonly lastCheckedAt: string;
  readonly readOnly: true;
}

export interface DemoSupportTicket {
  readonly id: string;
  readonly accountId: string;
  readonly displayNumber: string;
  readonly subject: string;
  readonly severity: "normal" | "urgent";
  readonly state: "awaiting_customer" | "investigating" | "resolved";
  readonly updatedAt: string;
  readonly readOnly: true;
}

export interface DemoOffboarding {
  readonly id: string;
  readonly accountId: string;
  readonly serviceId: string;
  readonly state: "retrieval_window" | "retention_exclusion";
  readonly effectiveOn: string;
  readonly retrievalEndsOn: string;
  readonly deletionEligibleOn: string;
  readonly certificateDocumentId?: string;
  readonly retentionExclusions: readonly {
    readonly scope: string;
    readonly retainedUntil: string;
  }[];
}

export interface DemoQueueItem {
  readonly id: string;
  readonly queue:
    | "collections"
    | "external_gate"
    | "legal_approval"
    | "migration_review"
    | "price_approval"
    | "provisioning_recovery"
    | "reconciliation";
  readonly accountId: string;
  readonly state: "blocked" | "due" | "recoverable" | "stale_version";
  readonly title: string;
  readonly owner: string;
  readonly dueAt: string;
  readonly version: number;
}

export interface DemoTimelineEvent {
  readonly id: string;
  readonly accountId: string;
  readonly occurredAt: string;
  readonly actor: string;
  readonly kind:
    | "agreement"
    | "assisted_action"
    | "billing"
    | "order"
    | "provisioning"
    | "quote";
  readonly summary: string;
}

export interface DemoNotification {
  readonly id: string;
  readonly personaKey: string;
  readonly kind: "action" | "information" | "recovery";
  readonly state: "read" | "unread";
  readonly createdAt: string;
  readonly title: string;
  readonly route: `/${string}`;
}

export interface DemoSeed {
  readonly metadata: {
    readonly seedVersion: string;
    readonly generatedAt: typeof DEMO_NOW;
    readonly origin: typeof DEMO_ORIGIN;
    readonly fictional: true;
    readonly resetTarget: "demo";
  };
  readonly accounts: readonly DemoAccount[];
  readonly agreements: readonly DemoAgreement[];
  readonly quotes: readonly DemoQuote[];
  readonly orders: readonly DemoOrder[];
  readonly services: readonly DemoService[];
  readonly amendments: readonly DemoAmendment[];
  readonly pocs: readonly DemoPoc[];
  readonly invoices: readonly DemoInvoice[];
  readonly payments: readonly DemoPayment[];
  readonly dealRegistrations: readonly DemoDealRegistration[];
  readonly commissions: readonly DemoCommission[];
  readonly renewals: readonly DemoRenewal[];
  readonly sandboxes: readonly DemoSandbox[];
  readonly marketplaces: readonly DemoMarketplaceConnection[];
  readonly supportTickets: readonly DemoSupportTicket[];
  readonly offboarding: readonly DemoOffboarding[];
  readonly queueItems: readonly DemoQueueItem[];
  readonly timeline: readonly DemoTimelineEvent[];
  readonly notifications: readonly DemoNotification[];
}

const usd = (minor: string): DemoMoney => ({ currency: "USD", minor });
const gbp = (minor: string): DemoMoney => ({ currency: "GBP", minor });

export const demoIds = {
  agreements: {
    direct: "agreement-direct-csa-v3",
    directPaper: "agreement-direct-paper-v1",
    distributor: "agreement-distributor-v1",
    referral: "agreement-referral-v2",
    referralEndClient: "agreement-referral-end-client-csa-v1",
    reseller: "agreement-reseller-v4",
  },
  quotes: {
    directAccepted: "quote-direct-accepted-v3",
    directDraft: "quote-direct-draft-v1",
    directRenewal: "quote-direct-renewal-v2",
    distributor: "quote-distributor-exception-v1",
    expired: "quote-direct-expired-v1",
    referral: "quote-referral-issued-v2",
    resaleCustomer: "quote-resale-customer-v4",
    resaleTransfer: "quote-resale-transfer-v4",
  },
  orders: {
    direct: "order-direct-2025",
    distributor: "order-distributor-recovery",
    endClient: "order-referral-end-client",
    resale: "order-resale-lumen",
  },
  services: {
    direct: "service-direct-archive",
    distributor: "service-distributor-recovery",
    endClient: "service-referral-end-client",
    resale: "service-resale-retention",
  },
} as const;

/**
 * Presentation projections for UI and document journeys. They intentionally do
 * not model transition rules or stand in for API responses. Generated commerce
 * operations use the contract simulators in handlers.ts.
 */
export const pristineDemoSeed = {
  metadata: {
    seedVersion: DEMO_SEED_VERSION,
    generatedAt: DEMO_NOW,
    origin: DEMO_ORIGIN,
    fictional: true,
    resetTarget: "demo",
  },
  accounts: [
    {
      id: demoAccountIds.direct,
      name: "Meridian Archive Labs",
      slug: "meridian-archive",
      relationship: "direct",
      legalEntity: "Meridian Archive Labs, Inc.",
      locale: "en-US",
      currency: "USD",
      country: "US",
      taxLabel: "EIN",
      taxIdMasked: "••-•••4821",
      lifecycleState: "attention",
      billingEmail: "ap@meridian-archive.test",
      demoNote: "Annual direct buyer with an overdue invoice and renewal due.",
    },
    {
      id: demoAccountIds.referral,
      name: "Northstar Advisory",
      slug: "northstar-advisory",
      relationship: "referral_partner",
      legalEntity: "Northstar Advisory Group LLC",
      locale: "en-US",
      currency: "USD",
      country: "US",
      taxLabel: "EIN",
      taxIdMasked: "••-•••1940",
      lifecycleState: "active",
      billingEmail: "finance@northstar-advisory.test",
      demoNote: "Referral partner with commission holdback and a deal dispute.",
    },
    {
      id: demoAccountIds.reseller,
      name: "Ember Peak Systems",
      slug: "ember-peak",
      relationship: "reseller",
      legalEntity: "Ember Peak Systems Ltd",
      locale: "en-GB",
      currency: "GBP",
      country: "GB",
      taxLabel: "VAT",
      taxIdMasked: "GB ••• •••• 18",
      lifecycleState: "attention",
      billingEmail: "accounts@ember-peak.test",
      demoNote: "Reseller whose agreement enters its notice window tomorrow.",
    },
    {
      id: demoAccountIds.distributor,
      name: "Harborline Distribution",
      slug: "harborline-distribution",
      relationship: "distributor",
      legalEntity: "Harborline Distribution Ltd",
      locale: "en-GB",
      currency: "GBP",
      country: "GB",
      taxLabel: "VAT",
      taxIdMasked: "GB ••• •••• 62",
      lifecycleState: "onboarding",
      billingEmail: "settlement@harborline-distribution.test",
      demoNote:
        "Two-tier distributor with a price exception and recovery case.",
    },
    {
      id: demoAccountIds.endClient,
      name: "Lumen Field Research",
      slug: "lumen-field",
      relationship: "end_client",
      legalEntity: "Lumen Field Research, Inc.",
      locale: "en-US",
      currency: "USD",
      country: "US",
      taxLabel: "EIN",
      taxIdMasked: "••-•••7335",
      lifecycleState: "active",
      parentAccountId: demoAccountIds.referral,
      billingEmail: "billing@lumen-field.test",
      demoNote: "Referral end client in a nearly complete POC conversion.",
    },
    {
      id: demoAccountIds.resaleEndClient,
      name: "Aster House Media",
      slug: "aster-house",
      relationship: "end_client",
      legalEntity: "Aster House Media Ltd",
      locale: "en-GB",
      currency: "GBP",
      country: "GB",
      taxLabel: "VAT",
      taxIdMasked: "GB ••• •••• 47",
      lifecycleState: "offboarding",
      parentAccountId: demoAccountIds.reseller,
      billingEmail: "ops@aster-house.test",
      demoNote: "Resale end client with Object Lock retention exclusions.",
    },
    {
      id: demoAccountIds.ukEndClient,
      name: "Cobalt Orchard GmbH",
      slug: "cobalt-orchard",
      relationship: "end_client",
      legalEntity: "Cobalt Orchard GmbH",
      locale: "en-GB",
      currency: "GBP",
      country: "DE",
      taxLabel: "VAT",
      taxIdMasked: "DE ••••••••41",
      lifecycleState: "onboarding",
      parentAccountId: demoAccountIds.distributor,
      billingEmail: "procurement@cobalt-orchard.test",
      demoNote: "Distributor end client waiting on marketplace confirmation.",
    },
  ],
  agreements: [
    {
      id: demoIds.agreements.direct,
      accountId: demoAccountIds.direct,
      title: "Cloud Service Agreement",
      kind: "csa",
      version: 3,
      executionState: "active",
      startsOn: "2025-10-01",
      endsOn: "2026-09-30",
      noticeStartsOn: "2026-08-02",
      renewalState: "notice_due",
      signatory: "Mara Voss",
      documentId: "DOC-AGR-1042",
      documentHash: "sha256:demo-direct-csa-v3-7b31",
      customerPaper: false,
    },
    {
      id: demoIds.agreements.directPaper,
      accountId: demoAccountIds.direct,
      title: "Meridian Data Processing Addendum",
      kind: "customer_paper",
      version: 1,
      executionState: "awaiting_legal_review",
      startsOn: "2026-10-01",
      endsOn: "2027-09-30",
      noticeStartsOn: "2027-08-02",
      renewalState: "renewal_in_review",
      signatory: "Pending counsel review",
      documentId: "DOC-AGR-1198",
      documentHash: "sha256:demo-customer-paper-v1-a119",
      customerPaper: true,
    },
    {
      id: demoIds.agreements.referral,
      accountId: demoAccountIds.referral,
      title: "Referral Partner Agreement",
      kind: "partner_referral",
      version: 2,
      executionState: "active",
      startsOn: "2026-01-01",
      endsOn: "2026-12-31",
      noticeStartsOn: "2026-11-01",
      renewalState: "auto_renews",
      signatory: "Jon Bell",
      documentId: "DOC-PAR-0202",
      documentHash: "sha256:demo-referral-v2-0202",
      customerPaper: false,
    },
    {
      id: demoIds.agreements.referralEndClient,
      accountId: demoAccountIds.endClient,
      title: "Cloud Service Agreement",
      kind: "csa",
      version: 1,
      executionState: "active",
      startsOn: "2026-08-15",
      endsOn: "2027-08-14",
      noticeStartsOn: "2027-06-15",
      renewalState: "auto_renews",
      signatory: "Nora Chen",
      documentId: "DOC-AGR-1317",
      documentHash: "sha256:demo-referral-end-client-csa-v1-1317",
      customerPaper: false,
    },
    {
      id: demoIds.agreements.reseller,
      accountId: demoAccountIds.reseller,
      title: "Reseller Partner Agreement",
      kind: "partner_resale",
      version: 4,
      executionState: "active",
      startsOn: "2025-09-01",
      endsOn: "2026-08-31",
      noticeStartsOn: "2026-08-01",
      renewalState: "notice_due",
      signatory: "Priya Nair",
      documentId: "DOC-PAR-0417",
      documentHash: "sha256:demo-reseller-v4-0417",
      customerPaper: false,
    },
    {
      id: demoIds.agreements.distributor,
      accountId: demoAccountIds.distributor,
      title: "Distributor Partner Agreement",
      kind: "partner_distributor",
      version: 1,
      executionState: "awaiting_counter_signature",
      startsOn: "2026-08-15",
      endsOn: "2027-08-14",
      noticeStartsOn: "2027-06-15",
      renewalState: "renewal_in_review",
      signatory: "Elias Ward",
      documentId: "DOC-PAR-0508",
      documentHash: "sha256:demo-distributor-v1-0508",
      customerPaper: false,
    },
  ],
  quotes: [
    {
      id: demoIds.quotes.directDraft,
      accountId: demoAccountIds.direct,
      governingAgreementId: demoIds.agreements.direct,
      displayNumber: "Q-DRAFT-2026-0331",
      path: "direct",
      version: 1,
      state: "draft",
      total: usd("0"),
      annualizedTotal: usd("0"),
      expiresAt: "2026-08-31T23:59:59Z",
      priceBookVersion: "USD-2026.2",
    },
    {
      id: demoIds.quotes.directAccepted,
      accountId: demoAccountIds.direct,
      governingAgreementId: demoIds.agreements.direct,
      displayNumber: "Q-2025-0148",
      path: "direct",
      version: 3,
      state: "accepted",
      total: usd("15600000"),
      annualizedTotal: usd("15600000"),
      issuedAt: "2025-09-16T14:10:00Z",
      expiresAt: "2025-10-15T23:59:59Z",
      priceBookVersion: "USD-2025.3",
      documentId: "DOC-QTE-0148-V3",
    },
    {
      id: demoIds.quotes.directRenewal,
      accountId: demoAccountIds.direct,
      governingAgreementId: demoIds.agreements.direct,
      displayNumber: "Q-2026-0312",
      path: "direct",
      version: 2,
      state: "issued",
      total: usd("16848000"),
      annualizedTotal: usd("16848000"),
      issuedAt: "2026-07-29T15:22:00Z",
      expiresAt: "2026-08-14T23:59:59Z",
      priceBookVersion: "USD-2026.2",
      documentId: "DOC-QTE-0312-V2",
    },
    {
      id: demoIds.quotes.referral,
      accountId: demoAccountIds.endClient,
      endClientAccountId: demoAccountIds.endClient,
      governingAgreementId: demoIds.agreements.referralEndClient,
      displayNumber: "Q-2026-0317",
      path: "referral",
      version: 2,
      state: "issued",
      total: usd("9480000"),
      annualizedTotal: usd("9480000"),
      issuedAt: "2026-07-30T18:05:00Z",
      expiresAt: "2026-08-13T23:59:59Z",
      priceBookVersion: "USD-2026.2",
      documentId: "DOC-QTE-0317-V2",
    },
    {
      id: demoIds.quotes.resaleTransfer,
      accountId: demoAccountIds.reseller,
      endClientAccountId: demoAccountIds.resaleEndClient,
      governingAgreementId: demoIds.agreements.reseller,
      displayNumber: "QT-2026-0084",
      path: "resale_transfer",
      version: 4,
      state: "accepted",
      total: gbp("7125000"),
      annualizedTotal: gbp("7125000"),
      issuedAt: "2026-05-12T09:00:00Z",
      expiresAt: "2026-06-11T23:59:59Z",
      priceBookVersion: "GBP-2026.1",
      documentId: "DOC-TRF-0084-V4",
    },
    {
      id: demoIds.quotes.resaleCustomer,
      accountId: demoAccountIds.reseller,
      endClientAccountId: demoAccountIds.resaleEndClient,
      governingAgreementId: demoIds.agreements.reseller,
      displayNumber: "RQ-EP-2026-084",
      path: "resale_customer",
      version: 4,
      state: "issued",
      total: gbp("9960000"),
      annualizedTotal: gbp("9960000"),
      issuedAt: "2026-05-12T09:01:00Z",
      expiresAt: "2026-08-20T23:59:59Z",
      priceBookVersion: "GBP-2026.1",
      documentId: "DOC-RSL-0084-V4",
    },
    {
      id: demoIds.quotes.distributor,
      accountId: demoAccountIds.distributor,
      endClientAccountId: demoAccountIds.ukEndClient,
      governingAgreementId: demoIds.agreements.distributor,
      displayNumber: "QD-2026-0011",
      path: "distributor",
      version: 1,
      state: "awaiting_finance_approval",
      total: gbp("18420000"),
      annualizedTotal: gbp("18420000"),
      expiresAt: "2026-08-07T23:59:59Z",
      priceBookVersion: "GBP-2026.1",
      exceptionReason: "Transfer price is 180 bps below the approved floor.",
    },
    {
      id: demoIds.quotes.expired,
      accountId: demoAccountIds.direct,
      governingAgreementId: demoIds.agreements.direct,
      displayNumber: "Q-2026-0241",
      path: "direct",
      version: 1,
      state: "expired",
      total: usd("4200000"),
      annualizedTotal: usd("4200000"),
      issuedAt: "2026-05-01T13:00:00Z",
      expiresAt: "2026-05-31T23:59:59Z",
      priceBookVersion: "USD-2026.1",
      documentId: "DOC-QTE-0241-V1",
    },
  ],
  orders: [
    {
      id: demoIds.orders.direct,
      accountId: demoAccountIds.direct,
      quoteId: demoIds.quotes.directAccepted,
      agreementId: demoIds.agreements.direct,
      displayNumber: "O-2025-0096",
      state: "active",
      startsOn: "2025-10-01",
      endsOn: "2026-09-30",
      noticeStartsOn: "2026-08-02",
      purchaseOrderNumber: "MA-PO-88412",
      invoicingPartyAccountId: demoAccountIds.direct,
      annualValue: usd("15600000"),
    },
    {
      id: demoIds.orders.endClient,
      accountId: demoAccountIds.endClient,
      quoteId: demoIds.quotes.referral,
      agreementId: demoIds.agreements.referralEndClient,
      displayNumber: "O-2026-0182",
      state: "awaiting_signature",
      startsOn: "2026-08-15",
      endsOn: "2027-08-14",
      noticeStartsOn: "2027-06-15",
      invoicingPartyAccountId: demoAccountIds.endClient,
      annualValue: usd("9480000"),
    },
    {
      id: demoIds.orders.resale,
      accountId: demoAccountIds.resaleEndClient,
      quoteId: demoIds.quotes.resaleTransfer,
      agreementId: demoIds.agreements.reseller,
      displayNumber: "O-2026-0125",
      state: "active",
      startsOn: "2026-06-15",
      endsOn: "2027-06-14",
      noticeStartsOn: "2027-04-15",
      purchaseOrderNumber: "EP-7719",
      invoicingPartyAccountId: demoAccountIds.reseller,
      annualValue: gbp("7125000"),
    },
    {
      id: demoIds.orders.distributor,
      accountId: demoAccountIds.ukEndClient,
      quoteId: demoIds.quotes.distributor,
      agreementId: demoIds.agreements.distributor,
      displayNumber: "O-2026-0191",
      state: "provisioning_recovery",
      startsOn: "2026-07-28",
      endsOn: "2027-07-27",
      noticeStartsOn: "2027-05-28",
      purchaseOrderNumber: "HD-CO-2048",
      invoicingPartyAccountId: demoAccountIds.distributor,
      annualValue: gbp("18420000"),
    },
  ],
  services: [
    {
      id: demoIds.services.direct,
      accountId: demoAccountIds.direct,
      orderId: demoIds.orders.direct,
      name: "Meridian primary archive",
      region: "us-east-1",
      state: "live",
      capacityBytes: "5000000000000000",
      usedBytes: "3710000000000000",
      startsOn: "2025-10-01",
      endsOn: "2026-09-30",
      noticeStartsOn: "2026-08-02",
    },
    {
      id: demoIds.services.endClient,
      accountId: demoAccountIds.endClient,
      orderId: demoIds.orders.endClient,
      name: "Lumen research archive",
      region: "us-west-2",
      state: "live",
      capacityBytes: "2000000000000000",
      usedBytes: "1270000000000000",
      startsOn: "2026-08-15",
      endsOn: "2027-08-14",
      noticeStartsOn: "2027-06-15",
    },
    {
      id: demoIds.services.resale,
      accountId: demoAccountIds.resaleEndClient,
      orderId: demoIds.orders.resale,
      name: "Aster locked media archive",
      region: "eu-west-2",
      state: "offboarding_retention_locked",
      capacityBytes: "1000000000000000",
      usedBytes: "842000000000000",
      startsOn: "2026-06-15",
      endsOn: "2027-06-14",
      noticeStartsOn: "2027-04-15",
      maxRetentionDate: "2028-04-30",
    },
    {
      id: demoIds.services.distributor,
      accountId: demoAccountIds.ukEndClient,
      orderId: demoIds.orders.distributor,
      name: "Cobalt EU archive",
      region: "eu-west-2",
      state: "provisioning_recovery",
      capacityBytes: "3000000000000000",
      usedBytes: "0",
      startsOn: "2026-07-28",
      endsOn: "2027-07-27",
      noticeStartsOn: "2027-05-28",
    },
  ],
  amendments: [
    {
      id: "amendment-direct-coterm-v1",
      orderId: demoIds.orders.direct,
      displayNumber: "A-2026-0042",
      kind: "coterm_upgrade",
      state: "pending_approval",
      effectiveOn: "2026-08-15",
      delta: usd("1850000"),
      summary: "Add one petabyte and co-terminate on 30 September.",
    },
    {
      id: "amendment-resale-region-v2",
      orderId: demoIds.orders.resale,
      displayNumber: "A-2026-0031",
      kind: "region_change",
      state: "applied",
      effectiveOn: "2026-07-01",
      delta: gbp("240000"),
      summary: "Add London-region replication under the existing term.",
    },
  ],
  pocs: [
    {
      id: "poc-lumen-active",
      accountId: demoAccountIds.endClient,
      sponsorAccountId: demoAccountIds.referral,
      name: "Research dataset immutability trial",
      state: "running",
      startsAt: "2026-07-10T16:00:00Z",
      expiresAt: "2026-08-03T16:00:00Z",
      capacityBytes: "100000000000000",
      usedBytes: "91000000000000",
      successTestsPassed: 4,
      successTestsTotal: 5,
      permittedDataClass: "business_confidential",
    },
    {
      id: "poc-meridian-converted",
      accountId: demoAccountIds.direct,
      name: "Retrieval validation",
      state: "converted",
      startsAt: "2025-08-01T16:00:00Z",
      expiresAt: "2025-08-22T16:00:00Z",
      capacityBytes: "50000000000000",
      usedBytes: "43000000000000",
      successTestsPassed: 6,
      successTestsTotal: 6,
      permittedDataClass: "business_confidential",
      convertedQuoteId: demoIds.quotes.directAccepted,
    },
    {
      id: "poc-cobalt-expired",
      accountId: demoAccountIds.ukEndClient,
      sponsorAccountId: demoAccountIds.distributor,
      name: "EU residency trial",
      state: "expired",
      startsAt: "2026-06-01T16:00:00Z",
      expiresAt: "2026-06-22T16:00:00Z",
      capacityBytes: "75000000000000",
      usedBytes: "18000000000000",
      successTestsPassed: 2,
      successTestsTotal: 4,
      permittedDataClass: "public_only",
    },
  ],
  invoices: [
    {
      id: "invoice-meridian-overdue",
      accountId: demoAccountIds.direct,
      displayNumber: "INV-2026-0718",
      state: "overdue",
      issuedOn: "2026-07-01",
      dueOn: "2026-07-16",
      amount: usd("1300000"),
      balance: usd("1300000"),
      consolidatedEndClientCount: 0,
      purchaseOrderNumber: "MA-PO-88412",
    },
    {
      id: "invoice-ember-consolidated",
      accountId: demoAccountIds.reseller,
      displayNumber: "INV-2026-0724",
      state: "due",
      issuedOn: "2026-07-15",
      dueOn: "2026-08-14",
      amount: gbp("593750"),
      balance: gbp("593750"),
      consolidatedEndClientCount: 4,
      purchaseOrderNumber: "EP-7719",
    },
    {
      id: "invoice-harborline-disputed",
      accountId: demoAccountIds.distributor,
      displayNumber: "INV-2026-0711",
      state: "disputed",
      issuedOn: "2026-07-01",
      dueOn: "2026-07-31",
      amount: gbp("1535000"),
      balance: gbp("1535000"),
      consolidatedEndClientCount: 7,
      purchaseOrderNumber: "HD-CO-2048",
    },
    {
      id: "invoice-meridian-paid",
      accountId: demoAccountIds.direct,
      displayNumber: "INV-2026-0612",
      state: "paid",
      issuedOn: "2026-06-01",
      dueOn: "2026-06-16",
      amount: usd("1300000"),
      balance: usd("0"),
      consolidatedEndClientCount: 0,
      purchaseOrderNumber: "MA-PO-88412",
    },
  ],
  payments: [
    {
      id: "payment-meridian-failed",
      invoiceId: "invoice-meridian-overdue",
      state: "failed_recoverable",
      amount: usd("1300000"),
      methodLabel: "ACH account ending 2041",
      recordedAt: "2026-07-29T09:14:00Z",
    },
    {
      id: "payment-ember-pending",
      invoiceId: "invoice-ember-consolidated",
      state: "pending",
      amount: gbp("593750"),
      methodLabel: "Bank transfer reference EP-7719",
      recordedAt: "2026-07-31T10:20:00Z",
    },
    {
      id: "payment-meridian-paid",
      invoiceId: "invoice-meridian-paid",
      state: "succeeded",
      amount: usd("1300000"),
      methodLabel: "ACH account ending 2041",
      recordedAt: "2026-06-12T17:02:00Z",
      receiptDocumentId: "DOC-RCP-2026-0612",
    },
  ],
  dealRegistrations: [
    {
      id: "deal-northstar-lumen",
      partnerAccountId: demoAccountIds.referral,
      endClientAccountId: demoAccountIds.endClient,
      displayNumber: "DR-2026-0088",
      path: "referral",
      state: "disputed",
      registeredAt: "2026-07-01T15:00:00Z",
      protectedUntil: "2026-09-29T23:59:59Z",
      decisionDueAt: "2026-08-03T16:00:00Z",
      attribution: "sourced",
      disputeOwner: "Ada Mercer",
    },
    {
      id: "deal-ember-aster",
      partnerAccountId: demoAccountIds.reseller,
      endClientAccountId: demoAccountIds.resaleEndClient,
      displayNumber: "DR-2026-0054",
      path: "resale",
      state: "approved",
      registeredAt: "2026-04-24T11:30:00Z",
      protectedUntil: "2026-08-22T23:59:59Z",
      decisionDueAt: "2026-04-25T16:00:00Z",
      attribution: "sourced",
    },
    {
      id: "deal-harborline-cobalt",
      partnerAccountId: demoAccountIds.distributor,
      endClientAccountId: demoAccountIds.ukEndClient,
      displayNumber: "DR-2026-0101",
      path: "distributor",
      state: "expiring",
      registeredAt: "2026-06-15T12:00:00Z",
      protectedUntil: "2026-08-05T23:59:59Z",
      decisionDueAt: "2026-06-16T16:00:00Z",
      attribution: "influenced",
    },
  ],
  commissions: [
    {
      id: "commission-northstar-q2",
      partnerAccountId: demoAccountIds.referral,
      statementNumber: "CS-2026-Q2-0014",
      period: "2026-Q2",
      state: "issued",
      netCollectedRevenue: usd("28440000"),
      commission: usd("2844000"),
      holdback: usd("568800"),
      clawback: usd("125000"),
      documentId: "DOC-COM-2026-Q2-0014",
    },
    {
      id: "commission-northstar-q3",
      partnerAccountId: demoAccountIds.referral,
      statementNumber: "CS-2026-Q3-DRAFT",
      period: "2026-Q3",
      state: "held",
      netCollectedRevenue: usd("9480000"),
      commission: usd("948000"),
      holdback: usd("189600"),
      clawback: usd("0"),
    },
  ],
  renewals: [
    {
      id: "renewal-meridian-2026",
      accountId: demoAccountIds.direct,
      orderId: demoIds.orders.direct,
      agreementId: demoIds.agreements.direct,
      state: "quote_issued",
      endsOn: "2026-09-30",
      noticeStartsOn: "2026-08-02",
      owner: "Ada Mercer",
      riskSignals: ["Overdue invoice", "Usage down 8% over 30 days"],
      quoteId: demoIds.quotes.directRenewal,
    },
    {
      id: "renewal-ember-agreement-2026",
      accountId: demoAccountIds.reseller,
      agreementId: demoIds.agreements.reseller,
      state: "action_required",
      endsOn: "2026-08-31",
      noticeStartsOn: "2026-08-01",
      owner: "Ada Mercer",
      riskSignals: ["Notice window opens tomorrow"],
    },
    {
      id: "renewal-aster-declined",
      accountId: demoAccountIds.resaleEndClient,
      orderId: demoIds.orders.resale,
      agreementId: demoIds.agreements.reseller,
      state: "declined",
      endsOn: "2027-06-14",
      noticeStartsOn: "2027-04-15",
      owner: "Priya Nair",
      riskSignals: ["Retention extends beyond service end"],
    },
    {
      id: "renewal-lumen-scheduled",
      accountId: demoAccountIds.endClient,
      orderId: demoIds.orders.endClient,
      agreementId: demoIds.agreements.referralEndClient,
      state: "scheduled",
      endsOn: "2027-08-14",
      noticeStartsOn: "2027-06-15",
      owner: "Ada Mercer",
      riskSignals: [],
    },
  ],
  sandboxes: [
    {
      id: "sandbox-ember-demo",
      partnerAccountId: demoAccountIds.reseller,
      name: "Ember Peak solution lab",
      state: "expiring",
      expiresAt: "2026-08-04T16:00:00Z",
      capacityBytes: "25000000000000",
      usedBytes: "21900000000000",
    },
    {
      id: "sandbox-northstar-demo",
      partnerAccountId: demoAccountIds.referral,
      name: "Northstar presales lab",
      state: "active",
      expiresAt: "2026-10-31T16:00:00Z",
      capacityBytes: "25000000000000",
      usedBytes: "3200000000000",
    },
  ],
  marketplaces: [
    {
      id: "marketplace-meridian-aws",
      accountId: demoAccountIds.direct,
      provider: "aws",
      state: "connected",
      externalReference: "aws-demo-subscription-1482",
      lastCheckedAt: "2026-07-31T15:58:00Z",
      readOnly: true,
    },
    {
      id: "marketplace-cobalt-azure",
      accountId: demoAccountIds.ukEndClient,
      provider: "azure",
      state: "pending_provider",
      externalReference: "azure-demo-offer-7741",
      lastCheckedAt: "2026-07-31T15:52:00Z",
      readOnly: true,
    },
    {
      id: "marketplace-ember-gcp",
      accountId: demoAccountIds.reseller,
      provider: "gcp",
      state: "action_required",
      externalReference: "gcp-demo-entitlement-912",
      lastCheckedAt: "2026-07-31T15:50:00Z",
      readOnly: true,
    },
  ],
  supportTickets: [
    {
      id: "support-meridian-812",
      accountId: demoAccountIds.direct,
      displayNumber: "SUP-812",
      subject: "Intermittent retrieval latency",
      severity: "urgent",
      state: "investigating",
      updatedAt: "2026-07-31T14:42:00Z",
      readOnly: true,
    },
    {
      id: "support-aster-809",
      accountId: demoAccountIds.resaleEndClient,
      displayNumber: "SUP-809",
      subject: "Confirm retained object inventory",
      severity: "normal",
      state: "awaiting_customer",
      updatedAt: "2026-07-30T17:25:00Z",
      readOnly: true,
    },
    {
      id: "support-lumen-781",
      accountId: demoAccountIds.endClient,
      displayNumber: "SUP-781",
      subject: "POC access validation",
      severity: "normal",
      state: "resolved",
      updatedAt: "2026-07-28T18:05:00Z",
      readOnly: true,
    },
  ],
  offboarding: [
    {
      id: "offboarding-aster-2026",
      accountId: demoAccountIds.resaleEndClient,
      serviceId: demoIds.services.resale,
      state: "retention_exclusion",
      effectiveOn: "2027-06-14",
      retrievalEndsOn: "2027-07-14",
      deletionEligibleOn: "2028-05-01",
      retentionExclusions: [
        {
          scope: "Object Lock vault /legal-media",
          retainedUntil: "2028-04-30",
        },
      ],
    },
    {
      id: "offboarding-meridian-preview",
      accountId: demoAccountIds.direct,
      serviceId: demoIds.services.direct,
      state: "retrieval_window",
      effectiveOn: "2026-09-30",
      retrievalEndsOn: "2026-10-30",
      deletionEligibleOn: "2026-10-31",
      certificateDocumentId: "DOC-DEL-PREVIEW-1042",
      retentionExclusions: [],
    },
  ],
  queueItems: [
    {
      id: "queue-price-harborline",
      queue: "price_approval",
      accountId: demoAccountIds.distributor,
      state: "due",
      title: "Distributor transfer price below floor",
      owner: "Mateo Silva",
      dueAt: "2026-07-31T20:00:00Z",
      version: 1,
    },
    {
      id: "queue-legal-meridian",
      queue: "legal_approval",
      accountId: demoAccountIds.direct,
      state: "stale_version",
      title: "Customer paper changed after review opened",
      owner: "Imani Ross",
      dueAt: "2026-08-03T16:00:00Z",
      version: 3,
    },
    {
      id: "queue-provision-cobalt",
      queue: "provisioning_recovery",
      accountId: demoAccountIds.ukEndClient,
      state: "recoverable",
      title: "Marketplace entitlement not visible to provisioner",
      owner: "Ada Mercer",
      dueAt: "2026-07-31T17:00:00Z",
      version: 2,
    },
    {
      id: "queue-collections-meridian",
      queue: "collections",
      accountId: demoAccountIds.direct,
      state: "due",
      title: "ACH retry requires billing contact confirmation",
      owner: "Mateo Silva",
      dueAt: "2026-08-01T16:00:00Z",
      version: 1,
    },
    {
      id: "queue-reconcile-northstar",
      queue: "reconciliation",
      accountId: demoAccountIds.referral,
      state: "due",
      title: "Q2 commission clawback differs from QBO export",
      owner: "Mateo Silva",
      dueAt: "2026-08-04T16:00:00Z",
      version: 4,
    },
    {
      id: "queue-migration-ember",
      queue: "migration_review",
      accountId: demoAccountIds.reseller,
      state: "blocked",
      title: "Legacy partner PO lacks a pinned quote version",
      owner: "Ada Mercer",
      dueAt: "2026-08-05T16:00:00Z",
      version: 1,
    },
    {
      id: "queue-gate-brand",
      queue: "external_gate",
      accountId: demoAccountIds.reseller,
      state: "blocked",
      title: "White-label production domain awaits brand approval",
      owner: "Ada Mercer",
      dueAt: "2026-08-14T16:00:00Z",
      version: 1,
    },
  ],
  timeline: [
    {
      id: "timeline-meridian-1",
      accountId: demoAccountIds.direct,
      occurredAt: "2026-07-31T14:42:00Z",
      actor: "System",
      kind: "billing",
      summary: "ACH payment retry returned a recoverable failure.",
    },
    {
      id: "timeline-meridian-2",
      accountId: demoAccountIds.direct,
      occurredAt: "2026-07-30T19:08:00Z",
      actor: "Mara Voss",
      kind: "quote",
      summary: "Opened renewal quote Q-2026-0312 version 2.",
    },
    {
      id: "timeline-cobalt-1",
      accountId: demoAccountIds.ukEndClient,
      occurredAt: "2026-07-31T15:32:00Z",
      actor: "Ada Mercer for Harborline Distribution",
      kind: "assisted_action",
      summary:
        "Retried marketplace entitlement discovery with reason recorded.",
    },
    {
      id: "timeline-ember-1",
      accountId: demoAccountIds.reseller,
      occurredAt: "2026-07-29T11:20:00Z",
      actor: "Priya Nair",
      kind: "agreement",
      summary: "Downloaded partner agreement version 4.",
    },
    {
      id: "timeline-lumen-1",
      accountId: demoAccountIds.endClient,
      occurredAt: "2026-07-28T18:05:00Z",
      actor: "Nora Chen",
      kind: "provisioning",
      summary: "Completed POC retrieval success test four of five.",
    },
    {
      id: "timeline-aster-1",
      accountId: demoAccountIds.resaleEndClient,
      occurredAt: "2026-07-25T13:12:00Z",
      actor: "Priya Nair",
      kind: "order",
      summary: "Recorded end-client non-renewal evidence.",
    },
  ],
  notifications: [
    {
      id: "notification-direct-renewal",
      personaKey: "directBuyer",
      kind: "action",
      state: "unread",
      createdAt: "2026-07-31T13:00:00Z",
      title: "Your renewal notice window opens in two days",
      route: "/dashboard",
    },
    {
      id: "notification-billing-retry",
      personaKey: "billingUser",
      kind: "recovery",
      state: "unread",
      createdAt: "2026-07-31T14:42:00Z",
      title: "Payment needs a new authorization",
      route: "/billing/invoice-meridian-overdue",
    },
    {
      id: "notification-reseller-clock",
      personaKey: "reseller",
      kind: "action",
      state: "unread",
      createdAt: "2026-07-31T12:00:00Z",
      title: "Partner agreement notice window opens tomorrow",
      route: "/partner",
    },
    {
      id: "notification-operator-recovery",
      personaKey: "internalOperator",
      kind: "recovery",
      state: "read",
      createdAt: "2026-07-31T15:20:00Z",
      title: "Cobalt provisioning is ready to retry",
      route: "/internal/queues/queue-provision-cobalt",
    },
    {
      id: "notification-legal-stale",
      personaKey: "legalApprover",
      kind: "information",
      state: "unread",
      createdAt: "2026-07-31T15:10:00Z",
      title: "Meridian uploaded a newer customer-paper version",
      route: "/internal/queues/queue-legal-meridian",
    },
  ],
} as const satisfies DemoSeed;

export function createDemoSeed(): DemoSeed {
  return structuredClone(pristineDemoSeed);
}
