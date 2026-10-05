import { describe, expect, it } from "vitest";

import type { Money } from "@clockwork/contracts";

import { indicativeLinePrice } from "./index";

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
