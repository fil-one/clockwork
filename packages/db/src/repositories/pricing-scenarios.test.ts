import { describe, expect, it } from "vitest";

import type { IndicativePriceBookRecord } from "./core/indicative-price-books";
import { resolvePricingScenarioLines } from "./pricing-scenarios";

const usd = (minor: string) => ({ currency: "USD", minor }) as never;
const bookId = "60000000-0000-4000-8000-000000000001";
const rateId = "61000000-0000-4000-8000-000000000001";

// A full administration record, as a careless caller might pass one: every
// field behind the list price is present and must not survive into a line.
const book = {
  id: bookId,
  name: "Standard",
  currency: "USD",
  version: 4,
  status: "active",
  effectiveFrom: "2026-09-01",
  effectiveTo: null,
  discountMatrix: { defaultMaxDiscountBps: 1234 },
  lastDecisionReason: "Internal approval note",
  rateCards: [
    {
      id: rateId,
      sku: "STORAGE-TB",
      region: "us-east",
      unit: "TB-month",
      unitPrice: usd("1500"),
      overageRate: usd("1800"),
      minimumQuantity: "10",
      commitType: "period_allowance",
      approvedClaim: "approved storage claim",
      floorPrice: usd("1111"),
      partnerTransferPrices: { gold: usd("977") },
      stripeTaxCode: "txcd_secret_code",
      qboIncomeAccount: "qbo-income-4000",
      trialLimit: "1",
    },
  ],
} as unknown as IndicativePriceBookRecord;

const entry = {
  bookId,
  rateId,
  quantity: "500",
  termMonths: 12,
  discountBps: 1000,
};

describe("scenario lines", () => {
  it("keep the list price and nothing behind it", () => {
    const lines = resolvePricingScenarioLines([entry], [book]);
    const serialized = JSON.stringify(lines);
    for (const secret of [
      "floorPrice",
      "1111",
      "partnerTransferPrices",
      "977",
      "stripeTaxCode",
      "txcd_secret_code",
      "qboIncomeAccount",
      "qbo-income-4000",
      "approvedClaim",
      "1234",
      "trialLimit",
      "overageRate",
      "Internal approval note",
    ])
      expect(serialized).not.toContain(secret);
    expect(lines).toEqual([
      {
        ...entry,
        bookVersion: 4,
        sku: "STORAGE-TB",
        region: "us-east",
        unit: "TB-month",
        unitPrice: { currency: "USD", minor: "1500" },
        minimumQuantity: "10",
      },
    ]);
  });

  it("refuse a rate the books in force do not hold", () => {
    expect(() =>
      resolvePricingScenarioLines(
        [{ ...entry, rateId: "61000000-0000-4000-8000-000000000009" }],
        [book],
      ),
    ).toThrow("PRICING_SCENARIO_RATE_UNAVAILABLE");
  });

  it("refuse a quantity below the rate's minimum", () => {
    expect(() =>
      resolvePricingScenarioLines([{ ...entry, quantity: "9" }], [book]),
    ).toThrow("PRICING_SCENARIO_BELOW_MINIMUM");
  });

  it("store an entry in another unit in the rate's unit, exactly", () => {
    const [pib, tb] = resolvePricingScenarioLines(
      [
        { ...entry, quantity: "10", quantityUnit: "PiB" },
        { ...entry, quantity: "500", quantityUnit: "TB" },
      ],
      [book],
    );
    expect(pib).toMatchObject({
      quantity: "11258.99906842624",
      entered: { quantity: "10", unit: "PiB" },
    });
    // An entry already in the rate's unit is stored as it is.
    expect(tb?.quantity).toBe("500");
    expect(tb).not.toHaveProperty("entered");
  });

  it("refuse a unit that does not convert exactly to the rate's unit", () => {
    const tib = {
      ...book,
      rateCards: [{ ...book.rateCards?.[0], unit: "TiB-month" }],
    } as unknown as IndicativePriceBookRecord;
    expect(() =>
      resolvePricingScenarioLines(
        [{ ...entry, quantity: "500", quantityUnit: "TB" }],
        [tib],
      ),
    ).toThrow("PRICING_SCENARIO_UNIT_UNSUPPORTED");
  });

  it("checks the minimum against the converted quantity", () => {
    // 0.008 TiB is 0.0087960930222208 TB, below the 10 TB minimum.
    expect(() =>
      resolvePricingScenarioLines(
        [{ ...entry, quantity: "0.008", quantityUnit: "TiB" }],
        [book],
      ),
    ).toThrow("PRICING_SCENARIO_BELOW_MINIMUM");
    expect(
      resolvePricingScenarioLines(
        [{ ...entry, quantity: "0.01", quantityUnit: "PB" }],
        [book],
      )[0]?.quantity,
    ).toBe("10");
  });

  it("keep a rate's egress terms only when they fit the saved field", () => {
    const withEgress = (egressTreatment: string) =>
      ({
        ...book,
        rateCards: [{ ...book.rateCards?.[0], egressTreatment }],
      }) as unknown as IndicativePriceBookRecord;
    expect(
      resolvePricingScenarioLines([entry], [withEgress("included")])[0]
        ?.egressTreatment,
    ).toBe("included");
    expect(
      resolvePricingScenarioLines([entry], [withEgress("x".repeat(61))])[0],
    ).not.toHaveProperty("egressTreatment");
  });
});
