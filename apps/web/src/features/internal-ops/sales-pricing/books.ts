import type { PriceBookAdministrationRecord } from "@clockwork/db";

/**
 * One rate as a seller may see it: the list price a prospect would be quoted
 * and nothing that sits behind it. Floor prices, partner transfer prices and
 * accounting or tax codes stay on the server.
 */
export interface IndicativeRate {
  id: string;
  sku: string;
  region: string;
  unit: string;
  unitPrice: { currency: string; minor: string };
  overageRate: { currency: string; minor: string };
  minimumQuantity: string;
  commitType: "period_allowance" | "term_drawdown";
}

/** A price book as the sales workspace prices with it. */
export interface IndicativePriceBook {
  id: string;
  name: string;
  version: number;
  currency: string;
  /** The effective date, already written for the reader. */
  effectiveLabel: string;
  rates: readonly IndicativeRate[];
}

/**
 * The books a seller may price with: active books in force today, US dollar
 * books first, newest version first. A draft has not passed the two-person
 * activation, so it is never shown. Each book is rebuilt field by field so a
 * new column on a rate card cannot reach the browser by default.
 */
export function indicativePriceBooks(
  records: readonly PriceBookAdministrationRecord[],
  today: string,
  formatDate: (isoDate: string) => string,
): IndicativePriceBook[] {
  return records
    .filter(
      (book) =>
        book.status === "active" &&
        book.effectiveFrom <= today &&
        (!book.effectiveTo || book.effectiveTo >= today) &&
        (book.rateCards?.length ?? 0) > 0,
    )
    .toSorted(
      (left, right) =>
        Number(left.currency !== "USD") - Number(right.currency !== "USD") ||
        left.currency.localeCompare(right.currency) ||
        right.version - left.version,
    )
    .map((book) => ({
      id: book.id,
      name: book.name,
      version: book.version,
      currency: book.currency,
      effectiveLabel: formatDate(book.effectiveFrom),
      rates: (book.rateCards ?? []).map((rate) => ({
        id: rate.id,
        sku: rate.sku,
        region: rate.region,
        unit: rate.unit,
        unitPrice: {
          currency: rate.unitPrice.currency,
          minor: rate.unitPrice.minor,
        },
        overageRate: {
          currency: rate.overageRate.currency,
          minor: rate.overageRate.minor,
        },
        minimumQuantity: rate.minimumQuantity,
        commitType: rate.commitType,
      })),
    }));
}
