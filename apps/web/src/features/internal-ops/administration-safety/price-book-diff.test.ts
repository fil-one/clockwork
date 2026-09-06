import { expect, it } from "vitest";
import { MoneySchema } from "@clockwork/contracts";
import type { PriceBookAdministrationRecord } from "@clockwork/db";
import { priceBookEconomicDiff } from "./price-book-diff";

it("diffs changed and removed economics without treating rate IDs as price changes", () => {
  const money = (minor: string) =>
    MoneySchema.parse({ currency: "USD", minor });
  const rate = {
    id: "old",
    sku: "STORAGE",
    region: "test",
    unit: "TB-month",
    approvedClaim: "Storage",
    unitPrice: money("500"),
    overageRate: money("500"),
    minimumQuantity: "1",
    egressTreatment: "zero",
    commitType: "term_drawdown" as const,
    stripeTaxCode: "tax",
    qboIncomeAccount: "4000",
    partnerTransferPrices: { gold: money("400") },
  };
  const active = {
    rateCards: [rate],
  } as unknown as PriceBookAdministrationRecord;
  expect(
    priceBookEconomicDiff(
      {
        rateCards: [{ ...rate, id: "new" }],
      } as unknown as PriceBookAdministrationRecord,
      active,
    ),
  ).toEqual([]);
  const differences = priceBookEconomicDiff(
    {
      rateCards: [
        {
          ...rate,
          unitPrice: money("550"),
          partnerTransferPrices: { gold: money("425") },
        },
      ],
    } as unknown as PriceBookAdministrationRecord,
    active,
  );
  expect(differences).toEqual([
    {
      field: "STORAGE / test · List price",
      before: "USD 5.00",
      after: "USD 5.50",
    },
    {
      field: "STORAGE / test · Transfer prices",
      before: "gold: USD 4.00",
      after: "gold: USD 4.25",
    },
  ]);
  expect(
    priceBookEconomicDiff(
      { rateCards: [] } as unknown as PriceBookAdministrationRecord,
      active,
    ).every((change) => change.after === "Rate removed"),
  ).toBe(true);
});
