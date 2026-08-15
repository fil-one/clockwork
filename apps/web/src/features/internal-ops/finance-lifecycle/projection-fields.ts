import type { ProjectionRecord } from "@/src/features/experience-server/model";

/**
 * Readers for the one payload shape every internal surface receives.
 *
 * `presentation()` in `@clockwork/workflows` writes the same keys for every
 * aggregate: the display fields at the top level and the aggregate's own
 * allowlisted columns under `authoritative`. Nothing here invents a value. A
 * key the materializer did not write reads as `null`, and a caller that needs
 * it says "Not recorded" rather than substituting a plausible one.
 */

export type ProjectionData = Readonly<Record<string, unknown>>;

export interface EvidenceEntry {
  label: string;
  value: string;
}

export function text(data: ProjectionData, key: string): string | null {
  const value = data[key];
  return typeof value === "string" && value.trim() ? value : null;
}

export function integer(data: ProjectionData, key: string): number | null {
  const value = data[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** The aggregate's own allowlisted columns, or `{}` when none were written. */
export function authoritative(record: ProjectionRecord): ProjectionData {
  const value = record.data.authoritative;
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as ProjectionData)
    : {};
}

export function contextEntries(data: ProjectionData): readonly EvidenceEntry[] {
  const entries = data.context;
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const item = entry as ProjectionData;
    const label = text(item, "label");
    const value = text(item, "value");
    return label && value ? [{ label, value }] : [];
  });
}

export function allowedActions(data: ProjectionData): readonly string[] {
  return Array.isArray(data.allowedActions)
    ? data.allowedActions.filter(
        (action): action is string => typeof action === "string",
      )
    : [];
}

export type ProjectionRisk = "low" | "medium" | "high";

export function risk(data: ProjectionData): ProjectionRisk | null {
  const value = text(data, "risk");
  return value === "low" || value === "medium" || value === "high"
    ? value
    : null;
}

/**
 * Record evidence every operator row carries: the identity and version the
 * decision was taken against, so two operators reading the same row agree on
 * which revision they saw.
 */
export function recordEvidence(record: ProjectionRecord): EvidenceEntry[] {
  return [
    ...contextEntries(record.data),
    {
      label: "Source record",
      value: `Version ${record.version} · updated ${record.sourceUpdatedAt}`,
    },
  ];
}

const MINOR_UNITS = /^-?\d+$/u;

/** Exact minor units, or `null` when the payload carried no parseable amount. */
export function minorUnits(value: string | null): bigint | null {
  return value && MINOR_UNITS.test(value) ? BigInt(value) : null;
}

const currencySymbols: Readonly<Record<string, string>> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
};

/**
 * Formats exact minor units without ever converting them to a float, matching
 * `formatMoney` in the materializer so a total computed here and an amount
 * printed by the projection read the same way.
 */
export function formatMinorUnits(
  amount: bigint,
  currency: string | null,
): string {
  const negative = amount < 0n;
  const digits = (negative ? -amount : amount).toString().padStart(3, "0");
  const whole = digits.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
  const symbol = currency ? (currencySymbols[currency] ?? "") : "";
  const suffix = currency && !symbol ? ` ${currency}` : "";
  return `${negative ? "-" : ""}${symbol}${whole}.${digits.slice(-2)}${suffix}`;
}

/** Whole days from `instant` to `now`; negative when `instant` is in the future. */
export function daysSince(instant: string | null, now: Date): number | null {
  if (!instant) return null;
  const parsed = Date.parse(instant);
  if (!Number.isFinite(parsed)) return null;
  return Math.floor((now.getTime() - parsed) / 86_400_000);
}

/**
 * A total is only a total when every amount is in one currency. Records in a
 * second currency are counted and reported rather than added, because a sum
 * across currencies is a wrong number under a right label.
 */
export interface CurrencyTotal {
  currency: string | null;
  total: bigint;
  counted: number;
  excluded: number;
}

export function totalInDominantCurrency(
  amounts: ReadonlyArray<{ minor: bigint | null; currency: string | null }>,
): CurrencyTotal {
  const present = amounts.filter(
    (amount): amount is { minor: bigint; currency: string | null } =>
      amount.minor !== null,
  );
  const counts = new Map<string, number>();
  for (const amount of present)
    if (amount.currency)
      counts.set(amount.currency, (counts.get(amount.currency) ?? 0) + 1);
  const dominant =
    [...counts].sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
    )[0]?.[0] ?? null;
  let total = 0n;
  let counted = 0;
  let excluded = 0;
  for (const amount of present) {
    if (amount.currency === dominant) {
      total += amount.minor;
      counted += 1;
    } else excluded += 1;
  }
  return { currency: dominant, total, counted, excluded };
}
