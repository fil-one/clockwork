import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { CommercialRecord, CollectionKind } from "./model";
import { CommercialRecordDetail } from "./record-detail";

// Forward steps are header links; the document read is stubbed so the server
// module stays out of jsdom and cannot influence what these assert.
vi.mock("@/src/features/experience-server/delivery", () => ({
  loadRecordArtifacts: () => Promise.resolve([]),
}));

/**
 * A record as `loadCommercialRecord` builds one from a materialized payload:
 * `id` is the aggregate UUID, the same value as `aggregateId`, and the
 * projection `recordKey` the route resolved it by is not on the record at all.
 * That is the shape the forward links used to be built from, and it is why
 * every one of them selected nothing at its destination.
 */
function projected(
  kind: CollectionKind,
  overrides: Partial<CommercialRecord> = {},
): CommercialRecord {
  const aggregateId = "80000000-0000-4000-8000-000000000001";
  return {
    id: aggregateId,
    aggregateId,
    kind,
    title: "Northstar primary archive",
    description: "Projected record",
    status: "active",
    statusLabel: "Active",
    tone: "success",
    risk: "low",
    owner: "Service operations",
    value: "62% used",
    valueLabel: "Capacity usage",
    updatedAt: "2026-07-31T15:42:00.000Z",
    dateLabel: "Updated Jul 31",
    href: `/${kind}/order-80000000-0000-4000-8000-000000000001`,
    term: "Ends Dec 31, 2026",
    nextAction: "No action due",
    version: "1",
    ...overrides,
  };
}

async function forwardStep(
  kind: CollectionKind,
  recordKey: string,
  overrides: Partial<CommercialRecord> = {},
) {
  const view = render(
    await CommercialRecordDetail({
      canMutate: true,
      id: recordKey,
      record: projected(kind, overrides),
    }),
  );
  // The header also carries "Sign this agreement", which is not a forward
  // step: it hands an agreement's aggregate id to the signing provider, which
  // is the identifier that route does take.
  const links = screen
    .getAllByRole("link")
    .filter(
      (link) =>
        link.closest("header") && link.textContent !== "Sign this agreement",
    );
  view.unmount();
  return links.map((link) => link.getAttribute("href"));
}

const recordKeys = {
  services: "termination-90000000-0000-4000-8000-000000000001",
  quotes: "quote-90000000-0000-4000-8000-000000000002",
  pocs: "poc-90000000-0000-4000-8000-000000000003",
  agreements: "agreement-90000000-0000-4000-8000-000000000004",
} as const;

describe("forward step references", () => {
  /**
   * `/account/offboarding` resolves `?service=` against the customer
   * `services` channel by `recordKey`, so that -- not the aggregate id -- is
   * what the link has to carry. The route's own `id` is that key by
   * construction: it is the value `loadCommercialRecord` found the record by.
   */
  it("sends the service's record key to offboarding", async () => {
    expect(await forwardStep("services", recordKeys.services)).toContain(
      `/account/offboarding?service=${encodeURIComponent(recordKeys.services)}`,
    );
  });

  it("does not send an accepted quote through acceptance again", async () => {
    expect(
      await forwardStep("quotes", recordKeys.quotes, { status: "accepted" }),
    ).toEqual([]);
  });

  it("offers an issued quote its binding acceptance step", async () => {
    const view = render(
      await CommercialRecordDetail({
        canMutate: true,
        id: recordKeys.quotes,
        record: projected("quotes", {
          status: "open",
          statusLabel: "Issued · awaiting acceptance",
        }),
      }),
    );

    expect(
      screen.getByRole("link", { name: "Review and accept order" }),
    ).toHaveAttribute(
      "href",
      `/orders/accept?quote=${encodeURIComponent(recordKeys.quotes)}`,
    );
    view.unmount();
  });

  it("sends the issued quote's record key to the revision builder", async () => {
    expect(
      await forwardStep("quotes", recordKeys.quotes, { status: "open" }),
    ).toContain(`/quotes/new?revises=${encodeURIComponent(recordKeys.quotes)}`);
  });

  it("sends the POC's record key to the quote builder", async () => {
    expect(await forwardStep("pocs", recordKeys.pocs)).toContain(
      `/quotes/new?poc=${encodeURIComponent(recordKeys.pocs)}`,
    );
  });

  it("sends the agreement's record key to execution", async () => {
    expect(
      await forwardStep("agreements", recordKeys.agreements, {
        status: "review",
        allowedActions: ["execute_agreement"],
      }),
    ).toContain(
      `/agreements/execute?agreement=${encodeURIComponent(recordKeys.agreements)}`,
    );
  });

  it("offers no execution or signing action on an active agreement", async () => {
    render(
      await CommercialRecordDetail({
        canMutate: true,
        id: recordKeys.agreements,
        record: projected("agreements", {
          status: "active",
          statusLabel: "Active · signed",
          allowedActions: [],
        }),
      }),
    );

    expect(
      screen.queryByRole("link", { name: "Execute a new agreement" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Sign this agreement" }),
    ).not.toBeInTheDocument();
  });

  /**
   * The one thing every one of those links used to carry. `aggregateId` and
   * the projected `id` are the same UUID, and no destination channel selects
   * on either, so a reference equal to it is the defect itself.
   */
  it("carries the aggregate id to none of them", async () => {
    for (const [kind, recordKey] of Object.entries(recordKeys))
      for (const href of await forwardStep(kind as CollectionKind, recordKey))
        expect(href).not.toContain("80000000-0000-4000-8000-000000000001");
  });

  /**
   * `/amendments` is the customer amendments collection, which reads only its
   * own list controls. It had an `?order=` that nothing could read; the link
   * states no reference rather than a reference the destination discards.
   */
  it("states no reference on the amendments collection link", async () => {
    expect(
      await forwardStep("orders", "order-90000000-0000-4000-8000-000000000005"),
    ).toContain("/amendments");
  });

  it("offers no forward step at all to a reader who cannot act", async () => {
    render(
      await CommercialRecordDetail({
        id: recordKeys.services,
        record: projected("services"),
      }),
    );

    expect(
      screen.queryByRole("link", { name: "Request offboarding" }),
    ).toBeNull();
    expect(
      screen.getByText("An owner or administrator can take the next action."),
    ).toBeVisible();
  });
});
