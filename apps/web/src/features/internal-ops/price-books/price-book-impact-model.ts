import type { PriceBookImpactSnapshot } from "@clockwork/db";

/**
 * Where the counts came from. A key, not a label: the panel words it for the
 * reader, and the demo's illustrative counts must never read as live ones.
 */
export type PriceBookImpactSource = "retainedRecords" | "demoScenario";

export type PriceBookImpactResult =
  | (PriceBookImpactSnapshot & {
      availability: "available";
      source: PriceBookImpactSource;
    })
  | { availability: "unavailable" };
