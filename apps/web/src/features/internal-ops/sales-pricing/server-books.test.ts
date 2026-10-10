import { describe, expect, it, vi } from "vitest";

import { loadIndicativePriceBookRecords } from "./server-books";

const book = {
  id: "c6000000-0000-4000-8000-000000000001",
  name: "Standard",
  currency: "USD",
  version: 3,
  status: "active" as const,
  effectiveFrom: "2026-09-01",
  effectiveTo: null,
  rateCards: [],
};

describe("indicative price book server read", () => {
  it("asks the service for the books in force on the day it reads", async () => {
    const listInForce = vi.fn(() => Promise.resolve([book]));
    const result = await loadIndicativePriceBookRecords(
      { listInForce },
      { locale: "en", now: new Date("2026-10-04T23:30:00.000Z") },
    );
    expect(listInForce).toHaveBeenCalledWith({ today: "2026-10-04" });
    expect(result).toEqual({
      books: [book],
      availability: "available",
      readAt: "2026-10-04T23:30:00.000Z",
    });
  });

  it("offers nothing when the read fails and no demo is enabled", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await loadIndicativePriceBookRecords(
      {
        listInForce: () =>
          Promise.reject(new Error("pricing service is unreachable")),
      },
      { locale: "en", demoEnabled: false },
    );
    expect(result.books).toEqual([]);
    expect(result.availability).toBe("unavailable");
    expect(logged).toHaveBeenCalledWith(
      "Indicative price books could not be read",
      { error: "Error" },
    );
    logged.mockRestore();
  });
});
