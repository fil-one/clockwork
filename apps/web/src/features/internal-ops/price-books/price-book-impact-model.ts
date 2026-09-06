import type { PriceBookImpactSnapshot } from "@clockwork/db";

export type PriceBookImpactResult =
  | (PriceBookImpactSnapshot & {
      availability: "available";
      source: "Retained commerce records" | "Illustrative demo scenario";
    })
  | { availability: "unavailable" };
