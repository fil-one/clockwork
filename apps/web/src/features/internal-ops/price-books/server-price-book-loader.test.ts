import { describe, expect, it } from "vitest";

import { loadPriceBookRecords } from "./server-price-book-loader";

const book = {
  id: "c6000000-0000-4000-8000-000000000001",
  name: "Sterling rate card",
  currency: "GBP",
  version: 3,
  rowVersion: 2,
  status: "draft" as const,
  effectiveFrom: "2026-01-01",
  effectiveTo: null,
  rateCardCount: 4,
  regions: ["uk-south"],
  activationRequestedBy: "20000000-0000-4000-8000-000000000001",
  activationRequestedByEmail: "operator@clockwork.test",
  activationRequestedAt: "2026-08-01T16:00:00.000Z",
  lastDecisionAt: null,
  lastDecisionReason: null,
};

describe("price book server read", () => {
  it("returns what the pricing service holds", async () => {
    const result = await loadPriceBookRecords(
      { list: () => Promise.resolve([book]) },
      { now: new Date("2026-08-02T00:00:00.000Z") },
    );
    expect(result).toEqual({
      books: [book],
      source: "Pricing service",
      readAt: "2026-08-02T00:00:00.000Z",
    });
  });

  it("offers nothing to activate when the read is unavailable", async () => {
    const unreadable = await loadPriceBookRecords({
      list: () => Promise.reject(new Error("pricing service is unreachable")),
    });
    expect(unreadable.books).toEqual([]);
    expect(unreadable.source).toBe("Fail-closed operational fallback");

    const unconfigured = await loadPriceBookRecords(undefined);
    expect(unconfigured.books).toEqual([]);
    expect(unconfigured.source).toBe("Fail-closed operational fallback");
  });
});
