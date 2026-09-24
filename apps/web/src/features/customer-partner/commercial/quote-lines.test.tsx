import { translatorFor } from "@/src/i18n/catalogs";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { QuoteBuilder } from "./quote-builder";
import { validateAdditionalLines } from "./quote-lines";
import {
  authoritativeQuoteOffer,
  authoritativeQuoteOffers,
} from "./quote-offer.test-fixture";

describe("multiple-line quoting", () => {
  it("retains the revision's extra lines through review and blocks invalid or mixed-book lines", async () => {
    const user = userEvent.setup();
    render(
      <QuoteBuilder
        account={{
          id: "10000000-0000-4000-8000-000000000001",
          name: "Customer",
        }}
        catalogueMode="simulated"
        offers={authoritativeQuoteOffers}
        initialDraft={{
          offer: authoritativeQuoteOffer.label,
          region: authoritativeQuoteOffer.region,
          capacity: "20",
          termMonths: "12",
          expiresAt: new Date(Date.now() + 86400000).toISOString().slice(0, 16),
        }}
        initialLines={[
          {
            offerId: authoritativeQuoteOffer.id,
            capacity: "30",
            termMonths: "24",
          },
        ]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByLabelText("Capacity (TB) for line 2")).toHaveValue(30);
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getAllByText(/30 TB · 24 months/)).toHaveLength(2);
    expect(
      validateAdditionalLines(
        [
          {
            offerId: authoritativeQuoteOffer.id,
            capacity: "30",
            termMonths: "24",
          },
        ],
        authoritativeQuoteOffers,
        "another-book",
        translatorFor("en"),
      ),
    ).toContain("same price book");
    expect(
      validateAdditionalLines(
        [
          {
            offerId: authoritativeQuoteOffer.id,
            capacity: "9",
            termMonths: "24",
          },
        ],
        authoritativeQuoteOffers,
        authoritativeQuoteOffer.priceBookId,
        translatorFor("en"),
      ),
    ).toContain("at least 10");
  });
});
