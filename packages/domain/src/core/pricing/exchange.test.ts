import { expect, it } from "vitest";
import {
  importedPriceBook,
  parsePriceBookExchange,
  PriceBookExchangeSchema,
  PRICE_BOOK_IMPORT_MAX_BYTES,
} from "./exchange";

const sourceId = "66000000-0000-4000-8000-000000000001";
export const exchangeFixture = {
  format: "clockwork.price-book.v2",
  schemaVersion: 2,
  exportedAt: "2026-09-06T12:00:00.000Z",
  source: { id: sourceId, name: "Source USD", version: 7, rowVersion: 8 },
  currency: "USD",
  rateCards: [
    {
      id: "66100000-0000-4000-8000-000000000001",
      sku: "STORAGE",
      region: "us-east-2",
      unit: "TB-month",
      approvedClaim: "Storage capacity",
      unitPrice: { currency: "USD", minor: "9007199254740993" },
      overageRate: { currency: "USD", minor: "18000" },
      minimumQuantity: "0.123456789123456789",
      trialLimit: "0.000000000000000001",
      egressTreatment: "metered",
      commitType: "term_drawdown",
      stripeTaxCode: "txcd_10103000",
      qboIncomeAccount: "4000",
      partnerTransferPrices: {
        "Managed Reseller": { currency: "USD", minor: "11000" },
      },
    },
  ],
  discountMatrix: {
    id: "old-policy",
    version: 7,
    defaultMaxDiscountBps: 250,
    rules: [
      { id: "gold", partnerTier: "Managed Reseller", maxDiscountBps: 300 },
    ],
  },
};
it("preserves lossless economics but creates fresh draft identities and policy", () => {
  const document = parsePriceBookExchange(JSON.stringify(exchangeFixture));
  const book = importedPriceBook(
    document,
    {
      id: "66000000-0000-4000-8000-000000000002",
      name: "Imported USD",
      version: 9,
      effectiveFrom: "2026-09-06",
    },
    () => "66100000-0000-4000-8000-000000000002",
  );
  expect(book.status).toBe("draft");
  expect(book.effectiveTo).toBeUndefined();
  expect(book.rateCards[0]).toMatchObject({
    ...exchangeFixture.rateCards[0],
    id: "66100000-0000-4000-8000-000000000002",
  });
  expect(book.discountMatrix).toMatchObject({
    id: `discount-${book.id}`,
    version: 1,
    rules: exchangeFixture.discountMatrix.rules,
  });
  expect(document).toEqual(exchangeFixture);
});
it("rejects unknown authority fields, unsupported format, mixed currencies, duplicate rates and excess scale", () => {
  const rate = exchangeFixture.rateCards[0];
  for (const patch of [
    { status: "active" },
    { approvals: [] },
    { providerBindings: [] },
    { schemaVersion: 1 },
    { rateCards: [] },
    { currency: "GBP" },
    { rateCards: [rate, rate] },
    { rateCards: [{ ...rate, minimumQuantity: "1.0000000000000000001" }] },
    { rateCards: [{ ...rate, minimumQuantity: "100000000000000000000" }] },
    { rateCards: [{ ...rate, unitPrice: { currency: "USD", minor: 123 } }] },
    { rateCards: [{ ...rate, unitPrice: { currency: "USD", minor: "-1" } }] },
  ])
    expect(
      PriceBookExchangeSchema.safeParse({ ...exchangeFixture, ...patch })
        .success,
    ).toBe(false);
  expect(() =>
    PriceBookExchangeSchema.safeParse({
      ...exchangeFixture,
      rateCards: [{ ...rate, unitPrice: { currency: "USD", minor: "abc" } }],
    }),
  ).not.toThrow();
  expect(
    PriceBookExchangeSchema.safeParse({
      ...exchangeFixture,
      rateCards: [{ ...rate, unitPrice: { currency: "USD", minor: "abc" } }],
    }).success,
  ).toBe(false);
});
it("enforces the byte limit on both text and structured commands", () => {
  expect(() =>
    parsePriceBookExchange(" ".repeat(PRICE_BOOK_IMPORT_MAX_BYTES + 1)),
  ).toThrow("1 MiB");
  expect(() =>
    parsePriceBookExchange({
      ...exchangeFixture,
      unexpected: "a".repeat(PRICE_BOOK_IMPORT_MAX_BYTES),
    }),
  ).toThrow("1 MiB");
});
it("does not trim imported economic identifiers or customer claim text", () => {
  const document = parsePriceBookExchange({
    ...exchangeFixture,
    rateCards: [
      {
        ...exchangeFixture.rateCards[0],
        sku: " STORAGE ",
        approvedClaim: " Storage capacity ",
      },
    ],
  });
  expect(document.rateCards[0]?.sku).toBe(" STORAGE ");
  expect(document.rateCards[0]?.approvedClaim).toBe(" Storage capacity ");
});

it.each(["__proto__", "constructor", "prototype"])(
  "rejects reserved transfer tier %s without silently dropping its price",
  (tier) => {
    const transfers: unknown = JSON.parse(
      `{"${tier}":{"currency":"USD","minor":"123"}}`,
    );
    expect(() =>
      parsePriceBookExchange({
        ...exchangeFixture,
        rateCards: [
          { ...exchangeFixture.rateCards[0], partnerTransferPrices: transfers },
        ],
      }),
    ).toThrow("reserved transfer tier");
  },
);

it("refuses the foreign source identity even when it is absent from the destination catalogue", () => {
  const document = parsePriceBookExchange(exchangeFixture);
  expect(() =>
    importedPriceBook(
      document,
      {
        id: document.source.id,
        name: "New destination",
        version: 99,
        effectiveFrom: "2026-09-06",
      },
      () => "66100000-0000-4000-8000-000000000002",
    ),
  ).toThrow("new price-book identity");
});
