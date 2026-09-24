import type { ProjectionRecord } from "@/src/features/experience-server/model";
import {
  formatDate,
  formatMoney,
  type SupportedCurrency,
} from "@/src/features/shared/format";
import type { MessageId, Translator } from "@/src/i18n";

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
 * The context lines the projection carries for a row. The row's own version
 * and update instant -- which revision two operators saw -- are separate
 * fields on every row type, and the surface states them in the reader's
 * language beside these lines rather than as a pre-rendered English one.
 */
export function recordEvidence(record: ProjectionRecord): EvidenceEntry[] {
  return [...contextEntries(record.data)];
}

const MINOR_UNITS = /^-?\d+$/u;

/** Exact minor units, or `null` when the payload carried no parseable amount. */
export function minorUnits(value: string | null): bigint | null {
  return value && MINOR_UNITS.test(value) ? BigInt(value) : null;
}

/** An exact amount as facts: minor units and the currency they are held in. */
export interface MinorAmount {
  minor: bigint;
  currency: string | null;
}

const CURRENCY_CODE = /^[A-Z]{3}$/u;

/**
 * Formats exact minor units for the reader, without ever converting them to a
 * float. The account decides the currency; the reader's formatting locale
 * decides how the digits are grouped and where the symbol goes. An amount with
 * no currency on record is shown as a plain decimal rather than borrowing one.
 */
export function formatMinorAmount(
  minor: bigint | string,
  currency: string | null,
  locale: string,
): string {
  const amount = BigInt(minor);
  if (currency && CURRENCY_CODE.test(currency))
    try {
      return formatMoney(amount, currency as SupportedCurrency, locale);
    } catch {
      // An ISO-shaped code Intl does not know falls through to the decimal.
    }
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  const whole = new Intl.NumberFormat(locale).format(absolute / 100n);
  const decimal =
    new Intl.NumberFormat(locale)
      .formatToParts(1.5)
      .find((part) => part.type === "decimal")?.value ?? ".";
  const fraction = (absolute % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${whole}${decimal}${fraction}`;
}

/** The calendar day of an instant or ISO date, in the reader's locale (UTC). */
export function formatCalendarDay(
  value: string | null,
  locale: string,
): string | null {
  if (!value) return null;
  const instant = Date.parse(
    /^\d{4}-\d{2}-\d{2}$/u.test(value) ? `${value}T00:00:00Z` : value,
  );
  if (!Number.isFinite(instant)) return null;
  return formatDate(new Date(instant), locale);
}

/**
 * Two calendar days as one range in the reader's locale, so the separator and
 * the shared month or year follow the language ("1–31 jul 2026", "2026/07/01～
 * 2026/07/31") instead of an English "to".
 */
export function formatCalendarRange(
  start: string | null,
  end: string | null,
  locale: string,
): string | null {
  const parse = (value: string | null) =>
    value
      ? Date.parse(
          /^\d{4}-\d{2}-\d{2}$/u.test(value) ? `${value}T00:00:00Z` : value,
        )
      : Number.NaN;
  const from = parse(start);
  const to = parse(end);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).formatRange(new Date(from), new Date(to));
}

/** "in 39 days", "3 days ago", "today", as the reader's language says it. */
export function formatRelativeDays(days: number, locale: string): string {
  return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(
    days,
    "day",
  );
}

/** Counts and other plain integers, grouped for the reader. */
export function formatCount(value: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(value);
}

/**
 * Status chips, from the status the projection states as a code.
 *
 * The generic set is the one `publicStatus` in the materializer collapses
 * every aggregate onto; its forms agree with an implicit "record". Invoices and
 * orders have their own sets, whose forms agree with those nouns, and the row
 * mappers read the aggregate's own status for them before the public one.
 */
export const recordStatusMessages: Readonly<Record<string, MessageId>> = {
  active: "status.active",
  draft: "status.draft",
  accepted: "status.accepted",
  pending: "status.pending",
  paid: "status.paid",
  blocked: "status.blocked",
  open: "status.open",
  canceled: "status.canceled",
  complete: "status.complete",
  attention: "status.attention",
  provisioning: "status.provisioning",
  failed: "status.failed",
  ready: "status.ready",
  resolved: "status.resolved",
  submitted: "status.submitted",
  terminated: "status.terminated",
};

export const invoiceStatusMessages: Readonly<Record<string, MessageId>> = {
  draft: "status.invoice.draft",
  open: "status.invoice.open",
  issued: "status.invoice.open",
  paid: "status.invoice.paid",
  void: "status.invoice.void",
  uncollectible: "status.invoice.uncollectible",
};

export const orderStatusMessages: Readonly<Record<string, MessageId>> = {
  submitted: "status.order.submitted",
  accepted: "status.order.accepted",
  provisioning: "status.order.provisioning",
  active: "status.order.active",
  amended: "status.order.amended",
  completed: "status.order.completed",
  complete: "status.order.completed",
  cancelled: "status.order.cancelled",
  canceled: "status.order.cancelled",
  terminated: "status.order.terminated",
};

/**
 * The status of a row as the reader's language names it.
 *
 * A code in the closed set is always rendered from its message. A row whose
 * projection names no known code falls back to the label the read boundary
 * supplied (a demo fixture that states only a label, already resolved to the
 * reader's language there), then to the raw code, and only then to "Not
 * recorded" -- never to a plausible status the row did not state.
 */
export function statusText(
  t: Translator,
  codes: readonly (string | null)[],
  label: string | null,
  messages: Readonly<Record<string, MessageId>> = recordStatusMessages,
): string {
  for (const code of codes) {
    const id = code ? messages[code] : undefined;
    if (id) return t(id);
  }
  for (const code of codes) {
    const id = code ? recordStatusMessages[code] : undefined;
    if (id) return t(id);
  }
  return label ?? codes.find(Boolean) ?? t("common.notRecorded");
}

/**
 * The sales route an order was sourced through (`orders.sourcing`, and the
 * reporting views' `channel` column). The glossary keeps route distinct from
 * channel in every language.
 */
export const routeMessages: Readonly<Record<string, MessageId>> = {
  direct: "operations.finance.route.direct",
  referral: "operations.finance.route.referral",
  resale: "operations.finance.route.resale",
  distributor: "operations.finance.route.distributor",
  marketplace: "operations.finance.route.marketplace",
};

export function routeText(t: Translator, route: string): string {
  const id = routeMessages[route];
  return id ? t(id) : route;
}

const currencySymbols: Readonly<Record<string, string>> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
};

/**
 * Formats exact minor units without ever converting them to a float, in the
 * materializer's own English shape.
 *
 * @deprecated Kept only for `CollectionsSummary.openTotal`/`overdueTotal`,
 * which the operations home still reads as strings. Surfaces format
 * `MinorAmount` facts with `formatMinorAmount` in the reader's locale.
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
