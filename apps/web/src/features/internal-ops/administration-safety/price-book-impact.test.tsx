import { render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { catalogs } from "@/src/i18n/catalogs";
import { setHarnessLanguage } from "@/src/i18n/client";

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

afterEach(() => setHarnessLanguage("en", catalogs.en));

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

it("reads entirely in Portuguese, with counts and the check time in the reader's format", () => {
  setHarnessLanguage("pt", catalogs.pt);
  const { container } = render(
    <PriceBookImpactPanel
      candidate={candidate}
      incumbent={incumbent}
      impact={impact}
    />,
  );
  const table = screen.getByRole("table", {
    name: "Referências retidas em cada tabela de preços",
  });
  expect(
    within(table).getByRole("row", { name: "Cotações em rascunho 2 0" }),
  ).toBeVisible();
  expect(
    within(table).getByRole("columnheader", {
      name: `Vigente: ${incumbent.name} v${incumbent.version}`,
    }),
  ).toBeVisible();
  expect(
    screen.getByText(/não são totais reais de clientes nem de ações/u),
  ).toHaveTextContent("6 de set. de 2026");
  expect(container.textContent).not.toMatch(
    /Draft quotes|Existing business impact|Retained records|checked|Unavailable/u,
  );
});
