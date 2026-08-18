import type { CorrectionKind, CorrectionRefusal } from "./model";

export const correctionCopy = {
  heading: "Corrections",
  kinds: {
    credit_note: {
      trigger: "Issue credit note",
      confirm: "Issue this credit note",
      effect:
        "A credit note is approved against this invoice and a Stripe credit-note operation is created for it. The invoice amount is reduced by the credit the provider confirms; nothing is refunded to a card.",
      reversible:
        "Only by voiding the credit note through the provider. This surface cannot void one.",
    },
    refund: {
      trigger: "Submit refund",
      confirm: "Submit this refund",
      effect:
        "A refund is approved against a settled payment and a Stripe refund operation is created for it. Money leaves the account when the provider executes it.",
      reversible: "No. A refund the provider has executed cannot be recalled.",
    },
    dispute: {
      trigger: "Record dispute",
      confirm: "Record this dispute",
      effect:
        "A dispute Stripe already opened is recorded against a settled payment, with the evidence deadline it carries. Recording it does not answer it.",
      reversible:
        "The record stays. The dispute's outcome arrives from the provider.",
    },
  } as Readonly<
    Record<
      CorrectionKind,
      {
        trigger: string;
        confirm: string;
        effect: string;
        reversible: string;
      }
    >
  >,
  fields: {
    amount: "Amount in minor units",
    amountHelp: (currency: string | null, invoice: string | null) =>
      invoice
        ? `Whole minor units of ${currency ?? "the invoice currency"}. The invoice total is ${invoice}.`
        : `Whole minor units of ${currency ?? "the invoice currency"}.`,
    providerReason: "Provider reason",
    providerReasonHelp:
      "Sent to Stripe. Each resource accepts its own list; this one is the resource's.",
    internalReason: "Internal reason code",
    internalReasonHelp:
      "3 to 120 characters. Kept with your name on the audit row.",
    payment: "Payment identifier",
    paymentHelp:
      "No read surface resolves a payment, so this is the one value on this form that is not taken from the record you opened. Take it from the settled payment; the server refuses one that does not belong to this account.",
    disputeReference: "Stripe dispute identifier",
    disputeReferenceHelp: "The dp_… identifier from the Stripe dispute.",
    evidenceDue: "Evidence due",
    evidenceDueHelp: "The deadline Stripe set for evidence on this dispute.",
  },
  subject: "Invoice",
  effectTerm: "Effect",
  reversibleTerm: "Reversible",
  authority:
    "Finance approval authority is required. The server re-checks your role against freshly read authorization, requires a recent sign-in for this command, and writes the audit row in the same transaction as the correction.",
  refusalsSummary: "Everything this form refuses before sending",
  submitting: "Sending",
  recorded: (reference: string) => `Recorded. Reference ${reference}.`,
  refusals: {
    ACCOUNT_UNRESOLVED:
      "This invoice is not linked to an account available in your current workspace. Open its order or switch accounts before recording a correction.",
    AMOUNT_INVALID:
      "Enter the amount as a positive whole number of minor units.",
    AMOUNT_EXCEEDS_INVOICE:
      "The credit is larger than the invoice total. The server allows less than this: it credits only what is still owed, minus any credit note already raised.",
    CURRENCY_UNRESOLVED:
      "This invoice records no currency, so no amount can be built for it.",
    PROVIDER_REASON_INVALID: "Choose a provider reason this resource accepts.",
    INTERNAL_REASON_REQUIRED:
      "Give an internal reason code of 3 to 120 characters.",
    PAYMENT_REQUIRED: "Enter the identifier of the settled payment.",
    DISPUTE_REFERENCE_INVALID:
      "Enter the Stripe dispute identifier, which begins dp_.",
    EVIDENCE_DUE_INVALID: "Enter the evidence deadline as a date and time.",
  } as Readonly<Record<CorrectionRefusal, string>>,
  failures: {
    forbidden:
      "Your role or current session cannot raise this correction. A recent sign-in is required for money commands.",
    conflict:
      "This record changed while you were working, or the same correction was already recorded. Reload before repeating it.",
    validation:
      "The server refused the correction. Nothing was written; the detail below is its answer.",
    unavailable: "The commerce service is unavailable. Nothing was written.",
    unknown: "The correction could not be sent. Nothing was written.",
  },
  unavailableTitle: "Corrections are unavailable on this row.",
} as const;
