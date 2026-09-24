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
