export const adminSafetyCopy = {
  selectorHint:
    "Search by name or operational reference. The technical ID is submitted securely.",
  technicalEvidence: "Technical evidence",
  reviewSummary: "Decision review summary",
  reviewLabels: {
    entity: "Affected entity",
    impact: "Impact",
    evidence: "Evidence",
    policy: "Policy basis",
    downstream: "Downstream effect",
    reason: "Required reason",
  },
  approvals: {
    eyebrow: "Internal operations · Approvals",
    title: "Approval review",
    description:
      "Review the affected entity, evidence, policy basis, and downstream effect before recording a reasoned decision.",
  },
  agreements: {
    eyebrow: "Administration · Legal controls",
    title: "Agreement templates",
    description:
      "Scan canonical template versions, approval evidence, jurisdiction, and execution mode without changing agreement rules.",
  },
  priceBooks: {
    eyebrow: "Administration · Commercial controls",
    title: "Price books",
    description:
      "Scan rate-card versions, routes, floors, and activation readiness while preserving finance authority.",
  },
  priceBookActivation: {
    authorities:
      "Activation takes two finance approvers: one proposes it, a second decides it.",
    proposeLabel: "Propose activation",
    proposeHint:
      "A second finance approver decides it. Floors, regions, and version are checked again then.",
    approveLabel: "Approve and activate",
    approveHint:
      "This retires the current version for the currency and sets price for new quotes.",
    retireLabel: "Retire this version",
    retireHint:
      "Quotes, orders, and invoices already priced from it stay as they are.",
    proposed: "Proposed. A second finance approver decides it.",
    activated: "Activated. This version sets price for new quotes.",
    retired: "Retired. Nothing already priced from it changed.",
    stale:
      "This version changed while the page was open. Reload it and review the current version.",
    failed: "The decision was not recorded. Nothing changed.",
    awaitingSecondTitle: "Awaiting a second approver",
    awaitingSecondBody:
      "You proposed this activation. Another finance approver decides it.",
    financeOnlyTitle: "Finance approval authority is required.",
    financeOnlyBody:
      "Other internal roles may scan versions. Only finance may decide activation.",
    noDecision: "This version has no decision open to you.",
    unreadable: "No price books are readable for this request.",
    noMatches: "No price-book versions match these filters.",
  },
  gates: {
    eyebrow: "Administration · Activation",
    title: "External gates",
    description:
      "Operational readiness grouped by provider, legal, brand, and operations, with owners and activation evidence.",
  },
  gateVersionUnavailable:
    "This gate has no current version to write against. Reload the register and try again.",
  assisted: {
    eyebrow: "Internal operations · Assisted mode",
    title: "Assisted account action",
    description:
      "Act with an explicit effective account while preserving the authenticated staff actor and server-side authority.",
  },
} as const;
