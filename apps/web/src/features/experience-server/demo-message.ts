import {
  demoTextIn,
  isDemoLocalizedText,
  type DemoLocalizedText,
} from "@clockwork/testing/demo-localized-text";

import {
  formatMoney,
  type SupportedCurrency,
} from "@/src/features/shared/format";
import type { Locale, MessageId, Translator } from "@/src/i18n";

/**
 * Product-authored text inside a demo fixture, kept as a message ID and the
 * facts it takes until the demo read boundary renders it for one reader.
 *
 * A fixture record stands in for a projection row, and a row's status label,
 * next action, value label and date line are text the product writes, not
 * text a person typed (translation policy rule 3). Writing them as English
 * strings is what left the demo half English in every other language. A
 * `DemoMessage` names the message and carries its values as facts: an amount
 * as minor units and a currency, a date as an ISO calendar date, a duration as
 * a number and a unit. `resolveDemoContent` formats each fact in the reader's
 * formatting locale and only then places it into the message, so the word
 * order is the translator's and the digits are the reader's.
 *
 * Every shape here is plain JSON. A demo action that writes a status label
 * into the demo state store therefore persists the message and its facts, not
 * one reader's rendering of it, and the next reader in another language sees
 * their own. Demo-authored prose that stands in for user-entered content uses
 * `demoText` instead (policy rule 4); both resolve in the same pass.
 */

const messageMarker = "$demoMessage";

/** A fact placed into a message; formatted for the reader at the boundary. */
export type DemoFact =
  | { readonly $money: string; readonly currency: SupportedCurrency }
  | { readonly $date: string }
  | { readonly $day: string }
  | { readonly $month: string }
  | { readonly $dateRange: readonly [string, string] }
  | { readonly $ago: number; readonly unit: "minute" | "hour" | "day" }
  | { readonly $percent: number }
  | { readonly $terabytes: number };

export type DemoValue =
  string | number | DemoFact | DemoMessage | DemoLocalizedText;

export interface DemoMessage {
  readonly [messageMarker]: MessageId;
  readonly values?: Readonly<Record<string, DemoValue>>;
}

/** A message the read boundary renders with the reader's translator. */
export function demoMessage(
  id: MessageId,
  values?: Readonly<Record<string, DemoValue>>,
): DemoMessage {
  return values ? { [messageMarker]: id, values } : { [messageMarker]: id };
}

/** Integer minor units in the record's currency. */
export function money(minor: string, currency: SupportedCurrency): DemoFact {
  return { $money: minor, currency };
}

/** A calendar date with its year (`2026-08-28`, or a full ISO instant). */
export function onDate(iso: string): DemoFact {
  return { $date: iso };
}

/** A calendar date shown as month and day, where the year is evident. */
export function onDay(iso: string): DemoFact {
  return { $day: iso };
}

/** A calendar month with its year (`2026-07`). */
export function inMonth(isoMonth: string): DemoFact {
  return { $month: isoMonth };
}

/** An inclusive range of calendar dates. */
export function dateRange(start: string, end: string): DemoFact {
  return { $dateRange: [start, end] };
}

/** A fixed age, for fixtures that show how long ago something happened. */
export function ago(amount: number, unit: "minute" | "hour" | "day"): DemoFact {
  return { $ago: amount, unit };
}

/** A share, as a fraction (0.62 renders as 62 %). */
export function percent(fraction: number): DemoFact {
  return { $percent: fraction };
}

/** A storage quantity in terabytes. */
export function terabytes(amount: number): DemoFact {
  return { $terabytes: amount };
}

export function isDemoMessage(value: unknown): value is DemoMessage {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>)[messageMarker] === "string"
  );
}

/** Who a demo record is being rendered for. */
export interface DemoReader {
  /** The interface language. */
  readonly locale: Locale;
  /** The tag numbers and dates are formatted with (`formattingLocales`). */
  readonly formatting: string;
  readonly t: Translator;
}

function calendarDate(iso: string): Date {
  return new Date(/^\d{4}-\d{2}-\d{2}$/u.test(iso) ? `${iso}T00:00:00Z` : iso);
}

/** Formats one fact for the reader. Calendar facts are read in UTC. */
export function formatDemoFact(fact: DemoFact, formatting: string): string {
  if ("$money" in fact)
    return formatMoney(fact.$money, fact.currency, formatting);
  if ("$date" in fact)
    return new Intl.DateTimeFormat(formatting, {
      dateStyle: "medium",
      timeZone: "UTC",
    }).format(calendarDate(fact.$date));
  if ("$day" in fact)
    return new Intl.DateTimeFormat(formatting, {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(calendarDate(fact.$day));
  if ("$month" in fact)
    return new Intl.DateTimeFormat(formatting, {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(calendarDate(`${fact.$month}-01`));
  if ("$dateRange" in fact)
    return new Intl.DateTimeFormat(formatting, {
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }).formatRange(
      calendarDate(fact.$dateRange[0]),
      calendarDate(fact.$dateRange[1]),
    );
  if ("$ago" in fact)
    return new Intl.RelativeTimeFormat(formatting, { numeric: "auto" }).format(
      -fact.$ago,
      fact.unit,
    );
  if ("$percent" in fact)
    return new Intl.NumberFormat(formatting, {
      style: "percent",
      maximumFractionDigits: 1,
    }).format(fact.$percent);
  return new Intl.NumberFormat(formatting, {
    style: "unit",
    unit: "terabyte",
  }).format(fact.$terabytes);
}

const factKeys = [
  "$money",
  "$date",
  "$day",
  "$month",
  "$dateRange",
  "$ago",
  "$percent",
  "$terabytes",
] as const;

function isDemoFact(value: unknown): value is DemoFact {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    factKeys.some((key) => Object.hasOwn(value, key))
  );
}

function valueText(value: DemoValue, reader: DemoReader): string | number {
  if (typeof value === "string" || typeof value === "number") return value;
  if (isDemoMessage(value)) return renderDemoMessage(value, reader);
  if (isDemoLocalizedText(value)) return demoTextIn(value, reader.locale);
  return formatDemoFact(value, reader.formatting);
}

export function renderDemoMessage(
  message: DemoMessage,
  reader: DemoReader,
): string {
  const values: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(message.values ?? {}))
    values[key] = valueText(value, reader);
  return reader.t(message[messageMarker], values);
}

/**
 * Renders every demo message, fact and demo-authored text inside `value` for
 * one reader. Deep over plain objects and arrays; everything else, including
 * record facts such as `authoritative` dates and minor units, passes through
 * unchanged. Only the demo read boundary calls this.
 */
export function resolveDemoContent<T>(value: T, reader: DemoReader): T {
  const visit = (current: unknown): unknown => {
    if (isDemoMessage(current)) return renderDemoMessage(current, reader);
    if (isDemoLocalizedText(current)) return demoTextIn(current, reader.locale);
    if (isDemoFact(current)) return formatDemoFact(current, reader.formatting);
    if (Array.isArray(current)) return current.map(visit);
    if (current && typeof current === "object") {
      const prototype = Object.getPrototypeOf(current) as unknown;
      if (prototype !== Object.prototype && prototype !== null) return current;
      return Object.fromEntries(
        Object.entries(current).map(([key, entry]) => [key, visit(entry)]),
      );
    }
    return current;
  };
  return visit(value) as T;
}
