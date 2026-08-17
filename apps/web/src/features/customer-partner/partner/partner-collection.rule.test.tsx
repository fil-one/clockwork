import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/partner/commissions",
  useSearchParams: () => new URLSearchParams(),
}));

import { t } from "@/src/i18n/en";

import { PartnerCollection } from "./partner-collection";
import { partnerSurfaces } from "./partner-data";

const formatting = { locale: "en-US", timeZone: "America/New_York" };
const fresh = {
  generatedAt: "2026-08-14T13:04:00Z",
  partial: false,
  stale: false,
};

describe("partner collection truth copy", () => {
  it("renders the commission purpose, truthful columns, shared rule, and numeric amount", () => {
    render(
      <PartnerCollection
        config={partnerSurfaces.commissions}
        formatting={formatting}
        freshness={fresh}
        partnerName="Aurora Systems"
        roles={["partner_admin"]}
        surface="commissions"
      />,
    );

    expect(
      screen.getByText("Partner desk · Collected-revenue earnings"),
    ).toBeVisible();
    expect(
      screen.getByText(t("partner.commissions.description")),
    ).toBeVisible();
    const table = screen.getByRole("table");
    expect(
      within(table).getByRole("columnheader", { name: "Amount accrued" }),
    ).toHaveClass("cw-table__numeric");
    expect(
      within(table).getByText("$18,420 accrued").closest("td"),
    ).toHaveClass("cw-table__numeric");
  });
});
