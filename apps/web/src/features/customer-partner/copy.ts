/**
 * Customer and partner experience copy lives with the feature so this lane does
 * not need to change the shared translation catalog while the UX work is being
 * integrated.
 */
export const customerPartnerCopy = {
  common: {
    search: "Search",
    filters: "Filters",
    status: "Status",
    risk: "Risk",
    owner: "Owner",
    sort: "Sort",
    view: "View",
    pageSize: "Rows per page",
    previous: "Previous",
    next: "Next",
    technicalDetails: "Technical details",
    documents: "Documents",
    auditEvidence: "Audit evidence",
    artifactChain: "Artifact chain",
    commercialSummary: "Commercial summary",
    termState: "Term state",
    nextAction: "Next action",
    loadingTitle: "Loading records",
    loadingBody: "The latest records are being retrieved.",
    emptyTitle: "Nothing here yet",
    emptyBody: "Records appear here as work starts on this account.",
    noMatchTitle: "No records match these filters",
    noMatchBody: "Clear or change a filter to see more results.",
    permissionTitle: "This information is not available to your role",
    permissionBody: "Ask an account owner to grant the required access.",
    errorTitle: "Records could not be loaded",
    errorBody: "Try again. Your filters have been preserved.",
  },
  customer: {
    dashboardGreeting: "Welcome back",
    dashboardDescription:
      "Act on commercial deadlines first, then review account performance.",
    attentionTitle: "Needs attention",
    attentionDescription: "Four items need a decision or follow-up.",
    termTitle: "Current commercial term",
    serviceRollup: "Service term rollup",
    metricsTitle: "Decisions at a glance",
    activityTitle: "Recent activity",
    chartTitle: "Committed capacity compared with use",
    chartFreshness: "Updated 18 minutes ago from metering data",
    chartComparison: "Compared with the previous 30-day period",
    accountTitle: "Account settings",
    accountDescription:
      "Manage your organization, people, and purchasing requirements.",
    quotePermissionNote: "An account owner or administrator can create quotes.",
    accountPermissionNote:
      "An account owner or administrator manages users, procurement, and offboarding requests.",
    collections: {
      amendments: {
        title: "Amendments",
        description:
          "Track requested and completed changes to active services.",
        searchPlaceholder: "Search amendments",
      },
      users: {
        title: "Users and access",
        description: "See who can view and approve commercial work.",
        searchPlaceholder: "Search users",
      },
      procurement: {
        title: "Procurement",
        description:
          "Keep invoice routing, supplier onboarding, and tax evidence current.",
        searchPlaceholder: "Search procurement records",
      },
      marketplace: {
        title: "Marketplace purchases",
        description: "Follow private offers and provider-reported fulfillment.",
        searchPlaceholder: "Search marketplace offers",
      },
      support: {
        title: "Support",
        description:
          "Follow customer issues while the support provider remains the source of truth.",
        searchPlaceholder: "Search support tickets",
      },
    },
  },
  commercial: {
    quoteStages: [
      "Offer and region",
      "Capacity, term, route, end client or partner, and expiry",
      "Review and issue",
    ],
    quoteSummary: "Quote summary",
    reviewIssue: "Review and issue",
    agreementAuthority:
      "I confirm I am authorized to bind this legal entity to this agreement.",
    agreementReview: "Review and accept agreement",
    orderReview: "Review resulting commitment",
    orderConfirmation:
      "I reviewed the accepted quote, governing agreement, purchase order, service start, and resulting commitment.",
    estimatedSpend: "Estimated spend",
    invoiceTruth: "Invoiced amount",
    paymentTruth: "Payment status",
    paymentWebhook: "Reported by the payment provider webhook",
    externalPayment:
      "You will continue with the payment provider. The invoice is marked paid only after the provider confirms it.",
    confirmMutation: "Review and confirm",
  },
  partner: {
    deskTitle: "Partner desk",
    deskDescription:
      "Protect the agreement clock and resolve urgent client work before reviewing performance.",
    agreementClock: "Partner agreement clock",
    urgentTitle: "Urgent partner work",
    portfolioTitle: "End-client portfolio",
    transferPrice: "Fil One transfer price",
    partnerPrice: "Partner resale price",
    merchantOfRecord: "Merchant of record",
    boundary:
      "Transfer pricing stays private to the partner. The end client sees the resale price set by the partner.",
    renewalReview: "Review renewal before confirming",
    registrationReview: "Review deal registration",
  },
} as const;

export type CustomerPartnerCopy = typeof customerPartnerCopy;
