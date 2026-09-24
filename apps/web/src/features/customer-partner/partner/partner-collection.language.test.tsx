import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/partner/portfolio",
  useSearchParams: () => new URLSearchParams(),
}));

import { formatMoney } from "@/src/features/shared/format";
import { catalogs, translatorFor } from "@/src/i18n/catalogs";
import { LanguageProvider } from "@/src/i18n/client";

import { PartnerCollection } from "./partner-collection";
import { presentedPartnerSurface } from "./partner-surface.test-fixture";

function renderPortfolio() {
  const t = translatorFor("pt");
  return render(
    <LanguageProvider locale="pt" catalog={catalogs.pt}>
      <PartnerCollection
        config={presentedPartnerSurface("portfolio", t, "pt")}
        formatting={{ locale: "pt-BR", timeZone: "Europe/London" }}
        freshness={{
          generatedAt: "2026-09-23T10:00:00Z",
          partial: false,
          stale: false,
        }}
        partnerName="Ember Peak Systems"
        roles={["partner_admin"]}
        surface="portfolio"
      />
    </LanguageProvider>,
  );
}

/**
 * The end-client portfolio in Portuguese, as James's screenshot showed it:
 * "ReferênciaEC-0047" (a translated label glued to the record ID) and a
 * merchant-of-record sentence that started in English and finished in
 * Portuguese. Both are asserted on the rendered page, not on the catalog.
 */
describe("partner portfolio in Portuguese", () => {
  it("keeps the record reference a separate word from its label", () => {
    renderPortfolio();
    const table = screen.getByRole("table");
    expect(within(table).getByText("Referência EC-0047")).toBeVisible();
    expect(table.textContent).not.toMatch(/Referência(?:EC|⁨)/u);
  });

  it("states the merchant of record in one language, with the partner named inside it", () => {
    renderPortfolio();
    const boundary = screen.getByRole("region", {
      name: "Separação de preços comerciais",
    });
    expect(boundary).toHaveTextContent(
      "Na modalidade de revenda, Ember Peak Systems é o vendedor responsável pela transação.",
    );
    expect(boundary.textContent).not.toMatch(
      /on resale routes|Set and controlled by|Private partner cost|end-client resale/u,
    );
  });

  it("renders no interface English anywhere on the page", () => {
    renderPortfolio();
    const text = document.body.textContent ?? "";
    for (const english of [
      "Apply",
      "All statuses",
      "Needs attention",
      "All risk",
      "All owners",
      "Name A–Z",
      "Highest risk",
      "Table",
      "Results",
      "end clients",
      "Risk and owner",
      "Page 1 of",
      "Partner desk",
      "Commercial position",
      "transfer /",
      "Renewal decision due",
      "commission eligible",
      "Qualification due",
      "Resale ·",
      "risk",
    ])
      expect(text, english).not.toContain(english);
    // pt-BR puts a no-break space after "US$"; compare with Intl's own output.
    expect(text).toContain(
      `Repasse: ${formatMoney("9120000", "USD", "pt-BR")} / Revenda: ${formatMoney("11200000", "USD", "pt-BR")}`,
    );
    expect(text).toContain("Decisão de renovação até 2 de set. de 2026");
  });
});
