import { afterAll, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";

import { createRuntimeDatabase } from "../../client";
import { orders, quotes, orderLines, entitlements } from "../../schema";
import { withInternalTransaction } from "../../transaction";
import { DatabasePriceBookImpactReader } from "./price-book-impact";

const { db, client } = createRuntimeDatabase({
  url:
    process.env.DIRECT_DATABASE_URL ??
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
  role: "clockwork_service",
  ssl: false,
});
const reader = new DatabasePriceBookImpactReader(db);
const userId = "20000000-0000-4000-8000-000000000001";
const bookId = "60000000-0000-4000-8000-000000000001";
afterAll(() => client.end());

it("counts retained references without multiplying orders by lines or shared agreements", async () => {
  const expected = await withInternalTransaction(
    db,
    "impact-independent-references",
    async (tx) => {
      const quoteRows = await tx
        .select()
        .from(quotes)
        .where(eq(quotes.priceBookId, bookId));
      const orderRows = await tx
        .select()
        .from(orders)
        .where(
          inArray(
            orders.quoteId,
            quoteRows.map((quote) => quote.id),
          ),
        );
      const lineRows = await tx
        .select()
        .from(orderLines)
        .where(
          inArray(
            orderLines.orderId,
            orderRows.map((order) => order.id),
          ),
        );
      const entitlementRows = await tx
        .select()
        .from(entitlements)
        .where(
          inArray(
            entitlements.orderId,
            orderRows.map((order) => order.id),
          ),
        );
      return { quoteRows, orderRows, lineRows, entitlementRows };
    },
  );
  expect(expected.orderRows.length).toBeGreaterThanOrEqual(6);
  const agreementCount = new Set(
    expected.orderRows.map((order) => order.agreementId),
  ).size;
  expect(agreementCount).toBeLessThan(expected.orderRows.length);
  const now = new Date("2026-09-06T12:00:00.000Z");
  const result = await reader.read({ userId, bookIds: [bookId], now });
  expect(result.asOf).toBe(now.toISOString());
  expect(result.records).toHaveLength(1);
  expect(result.records[0]).toMatchObject({
    id: bookId,
    quoteRevisions: expected.quoteRows.length,
    quoteSeries: new Set(expected.quoteRows.map((quote) => quote.seriesId))
      .size,
    quotedAccounts: new Set(expected.quoteRows.map((quote) => quote.accountId))
      .size,
    draftQuotes: expected.quoteRows.filter((quote) => quote.status === "draft")
      .length,
    unexpiredIssuedQuotes: expected.quoteRows.filter(
      (quote) => quote.status === "issued" && quote.expiresAt > now,
    ).length,
    expiredIssuedQuotes: expected.quoteRows.filter(
      (quote) => quote.status === "issued" && quote.expiresAt <= now,
    ).length,
    acceptedQuotes: expected.quoteRows.filter(
      (quote) => quote.status === "accepted",
    ).length,
    orders: expected.orderRows.length,
    immutableOrders: expected.orderRows.filter(
      (order) => order.immutableAt !== null,
    ).length,
    governingAgreements: agreementCount,
    orderLines: expected.lineRows.length,
    activeEntitlements: expected.entitlementRows.filter(
      (entry) => entry.status === "active",
    ).length,
    suspendedEntitlements: expected.entitlementRows.filter(
      (entry) => entry.status === "suspended_write",
    ).length,
  });
});

it("does not turn a missing book into a zero-reference record", async () => {
  const result = await reader.read({ userId, bookIds: [crypto.randomUUID()] });
  expect(result.records).toEqual([]);
});

it("rechecks persisted internal authority even for an empty request", async () => {
  await expect(
    reader.read({
      userId: "20000000-0000-4000-8000-000000000002",
      bookIds: [],
    }),
  ).rejects.toThrow("PRICE_BOOK_IMPACT_ACCESS_DENIED");
  await expect(
    reader.read({ userId: crypto.randomUUID(), bookIds: [bookId] }),
  ).rejects.toThrow("PRICE_BOOK_IMPACT_ACCESS_DENIED");
});
