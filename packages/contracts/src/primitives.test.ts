import { describe, expect, it } from "vitest";

import { MoneySchema, QuantitySchema } from "./primitives";

describe("commerce primitives", () => {
  it("keeps money in exact integer minor units", () => {
    expect(
      MoneySchema.parse({ currency: "USD", minor: "90071992547409931234" }),
    ).toEqual({ currency: "USD", minor: "90071992547409931234" });
    expect(() =>
      MoneySchema.parse({ currency: "USD", minor: "1.01" }),
    ).toThrow();
  });

  it("rejects exponent and negative quantity notation", () => {
    expect(QuantitySchema.safeParse("1.000000000000000001").success).toBe(true);
    expect(QuantitySchema.safeParse("1e3").success).toBe(false);
    expect(QuantitySchema.safeParse("-1").success).toBe(false);
  });
});
