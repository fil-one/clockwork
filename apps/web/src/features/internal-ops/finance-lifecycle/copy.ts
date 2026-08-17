export const lifecycleCopy = {
  eyebrow: "Internal operations",
  provenance: "Data provenance",
  sourcePrefix: "Source:",
  projectionCurrent: "Projection generated",
  projectionStale: "Stale projection generated",
  readAtLoad: "Read at page load",
  readFailed: "No read completed for this request",
  notWired: "This surface is not wired to a data source.",
  staleTitle: "At least one record is past its refresh window.",
  staleBody:
    "Verify anything you are about to act on against the source record before deciding it.",
  renewals: {
    title: "Renewal notice windows",
    description:
      "Orders grouped by how long is left before their contractual notice date, with the route and the invoicing already recorded against them.",
    noExposureTitle: "No exposure estimate is shown here.",
    noExposureBody:
      "Exposure is a forward estimate of renewal value, and no projection carries an order amount to build one from. The money on this page is invoice truth: the sum of the invoices the collections channel reports against the same order. It is not a forecast, a payment, or collected revenue.",
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
    noDisputeStateTitle: "Dispute state is not shown on this surface.",
    noDisputeStateBody:
      "The invoice projection carries no dispute, promise-to-pay or last-contact field, so none is displayed. Dispute holds are enforced by the server when a correction is submitted, not by this page.",
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
    empty:
      "No invoices are projected into your operator scope. That is not the same as no invoices existing: it means this session's collections channel returned no rows.",
  },
  provisioning: {
    title: "Provisioning work",
    description:
      "Provider operations and service terminations as the projection records them, with attempts already spent and what each record is waiting on.",
    retryTitle: "Retry safety is not decided on this page.",
    retryBody:
      "The provisioning projection carries the attempt count and the next scheduled attempt. It does not carry the failure class, the attempt ceiling, or the idempotency evidence a retry has to be justified by, so no retry-safety verdict is offered here. Stopped work and its retry or abandon decision live on the recovery queue.",
    recoveryLink: "Open the recovery queue",
    providerOperations: "Provider operations",
    terminations: "Service terminations",
    highRisk: "High risk",
    unclassified: (count: number) =>
      count === 1
        ? "1 record in this channel identifies no aggregate type and is listed unclassified."
        : `${count} records in this channel identify no aggregate type and are listed unclassified.`,
    tableHeading: "Projected provisioning records",
    caption: "Provisioning records ordered by risk then attempts spent",
    empty:
      "No provisioning records are projected into your operator scope. That is not the same as no provisioning work existing.",
    attemptsLabel: "Attempts",
    noAttempts: "Not applicable",
  },
  migrations: {
    title: "Migration matching",
    description:
      "Resolve source records against human-readable account candidates. Ambiguous matches never create a duplicate account.",
    unwired:
      "No channel, read model or candidate table backs this surface. `lifecycle_migration_runs` and `lifecycle_migration_matches` record decisions that have already been made; nothing persists the pending candidates this page is designed to resolve, and `migrations` is not a projection channel.",
    illustrativeTitle: "The records below are illustrative, not operational.",
    illustrativeBody:
      "They demonstrate the matching decision this surface is designed to take. They are checked-in examples, they do not correspond to any source record, and nothing you do here reaches a migration run.",
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
    noVarianceTitle: "No variance or reconciliation state is shown.",
    noVarianceBody:
      "The report_export projection carries the report name, its status and its document. It carries no freshness, variance or reconciliation state, so none is displayed.",
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
