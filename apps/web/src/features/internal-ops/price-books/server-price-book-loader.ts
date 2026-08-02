import "server-only";

import type {
  DatabasePriceBookAdministrationReader,
  PriceBookAdministrationRecord,
} from "@clockwork/db";

export type PriceBookSource =
  "Pricing service" | "Fail-closed operational fallback";

export interface PriceBookResult {
  books: readonly PriceBookAdministrationRecord[];
  source: PriceBookSource;
  readAt: string;
}

/**
 * Read price books through the service database. There is deliberately no URL,
 * outbound fetch, request header, or cookie parameter on this boundary. When
 * the read is unavailable the page shows nothing to activate rather than a
 * shape a reader could mistake for current price.
 */
export async function loadPriceBookRecords(
  reader: Pick<DatabasePriceBookAdministrationReader, "list"> | undefined,
  input: { requestId?: string; now?: Date } = {},
): Promise<PriceBookResult> {
  const readAt = (input.now ?? new Date()).toISOString();
  if (!reader)
    return { books: [], source: "Fail-closed operational fallback", readAt };
  try {
    return {
      books: await reader.list({
        ...(input.requestId ? { requestId: input.requestId } : {}),
      }),
      source: "Pricing service",
      readAt,
    };
  } catch {
    return { books: [], source: "Fail-closed operational fallback", readAt };
  }
}
