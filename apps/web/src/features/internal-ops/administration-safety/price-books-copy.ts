/**
 * Price-book copy, split out of the shared administration-safety copy so the
 * pricing and governance lanes do not edit one file. Legacy: rendered through
 * `localizeCopy`; the pricing lane replaces it with message IDs.
 */
export const priceBooksCopy = {
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
    empty: "The pricing service is available, but no price books exist yet.",
    unreadable: "No price books are readable for this request.",
    noMatches: "No price-book versions match these filters.",
  },
} as const;
