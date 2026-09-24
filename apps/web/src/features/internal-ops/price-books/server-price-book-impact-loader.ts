import "server-only";

import type {
  DatabasePriceBookImpactReader,
  PriceBookAdministrationRecord,
  PriceBookImpactRecord,
} from "@clockwork/db";

import type { PriceBookImpactResult } from "./price-book-impact-model";

/** Explicitly illustrative counts; never read production data with a demo identity. */
export function demoPriceBookImpact(
  books: readonly PriceBookAdministrationRecord[],
  asOf: string,
): PriceBookImpactResult {
  const records = books.map((book): PriceBookImpactRecord => {
    const example = book.id === "66000000-0000-4000-8000-000000000001";
    return {
      id: book.id,
      rowVersion: book.rowVersion,
      status: book.status,
      quoteRevisions: example ? 8 : 0,
      quoteSeries: example ? 6 : 0,
      quotedAccounts: example ? 3 : 0,
      draftQuotes: example ? 2 : 0,
      unexpiredIssuedQuotes: example ? 3 : 0,
      expiredIssuedQuotes: example ? 1 : 0,
      acceptedQuotes: example ? 2 : 0,
      orders: example ? 2 : 0,
      immutableOrders: example ? 2 : 0,
      openOrders: example ? 2 : 0,
      governingAgreements: example ? 2 : 0,
      orderLines: example ? 3 : 0,
      activeEntitlements: example ? 2 : 0,
      suspendedEntitlements: 0,
    };
  });
  return {
    availability: "available",
    source: "demoScenario",
    asOf,
    records,
  };
}

export async function loadPriceBookImpact(input: {
  reader?: Pick<DatabasePriceBookImpactReader, "read"> | undefined;
  books: readonly PriceBookAdministrationRecord[];
  userId: string;
  providerBacked: boolean;
  internalReader: boolean;
  demo: boolean;
  readAt: string;
}): Promise<PriceBookImpactResult> {
  if (!input.internalReader) return { availability: "unavailable" };
  if (!input.providerBacked)
    return input.demo
      ? demoPriceBookImpact(input.books, input.readAt)
      : { availability: "unavailable" };
  if (!input.reader || input.demo) return { availability: "unavailable" };
  try {
    const snapshot = await input.reader.read({
      userId: input.userId,
      bookIds: input.books.map((book) => book.id),
    });
    return {
      ...snapshot,
      availability: "available",
      source: "retainedRecords",
    };
  } catch {
    return { availability: "unavailable" };
  }
}
