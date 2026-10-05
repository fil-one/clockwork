import "server-only";

import { mndaHomeSource } from "./mnda-source";
import type {
  SalesHomeContext,
  SalesHomeSection,
  SalesHomeSource,
} from "./model";

/**
 * Every kind of work on the staff home page, in page order. The contracts
 * workspace adds its renewal notices here as one more source.
 */
export const salesHomeSources: readonly SalesHomeSource[] = [mndaHomeSource];

/**
 * Loads each source the reader may see. A source that fails reads as
 * unavailable on its own; the rest of the page still renders.
 */
export async function loadSalesHome(
  context: SalesHomeContext,
  sources: readonly SalesHomeSource[] = salesHomeSources,
): Promise<SalesHomeSection[]> {
  return Promise.all(
    sources
      .filter((source) =>
        context.permissions.includes(source.requiredPermission),
      )

      .map(async (source) => {
        const section = {
          id: source.id,
          heading: source.heading,
          unavailable: source.unavailable,
        };
        try {
          return { ...section, rows: await source.load(context) };
        } catch (error) {
          console.error("Sales home source failed", {
            source: source.id,
            error: error instanceof Error ? error.message : "unknown",
          });
          return { ...section, rows: null };
        }
      }),
  );
}
