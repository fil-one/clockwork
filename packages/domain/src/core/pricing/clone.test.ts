import { expect, it } from "vitest";
import { clonedDiscountMatrix, PriceBookCloneCommandSchema } from "./clone";
const command = {
  sourceId: "66000000-0000-4000-8000-000000000001",
  sourceRowVersion: 4,
  name: "USD refresh",
  version: 5,
  effectiveFrom: "2026-09-06",
  reason: "Prepare refreshed regional pricing",
};
it("accepts only source identity/version and fresh draft metadata", () => {
  expect(PriceBookCloneCommandSchema.parse(command)).toEqual(command);
  for (const patch of [
    { status: "active" },
    { rateCards: [] },
    { currency: "EUR" },
    { sourceRowVersion: 0 },
    { version: 2147483648 },
    { effectiveFrom: "2026-02-30" },
    { effectiveFrom: "0000-01-01" },
  ])
    expect(
      PriceBookCloneCommandSchema.safeParse({ ...command, ...patch }).success,
    ).toBe(false);
});
it("preserves independent discount economics while assigning fresh policy identity", () => {
  const source = {
    id: "approved-matrix",
    version: 7,
    defaultMaxDiscountBps: 100,
    rules: [{ id: "gold", partnerTier: "gold", maxDiscountBps: 300 }],
  };
  const cloned = clonedDiscountMatrix(source, "new-draft");
  expect(cloned).toEqual({ ...source, id: "discount-new-draft", version: 1 });
  const rule = cloned.rules[0];
  if (!rule) throw new Error("Missing copied rule");
  rule.maxDiscountBps = 500;
  expect(source.rules[0]?.maxDiscountBps).toBe(300);
  expect(clonedDiscountMatrix({}, "new-draft")).toEqual({});
});
