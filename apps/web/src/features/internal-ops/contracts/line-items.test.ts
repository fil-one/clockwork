import { expect, it } from "vitest";
import { checkLineItems, rateMinimums } from "./line-items";

const rate = (minimumQuantity: string, region = "us-east") => ({
  sku: "STORAGE-TB",
  region,
  unit: "TB-month",
  minimumQuantity,
});

it("keeps the higher minimum where two books price the same item, region and unit", () => {
  const minimums = rateMinimums([
    { rateCards: [rate("10"), rate("1", "eu-west")] },
    { rateCards: [rate("25.5")] },
    {},
  ]);
  const table = (region: string, sku = "STORAGE-TB") => ({
    currency: "USD",
    rows: [
      {
        sku,
        region,
        unit: "TB-month",
        quantity: "20",
        termMonths: 1,
        unitPriceMinor: "100",
        minimumQuantity: "0",
        discountBps: 0,
        extendedMinor: "2000",
      },
    ],
  });
  expect(checkLineItems(table("us-east"), minimums)).toEqual({
    ok: false,
    code: "below_minimum",
  });
  const checked = checkLineItems(table("eu-west"), minimums);
  expect(checked.ok && checked.value.rows[0]?.minimumQuantity).toBe("1");
  // The browser's own minimum is what the editor shows before it is sent.
  expect(checkLineItems(table("us-east")).ok).toBe(true);
});
