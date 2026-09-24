import "server-only";

import type {
  DatabasePriceBookAdministrationReader,
  PriceBookAdministrationRecord,
} from "@clockwork/db";
import type { DemoAdapterStateStore } from "@clockwork/testing/demo-state";

import { demoDeployIdentityEnabled } from "@/src/auth/demo-deploy";
import { configuredDemoStateStore } from "@/src/features/experience-server/demo-state-store";

import { readDemoPriceBookRecords } from "./demo-price-books";

/** Where the books came from. A key; the page words it for the reader. */
export type PriceBookSource = "service" | "demo" | "unavailable";
export type PriceBookAvailability = "available" | "empty" | "unavailable";

export interface PriceBookResult {
  books: readonly PriceBookAdministrationRecord[];
  source: PriceBookSource;
  availability: PriceBookAvailability;
  readAt: string;
}

async function demoResult(
  store: DemoAdapterStateStore,
  readAt: string,
  locale: string,
): Promise<PriceBookResult> {
  const books = await readDemoPriceBookRecords(store, locale);
  return {
    books,
    source: "demo",
    availability: books.length ? "available" : "empty",
    readAt,
  };
}

/**
 * Read price books through the service database. There is deliberately no URL,
 * outbound fetch, request header, or cookie parameter on this boundary. When
 * the read is unavailable the page shows nothing to activate rather than a
 * shape a reader could mistake for current price.
 */
export async function loadPriceBookRecords(
  reader: Pick<DatabasePriceBookAdministrationReader, "list"> | undefined,
  input: {
    /**
     * The reader's interface language. Only the demo fixture uses it, to show
     * its authored book names and reasons in that language; production books
     * are returned exactly as stored.
     */
    locale: string;
    requestId?: string;
    now?: Date;
    demoEnabled?: boolean;
    demoStore?: DemoAdapterStateStore;
  },
): Promise<PriceBookResult> {
  const readAt = (input.now ?? new Date()).toISOString();
  if (reader)
    try {
      const books = await reader.list({
        ...(input.requestId ? { requestId: input.requestId } : {}),
      });
      return {
        books,
        source: "service",
        availability: books.length ? "available" : "empty",
        readAt,
      };
    } catch {
      // A canonical demo may fall through to its explicitly labelled fixture.
      // Ordinary deployments still fail closed below.
    }
  const demoEnabled =
    input.demoEnabled ?? demoDeployIdentityEnabled(process.env);
  if (demoEnabled)
    try {
      return await demoResult(
        input.demoStore ?? configuredDemoStateStore(),
        readAt,
        input.locale,
      );
    } catch {
      // Corrupt or unreachable demo state is unavailable, never pristine.
    }
  return {
    books: [],
    source: "unavailable",
    availability: "unavailable",
    readAt,
  };
}
