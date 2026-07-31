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
    eyebrow: "Internal operations · Safe decisions",
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
  gates: {
    eyebrow: "Administration · Activation safety",
    title: "External gates",
    description:
      "Operational readiness grouped by provider, legal, brand, and operations, with owners and activation evidence.",
  },
  assisted: {
    eyebrow: "Internal operations · Assisted mode",
    title: "Assisted account action",
    description:
      "Act with an explicit effective account while preserving the authenticated staff actor and server-side authority.",
  },
} as const;
