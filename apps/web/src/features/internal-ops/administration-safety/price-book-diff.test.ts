import { expect, it } from "vitest";
import { MoneySchema } from "@clockwork/contracts";
import type { PriceBookAdministrationRecord } from "@clockwork/db";

import { formatMoney } from "@/src/features/shared/format";
import { translatorFor } from "@/src/i18n/catalogs";

import { priceBookEconomicDiff } from "./price-book-diff";

const money = (minor: string) => MoneySchema.parse({ currency: "USD", minor });
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
const repriced = {
  rateCards: [
    {
      ...rate,
      unitPrice: money("550"),
      partnerTransferPrices: { gold: money("425") },
    },
  ],
} as unknown as PriceBookAdministrationRecord;
const en = translatorFor("en");

it("diffs changed and removed economics without treating rate IDs as price changes", () => {
  expect(
    priceBookEconomicDiff(
      {
        rateCards: [{ ...rate, id: "new" }],
      } as unknown as PriceBookAdministrationRecord,
      active,
      en,
      "en-US",
    ),
  ).toEqual([]);
  expect(priceBookEconomicDiff(repriced, active, en, "en-US")).toEqual([
    {
      key: "STORAGE / test|listPrice",
      field: "STORAGE / test · List price",
      before: "$5.00",
      after: "$5.50",
    },
    {
      key: "STORAGE / test|transferPrices",
      field: "STORAGE / test · Transfer prices",
      before: "gold: $4.00",
      after: "gold: $4.25",
    },
  ]);
  expect(
    priceBookEconomicDiff(
      { rateCards: [] } as unknown as PriceBookAdministrationRecord,
      active,
      en,
      "en-US",
    ).every((change) => change.after === "Rate removed"),
  ).toBe(true);
});

it("words the same facts for a German reader with German grouping", () => {
  const changes = priceBookEconomicDiff(
    repriced,
    active,
    translatorFor("de"),
    "de-DE",
  );
  expect(changes.map((change) => change.field)).toEqual([
    "STORAGE / test · Listenpreis",
    "STORAGE / test · Partner-Einkaufspreise",
  ]);
  expect(changes[0]).toMatchObject({
    before: formatMoney("500", "USD", "de-DE"),
    after: formatMoney("550", "USD", "de-DE"),
  });
  expect(changes[1]?.after).toBe(`gold: ${formatMoney("425", "USD", "de-DE")}`);
  expect(JSON.stringify(changes)).not.toMatch(/List price|Transfer prices/u);
});

it("summarizes discount authority changes and ignores surrogate matrix identifiers", () => {
  const rule = { id: "rule-a", route: "resale" as const, maxDiscountBps: 900 };
  const matrix = {
    id: "discount-a",
    version: 1,
    defaultMaxDiscountBps: 500,
    rules: [rule],
  };
  const withMatrix = (value: typeof matrix) =>
    ({
      rateCards: [rate],
      discountMatrix: value,
    }) as unknown as PriceBookAdministrationRecord;
  expect(
    priceBookEconomicDiff(
      withMatrix({
        ...matrix,
        id: "discount-b",
        version: 3,
        rules: [{ ...rule, id: "rule-b" }],
      }),
      withMatrix(matrix),
      en,
      "en-US",
    ),
  ).toEqual([]);
  expect(
    priceBookEconomicDiff(
      withMatrix({ ...matrix, defaultMaxDiscountBps: 1000 }),
      withMatrix(matrix),
      en,
      "en-US",
    ),
  ).toEqual([
    {
      key: "discountAuthority",
      field: "Discount authority",
      before: "Default ceiling 500 bps (5%); 1 scoped rule",
      after: "Default ceiling 1,000 bps (10%); 1 scoped rule",
    },
  ]);
  expect(
    priceBookEconomicDiff(
      withMatrix({
        ...matrix,
        rules: [{ ...rule, maxDiscountBps: 1200 }],
      }),
      withMatrix(matrix),
      translatorFor("ar"),
      "ar-AE",
    )[0]?.after,
  ).toMatch(/تغيّرت القواعد المحددة/u);
});
