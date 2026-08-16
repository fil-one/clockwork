import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProjectedArtifact } from "@/src/features/experience-server/artifact-delivery-list";

import type { CommercialRecord } from "./model";
import { CommercialRecordDetail } from "./record-detail";

/**
 * The Documents section reads the record's attached artifacts through the
 * server projection, which is not reachable from jsdom. The read is stubbed
 * here; that the section renders what the read returns is asserted below, and
 * that the documents themselves are real bytes is proved against the running
 * application, not here.
 */
const mocks = vi.hoisted(() => ({
  loadRecordArtifacts: vi.fn<() => Promise<readonly ProjectedArtifact[]>>(() =>
    Promise.resolve([]),
  ),
}));

vi.mock("@/src/features/experience-server/delivery", () => ({
  loadRecordArtifacts: mocks.loadRecordArtifacts,
}));

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
    mocks.loadRecordArtifacts.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.cookie = "clockwork-csrf=; Max-Age=0; path=/";
  });

  it("states each open invoice's own amount and due date", async () => {
    const july = render(
      await CommercialRecordDetail({
        accountId,
        canMutate: true,
        id: "INV-2026-0781",
        record: invoice(),
      }),
    );
    const august = render(
      await CommercialRecordDetail({
        accountId,
        canMutate: true,
        id: "INV-2026-0802",
        record: invoice({
          id: "INV-2026-0802",
          title: "August committed capacity",
          value: "$27,150.00",
          dateLabel: "Due Sep 8",
          href: "/billing/INV-2026-0802",
          aggregateId: "50000000-0000-4000-8000-000000000015",
        }),
      }),
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
      await CommercialRecordDetail({
        accountId,
        canMutate: true,
        id: "INV-2026-0802",
        record: invoice({
          id: "INV-2026-0802",
          value: "$27,150.00",
          dateLabel: "Due Sep 8",
          aggregateId: "50000000-0000-4000-8000-000000000015",
        }),
      }),
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

  it("refuses the handoff, charging nothing, when the invoice has no persisted identity", async () => {
    const withoutIdentity: CommercialRecord = invoice();
    delete withoutIdentity.aggregateId;
    render(
      await CommercialRecordDetail({
        accountId,
        canMutate: true,
        id: "INV-2026-0781",
        record: withoutIdentity,
      }),
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Nothing was charged.");
    expect(
      screen.queryByRole("button", { name: "Prepare secure payment" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the existing explanation for a reader without payment rights", async () => {
    render(
      await CommercialRecordDetail({
        accountId,
        id: "INV-2026-0781",
        record: invoice(),
      }),
    );

    expect(
      screen.getByRole("heading", { name: "Payment access" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Prepare secure payment" }),
    ).not.toBeInTheDocument();
  });
});

/**
 * The section used to be three sentences and no link: a "Primary artifact" that
 * was the record's own title, an "Availability" that was a claim about roles,
 * and a promise that downloads appear "when a document provider supplies a
 * safe, authorized link" -- from a surface that asked no provider anything.
 * These hold the two halves of what replaced it: it reads the record's real
 * artifacts, and when there are none it says none rather than implying one.
 */
describe("record documents", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.loadRecordArtifacts.mockResolvedValue([]);
  });

  it("reads the artifacts attached to this record, by audience and channel", async () => {
    mocks.loadRecordArtifacts.mockResolvedValue([]);
    render(
      await CommercialRecordDetail({
        id: "INV-2026-0781",
        record: invoice(),
      }),
    );

    expect(mocks.loadRecordArtifacts).toHaveBeenCalledWith(
      "customer",
      "billing",
      "INV-2026-0781",
    );
  });

  it("renders every attached artifact for download", async () => {
    mocks.loadRecordArtifacts.mockResolvedValue([
      {
        kind: "invoice_companion",
        id: "fa9d7fdb-c63b-4cf3-8432-f98a70e9c912",
        label: "Invoice INV-2026-0781",
        state: "stored",
      },
      {
        kind: "receipt",
        id: "f443a6bd-e77d-4caa-8cee-00704ae2d388",
        label: "Receipt RCPT-2026-0712",
        state: "stored",
      },
    ]);
    render(
      await CommercialRecordDetail({
        id: "INV-2026-0781",
        record: invoice(),
      }),
    );

    const documents = screen.getByRole("region", {
      name: "Immutable document artifacts",
    });
    expect(documents).toHaveTextContent("Invoice INV-2026-0781");
    expect(documents).toHaveTextContent("Receipt RCPT-2026-0712");
  });

  it("says there are none rather than implying a download", async () => {
    mocks.loadRecordArtifacts.mockResolvedValue([]);
    const { container } = render(
      await CommercialRecordDetail({
        id: "INV-2026-0781",
        record: invoice(),
      }),
    );

    expect(
      screen.getByText("No generated artifacts are attached to this record."),
    ).toBeVisible();
    for (const claim of [
      "Primary artifact",
      "Visible to authorized account roles",
      "Downloads are shown only when a document provider supplies a safe",
    ])
      expect(container.textContent).not.toContain(claim);
  });
});
