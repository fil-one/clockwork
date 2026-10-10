import { describe, expect, it } from "vitest";

import {
  indicativePriceBookRecords,
  type IndicativePriceBookRow,
} from "./indicative-price-books";

const row = (
  overrides: Partial<IndicativePriceBookRow>,
): IndicativePriceBookRow => ({
  bookId: "book-usd",
  name: "Standard",
  currency: "USD",
  version: 4,
  effectiveFrom: "2026-09-01",
  effectiveTo: null,
  rateId: "rate-1",
  sku: "STORAGE-TB",
  region: "us-east",
  unit: "TB-month",
  unitPriceMinor: 1500n,
  overageRateMinor: 1800n,
  minimumQuantity: "10.000000000000000000",
  commitType: "period_allowance",
  ...overrides,
});

describe("indicative price book records", () => {
  it("groups joined rows into books in arrival order", () => {
    const books = indicativePriceBookRecords([
      row({ rateId: "rate-1", sku: "EGRESS-TB" }),
      row({ rateId: "rate-2", sku: "STORAGE-TB" }),
      row({
        bookId: "book-eur",
        name: "Europe",
        currency: "EUR",
        version: 2,
        effectiveTo: "2026-12-31",
        rateId: "rate-3",
        region: "eu-central",
        unitPriceMinor: 1400n,
        overageRateMinor: 1700n,
        commitType: "term_drawdown",
      }),
    ]);
    expect(books.map(({ id }) => id)).toEqual(["book-usd", "book-eur"]);
    expect(books[0]?.rateCards?.map(({ id }) => id)).toEqual([
      "rate-1",
      "rate-2",
    ]);
    expect(books[1]).toEqual({
      id: "book-eur",
      name: "Europe",
      currency: "EUR",
      version: 2,
      status: "active",
      effectiveFrom: "2026-09-01",
      effectiveTo: "2026-12-31",
      rateCards: [
        {
          id: "rate-3",
          sku: "STORAGE-TB",
          region: "eu-central",
          unit: "TB-month",
          unitPrice: { currency: "EUR", minor: "1400" },
          overageRate: { currency: "EUR", minor: "1700" },
          minimumQuantity: "10.000000000000000000",
          commitType: "term_drawdown",
        },
      ],
    });
  });

  it("keeps minor units beyond the safe integer range exact", () => {
    const [book] = indicativePriceBookRecords([
      row({ unitPriceMinor: 9007199254740993n }),
    ]);
    expect(book?.rateCards?.[0]?.unitPrice.minor).toBe("9007199254740993");
  });

  it("returns no books for no rows", () => {
    expect(indicativePriceBookRecords([])).toEqual([]);
  });
});
