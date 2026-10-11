import type {
  PricingScenarioRecord,
  PricingScenarioSummary,
} from "@clockwork/contracts";

/** What the page's scenario section can show. */
export type ScenarioPanelState =
  | {
      kind: "demo";
      /** Fictional scenarios priced from the demo books, to open read only. */
      examples: readonly PricingScenarioRecord[];
      opened: PricingScenarioRecord | null;
    }
  | { kind: "unavailable" }
  | { kind: "mfa" }
  | { kind: "error" }
  | {
      kind: "ready";
      scenarios: readonly PricingScenarioSummary[];
      opened: PricingScenarioRecord | null;
      seesAll: boolean;
    };

/**
 * "12.5" percent as basis points, or null when it is not a percentage from 0
 * to 100 with up to two decimals. Discounts, commissions and margins alike.
 */
export function discountBps(percent: string): number | null {
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(percent.trim())) return null;
  const bps = Math.round(Number(percent) * 100);
  return bps <= 10_000 ? bps : null;
}

/**
 * "6.50" or "1,250.00" as minor units ("650"), or null when it is not an
 * amount: digits with optional thousands commas and up to two decimals, at
 * most 99,999,999.99. No currency symbol; the scenario's currency applies.
 */
export function priceMinor(text: string): string | null {
  const match =
    /^(\d{1,8}|\d{1,2},\d{3},\d{3}|\d{1,3},\d{3})(?:\.(\d{1,2}))?$/u.exec(
      text.trim(),
    );
  if (!match) return null;
  return String(
    BigInt((match[1] ?? "0").replaceAll(",", "")) * 100n +
      BigInt((match[2] ?? "").padEnd(2, "0")),
  );
}

/** Minor units as the plain decimal a seller types: "650" as "6.50". */
export function minorText(minor: string): string {
  const value = BigInt(minor);
  return `${value / 100n}.${String(value % 100n).padStart(2, "0")}`;
}

/** Basis points as the percentage a seller types: 3200 as "32". */
export const bpsText = (bps: number) => String(bps / 100);
