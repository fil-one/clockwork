import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { CustomerCollectionRecord } from "./collection-state";
import { CustomerCollection } from "./customer-collection";
import { customerCollections } from "./customer-data";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

const formatting = { locale: "en-US", timeZone: "America/New_York" };
const fresh = {
  generatedAt: "2026-08-14T13:04:00Z",
  partial: false,
  stale: false,
};

function record(letter: string, index: number): CustomerCollectionRecord {
  return {
    id: `AMD-${letter}`,
    title: `${letter} amendment`,
    description: "Capacity change",
    status: "review",
    statusLabel: "Review",
    risk: "low",
    owner: "Maya Chen",
    value: `+$${(index + 1) * 1_000}`,
    valueSort: (index + 1) * 1_000,
    updatedAt: `2026-08-${String(index + 1).padStart(2, "0")}T00:00:00Z`,
    updatedLabel: "Updated recently",
    context: [{ label: "Order", value: "ORD-1" }],
  };
}

/** Twelve records against a five-record page. */
const records = "LKJIHGFEDCBA".split("").map(record);
const config = { ...customerCollections.amendments, records };

function headerCell(name: string) {
  return screen
    .getAllByRole("columnheader")
    .find((cell) => cell.textContent?.trim().startsWith(name));
}

function visibleTitles() {
  return within(screen.getByRole("table"))
    .getAllByRole("rowheader")
    .map((cell) => cell.textContent?.slice(0, 1));
}

/**
 * Fails against the unfixed component: it renders plain header text with no
 * control and no `aria-sort`, so the ordering was neither announced nor
 * reachable from the header row.
 */
describe("customer collection sortable columns", () => {
  it("announces the ordering, and only on columns that have one", () => {
    render(
      <CustomerCollection
        config={config}
        formatting={formatting}
        freshness={fresh}
        searchParams={{ sort: "value-desc" }}
      />,
    );

    expect(headerCell(config.valueLabel)).toHaveAttribute(
      "aria-sort",
      "descending",
    );
    expect(headerCell("Updated")).toHaveAttribute("aria-sort", "none");
    // Owner is a filter on this surface, with no ordering behind it.
    expect(headerCell(config.ownerLabel)).not.toHaveAttribute("aria-sort");
  });

  it("orders every record read, not the page on screen", () => {
    const { rerender } = render(
      <CustomerCollection
        config={config}
        formatting={formatting}
        freshness={fresh}
        searchParams={{ sort: "title-asc", pageSize: "5" }}
      />,
    );
    expect(visibleTitles()).toEqual(["A", "B", "C", "D", "E"]);

    rerender(
      <CustomerCollection
        config={config}
        formatting={formatting}
        freshness={fresh}
        searchParams={{ sort: "title-desc", pageSize: "5" }}
      />,
    );

    expect(visibleTitles()).toEqual(["L", "K", "J", "I", "H"]);
  });

  it("returns the reader to the first page of the new ordering", () => {
    render(
      <CustomerCollection
        config={config}
        formatting={formatting}
        freshness={fresh}
        searchParams={{ sort: "title-asc", pageSize: "5", page: "2" }}
      />,
    );

    const control = screen.getByRole("link", {
      name: `${config.recordLabel}, sorted ascending. Sort descending`,
    });
    expect(control).toHaveAttribute(
      "href",
      expect.stringContaining("sort=title-desc"),
    );
    // `serializeCollectionState` omits page 1 rather than writing it, so the
    // absence of the parameter is the reset.
    expect(control).toHaveAttribute(
      "href",
      expect.not.stringContaining("page="),
    );
  });
});
