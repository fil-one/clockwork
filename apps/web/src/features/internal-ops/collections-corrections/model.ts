/**
 * The three money corrections a finance approver may raise against an invoice,
 * and every reason one of them is refused before it is sent.
 *
 * The verbs are exactly what the money work-stream implements. `credit_notes`
 * accepts `issue`, `refunds` accepts `submit`, `disputes` accepts `create`, and
 * `databaseCoreCommands` in `@clockwork/db/core` lists nothing else for the
 * three resources. A fourth verb offered here would render a button whose click
 * returns an unsupported-transition error.
 *
 * ## The complete refused set
 *
 * This module refuses a correction for these reasons and no others. Each one is
 * a check the server also makes; refusing here means the operator is told
 * before a command is spent, not instead of the server deciding.
 *
 * 1. `ACCOUNT_UNRESOLVED` -- the invoice's billing account could not be
 *    resolved. The internal projection selects `audience_account_id`, which is
 *    always null for an operator, so the account is joined through the invoice's
 *    order (`orders.invoicingAccountId`, which is what `invoices.accountId` is
 *    set from). An invoice whose order is outside the operator's projection
 *    scope has no resolvable account, and `assertBillingAccount` would answer
 *    NOT_FOUND for it.
 * 2. `AMOUNT_INVALID` -- the amount is not a positive whole number of minor
 *    units.
 * 3. `AMOUNT_EXCEEDS_INVOICE` -- credit notes only. The request is larger than
 *    the invoice's own total, which is the widest ceiling `creditAmount` could
 *    possibly allow.
 * 4. `CURRENCY_UNRESOLVED` -- the invoice records no currency, so no `Money`
 *    can be built for it.
 * 5. `PROVIDER_REASON_INVALID` -- the provider reason is not one the resource
 *    accepts. Credit notes and refunds take different sets, and neither is the
 *    other's.
 * 6. `INTERNAL_REASON_REQUIRED` -- the internal reason code is shorter than 3
 *    or longer than 120 characters. It is kept with the actor on the audit row.
 * 7. `PAYMENT_REQUIRED` -- refunds and disputes only. No payment identity was
 *    given.
 * 8. `DISPUTE_REFERENCE_INVALID` -- disputes only. The Stripe dispute
 *    identifier does not match `dp_...`.
 * 9. `EVIDENCE_DUE_INVALID` -- disputes only. The evidence deadline is not a
 *    readable instant.
 *
 * ## What is deliberately NOT refused here
 *
 * These are server-only and are never pre-judged, because guessing them would
 * block a write the server would have allowed:
 *
 * - whether the invoice is provider-bound. `creditAmount`'s caller requires a
 *   `stripeInvoiceId`, and the invoice projection payload does not carry one.
 * - the exact credit ceiling. The server credits an open invoice down to
 *   `amountRemainingMinor` and a paid one against its settled total, then
 *   subtracts the credit notes already approved, pending or issued. Neither the
 *   remaining amount nor the prior credits are in the projection, so only the
 *   invoice total is checked here and the server's answer is authoritative.
 * - whether the payment is settled, matches the invoice, or has room for the
 *   refund.
 * - the actor's role, recent authentication, and the billing capability flag.
 *   `billing:approve` gates the control, `assertFinanceApproval` re-checks the
 *   role against freshly read authorization, and `credit_notes:issue`,
 *   `refunds:submit` and `disputes:create` all require recent authentication at
 *   the API boundary.
 */

export const correctionKinds = ["credit_note", "refund", "dispute"] as const;
export type CorrectionKind = (typeof correctionKinds)[number];

/** The three core resources a correction writes to. */
export type CorrectionResource = "credit_notes" | "refunds" | "disputes";

/** Resource and verb per correction, matching `databaseCoreCommands`. */
export const correctionCommands = {
  credit_note: { resource: "credit_notes", action: "issue" },
  refund: { resource: "refunds", action: "submit" },
  dispute: { resource: "disputes", action: "create" },
} as const satisfies Readonly<
  Record<CorrectionKind, { resource: CorrectionResource; action: string }>
>;

/**
 * Provider reasons each resource accepts. These are Stripe's enumerations, and
 * they are not the same list: a refund may be `requested_by_customer`, a credit
 * note may be `order_change` or `product_unsatisfactory`, and neither accepts
 * the other's values.
 */
export const providerReasons = {
  credit_note: [
    "duplicate",
    "fraudulent",
    "order_change",
    "product_unsatisfactory",
  ],
  refund: ["duplicate", "fraudulent", "requested_by_customer"],
  dispute: [],
} as const satisfies Readonly<Record<CorrectionKind, readonly string[]>>;

export type CorrectionRefusal =
  | "ACCOUNT_UNRESOLVED"
  | "AMOUNT_INVALID"
  | "AMOUNT_EXCEEDS_INVOICE"
  | "CURRENCY_UNRESOLVED"
  | "PROVIDER_REASON_INVALID"
  | "INTERNAL_REASON_REQUIRED"
  | "PAYMENT_REQUIRED"
  | "DISPUTE_REFERENCE_INVALID"
  | "EVIDENCE_DUE_INVALID";

export interface CorrectionSubject {
  invoiceId: string;
  /** Joined through the invoice's order; `null` when the order is out of scope. */
  accountId: string | null;
  currency: string | null;
  /** The invoice's own total in minor units, the widest possible credit ceiling. */
  amountMinor: bigint | null;
}

export interface CorrectionInput {
  kind: CorrectionKind;
  amountMinor: string;
  providerReason: string;
  internalReasonCode: string;
  paymentId: string;
  stripeDisputeId: string;
  evidenceDueAt: string;
}

export interface CorrectionCommand {
  resource: CorrectionResource;
  action: string;
  accountId: string;
  payload: Readonly<Record<string, unknown>>;
}

export type CorrectionResult =
  | { ok: true; command: CorrectionCommand }
  | { ok: false; refusals: readonly CorrectionRefusal[] };

const WHOLE_MINOR_UNITS = /^\d+$/u;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const STRIPE_DISPUTE = /^dp_[A-Za-z0-9_]+$/u;

/**
 * Builds the command a correction would send, or every reason it cannot be
 * built. Every refusal is reported at once so the operator fixes the form in
 * one pass rather than one field per submission.
 */
export function buildCorrectionCommand(
  subject: CorrectionSubject,
  input: CorrectionInput,
): CorrectionResult {
  const refusals: CorrectionRefusal[] = [];
  if (!subject.accountId) refusals.push("ACCOUNT_UNRESOLVED");
  if (!subject.currency) refusals.push("CURRENCY_UNRESOLVED");

  const amount = input.amountMinor.trim();
  const parsed =
    WHOLE_MINOR_UNITS.test(amount) && BigInt(amount) > 0n
      ? BigInt(amount)
      : null;
  if (parsed === null) refusals.push("AMOUNT_INVALID");
  else if (
    input.kind === "credit_note" &&
    subject.amountMinor !== null &&
    parsed > subject.amountMinor
  )
    refusals.push("AMOUNT_EXCEEDS_INVOICE");

  const accepted: readonly string[] = providerReasons[input.kind];
  if (accepted.length > 0 && !accepted.includes(input.providerReason))
    refusals.push("PROVIDER_REASON_INVALID");

  if (input.kind !== "dispute") {
    const reason = input.internalReasonCode.trim();
    if (reason.length < 3 || reason.length > 120)
      refusals.push("INTERNAL_REASON_REQUIRED");
  }

  if (input.kind !== "credit_note" && !UUID.test(input.paymentId.trim()))
    refusals.push("PAYMENT_REQUIRED");

  let evidenceDueAt: string | null = null;
  if (input.kind === "dispute") {
    if (!STRIPE_DISPUTE.test(input.stripeDisputeId.trim()))
      refusals.push("DISPUTE_REFERENCE_INVALID");
    const instant = Date.parse(input.evidenceDueAt);
    if (Number.isFinite(instant))
      evidenceDueAt = new Date(instant).toISOString();
    else refusals.push("EVIDENCE_DUE_INVALID");
  }

  if (
    refusals.length > 0 ||
    !subject.accountId ||
    !subject.currency ||
    !parsed ||
    (input.kind === "dispute" && !evidenceDueAt)
  )
    return { ok: false, refusals };

  const money = { currency: subject.currency, minor: parsed.toString() };
  const command = correctionCommands[input.kind];
  if (input.kind === "credit_note")
    return {
      ok: true,
      command: {
        ...command,
        accountId: subject.accountId,
        payload: {
          invoiceId: subject.invoiceId,
          amount: money,
          providerReason: input.providerReason,
          internalReasonCode: input.internalReasonCode.trim(),
        },
      },
    };
  if (input.kind === "refund")
    return {
      ok: true,
      command: {
        ...command,
        accountId: subject.accountId,
        payload: {
          paymentId: input.paymentId.trim(),
          amount: money,
          providerReason: input.providerReason,
          internalReasonCode: input.internalReasonCode.trim(),
        },
      },
    };
  return {
    ok: true,
    command: {
      ...command,
      accountId: subject.accountId,
      payload: {
        paymentId: input.paymentId.trim(),
        stripeDisputeId: input.stripeDisputeId.trim(),
        amount: money,
        evidenceDueAt,
      },
    },
  };
}
