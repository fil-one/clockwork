import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CommercialCollectionPage } from "./collection-page";
import type { CommercialRecord } from "./model";

const fresh = { generatedAt: "2026-08-14T13:00:00Z", stale: false };
const formatting = { locale: "en-US", timeZone: "America/New_York" };

function record(letter: string, index: number): CommercialRecord {
  return {
    id: `quote-${letter}`,
    kind: "quotes",
    title: `${letter} quote`,
    description: "Committed capacity",
    status: "issued",
    statusLabel: "Issued",
    tone: "neutral",
    risk: "low",
    owner: "Dana Reyes",
    value: `$${(index + 1) * 1_000}.00`,
    valueLabel: "Estimated spend",
    updatedAt: `2026-08-${String(index + 1).padStart(2, "0")}T00:00:00Z`,
    dateLabel: "Updated recently",
    href: `/quotes/quote-${letter}`,
    term: "12 months",
    nextAction: "Review",
    version: "1",
    projectionId: `projection-${letter}`,
    aggregateId: `aggregate-${letter}`,
    allowedActions: [],
  };
}

/** Twelve records, so a five-record page can only ever hold a prefix. */
const records = "LKJIHGFEDCBA".split("").map(record);

function headerCell(name: string) {
  return screen
    .getAllByRole("columnheader")
    .find((cell) => cell.textContent?.trim().startsWith(name));
}

function visibleTitles() {
  return within(screen.getByRole("table"))
    .getAllByRole("rowheader")
    .map((cell) => cell.textContent?.split(" quote")[0]);
}

/**
 * There was no `aria-sort` anywhere in `apps/web`, and the sort lived only in
 * a `<select>` below the heading, so the column headers were inert text: a
 * reader was never told which column the rows were ordered by, and could not
 * change it from the header row. Every assertion here fails against that
 * component -- it renders no header links and no `aria-sort` at all.
 */
describe("commercial collection sortable columns", () => {
  it("announces the active ordering on the column it applies to", () => {
    render(
      <CommercialCollectionPage
        formatting={formatting}
        freshness={fresh}
        kind="quotes"
        records={records}
        searchParams={{ sort: "title_asc" }}
      />,
    );

    expect(headerCell("Record")).toHaveAttribute("aria-sort", "ascending");
    // Sortable, not active.
    expect(headerCell("Timing")).toHaveAttribute("aria-sort", "none");
    // Not sortable at all: `filterAndSortRecords` has no ordering for status,
    // so the header carries no `aria-sort` rather than a claim it cannot back.
    expect(headerCell("Status")).not.toHaveAttribute("aria-sort");
  });

  it("offers a control that names the column and reverses the active ordering", () => {
    render(
      <CommercialCollectionPage
        formatting={formatting}
        freshness={fresh}
        kind="quotes"
        records={records}
        searchParams={{ sort: "title_asc" }}
      />,
    );

    const control = screen.getByRole("link", {
      name: "Record, sorted ascending. Sort descending",
    });
    expect(control).toHaveAttribute(
      "href",
      expect.stringContaining("sort=title_desc"),
    );
    // A new ordering starts at its own first page.
    expect(control).toHaveAttribute("href", expect.stringContaining("page=1"));
  });

  /**
   * The failure a column sort must not introduce: ordering the page instead of
   * the set. It cannot happen here, and this is the proof -- the ordering is a
   * URL parameter applied by `filterAndSortRecords` over every record the
   * server read, and only then is the page sliced out of the result.
   */
  it("orders the whole collection, not the page that happens to be shown", () => {
    const { rerender } = render(
      <CommercialCollectionPage
        formatting={formatting}
        freshness={fresh}
        kind="quotes"
        records={records}
        searchParams={{ sort: "title_asc", pageSize: "5" }}
      />,
    );
    expect(visibleTitles()).toEqual(["A", "B", "C", "D", "E"]);

    rerender(
      <CommercialCollectionPage
        formatting={formatting}
        freshness={fresh}
        kind="quotes"
        records={records}
        searchParams={{ sort: "title_desc", pageSize: "5" }}
      />,
    );

    // L..H, not "the five records of page one, reversed" (E D C B A).
    expect(visibleTitles()).toEqual(["L", "K", "J", "I", "H"]);
  });

  it("keeps the sort control and the header agreeing on the ordering", () => {
    render(
      <CommercialCollectionPage
        formatting={formatting}
        freshness={fresh}
        kind="quotes"
        records={records}
        searchParams={{ sort: "value_asc" }}
      />,
    );

    // A header sort that produced a token the `<select>` did not offer would
    // leave that control showing no selection -- the page disagreeing with
    // itself about how it is ordered.
    expect(screen.getByLabelText("Sort")).toHaveValue("value_asc");
    expect(headerCell("Commercial context")).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
  });
});
