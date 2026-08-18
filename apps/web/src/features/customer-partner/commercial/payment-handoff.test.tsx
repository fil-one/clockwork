import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  recordKey: "invoice-meridian-overdue",
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

afterEach(() => {
  vi.unstubAllGlobals();
  document.cookie = "clockwork-csrf=; Max-Age=0; path=/";
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

describe("the guided demo payment sandbox", () => {
  beforeEach(() => {
    document.cookie = "clockwork-csrf=12345678901234567890123456789012; path=/";
  });

  it("uses only same-origin demo mutations and returns to the paid invoice", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          provider: "demo_sandbox",
          sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          invoiceId: invoice.invoiceId,
          status: "requires_customer_action",
          paymentAttemptId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          receiptId: null,
          completedAt: null,
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          provider: "demo_sandbox",
          sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          invoiceId: invoice.invoiceId,
          status: "paid",
          paymentAttemptId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          receiptId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          completedAt: "2026-08-18T18:00:00.000Z",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<PaymentHandoff {...invoice} guidedDemo />);

    expect(screen.getByText(/never contacts Stripe/u)).toBeVisible();
    expect(screen.getByText(/no money moves/u)).toBeVisible();
    await user.click(screen.getByRole("checkbox"));
    await user.click(
      screen.getByRole("button", { name: "Start demo sandbox checkout" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Complete demo payment" }),
    );

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Demo payment complete",
    );
    expect(
      screen.getByRole("link", { name: "Return to paid invoice" }),
    ).toHaveAttribute("href", "/billing/invoice-meridian-overdue");
    expect(mocks.createInvoicePaymentSession).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/demo/payments/sessions");
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "/api/demo/payments/sessions/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/complete",
    );
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.credentials).toBe("same-origin");
      expect(new Headers(init?.headers).get("x-csrf-token")).toBe(
        "12345678901234567890123456789012",
      );
      expect(new Headers(init?.headers).get("idempotency-key")).toHaveLength(
        36,
      );
    }
  });

  it("refuses a sandbox response bound to another invoice", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(() =>
        Promise.resolve(
          Response.json({
            provider: "demo_sandbox",
            sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            invoiceId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            status: "requires_customer_action",
            paymentAttemptId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            receiptId: null,
            completedAt: null,
          }),
        ),
      ),
    );
    const user = userEvent.setup();
    render(<PaymentHandoff {...invoice} guidedDemo />);
    await user.click(screen.getByRole("checkbox"));
    await user.click(
      screen.getByRole("button", { name: "Start demo sandbox checkout" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "different invoice",
    );
    expect(
      screen.queryByRole("button", { name: "Complete demo payment" }),
    ).toBeNull();
  });
});
