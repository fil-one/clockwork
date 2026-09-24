import { describe, expect, it } from "vitest";

import {
  buildBuyQuoteCommand,
  initialBuyDraft,
  needsFullQuote,
  quoteHandoff,
  requiresPricingReview,
  serverPrice,
} from "./buy-model";
import {
  authoritativeQuoteOffer,
  authoritativeQuoteOffers,
} from "./quote-offer.test-fixture";

const account = {
  id: "10000000-0000-4000-8000-000000000001",
  label: "Northstar Archive Labs",
};
const quoteId = "70000000-0000-4000-8000-000000000001";
const initial = initialBuyDraft(authoritativeQuoteOffers);

describe("self-serve buy model", () => {
  it("uses the approved configurable handoff without changing term economics", () => {
    expect(needsFullQuote({ ...initial, capacity: "200" }, 250)).toBe(false);
    expect(needsFullQuote({ ...initial, capacity: "250" }, 250)).toBe(true);
    const command = buildBuyQuoteCommand({
      account,
      quoteId,
      now: new Date("2026-09-06T00:00:00Z"),
      draft: { ...initial, capacity: "200" },
      offers: authoritativeQuoteOffers,
      thresholdTb: 250,
    });
    expect(command.resource).toBe("quotes");
  });
  it("keeps 99 TB self-serve and routes 100 TB to the full quote", () => {
    expect(needsFullQuote({ ...initial, capacity: "99" })).toBe(false);
    expect(needsFullQuote({ ...initial, capacity: "99.999" })).toBe(false);
    expect(needsFullQuote({ ...initial, capacity: "100" })).toBe(true);
    expect(needsFullQuote({ ...initial, capacity: "101" })).toBe(true);
    expect(quoteHandoff({ ...initial, capacity: "100" })).toBe(
      "/quotes/new?capacity=100&term=12",
    );
  });

  it("builds only the direct fixed-term command for an existing offer", () => {
    const command = buildBuyQuoteCommand({
      account,
      quoteId,
      now: new Date("2026-08-16T12:00:00.000Z"),
      draft: { ...initial, capacity: "42" },
      offers: authoritativeQuoteOffers,
    });
    expect(command).toMatchObject({
      resource: "quotes",
      action: "create",
      id: quoteId,
      accountId: account.id,
      payload: {
        route: "direct",
        priceBookId: authoritativeQuoteOffer.priceBookId,
        lines: [
          {
            sku: authoritativeQuoteOffer.sku,
            region: authoritativeQuoteOffer.region,
            quantity: "42",
            termMonths: 12,
          },
        ],
        expiresAt: "2026-08-30T12:00:00.000Z",
      },
    });
    expect(command.payload).not.toHaveProperty("partnerAccountId");
    expect(command.payload).not.toHaveProperty("endClientAccountId");
    expect(command.payload).not.toHaveProperty("marketplaceProvider");
  });

  it("shows money only when the command response carries a supported server total", () => {
    expect(
      serverPrice({
        record: { data: { totalMinor: "120000", currency: "USD" } },
      }),
    ).toEqual({ totalMinor: "120000", currency: "USD" });
    expect(serverPrice({ record: { data: { currency: "USD" } } })).toBeNull();
    expect(
      serverPrice({
        record: { data: { totalMinor: "120000", currency: "DOGE" } },
      }),
    ).toBeNull();
  });

  it("recognizes the persisted margin decision without inventing one", () => {
    expect(
      requiresPricingReview({
        record: { data: { marginFloorResult: "exception_required" } },
      }),
    ).toBe(true);
    expect(requiresPricingReview({ record: { data: {} } })).toBe(false);
  });
});
