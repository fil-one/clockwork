import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createInvoicePaymentSession: vi.fn() }));

vi.mock("@/src/features/contracts/commerce-client", async (importOriginal) => {
  // The real module is kept for `CommerceApiError`: the surface tells a
  // scripted refusal from an outage by reading the error's own problem code, so
  // a hand-rolled stand-in would not exercise the branch under test.
  const actual = await importOriginal<
    Record<string, unknown> & { CommerceApiError: unknown }
  >();
  return {
    ...actual,
    createInvoicePaymentSession: mocks.createInvoicePaymentSession,
  };
});

import { CommerceApiError } from "@/src/features/contracts/commerce-client";

import { PaymentHandoff } from "./payment-handoff";

const invoice = {
  accountId: "11111111-1111-4111-8111-111111111111",
  invoiceId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  amountLabel: "$15,400.00",
  dueLabel: "Aug 12, 2026",
};

async function prepare() {
  const user = userEvent.setup();
  render(<PaymentHandoff {...invoice} />);
  await user.click(screen.getByRole("checkbox"));
  await user.click(screen.getByRole("button", { name: /Prepare secure/u }));
  return user;
}

beforeEach(() => {
  mocks.createInvoicePaymentSession.mockReset();
});

describe("the payment boundary", () => {
  /**
   * The demo refuses checkout on purpose. Rendering that refusal in the alert
   * style, under the sentence "The commerce service is unavailable.", showed a
   * prospect breakage where the product had made a deliberate choice -- and
   * left a retry control that could not possibly succeed.
   */
  it("reads as a scripted boundary, not an outage", async () => {
    mocks.createInvoicePaymentSession.mockRejectedValue(
      new CommerceApiError(
        503,
        "unavailable",
        "The demo never contacts a payment provider, so no checkout session exists.",
        "DEMO_PAYMENT_UNAVAILABLE",
      ),
    );

    await prepare();

    const boundary = await screen.findByRole("status");
    expect(boundary).toHaveTextContent("Payment is where this workspace stops");
    expect(boundary).toHaveTextContent("never contacts a payment provider");
    expect(boundary).toHaveTextContent("On the live platform");
    expect(screen.queryByRole("alert")).toBeNull();
    // Nothing to retry: pressing it again cannot change a deliberate refusal.
    expect(
      screen.queryByRole("button", { name: /Prepare secure/u }),
    ).toBeNull();
  });

  /** A genuine failure keeps the alert and keeps the retry. */
  it("still reports a real failure as an error", async () => {
    mocks.createInvoicePaymentSession.mockRejectedValue(
      new CommerceApiError(
        503,
        "unavailable",
        "The commerce service is unavailable.",
      ),
    );

    await prepare();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The commerce service is unavailable.",
    );
    expect(
      screen.getByRole("button", { name: /Prepare secure/u }),
    ).toBeInTheDocument();
  });
});
