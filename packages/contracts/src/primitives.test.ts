import { describe, expect, it } from "vitest";

import { MoneySchema, QuantitySchema } from "./primitives";

describe("commerce primitives", () => {
  it("keeps money in exact integer minor units", () => {
    expect(
      MoneySchema.parse({ currency: "USD", minor: "9223372036854775807" }),
    ).toEqual({ currency: "USD", minor: "9223372036854775807" });
    expect(
      MoneySchema.parse({ currency: "USD", minor: "-9223372036854775808" }),
    ).toEqual({ currency: "USD", minor: "-9223372036854775808" });
    expect(
      MoneySchema.safeParse({ currency: "USD", minor: "9223372036854775808" })
        .success,
    ).toBe(false);
    expect(
      MoneySchema.safeParse({ currency: "USD", minor: "-9223372036854775809" })
        .success,
    ).toBe(false);
    for (const minor of ["1.01", "1e3", "+1", "--1", "01"])
      expect(MoneySchema.safeParse({ currency: "USD", minor }).success).toBe(
        false,
      );
  });

  it("rejects exponent and negative quantity notation", () => {
    expect(QuantitySchema.safeParse("1.000000000000000001").success).toBe(true);
    expect(
      QuantitySchema.safeParse("99999999999999999999.999999999999999999")
        .success,
    ).toBe(true);
    expect(QuantitySchema.safeParse("100000000000000000000").success).toBe(
      false,
    );
    expect(QuantitySchema.safeParse("1e3").success).toBe(false);
    expect(QuantitySchema.safeParse("-1").success).toBe(false);
    expect(QuantitySchema.safeParse("0.0000000000000000001").success).toBe(
      false,
    );
    expect(
      QuantitySchema.safeParse("99999999999999999999.9999999999999999999")
        .success,
    ).toBe(false);
  });
});
