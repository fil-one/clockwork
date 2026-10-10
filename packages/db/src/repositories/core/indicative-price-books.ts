import { MoneySchema, type Money } from "@clockwork/contracts";
import type { RateCard } from "@clockwork/domain/core";
import { and, asc, eq, gte, isNull, lte, or } from "drizzle-orm";

import type { RuntimeDatabase } from "../../client";
import { priceBooks, rateCards } from "../../schema";
import { withInternalTransaction } from "../../transaction";

/**
 * One rate as the sales workspace prices with it: the list price and the
 * terms a prospect would be quoted. Floors, partner transfer prices, claims and
 * accounting or tax codes are never selected.
 */
export interface IndicativeRateCardRecord {
  id: string;
  sku: string;
  region: string;
  unit: string;
  unitPrice: Money;
  overageRate: Money;
  minimumQuantity: string;
  commitType: RateCard["commitType"];
}

/**
 * A price book as the sales workspace reads it. A full administration record
 * also satisfies this shape, so the demo fixture can stand in for it.
 */
export interface IndicativePriceBookRecord {
  id: string;
  name: string;
  currency: string;
  version: number;
  status: "draft" | "active" | "retired";
  effectiveFrom: string;
  effectiveTo: string | null;
  rateCards?: readonly IndicativeRateCardRecord[];
}

/** One row of the joined read: a book's header beside one of its rates. */
export interface IndicativePriceBookRow {
  bookId: string;
  name: string;
  currency: string;
  version: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  rateId: string;
  sku: string;
  region: string;
  unit: string;
  unitPriceMinor: bigint;
  overageRateMinor: bigint;
  minimumQuantity: string;
  commitType: string;
}

/**
 * Folds joined rows into books, keeping the order the rows arrived in for both
 * books and their rates.
 */
export function indicativePriceBookRecords(
  rows: readonly IndicativePriceBookRow[],
): IndicativePriceBookRecord[] {
  const books = new Map<
    string,
    IndicativePriceBookRecord & { rateCards: IndicativeRateCardRecord[] }
  >();
  for (const row of rows) {
    let book = books.get(row.bookId);
    if (!book) {
      book = {
        id: row.bookId,
        name: row.name,
        currency: row.currency,
        version: row.version,
        status: "active",
        effectiveFrom: row.effectiveFrom,
        effectiveTo: row.effectiveTo,
        rateCards: [],
      };
      books.set(row.bookId, book);
    }
    book.rateCards.push({
      id: row.rateId,
      sku: row.sku,
      region: row.region,
      unit: row.unit,
      unitPrice: MoneySchema.parse({
        currency: row.currency,
        minor: row.unitPriceMinor.toString(),
      }),
      overageRate: MoneySchema.parse({
        currency: row.currency,
        minor: row.overageRateMinor.toString(),
      }),
      minimumQuantity: row.minimumQuantity,
      commitType: row.commitType as RateCard["commitType"],
    });
  }
  return [...books.values()];
}

/**
 * The read behind indicative pricing: active books in force on the given day,
 * with their rates, in one statement. Drafts, retired books, books outside
 * their dates and books without rates are left out by the query itself.
 */
export class DatabaseIndicativePriceBookReader {
  public constructor(private readonly database: RuntimeDatabase) {}

  public listInForce(input: { today: string; requestId?: string }) {
    return withInternalTransaction(
      this.database,
      input.requestId ?? `indicative-price-books:${crypto.randomUUID()}`,
      async (transaction): Promise<IndicativePriceBookRecord[]> =>
        indicativePriceBookRecords(
          await transaction
            .select({
              bookId: priceBooks.id,
              name: priceBooks.name,
              currency: priceBooks.currency,
              version: priceBooks.version,
              effectiveFrom: priceBooks.effectiveFrom,
              effectiveTo: priceBooks.effectiveTo,
              rateId: rateCards.id,
              sku: rateCards.sku,
              region: rateCards.region,
              unit: rateCards.unit,
              unitPriceMinor: rateCards.unitPriceMinor,
              overageRateMinor: rateCards.overageRateMinor,
              minimumQuantity: rateCards.minimumQuantity,
              commitType: rateCards.commitType,
            })
            .from(priceBooks)
            .innerJoin(rateCards, eq(rateCards.priceBookId, priceBooks.id))
            .where(
              and(
                eq(priceBooks.status, "active"),
                lte(priceBooks.effectiveFrom, input.today),
                or(
                  isNull(priceBooks.effectiveTo),
                  gte(priceBooks.effectiveTo, input.today),
                ),
              ),
            )
            .orderBy(
              asc(priceBooks.currency),
              asc(priceBooks.id),
              asc(rateCards.sku),
              asc(rateCards.region),
            ),
        ),
    );
  }
}
