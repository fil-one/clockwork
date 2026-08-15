import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CommercialRecord } from "./model";
import { CommercialRecordDetail } from "./record-detail";

const csrfToken = "12345678901234567890123456789012";
const accountId = "10000000-0000-4000-8000-000000000001";

function invoice(overrides: Partial<CommercialRecord> = {}): CommercialRecord {
  return {
    id: "INV-2026-0781",
    kind: "billing",
    title: "July committed capacity",
    description: "Invoice for Northstar primary archive",
    status: "open",
    statusLabel: "Open",
    tone: "warning",
    risk: "medium",
    owner: "Accounts payable",
    value: "$15,400.00",
    valueLabel: "Invoiced amount",
    updatedAt: "2026-07-31T08:00:00.000Z",
    dateLabel: "Due Aug 8",
    href: "/billing/INV-2026-0781",
    term: "Service period Jul 1-31, 2026",
    nextAction: "Review and pay by Aug 8",
    version: "1",
    aggregateId: "50000000-0000-4000-8000-000000000014",
    ...overrides,
  };
}

describe("invoice payment handoff", () => {
  beforeEach(() => {
    document.cookie = `clockwork-csrf=${csrfToken}; path=/`;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.cookie = "clockwork-csrf=; Max-Age=0; path=/";
  });

  it("states each open invoice's own amount and due date", () => {
    const july = render(
      <CommercialRecordDetail
        accountId={accountId}
        canMutate
        id="INV-2026-0781"
        record={invoice()}
      />,
    );
    const august = render(
      <CommercialRecordDetail
        accountId={accountId}
        canMutate
        id="INV-2026-0802"
        record={invoice({
          id: "INV-2026-0802",
          title: "August committed capacity",
          value: "$27,150.00",
          dateLabel: "Due Sep 8",
          href: "/billing/INV-2026-0802",
          aggregateId: "50000000-0000-4000-8000-000000000015",
        })}
      />,
    );

    const first = within(july.container).getByRole("region", {
      name: "Review payment",
    });
    const second = within(august.container).getByRole("region", {
      name: "Review payment",
    });
    expect(first).toHaveTextContent("$15,400.00");
    expect(first).toHaveTextContent("Due Aug 8");
    expect(first).not.toHaveTextContent("$27,150.00");
    expect(second).toHaveTextContent("$27,150.00");
    expect(second).toHaveTextContent("Due Sep 8");
    expect(second).not.toHaveTextContent("$15,400.00");
  });

  it("opens the payment session for the invoice on screen", async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            provider: "stripe",
            sessionId: "in_test",
            invoiceId: "50000000-0000-4000-8000-000000000015",
            url: "https://invoice.stripe.com/i/acct_test/in_test",
            status: "requires_customer_action",
          }),
          { headers: { "content-type": "application/json" } },
        ),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(
      <CommercialRecordDetail
        accountId={accountId}
        canMutate
        id="INV-2026-0802"
        record={invoice({
          id: "INV-2026-0802",
          value: "$27,150.00",
          dateLabel: "Due Sep 8",
          aggregateId: "50000000-0000-4000-8000-000000000015",
        })}
      />,
    );

    await user.click(screen.getByRole("checkbox"));
    await user.click(
      screen.getByRole("button", { name: "Prepare secure payment" }),
    );
    expect(
      await screen.findByRole("link", {
        name: "Continue to secure Stripe payment",
      }),
    ).toHaveAttribute("href", "https://invoice.stripe.com/i/acct_test/in_test");

    const firstCall = fetchMock.mock.calls.at(0);
    if (!firstCall) throw new Error("No payment session was requested.");
    const request = firstCall[0] as Request;
    expect(request.url).toContain("/api/v1/core/payment-sessions");
    await expect(request.clone().json()).resolves.toEqual({
      accountId,
      invoiceId: "50000000-0000-4000-8000-000000000015",
    });
  });

  it("refuses the handoff, charging nothing, when the invoice has no persisted identity", () => {
    const withoutIdentity: CommercialRecord = invoice();
    delete withoutIdentity.aggregateId;
    render(
      <CommercialRecordDetail
        accountId={accountId}
        canMutate
        id="INV-2026-0781"
        record={withoutIdentity}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Nothing was charged.");
    expect(
      screen.queryByRole("button", { name: "Prepare secure payment" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the existing explanation for a reader without payment rights", () => {
    render(
      <CommercialRecordDetail
        accountId={accountId}
        id="INV-2026-0781"
        record={invoice()}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Payment access" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Prepare secure payment" }),
    ).not.toBeInTheDocument();
  });
});
