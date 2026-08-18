import { describe, expect, it } from "vitest";

import { createMemoryDemoStore } from "@clockwork/testing/demo-reset";

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
      availability: "available",
      readAt: "2026-08-02T00:00:00.000Z",
    });
  });

  it("offers nothing to activate when the read is unavailable", async () => {
    const unreadable = await loadPriceBookRecords({
      list: () => Promise.reject(new Error("pricing service is unreachable")),
    });
    expect(unreadable.books).toEqual([]);
    expect(unreadable.source).toBe("Pricing service unavailable");
    expect(unreadable.availability).toBe("unavailable");

    const unconfigured = await loadPriceBookRecords(undefined);
    expect(unconfigured.books).toEqual([]);
    expect(unconfigured.source).toBe("Pricing service unavailable");
    expect(unconfigured.availability).toBe("unavailable");
  });

  it("distinguishes a successful empty live read from an unavailable read", async () => {
    const result = await loadPriceBookRecords({
      list: () => Promise.resolve([]),
    });
    expect(result).toMatchObject({
      books: [],
      source: "Pricing service",
      availability: "empty",
    });
  });

  it("serves canonical fictional books only for an explicit demo", async () => {
    const result = await loadPriceBookRecords(undefined, {
      demoEnabled: true,
      demoStore: createMemoryDemoStore(),
      now: new Date("2026-08-02T00:00:00.000Z"),
    });
    expect(result.source).toBe("Deterministic demo fixture");
    expect(result.availability).toBe("available");
    expect(result.books).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ currency: "USD", status: "active" }),
        expect.objectContaining({ currency: "GBP", status: "active" }),
        expect.objectContaining({
          currency: "USD",
          status: "draft",
          activationRequestedByEmail: "commercial.policy@filone.test",
        }),
      ]),
    );
  });
});
