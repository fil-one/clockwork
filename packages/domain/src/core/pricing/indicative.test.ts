import { describe, expect, it } from "vitest";

import type { Money } from "@clockwork/contracts";

import { indicativeLinePrice, indicativeScenarioPrice } from "./index";

const usd = (minor: string) => ({ currency: "USD", minor }) as Money;

describe("indicative line price", () => {
  it("prices a monthly figure and the full term", () => {
    expect(
      indicativeLinePrice({
        unitPrice: usd("1500"),
        minimumQuantity: "10",
        quantity: "500",
        termMonths: 12,
        discountBps: 0,
      }),
    ).toEqual({
      unitPrice: usd("1500"),
      monthly: usd("750000"),
      total: usd("9000000"),
      belowMinimum: false,
    });
  });

  it("applies a discount with the quote engine's rounding", () => {
    const priced = indicativeLinePrice({
      unitPrice: usd("999"),
      minimumQuantity: "1",
      quantity: "3",
      termMonths: 2,
      discountBps: 1_250,
    });
    // 999 x 0.875 = 874.125, rounded half up to 874.
    expect(priced.unitPrice).toEqual(usd("874"));
    expect(priced.total).toEqual(usd("5244"));
  });

  it("flags a quantity below the rate's minimum", () => {
    expect(
      indicativeLinePrice({
        unitPrice: usd("1500"),
        minimumQuantity: "10",
        quantity: "2.5",
        termMonths: 1,
        discountBps: 0,
      }).belowMinimum,
    ).toBe(true);
  });

  it.each([{ termMonths: 0 }, { discountBps: 10_001 }, { quantity: "0" }])(
    "refuses an impossible request: %j",
    (change) => {
      expect(() =>
        indicativeLinePrice({
          unitPrice: usd("1500"),
          minimumQuantity: "1",
          quantity: "1",
          termMonths: 1,
          discountBps: 0,
          ...change,
        }),
      ).toThrow();
    },
  );
});

describe("indicative scenario price", () => {
  const line = {
    unitPrice: usd("999"),
    minimumQuantity: "1",
    quantity: "3",
    termMonths: 2,
    discountBps: 1_250,
  };

  it("sums lines at list, the discount taken off and the total", () => {
    const priced = indicativeScenarioPrice([
      line,
      { ...line, unitPrice: usd("1500"), quantity: "10", discountBps: 0 },
    ]);
    // 999 x 3 x 2 = 5994 at list; discounted 874 x 3 x 2 = 5244.
    expect(priced.lines[0]?.listTotal).toEqual(usd("5994"));
    expect(priced.subtotal).toEqual(usd("35994"));
    expect(priced.total).toEqual(usd("35244"));
    expect(priced.discount).toEqual(usd("750"));
    expect(priced.currency).toBe("USD");
  });

  it("refuses an empty scenario and mixed currencies", () => {
    expect(() => indicativeScenarioPrice([])).toThrow();
    expect(() =>
      indicativeScenarioPrice([
        line,
        { ...line, unitPrice: { currency: "EUR", minor: "999" } as Money },
      ]),
    ).toThrow("one currency");
  });
});
