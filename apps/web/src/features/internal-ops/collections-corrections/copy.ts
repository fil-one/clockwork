import type { MessageId } from "@/src/i18n";

import type {
  CorrectionKind,
  CorrectionRefusal,
  ProviderReason,
} from "./model";

/**
 * Message IDs for the money-correction dialogs. The wording lives in
 * `src/i18n/messages/operations-finance.ts` in every interface language; this
 * map only says which message each part of the form shows.
 */
export const correctionCopy = {
  heading: "operations.finance.corrections.heading",
  kinds: {
    credit_note: {
      trigger: "operations.finance.corrections.creditNote.trigger",
      confirm: "operations.finance.corrections.creditNote.confirm",
      effect: "operations.finance.corrections.creditNote.effect",
      reversible: "operations.finance.corrections.creditNote.reversible",
    },
    refund: {
      trigger: "operations.finance.corrections.refund.trigger",
      confirm: "operations.finance.corrections.refund.confirm",
      effect: "operations.finance.corrections.refund.effect",
      reversible: "operations.finance.corrections.refund.reversible",
    },
    dispute: {
      trigger: "operations.finance.corrections.dispute.trigger",
      confirm: "operations.finance.corrections.dispute.confirm",
      effect: "operations.finance.corrections.dispute.effect",
      reversible: "operations.finance.corrections.dispute.reversible",
    },
  } as const satisfies Readonly<
    Record<
      CorrectionKind,
      {
        trigger: MessageId;
        confirm: MessageId;
        effect: MessageId;
        reversible: MessageId;
      }
    >
  >,
  fields: {
    amount: "operations.finance.corrections.amount",
    amountHelp: "operations.finance.corrections.amount.help",
    amountHelpWithTotal: "operations.finance.corrections.amount.helpWithTotal",
    amountHelpNoCurrency:
      "operations.finance.corrections.amount.helpNoCurrency",
    providerReason: "operations.finance.corrections.providerReason",
    providerReasonHelp: "operations.finance.corrections.providerReason.help",
    internalReason: "operations.finance.corrections.internalReason",
    internalReasonHelp: "operations.finance.corrections.internalReason.help",
    payment: "operations.finance.corrections.payment",
    paymentHelp: "operations.finance.corrections.payment.help",
    disputeReference: "operations.finance.corrections.disputeReference",
    disputeReferenceHelp:
      "operations.finance.corrections.disputeReference.help",
    evidenceDue: "operations.finance.corrections.evidenceDue",
    evidenceDueHelp: "operations.finance.corrections.evidenceDue.help",
  },
  /** Stripe's own reason codes, labelled as Stripe's dashboard labels them. */
  providerReasons: {
    duplicate: "operations.finance.corrections.reason.duplicate",
    fraudulent: "operations.finance.corrections.reason.fraudulent",
    order_change: "operations.finance.corrections.reason.orderChange",
    product_unsatisfactory:
      "operations.finance.corrections.reason.productUnsatisfactory",
    requested_by_customer:
      "operations.finance.corrections.reason.requestedByCustomer",
  } as const satisfies Readonly<Record<ProviderReason, MessageId>>,
  subject: "recordKind.invoice",
  effectTerm: "operations.finance.corrections.effect",
  reversibleTerm: "operations.finance.corrections.reversible",
  authority: "operations.finance.corrections.authority",
  refusalsSummary: "operations.finance.corrections.refusalsSummary",
  submitting: "operations.finance.corrections.submitting",
  recorded: "operations.finance.corrections.recorded",
  serverDetail: "operations.finance.corrections.serverDetail",
  refusals: {
    ACCOUNT_UNRESOLVED: "operations.finance.corrections.refusal.account",
    AMOUNT_INVALID: "operations.finance.corrections.refusal.amount",
    AMOUNT_EXCEEDS_INVOICE:
      "operations.finance.corrections.refusal.amountExceedsInvoice",
    CURRENCY_UNRESOLVED: "operations.finance.corrections.refusal.currency",
    PROVIDER_REASON_INVALID:
      "operations.finance.corrections.refusal.providerReason",
    INTERNAL_REASON_REQUIRED:
      "operations.finance.corrections.refusal.internalReason",
    PAYMENT_REQUIRED: "operations.finance.corrections.refusal.payment",
    DISPUTE_REFERENCE_INVALID:
      "operations.finance.corrections.refusal.disputeReference",
    EVIDENCE_DUE_INVALID: "operations.finance.corrections.refusal.evidenceDue",
  } as const satisfies Readonly<Record<CorrectionRefusal, MessageId>>,
  failures: {
    forbidden: "operations.finance.corrections.failure.forbidden",
    conflict: "operations.finance.corrections.failure.conflict",
    validation: "operations.finance.corrections.failure.validation",
    unavailable: "operations.finance.corrections.failure.unavailable",
    unknown: "operations.finance.corrections.failure.unknown",
  },
} as const satisfies {
  heading: MessageId;
  subject: MessageId;
  fields: Readonly<Record<string, MessageId>>;
  failures: Readonly<Record<string, MessageId>>;
} & Readonly<Record<string, unknown>>;
