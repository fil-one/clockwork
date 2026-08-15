import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { CommercialRecord } from "./model";
import { CommercialRecordDetail } from "./record-detail";

const record: CommercialRecord = {
  id: "Q-3F2A91B0",
  kind: "quotes",
  title: "Archive expansion quote",
  description: "Revision 3 · issued Jul 31, 2026",
  status: "open",
  statusLabel: "Open",
  tone: "warning",
  risk: "medium",
  owner: "Dana Direct",
  value: "$184,800.00",
  valueLabel: "Quoted value",
  updatedAt: "2026-07-31T16:00:00.000Z",
  dateLabel: "Updated Jul 31",
  href: "/quotes/Q-3F2A91B0",
  term: "12 months from acceptance",
  nextAction: "Accept or request a revision",
  version: "3",
};

function markupFor(id: string): string {
  const { container, unmount } = render(
    <CommercialRecordDetail id={id} record={null} />,
  );
  const html = container.innerHTML;
  unmount();
  return html;
}

describe("commercial record detail, unreadable record", () => {
  it("still renders the record when one was readable", () => {
    render(<CommercialRecordDetail id={record.id} record={record} />);

    expect(
      screen.getByRole("heading", { name: /Archive expansion quote/ }),
    ).toBeVisible();
  });

  it("renders the branded not-found state when no record was readable", () => {
    render(<CommercialRecordDetail id="Q-NOT-A-RECORD" record={null} />);

    expect(screen.getByText("That page is not available")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Return to your dashboard" }),
    ).toHaveAttribute("href", "/dashboard");
  });

  /**
   * `loadCommercialRecord` returns the same `null` for a reference that does
   * not exist and one that belongs to another account, because the projection
   * query cannot tell them apart. This surface must not reintroduce the
   * difference -- including by echoing the reference back, which is the one
   * thing that varies between two such requests.
   */
  it("renders identical markup for every unreadable reference", () => {
    expect(markupFor("Q-THEIRS-0001")).toBe(markupFor("Q-NOT-A-RECORD"));
  });

  it("keeps loader vocabulary out of the not-found state", () => {
    const markup = markupFor("Q-NOT-A-RECORD");

    for (const internal of [
      "Projection",
      "projection",
      "omitted",
      "PROJECTION_NOT_FOUND",
      "ExperienceProblem",
    ])
      expect(markup).not.toContain(internal);
  });
});
