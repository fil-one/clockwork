import { describe, expect, it } from "vitest";

import {
  buildCorrectionCommand,
  correctionCommands,
  providerReasons,
  type CorrectionInput,
  type CorrectionSubject,
} from "./model";

const subject: CorrectionSubject = {
  invoiceId: "11111111-1111-4111-8111-111111111111",
  accountId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  currency: "USD",
  amountMinor: 100000n,
};

const PAYMENT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function input(overrides: Partial<CorrectionInput> = {}): CorrectionInput {
  return {
    kind: "credit_note",
    amountMinor: "25000",
    providerReason: "order_change",
    internalReasonCode: "SERVICE_CREDIT",
    paymentId: "",
    stripeDisputeId: "",
    evidenceDueAt: "",
    ...overrides,
  };
}

describe("correction command binding", () => {
  /**
   * The retired panel branch sent `{invoiceId, stripeCreditNoteId, amount,
   * reasonCode}`. `CreditNoteIssueCommandSchema` is strict and wants
   * `{invoiceId, amount, providerReason, internalReasonCode}`, so every credit
   * note that branch ever sent was rejected before it reached a branch.
   */
  it("builds the credit-note payload the strict server schema accepts", () => {
    const result = buildCorrectionCommand(subject, input());
    if (!result.ok) throw new Error(result.refusals.join(", "));

    expect(result.command).toEqual({
      resource: "credit_notes",
      action: "issue",
      accountId: subject.accountId,
      payload: {
        invoiceId: subject.invoiceId,
        amount: { currency: "USD", minor: "25000" },
        providerReason: "order_change",
        internalReasonCode: "SERVICE_CREDIT",
      },
    });
  });

  it("builds the refund payload with the payment identity and no provider reference", () => {
    const result = buildCorrectionCommand(
      subject,
      input({
        kind: "refund",
        providerReason: "requested_by_customer",
        paymentId: PAYMENT,
      }),
    );
    if (!result.ok) throw new Error(result.refusals.join(", "));

    expect(result.command).toEqual({
      resource: "refunds",
      action: "submit",
      accountId: subject.accountId,
      payload: {
        paymentId: PAYMENT,
        amount: { currency: "USD", minor: "25000" },
        providerReason: "requested_by_customer",
        internalReasonCode: "SERVICE_CREDIT",
      },
    });
  });

  it("normalizes the dispute deadline to an absolute instant", () => {
    const result = buildCorrectionCommand(
      subject,
      input({
        kind: "dispute",
        paymentId: PAYMENT,
        stripeDisputeId: "dp_1Abc23",
        evidenceDueAt: "2026-09-01T12:00:00.000Z",
      }),
    );
    if (!result.ok) throw new Error(result.refusals.join(", "));

    expect(result.command.payload).toEqual({
      paymentId: PAYMENT,
      stripeDisputeId: "dp_1Abc23",
      amount: { currency: "USD", minor: "25000" },
      evidenceDueAt: "2026-09-01T12:00:00.000Z",
    });
  });

  it("offers only the verbs the money work-stream implements", () => {
    expect(
      Object.values(correctionCommands).map((entry) => entry.action),
    ).toEqual(["issue", "submit", "create"]);
  });

  it("keeps the credit-note and refund provider reasons apart", () => {
    expect(providerReasons.credit_note).not.toContain("requested_by_customer");
    expect(providerReasons.refund).not.toContain("order_change");
    expect(
      buildCorrectionCommand(
        subject,
        input({
          kind: "refund",
          providerReason: "order_change",
          paymentId: PAYMENT,
        }),
      ),
    ).toMatchObject({ ok: false, refusals: ["PROVIDER_REASON_INVALID"] });
  });
});

describe("the complete refused set", () => {
  it("refuses a correction whose billing account could not be joined", () => {
    expect(
      buildCorrectionCommand({ ...subject, accountId: null }, input()),
    ).toMatchObject({ ok: false, refusals: ["ACCOUNT_UNRESOLVED"] });
  });

  it("refuses an amount that is not positive whole minor units", () => {
    for (const amountMinor of ["0", "-1", "12.50", "", "1e3"])
      expect(
        buildCorrectionCommand(subject, input({ amountMinor })),
      ).toMatchObject({ ok: false, refusals: ["AMOUNT_INVALID"] });
  });

  it("refuses a credit larger than the invoice total", () => {
    expect(
      buildCorrectionCommand(subject, input({ amountMinor: "100001" })),
    ).toMatchObject({ ok: false, refusals: ["AMOUNT_EXCEEDS_INVOICE"] });
  });

  /**
   * The server credits an open invoice only down to what is still owed, less
   * any credit note already raised. Neither figure is in the projection, so a
   * request inside the invoice total is passed through for the server to judge
   * rather than blocked here on a guess.
   */
  it("does not pre-judge the ceiling the server actually applies", () => {
    expect(
      buildCorrectionCommand(subject, input({ amountMinor: "100000" })).ok,
    ).toBe(true);
  });

  it("refuses a missing currency", () => {
    expect(
      buildCorrectionCommand({ ...subject, currency: null }, input()),
    ).toMatchObject({ ok: false, refusals: ["CURRENCY_UNRESOLVED"] });
  });

  it("refuses an internal reason code outside 3 to 120 characters", () => {
    for (const internalReasonCode of ["ab", "x".repeat(121)])
      expect(
        buildCorrectionCommand(subject, input({ internalReasonCode })),
      ).toMatchObject({ ok: false, refusals: ["INTERNAL_REASON_REQUIRED"] });
  });

  it("refuses a refund or dispute with no payment identity", () => {
    expect(
      buildCorrectionCommand(
        subject,
        input({ kind: "refund", providerReason: "duplicate" }),
      ),
    ).toMatchObject({ ok: false, refusals: ["PAYMENT_REQUIRED"] });
  });

  it("refuses a dispute reference that is not a Stripe dispute", () => {
    expect(
      buildCorrectionCommand(
        subject,
        input({
          kind: "dispute",
          paymentId: PAYMENT,
          stripeDisputeId: "ch_1Abc23",
          evidenceDueAt: "2026-09-01T12:00:00.000Z",
        }),
      ),
    ).toMatchObject({ ok: false, refusals: ["DISPUTE_REFERENCE_INVALID"] });
  });

  it("refuses an unreadable evidence deadline", () => {
    expect(
      buildCorrectionCommand(
        subject,
        input({
          kind: "dispute",
          paymentId: PAYMENT,
          stripeDisputeId: "dp_1Abc23",
          evidenceDueAt: "soon",
        }),
      ),
    ).toMatchObject({ ok: false, refusals: ["EVIDENCE_DUE_INVALID"] });
  });

  it("reports every refusal at once rather than one per submission", () => {
    const result = buildCorrectionCommand(
      { ...subject, accountId: null },
      input({ amountMinor: "0", internalReasonCode: "" }),
    );

    expect(result).toMatchObject({ ok: false });
    if (result.ok) throw new Error("Expected a refusal.");
    expect([...result.refusals].sort()).toEqual([
      "ACCOUNT_UNRESOLVED",
      "AMOUNT_INVALID",
      "INTERNAL_REASON_REQUIRED",
    ]);
  });

  it("asks a dispute for no internal reason code, which its schema has no field for", () => {
    expect(
      buildCorrectionCommand(
        subject,
        input({
          kind: "dispute",
          internalReasonCode: "",
          paymentId: PAYMENT,
          stripeDisputeId: "dp_1Abc23",
          evidenceDueAt: "2026-09-01T12:00:00.000Z",
        }),
      ).ok,
    ).toBe(true);
  });
});
