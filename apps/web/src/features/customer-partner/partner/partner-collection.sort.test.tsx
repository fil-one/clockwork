import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/partner/portfolio",
  useSearchParams: () => new URLSearchParams(search),
}));

import { PartnerCollection } from "./partner-collection";
import type { PartnerRecord } from "./partner-data";
import { partnerSurfaces } from "./partner-data";

let search = "";

const formatting = { locale: "en-US", timeZone: "America/New_York" };
const fresh = { generatedAt: "2026-08-14T13:04:00Z", stale: false };

function record(letter: string, index: number): PartnerRecord {
  return {
    id: `EC-${letter}`,
    name: `${letter} cooperative`,
    context: "Resale · US East",
    status: "active",
    risk: index % 2 === 0 ? "low" : "high",
    owner: "Juno Okafor",
    value: `$${(index + 1) * 1_000}`,
    secondary: "Renewal Sep 2",
  };
}

/** Twelve records against the ten-record default page. */
const records = "LKJIHGFEDCBA".split("").map(record);
const config = { ...partnerSurfaces.portfolio, records };

function renderLedger(query = "") {
  search = query;
  return render(
    <PartnerCollection
      config={config}
      formatting={formatting}
      freshness={fresh}
      partnerName="Aurora Systems"
      roles={["partner_admin"]}
      surface="portfolio"
    />,
  );
}

function headerCell(name: string) {
  return screen
    .getAllByRole("columnheader")
    .find((cell) => cell.textContent?.trim().startsWith(name));
}

function visibleNames() {
  return within(screen.getByRole("table"))
    .getAllByRole("rowheader")
    .map((cell) => cell.textContent?.slice(0, 1));
}

/**
 * The partner brief asks for a sortable work ledger. The ledger had a sort in
 * a `<select>` and inert header text, with no `aria-sort` anywhere in the
 * repository. Every assertion here fails against that component.
 */
describe("partner ledger sortable columns", () => {
  it("announces the ordering on the column it applies to", () => {
    renderLedger("sort=name-desc");

    expect(headerCell(config.columns[0])).toHaveAttribute(
      "aria-sort",
      "descending",
    );
    expect(headerCell("Status")).toHaveAttribute("aria-sort", "none");
    // The trailing columns are per-surface free text with no ordering behind
    // them, so they claim nothing.
    expect(headerCell(config.columns[2])).not.toHaveAttribute("aria-sort");
  });

  it("puts the reader's ordering in the URL rather than in component state", () => {
    renderLedger("sort=name-asc");

    fireEvent.click(
      screen.getByRole("button", {
        name: `${config.columns[0]}, sorted ascending. Sort descending`,
      }),
    );

    expect(mocks.push).toHaveBeenCalledWith(
      expect.stringContaining("sort=name-desc"),
      { scroll: false },
    );
  });

  it("orders the whole ledger, not the page on screen", () => {
    const view = renderLedger("sort=name-asc&pageSize=5");
    expect(visibleNames()).toEqual(["A", "B", "C", "D", "E"]);

    search = "sort=name-desc&pageSize=5";
    view.rerender(
      <PartnerCollection
        config={config}
        formatting={formatting}
        freshness={fresh}
        partnerName="Aurora Systems"
        roles={["partner_admin"]}
        surface="portfolio"
      />,
    );

    expect(visibleNames()).toEqual(["L", "K", "J", "I", "H"]);
  });

  it("offers every ordering its headers can produce in the sort control", () => {
    renderLedger("sort=status-desc");

    // A header sort producing a token the controlled `<select>` did not carry
    // would make React fall back to the first option, so the page would claim
    // an ordering it is not using.
    expect(screen.getByRole("combobox", { name: /sort/i })).toHaveValue(
      "status-desc",
    );
  });
});
