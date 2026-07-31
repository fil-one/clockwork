export const lifecycleCopy = {
  eyebrow: "Internal operations",
  provenance: "Data provenance",
  sourcePrefix: "Source:",
  renewals: {
    title: "Renewal exposure",
    description:
      "Plan route-aware renewal work without confusing exposure estimates with invoice or collection truth.",
    freshness: "Exposure model refreshed 6 minutes ago",
    source: "Orders, renewal terms, invoices, and collections ledger",
  },
  collections: {
    title: "Collections priority",
    description:
      "Prioritize overdue value and age while preserving dispute holds, route context, and finance approval gates.",
    freshness: "Collections ledger refreshed 3 minutes ago",
    source: "Invoices, disputes, promises to pay, and receipts",
  },
  provisioning: {
    title: "Provisioning recovery",
    description:
      "Recover failed provider operations only when failure class, attempt limits, and idempotency evidence make a retry safe.",
    freshness: "Provider state refreshed 2 minutes ago",
    source: "Provisioning orchestrator and provider activation tests",
  },
  migrations: {
    title: "Migration matching",
    description:
      "Resolve source records against human-readable account candidates. Ambiguous matches never create a duplicate account.",
    freshness: "Candidate index refreshed 14 minutes ago",
    source: "Legacy sources and current account index",
  },
  reports: {
    title: "Operational reports",
    description:
      "Trace each operating value to its source and freshness, and distinguish estimates from pending reconciliation and final truth.",
    freshness: "Report registry refreshed 4 minutes ago",
    source: "Supported core report endpoints",
  },
  review: {
    dialogPrefix: "Review:",
    dialogDescription:
      "Review the affected entity, evidence, policy, and downstream effect before staging this action.",
    actorNote:
      "The server—not this form—derives staff actor authority and rechecks credit, screening, provider, retention, and dual-control gates where applicable.",
    complete:
      "Review complete. Continue through the server-authorized workflow to apply the action; no lifecycle state changed here.",
  },
} as const;
