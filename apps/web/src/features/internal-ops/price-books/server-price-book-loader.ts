import "server-only";

import type {
  DatabasePriceBookAdministrationReader,
  PriceBookAdministrationRecord,
} from "@clockwork/db";
import type { DemoAdapterStateStore } from "@clockwork/testing/demo-state";

import { demoDeployIdentityEnabled } from "@/src/auth/demo-deploy";
import { configuredDemoStateStore } from "@/src/features/experience-server/demo-state-store";

import { readDemoPriceBookRecords } from "./demo-price-books";

export type PriceBookSource =
  | "Pricing service"
  | "Deterministic demo fixture"
  | "Pricing service unavailable";
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
): Promise<PriceBookResult> {
  const books = await readDemoPriceBookRecords(store);
  return {
    books,
    source: "Deterministic demo fixture",
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
    requestId?: string;
    now?: Date;
    demoEnabled?: boolean;
    demoStore?: DemoAdapterStateStore;
  } = {},
): Promise<PriceBookResult> {
  const readAt = (input.now ?? new Date()).toISOString();
  if (reader)
    try {
      const books = await reader.list({
        ...(input.requestId ? { requestId: input.requestId } : {}),
      });
      return {
        books,
        source: "Pricing service",
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
      );
    } catch {
      // Corrupt or unreachable demo state is unavailable, never pristine.
    }
  return {
    books: [],
    source: "Pricing service unavailable",
    availability: "unavailable",
    readAt,
  };
}
