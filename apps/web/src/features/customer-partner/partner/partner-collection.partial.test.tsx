import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/partner/portfolio",
  useSearchParams: () => new URLSearchParams(),
}));

import { PartnerCollection } from "./partner-collection";
import { translatorFor } from "@/src/i18n/catalogs";

import { presentedPartnerSurface } from "./partner-surface.test-fixture";

const formatting = { locale: "en-US", timeZone: "America/New_York" };

function renderLedger(freshness: {
  generatedAt: string;
  stale: boolean;
  partial: boolean;
}) {
  return render(
    <PartnerCollection
      config={presentedPartnerSurface("portfolio", translatorFor("en"), "en")}
      formatting={formatting}
      freshness={freshness}
      partnerName="Aurora Systems"
      roles={["partner_admin"]}
      surface="portfolio"
    />,
  );
}

/**
 * `loadPartnerRecords` has returned `truncated` since the page ceiling stopped
 * throwing, and `partner-route.tsx` dropped it. The ledger then showed a
 * result count and a set of owner and status choices built from a prefix, with
 * nothing saying so. Fails against the unfixed route and component, which
 * could not represent the condition at all.
 */
describe("partner ledger partial read disclosure", () => {
  it("tells the partner the ledger below is a prefix", () => {
    renderLedger({
      generatedAt: "2026-08-14T13:04:00Z",
      partial: true,
      stale: true,
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Only part of this collection could be read.",
    );
  });

  it("says nothing extra when the whole channel was read", () => {
    renderLedger({
      generatedAt: "2026-08-14T13:04:00Z",
      partial: false,
      stale: false,
    });

    expect(
      screen.queryByText(/Only part of this collection/),
    ).not.toBeInTheDocument();
  });
});
