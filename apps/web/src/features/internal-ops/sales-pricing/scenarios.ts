import type {
  PricingScenarioRecord,
  PricingScenarioSummary,
} from "@clockwork/contracts";

/** What the page's scenario section can show. */
export type ScenarioPanelState =
  | { kind: "unavailable" }
  | { kind: "demo" }
  | { kind: "mfa" }
  | { kind: "error" }
  | {
      kind: "ready";
      scenarios: readonly PricingScenarioSummary[];
      opened: PricingScenarioRecord | null;
      seesAll: boolean;
    };

/** "12.5" percent as basis points, or null when it is not a valid discount. */
export function discountBps(percent: string): number | null {
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(percent.trim())) return null;
  const bps = Math.round(Number(percent) * 100);
  return bps <= 10_000 ? bps : null;
}
