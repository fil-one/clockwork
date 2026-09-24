import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/partner/commissions",
  useSearchParams: () => new URLSearchParams(),
}));

import { translatorFor } from "@/src/i18n/catalogs";

import { PartnerCollection } from "./partner-collection";
import { presentedPartnerSurface } from "./partner-surface.test-fixture";

const t = translatorFor("en");

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
        config={presentedPartnerSurface("commissions", t, "en")}
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

  it("annotates registration credit from status and names the unavailable write boundary", () => {
    render(
      <PartnerCollection
        config={presentedPartnerSurface("registrations", t, "en")}
        formatting={formatting}
        freshness={fresh}
        partnerName="Aurora Systems"
        roles={["partner_admin"]}
        surface="registrations"
      />,
    );

    const table = screen.getByRole("table");
    expect(within(table).getByText("Attribution: sourced")).toBeVisible();
    expect(
      within(table).getByText("Attribution: decision pending"),
    ).toBeVisible();
    expect(
      within(table).getByText("Attribution: no sourced credit recorded"),
    ).toBeVisible();
    expect(
      screen.getByText(/influenced-credit and dispute decisions/),
    ).toHaveTextContent("cannot be recorded here");
  });
});
