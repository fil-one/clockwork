import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ProjectionFreshnessNotice } from "./projection-freshness";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

const formatting = { locale: "en-US", timeZone: "America/New_York" };
const generatedAt = "2026-08-14T13:04:00Z";

/**
 * `loadPortalRecords` stopped throwing at the page ceiling and started
 * returning `truncated` with the prefix it read -- the right call, because the
 * throw refused a legitimate read outright. But the surfaces only ever
 * rendered `stale`, so a reader whose collection had been cut short was told
 * the rows "may be out of date" and offered a refresh, when what had actually
 * happened was that rows were missing and no refresh would return them.
 *
 * Both assertions fail against the unfixed component: `ProjectionFreshness`
 * had no `partial` field, so the truncated case was unrepresentable.
 */
describe("partial projection read disclosure", () => {
  it("says rows are missing, not merely behind", () => {
    render(
      <ProjectionFreshnessNotice
        formatting={formatting}
        freshness={{ generatedAt, partial: true, stale: true }}
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Only part of this collection could be");
    expect(alert).toHaveTextContent(
      "The result count, the filter choices and any total on this page describe only what was read",
    );
    // The stale wording claims something different and lesser.
    expect(alert).not.toHaveTextContent("These records may be out of date.");
  });

  it("says a sorted view orders only what was read", () => {
    render(
      <ProjectionFreshnessNotice
        formatting={formatting}
        freshness={{ generatedAt, partial: true, stale: true }}
      />,
    );

    // These collections sort the whole read set server-side, and the sort
    // tests assert exactly that by name. On a truncated read that guarantee
    // quietly becomes "ordered over the prefix": a customer sorting by highest
    // value sees a confident, correctly-ordered list that can be missing the
    // very record the sort was meant to surface. The banner has to say that
    // the ordering, not just the count, describes only what was read.
    expect(screen.getByRole("alert")).toHaveTextContent(
      "sorting orders only what was read: a list sorted by value can be correctly ordered and still be missing this account's largest record",
    );
  });

  it("offers no control that cannot resolve the condition", () => {
    render(
      <ProjectionFreshnessNotice
        formatting={formatting}
        freshness={{ generatedAt, partial: true, stale: true }}
      />,
    );

    // Refreshing re-reads the same channel and stops at the same ceiling. A
    // button that cannot work is a button that teaches people to distrust
    // buttons.
    expect(
      screen.queryByRole("button", { name: "Refresh records" }),
    ).toBeNull();
  });

  it("leaves a complete stale read exactly as it was", () => {
    render(
      <ProjectionFreshnessNotice
        formatting={formatting}
        freshness={{ generatedAt, partial: false, stale: true }}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "These records may be out of date.",
    );
    expect(
      screen.getByRole("button", { name: "Refresh records" }),
    ).toBeVisible();
  });

  it("leaves a complete current read exactly as it was", () => {
    render(
      <ProjectionFreshnessNotice
        formatting={formatting}
        freshness={{ generatedAt, partial: false, stale: false }}
      />,
    );

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Records are current");
  });
});
