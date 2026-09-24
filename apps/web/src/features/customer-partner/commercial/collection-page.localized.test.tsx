import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { catalogs } from "@/src/i18n/catalogs";
import { LanguageProvider } from "@/src/i18n/client";

import { CommercialCollectionPage } from "./collection-page";
import { recordsFor, type CommercialRecord } from "./model";

const fresh = {
  generatedAt: "2026-08-14T13:00:00Z",
  partial: false,
  stale: false,
};

function renderIn(
  locale: "de" | "pt",
  records: readonly CommercialRecord[],
  searchParams: Record<string, string> = {},
) {
  return render(
    <LanguageProvider catalog={catalogs[locale]} locale={locale}>
      <CommercialCollectionPage
        formatting={{
          locale: locale === "de" ? "de-DE" : "pt-BR",
          timeZone: "Europe/Berlin",
        }}
        freshness={fresh}
        kind="quotes"
        records={records}
        searchParams={searchParams}
      />
    </LanguageProvider>,
  );
}

/** A quote whose only varying fact is its amount, in minor units. */
function quote(letter: string, amountMinor: string): CommercialRecord {
  const [template] = recordsFor("quotes", "de");
  if (!template?.facts) throw new Error("no quote fixture");
  return {
    ...template,
    id: `quote-${letter}`,
    title: `${letter}`,
    href: `/quotes/quote-${letter}`,
    facts: {
      ...template.facts,
      value: { kind: "money", currency: "USD", amountMinor },
    },
  };
}

describe("commercial collection in the reader's language", () => {
  it("renders the quote ledger in Portuguese with no English left", () => {
    const { container } = renderIn("pt", recordsFor("quotes", "pt"));

    expect(
      screen.getByRole("heading", { level: 1, name: "Cotações" }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { level: 2, name: "4 resultados" }),
    ).toBeVisible();
    const table = screen.getByRole("table");
    expect(
      within(table).getByText("Capacidade contratada corporativa"),
    ).toBeVisible();
    expect(within(table).getAllByText("Aberta").length).toBeGreaterThan(0);
    expect(
      within(table).getByText("Expira em 4 de ago. de 2026"),
    ).toBeVisible();
    for (const english of [
      "Record",
      "Commercial context",
      "Timing",
      "results",
      "Estimated annual spend",
      "Expires",
      "Open",
      "Customer workspace",
    ])
      expect(container.textContent).not.toContain(english);
  });

  /**
   * The value column used to be ordered by parsing the rendered string. That
   * reads "1.000,00 $" (German grouping) as 1 and "999,00 $" as 99900, so the
   * cheaper quote sorted above the dearer one once amounts were formatted for
   * a German reader. The order now comes from the amount itself.
   */
  it("orders the value column by amount, not by the formatted string", () => {
    renderIn("de", [quote("A", "99900"), quote("B", "100000")], {
      sort: "value_desc",
    });
    const titles = within(screen.getByRole("table"))
      .getAllByRole("rowheader")
      .map((cell) => cell.querySelector("a")?.textContent);
    expect(titles).toEqual(["B", "A"]);
  });
});
