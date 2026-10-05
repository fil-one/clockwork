import type { PriceBookAdministrationRecord } from "@clockwork/db";

import type { IndicativePriceBook } from "./pricing-workspace";

/**
 * The books a seller may price with, reduced to the facts the calculator
 * needs: who proposed or approved a book stays on the finance page.
 *
 * Active books in force come first, then drafts, each with US dollar books
 * first; retired books and books with no rates are left out. The first book
 * is the one the page opens on.
 */
export function indicativePriceBooks(
  records: readonly PriceBookAdministrationRecord[],
  today: string,
  formatDate: (isoDate: string) => string,
): IndicativePriceBook[] {
  const rank = (book: PriceBookAdministrationRecord) =>
    book.status === "active" && book.effectiveFrom <= today ? 0 : 1;
  return records
    .filter(
      (
        book,
      ): book is PriceBookAdministrationRecord & {
        status: "active" | "draft";
      } =>
        book.status !== "retired" &&
        (book.rateCards?.length ?? 0) > 0 &&
        (!book.effectiveTo || book.effectiveTo >= today),
    )
    .toSorted(
      (left, right) =>
        rank(left) - rank(right) ||
        // Fil One prices in US dollars first; other currencies follow.
        Number(left.currency !== "USD") - Number(right.currency !== "USD") ||
        left.currency.localeCompare(right.currency) ||
        right.version - left.version,
    )
    .map((book) => ({
      id: book.id,
      name: book.name,
      version: book.version,
      currency: book.currency,
      effectiveFrom: book.effectiveFrom,
      status: book.status,
      effectiveLabel: formatDate(book.effectiveFrom),
      ...(book.rateCards ? { rateCards: book.rateCards } : {}),
      ...(book.discountMatrix ? { discountMatrix: book.discountMatrix } : {}),
    }));
}
