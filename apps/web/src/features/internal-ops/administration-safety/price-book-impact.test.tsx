import { render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";

import { canonicalDemoPriceBooks } from "../price-books/demo-price-books";
import { demoPriceBookImpact } from "../price-books/server-price-book-impact-loader";
import { PriceBookImpactPanel } from "./price-book-impact";

const incumbent = canonicalDemoPriceBooks[0];
const candidate = canonicalDemoPriceBooks[2];
if (!incumbent || !candidate)
  throw new Error("Price-book impact fixtures are missing");
const impact = demoPriceBookImpact(
  canonicalDemoPriceBooks,
  "2026-09-06T12:00:00.000Z",
);

it("shows retained reference comparisons and explains draft workflow changes without a revenue forecast", () => {
  render(
    <PriceBookImpactPanel
      candidate={candidate}
      incumbent={incumbent}
      impact={impact}
    />,
  );
  const table = screen.getByRole("table", {
    name: "References retained on each price book",
  });
  expect(
    within(table).getByRole("row", { name: "Draft quotes 2 0" }),
  ).toBeVisible();
  expect(
    screen.getByText(
      /Retiring the current book stops draft issuance and revisions/,
    ),
  ).toBeVisible();
  expect(
    screen.getByText(/not live customer or demo-action totals/),
  ).toBeVisible();
  expect(
    screen.getByText(
      /Revenue, margin and renewal forecasts require additional approved inputs/,
    ),
  ).toBeVisible();
});

it("hides stale reference counts after either book changes and recovers on a fresh read", () => {
  const { rerender } = render(
    <PriceBookImpactPanel
      candidate={{ ...candidate, rowVersion: candidate.rowVersion + 1 }}
      incumbent={incumbent}
      impact={impact}
    />,
  );
  expect(screen.queryByRole("table")).toBeNull();
  expect(screen.getByRole("status")).toHaveTextContent(
    "Unavailable counts do not mean zero business",
  );
  rerender(
    <PriceBookImpactPanel
      candidate={candidate}
      incumbent={incumbent}
      impact={impact}
    />,
  );
  expect(screen.getByRole("table")).toBeVisible();
  rerender(
    <PriceBookImpactPanel
      candidate={candidate}
      incumbent={{ ...incumbent, status: "retired" }}
      impact={impact}
    />,
  );
  expect(screen.queryByRole("table")).toBeNull();
});
