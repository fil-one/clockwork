import "server-only";

import type {
  DatabaseIndicativePriceBookReader,
  IndicativePriceBookRecord,
} from "@clockwork/db";
import type { DemoAdapterStateStore } from "@clockwork/testing/demo-state";

import {
  loadPriceBookRecords,
  type PriceBookAvailability,
} from "@/src/features/internal-ops/price-books/server-price-book-loader";

export interface IndicativePriceBookResult {
  books: readonly IndicativePriceBookRecord[];
  availability: PriceBookAvailability;
  readAt: string;
}

/**
 * Read the books a seller may price with today. The service read returns only
 * active books in force and their list prices. Without it, the page falls back
 * exactly as the price book page does: to the labelled demo fixture where that
 * is enabled, otherwise to unavailable.
 */
export async function loadIndicativePriceBookRecords(
  reader: Pick<DatabaseIndicativePriceBookReader, "listInForce"> | undefined,
  input: {
    locale: string;
    now?: Date;
    demoEnabled?: boolean;
    demoStore?: DemoAdapterStateStore;
  },
): Promise<IndicativePriceBookResult> {
  const now = input.now ?? new Date();
  const readAt = now.toISOString();
  if (reader)
    try {
      const books = await reader.listInForce({ today: readAt.slice(0, 10) });
      return {
        books,
        availability: books.length ? "available" : "empty",
        readAt,
      };
    } catch (error) {
      // Fall through to the demo fixture or to unavailable below.
      console.error("Indicative price books could not be read", {
        error: error instanceof Error ? error.name : "unknown",
      });
    }
  const fallback = await loadPriceBookRecords(undefined, { ...input, now });
  return {
    books: fallback.books,
    availability: fallback.availability,
    readAt: fallback.readAt,
  };
}
