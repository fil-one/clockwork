export const reconciliationCopy = {
  page: {
    title: "Billing reconciliation",
    description:
      "The close from docs/operations/billing-reconciliation.md: stored tie-out periods, and the variances the reconciliation tasks actually raised.",
  },
  summary: {
    label: "Close readiness",
    periods: {
      title: "Tie-out periods",
      detail: "Rows stored in core_three_way_tie_outs",
    },
    untied: {
      title: "Not tied",
      detail: "Periods whose stored totals differ across the three sources",
    },
    blocking: {
      title: "Blocking variances",
      detail: "Reconciliation cases unclassified or classified unexplained",
    },
  },
  provenance: {
    heading: "Where these two tables come from",
    tieOut:
      "The tie-out table is a real relation that no application path writes. core.reconciliation.three-way.v1 computes its variances in memory, opens an exception case and records the run; it inserts no tie-out row. Rows below were therefore loaded by a fixture or by hand, and are shown as stored values rather than as the output of a close.",
    variances:
      "The variance list is produced: both reconciliation tasks route to the reconciliation exception queue, which is the record the platform creates, owns and tracks against a response target.",
    closing:
      "Closing a case is a signed decision with an immutable evidence document and stays on the lifecycle command path. Classifying a variance here records the disposition the runbook asks for and leaves the case open.",
  },
  unreadable: {
    title: "The reconciliation records could not be read.",
    detail:
      "Nothing is listed because no read completed, which is a different state from a clean close. Check the service database connection before concluding the period ties.",
  },
  periods: {
    heading: "Tie-out periods",
    subheading: "Platform against billing provider against general ledger.",
    caption: "Stored three-way tie-out periods and their variances",
    empty:
      "No tie-out period is stored. Nothing in the application writes this table, so an empty list is its normal state.",
    count: (count: number) => `${count} ${count === 1 ? "period" : "periods"}`,
    columns: {
      period: "Period",
      currency: "Currency",
      platform: "Platform",
      billing: "Billing provider",
      accounting: "General ledger",
      variance: "Variance",
      state: "State",
    },
    tied: "Tied",
    untied: "Not tied",
  },
  variances: {
    heading: "Reconciliation variances",
    subheading:
      "Exception cases raised by the usage and three-way reconciliation tasks.",
    caption: "Open reconciliation exception cases and their dispositions",
    empty:
      "No reconciliation exception is open. Neither reconciliation task has raised a variance that is still unresolved.",
    count: (count: number) => `${count} ${count === 1 ? "case" : "cases"}`,
    columns: {
      subject: "Subject",
      owner: "Owner",
      opened: "Opened",
      target: "Response target",
      classification: "Classification",
      action: "Disposition",
    },
    unclassified: "Not yet classified",
    blocking: "Blocks the close",
    clearing: (period: string) => `Clears ${period}`,
  },
  decision: {
    trigger: "Classify",
    confirm: "Record this classification",
    title: "Classify variance",
    description:
      "Records the classification, the expected clearing period and the evidence against this case. The case stays open.",
    caseTerm: "Case",
    effectTerm: "Effect",
    effectDetail:
      "The disposition is written to the case and to its audit trail. No amount is moved, no status is closed, and no accounting entry is created.",
    classificationLabel: "Classification",
    clearingLabel: "Expected clearing period",
    clearingHelp:
      "Optional. YYYY-MM, the period this variance should clear in.",
    evidenceLabel: "Evidence reference",
    evidenceHelp:
      "Optional. Document, export hash or ticket that carries the evidence. Letters, digits, dot, dash, underscore, slash and colon, up to 120 characters.",
    reasonLabel: "Correction mechanism and reason",
    reasonHelp:
      "At least 8 characters. Kept with your name on the audit record.",
    submitting: "Recording",
    recorded: "Recorded.",
  },
  failures: {
    RECONCILIATION_REASON_REQUIRED: "Give a reason of at least 8 characters.",
    RECONCILIATION_INVALID:
      "The disposition could not be read. Reload the page.",
    RECONCILIATION_CLASSIFICATION_INVALID:
      "Choose one of the classifications the runbook enumerates.",
    RECONCILIATION_CLEARING_PERIOD_INVALID:
      "Give the expected clearing period as YYYY-MM, or leave it empty.",
    RECONCILIATION_EVIDENCE_INVALID:
      "The evidence reference contains characters that are not allowed.",
    RECONCILIATION_RECENT_AUTH_REQUIRED:
      "Sign in again to confirm it is you, then repeat the disposition.",
    RECONCILIATION_FORBIDDEN:
      "Your permission to operate billing reconciliation has changed.",
    RECONCILIATION_UNAVAILABLE: "The reconciliation records cannot be reached.",
    RECONCILIATION_CASE_NOT_FOUND:
      "That case is no longer an open reconciliation variance. Reload the page.",
    RECONCILIATION_VERSION_CONFLICT:
      "The case changed while this page was open. Reload and repeat the disposition.",
    RECONCILIATION_FAILED: "The disposition could not be recorded.",
  } as Readonly<Record<string, string>>,
  fallbackFailure: "The disposition could not be recorded.",
  sourceLabel: {
    live: "Tie-out relation and the reconciliation exception queue",
    unavailable: "No reconciliation read is available",
  },
} as const;
