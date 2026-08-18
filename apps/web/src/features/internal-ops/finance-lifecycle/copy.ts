export const lifecycleCopy = {
  eyebrow: "Internal operations",
  provenance: "Data status",
  projectionCurrent: "Up to date",
  projectionStale: "Needs refresh",
  readAtLoad: "Up to date",
  readFailed: "Temporarily unavailable",
  notWired: "Not available in this workspace",
  staleTitle: "At least one record is past its refresh window.",
  staleBody:
    "Verify anything you are about to act on against the source record before deciding it.",
  renewals: {
    title: "Renewal notice windows",
    description:
      "Orders grouped by how long is left before their contractual notice date, with the route and the invoicing already recorded against them.",
    noExposureTitle: "About renewal value",
    noExposureBody:
      "Invoiced to date shows billed value for each order. Forecast value remains separate from this renewal worklist.",
    invoicedLabel: "Invoiced to date",
    noInvoices: "No invoices recorded against this order",
    routeUnrecorded: "Route not recorded",
    empty: "No orders fall in this window.",
  },
  collections: {
    title: "Collections priority",
    description:
      "Open invoices ordered by exposure and age, with the corrections a finance approver may raise against them.",
    priorityTitle: "Priority order",
    priorityBody:
      "Highest open amount, then days past due, then invoice reference. Amounts in a second currency are ranked but never added into a total.",
    noDisputeStateTitle: "Collections actions",
    noDisputeStateBody:
      "Open each invoice to review its payment history, disputes, and available corrections.",
    openTotal: "Open invoice total",
    overdueTotal: "Past due",
    oldest: "Oldest past due",
    unrecorded: "Not recorded",
    days: (count: number) => `${count} ${count === 1 ? "day" : "days"}`,
    mixedCurrency: (count: number) =>
      `${count} invoice${count === 1 ? "" : "s"} in another currency are excluded from these totals.`,
    tableHeading: "Open invoices",
    tableSubheading:
      "Amount, age, status and the corrections available on each invoice.",
    caption: "Open invoices ordered by amount then days past due",
    empty: "No open invoices need collections attention.",
  },
  provisioning: {
    title: "Provisioning work",
    description:
      "Track provider work, service terminations, retry timing, and the items that need operator attention.",
    retryTitle: "Stopped work is handled in recovery.",
    retryBody:
      "Open the recovery workspace to retry or abandon work that has exhausted its automatic attempts.",
    recoveryLink: "Open the recovery queue",
    providerOperations: "Provider operations",
    terminations: "Service terminations",
    highRisk: "High risk",
    unclassified: (count: number) =>
      count === 1
        ? "1 item needs classification before it can be routed."
        : `${count} items need classification before they can be routed.`,
    tableHeading: "Provisioning records",
    caption: "Provisioning records ordered by risk then attempts spent",
    empty: "No provisioning work needs attention in this workspace.",
    attemptsLabel: "Attempts",
    noAttempts: "Not applicable",
  },
  migrations: {
    title: "Migration matching",
    description:
      "Resolve source records against human-readable account candidates. Ambiguous matches never create a duplicate account.",
    unwired: "Migration source data is not enabled for this workspace.",
    illustrativeTitle: "Explore migration matching",
    illustrativeBody:
      "Use the guided examples below to review confident, ambiguous, and unmatched account records.",
  },
  reports: {
    title: "Operational reports",
    description:
      "Report exports recorded against your operator session, and the supported exports you can generate now.",
    exportsHeading: "Recorded report exports",
    exportsCaption: "Report exports newest first",
    exportsEmpty:
      "No report exports are projected into your operator scope. Generating an export below records one.",
    exportsFilterEmpty: (report: string) =>
      `No recorded export names ${report}. Clearing the report filter shows the rest.`,
    allReports: "All supported reports",
    documentRecorded: "Document recorded",
    documentPending: "No document recorded yet",
    catalogueHeading: "Supported exports",
    catalogueDescription:
      "The report registry in the commerce contract. Each one is generated on request; this page holds no cached result and states no freshness for one.",
    labels: {
      arr_mrr: "ARR & MRR",
      billing_collections: "Billing & collections",
      commission_settlement: "Commission settlement",
    },
    noVarianceTitle: "Exports are generated on demand",
    noVarianceBody:
      "Choose a report and account scope below. Completed exports remain available in the history list.",
  },
  review: {
    dialogPrefix: "Review:",
    dialogDescription:
      "Review the affected entity, evidence, policy, and downstream effect before staging this action.",
    actorNote:
      "Staff actor authority is derived from the server session. Credit, screening, provider, retention, and dual-control gates are rechecked where applicable.",
    complete:
      "Review complete. Continue through the server-authorized workflow to apply the action; no lifecycle state changed here.",
  },
} as const;
