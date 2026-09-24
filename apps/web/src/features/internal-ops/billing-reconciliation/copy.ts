import type { MessageId } from "@/src/i18n";

import type { VarianceClassification } from "./model";

/**
 * Message IDs for the billing reconciliation surface. The wording lives in
 * `src/i18n/messages/operations-finance.ts` in every interface language; this
 * map only says which message each part of the page shows.
 */
export const reconciliationCopy = {
  page: {
    title: "operations.finance.reconciliation.title",
    description: "operations.finance.reconciliation.description",
  },
  summary: {
    label: "operations.finance.reconciliation.summaryLabel",
    periods: {
      title: "operations.finance.reconciliation.periods.heading",
      detail: "operations.finance.reconciliation.summary.periods.detail",
    },
    untied: {
      title: "operations.finance.reconciliation.untied",
      detail: "operations.finance.reconciliation.summary.untied.detail",
    },
    blocking: {
      title: "operations.finance.reconciliation.summary.blocking",
      detail: "operations.finance.reconciliation.summary.blocking.detail",
    },
  },
  unreadable: {
    title: "operations.finance.reconciliation.unreadable",
    detail: "operations.finance.reconciliation.unreadable.detail",
  },
  periods: {
    heading: "operations.finance.reconciliation.periods.heading",
    subheading: "operations.finance.reconciliation.periods.subheading",
    caption: "operations.finance.reconciliation.periods.caption",
    empty: "operations.finance.reconciliation.periods.empty",
    count: "operations.finance.reconciliation.periods.count",
    columns: {
      period: "operations.finance.reconciliation.column.period",
      currency: "common.currency",
      platform: "operations.finance.reconciliation.column.platform",
      billing: "operations.finance.reconciliation.column.billing",
      accounting: "operations.finance.reconciliation.column.ledger",
      variance: "operations.finance.reconciliation.column.variance",
      state: "operations.finance.reconciliation.column.state",
    },
    ledgerVariance: "operations.finance.reconciliation.ledgerVariance",
    tied: "operations.finance.reconciliation.tied",
    untied: "operations.finance.reconciliation.untied",
  },
  variances: {
    heading: "operations.finance.reconciliation.variances.heading",
    subheading: "operations.finance.reconciliation.variances.subheading",
    caption: "operations.finance.reconciliation.variances.caption",
    empty: "operations.finance.reconciliation.variances.empty",
    count: "operations.finance.reconciliation.variances.count",
    columns: {
      subject: "operations.finance.reconciliation.column.subject",
      owner: "common.owner",
      opened: "operations.finance.reconciliation.column.opened",
      target: "operations.finance.reconciliation.column.target",
      classification: "operations.finance.reconciliation.classification",
      action: "operations.finance.reconciliation.column.disposition",
    },
    subject: "operations.finance.reconciliation.subject",
    caseId: "operations.finance.reconciliation.caseId",
    unclassified: "operations.finance.reconciliation.unclassified",
    clearing: "operations.finance.reconciliation.clearing",
  },
  decision: {
    trigger: "operations.finance.reconciliation.decision.trigger",
    confirm: "operations.finance.reconciliation.decision.confirm",
    title: "operations.finance.reconciliation.decision.title",
    description: "operations.finance.reconciliation.decision.description",
    caseTerm: "operations.finance.reconciliation.decision.case",
    effectTerm: "operations.finance.corrections.effect",
    effectDetail: "operations.finance.reconciliation.decision.effect",
    classificationLabel: "operations.finance.reconciliation.classification",
    clearingLabel: "operations.finance.reconciliation.decision.clearing",
    clearingHelp: "operations.finance.reconciliation.decision.clearing.help",
    evidenceLabel: "operations.finance.reconciliation.decision.evidence",
    evidenceHelp: "operations.finance.reconciliation.decision.evidence.help",
    reasonLabel: "operations.finance.reconciliation.decision.reason",
    reasonHelp: "operations.finance.reconciliation.decision.reason.help",
    submitting: "operations.finance.review.recording",
    recorded: "operations.finance.reconciliation.decision.recorded",
  },
  /** Every refusal code `classifyReconciliationVariance` returns, worded. */
  failures: {
    RECONCILIATION_REASON_REQUIRED:
      "operations.finance.reconciliation.failure.reasonRequired",
    RECONCILIATION_INVALID: "operations.finance.reconciliation.failure.invalid",
    RECONCILIATION_CLASSIFICATION_INVALID:
      "operations.finance.reconciliation.failure.classification",
    RECONCILIATION_CLEARING_PERIOD_INVALID:
      "operations.finance.reconciliation.failure.clearingPeriod",
    RECONCILIATION_EVIDENCE_INVALID:
      "operations.finance.reconciliation.failure.evidence",
    RECONCILIATION_RECENT_AUTH_REQUIRED:
      "operations.finance.reconciliation.failure.recentAuth",
    RECONCILIATION_FORBIDDEN:
      "operations.finance.reconciliation.failure.forbidden",
    RECONCILIATION_UNAVAILABLE:
      "operations.finance.reconciliation.failure.unavailable",
    RECONCILIATION_CASE_NOT_FOUND:
      "operations.finance.reconciliation.failure.notFound",
    RECONCILIATION_VERSION_CONFLICT:
      "operations.finance.reconciliation.failure.conflict",
    RECONCILIATION_FAILED: "operations.finance.reconciliation.failure.failed",
  } as Readonly<Record<string, MessageId>>,
  fallbackFailure: "operations.finance.reconciliation.failure.failed",
  classifications: {
    delivery_timing:
      "operations.finance.reconciliation.classification.deliveryTiming",
    period_cut_off:
      "operations.finance.reconciliation.classification.periodCutOff",
    currency: "operations.finance.reconciliation.classification.currency",
    tax: "operations.finance.reconciliation.classification.tax",
    account_mapping:
      "operations.finance.reconciliation.classification.accountMapping",
    missing_or_duplicate_event:
      "operations.finance.reconciliation.classification.missingOrDuplicateEvent",
    usage_correction:
      "operations.finance.reconciliation.classification.usageCorrection",
    amendment_or_proration:
      "operations.finance.reconciliation.classification.amendmentOrProration",
    provider_fee:
      "operations.finance.reconciliation.classification.providerFee",
    unexplained: "operations.finance.reconciliation.classification.unexplained",
  } as const satisfies Readonly<Record<VarianceClassification, MessageId>>,
  /** Object types a reconciliation case is raised against, where one is known. */
  objectTypes: {
    invoice: "recordKind.invoice",
    order: "recordKind.order",
    payment: "recordKind.payment",
    credit_note: "recordKind.creditNote",
    dispute: "recordKind.dispute",
    account: "recordKind.account",
  } as Readonly<Record<string, MessageId>>,
} as const;
