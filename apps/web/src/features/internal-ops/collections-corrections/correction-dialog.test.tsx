import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as CommerceClient from "@/src/features/contracts/commerce-client";
import { CommerceApiError } from "@/src/features/contracts/commerce-client";
import { catalogs } from "@/src/i18n/catalogs";
import { LanguageProvider } from "@/src/i18n/client";

const send = vi.hoisted(() => vi.fn());

vi.mock("@/src/features/contracts/commerce-client", async () => {
  const actual = await vi.importActual<typeof CommerceClient>(
    "@/src/features/contracts/commerce-client",
  );
  return { ...actual, sendCoreCommand: send };
});

import { CorrectionDialog } from "./correction-dialog";
import type { CorrectionKind } from "./model";

const subject = {
  invoiceId: "11111111-1111-4111-8111-111111111111",
  accountId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  currency: "USD",
  amountMinor: "100000",
  reference: "INV-11111111",
};

function open(kind: CorrectionKind = "credit_note", overrides = {}) {
  return render(
    <CorrectionDialog kind={kind} subject={{ ...subject, ...overrides }} />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  send.mockResolvedValue({
    record: { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" },
  });
});

describe("collections corrections", () => {
  it("states what a credit note does and whether it can be undone", async () => {
    const user = userEvent.setup();
    open();

    await user.click(screen.getByRole("button", { name: "Issue credit note" }));

    expect(
      screen.getAllByText(/A credit note is approved against this invoice/u)
        .length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByText(/Only by voiding the credit note through the provider/u),
    ).toBeVisible();
  });

  /**
   * The invoice, the account and the currency come from the row. Only the
   * amount and the reasons are the operator's, so the sent payload has to carry
   * the row's identity even though nothing on the form named it.
   */
  it("sends the credit note bound to the row's invoice and account", async () => {
    const user = userEvent.setup();
    open();

    await user.click(screen.getByRole("button", { name: "Issue credit note" }));
    await user.type(screen.getByLabelText(/Amount in minor units/u), "25000");
    await user.type(
      screen.getByLabelText(/Internal reason code/u),
      "SERVICE_CREDIT",
    );
    await user.click(
      screen.getByRole("button", { name: "Issue this credit note" }),
    );

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toMatchObject({
      resource: "credit_notes",
      action: "issue",
      accountId: subject.accountId,
      payload: {
        invoiceId: subject.invoiceId,
        amount: { currency: "USD", minor: "25000" },
        providerReason: "duplicate",
        internalReasonCode: "SERVICE_CREDIT",
      },
    });
    expect(
      await screen.findByText(
        /Recorded\. Reference cccccccc-cccc-4ccc-8ccc-cccccccccccc\./u,
      ),
    ).toBeVisible();
  });

  it("sends nothing and lists every refusal at once", async () => {
    const user = userEvent.setup();
    open();

    await user.click(screen.getByRole("button", { name: "Issue credit note" }));
    await user.click(
      screen.getByRole("button", { name: "Issue this credit note" }),
    );

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain(
      "Enter the amount as a positive whole number in the smallest currency unit.",
    );
    expect(alert.textContent).toContain(
      "Give an internal reason code of 3 to 120 characters.",
    );
    expect(send).not.toHaveBeenCalled();
  });

  /**
   * No page looks up payments, so the refund form has to say the field
   * is the operator's and not the record's.
   */
  it("labels the payment identity on a refund as operator-supplied", async () => {
    const user = userEvent.setup();
    open("refund");

    await user.click(screen.getByRole("button", { name: "Submit refund" }));

    expect(screen.getByText(/No page looks up payments/u)).toBeVisible();
  });

  it("asks a dispute for the Stripe identifier and no internal reason code", async () => {
    const user = userEvent.setup();
    open("dispute");

    await user.click(screen.getByRole("button", { name: "Record dispute" }));

    expect(screen.getByLabelText(/Stripe dispute identifier/u)).toBeVisible();
    expect(screen.queryByLabelText(/Internal reason code/u)).toBeNull();
  });

  /**
   * The server's English `detail` is for logs and API callers. The reader is
   * told in their language that nothing was written, with the server's problem
   * code (an identifier) so the refusal can still be traced.
   */
  it("reports a server refusal in the reader's words without quoting the server", async () => {
    send.mockRejectedValue(
      new CommerceApiError(
        422,
        "validation",
        "Credit exceeds the remaining invoice amount or currency",
        "CREDIT_EXCEEDS_REMAINING",
      ),
    );
    const user = userEvent.setup();
    open();

    await user.click(screen.getByRole("button", { name: "Issue credit note" }));
    await user.type(screen.getByLabelText(/Amount in minor units/u), "90000");
    await user.type(
      screen.getByLabelText(/Internal reason code/u),
      "SERVICE_CREDIT",
    );
    await user.click(
      screen.getByRole("button", { name: "Issue this credit note" }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Nothing was written");
    expect(alert.textContent).toContain(
      "Server code: CREDIT_EXCEEDS_REMAINING",
    );
    expect(alert.textContent).not.toContain(
      "Credit exceeds the remaining invoice amount or currency",
    );
  });

  /**
   * The dialog is worded in the reader's language end to end: the Stripe
   * reason codes are labelled rather than shown as "order change", and the
   * invoice total in the amount help is formatted for the reader from minor
   * units, not copied from an English-formatted string.
   */
  it("speaks the reader's language, including the provider reasons and the total", async () => {
    const user = userEvent.setup();
    render(
      <LanguageProvider locale="pt" catalog={catalogs.pt}>
        <CorrectionDialog kind="credit_note" subject={subject} />
      </LanguageProvider>,
    );

    await user.click(
      screen.getByRole("button", { name: "Emitir nota de crédito" }),
    );

    const total = new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "USD",
    })
      .format(1000)
      // The DOM matcher collapses Intl's no-break space to a plain one.
      .replace(/\s/gu, " ");
    expect(
      screen.getByText(
        `Número inteiro na menor unidade de USD. O total da fatura é ${total}.`,
      ),
    ).toBeVisible();
    const reasons = screen
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(reasons).toEqual([
      "Duplicado",
      "Fraudulento",
      "Alteração do pedido",
      "Produto insatisfatório",
    ]);
    expect(
      screen.getByText(/Somente anulando a nota de crédito no provedor/u),
    ).toBeVisible();
  });
});
