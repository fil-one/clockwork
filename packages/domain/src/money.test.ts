import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { addMoney, money, subtractMoney } from "./money";

describe("money", () => {
  it("round-trips exact integer amounts", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -9_000_000_000_000n, max: 9_000_000_000_000n }),
        fc.bigInt({ min: -9_000_000_000_000n, max: 9_000_000_000_000n }),
        (left, right) => {
          const original = money("USD", left);
          expect(
            subtractMoney(
              addMoney(original, money("USD", right)),
              money("USD", right),
            ),
          ).toEqual(original);
        },
      ),
    );
  });

  it("refuses to combine currencies", () => {
    expect(() => addMoney(money("USD", 1n), money("EUR", 1n))).toThrow(
      "Currency mismatch",
    );
  });
});
