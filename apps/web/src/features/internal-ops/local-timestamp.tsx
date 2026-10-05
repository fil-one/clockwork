"use client";

import { useSyncExternalStore } from "react";

import { useFormattingLocale } from "@/src/i18n/client";

import { formatOperationalTimestamp } from "./presentation";

const noSubscription = () => () => {};

function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * The reader's IANA time zone, from the browser. The server cannot know it, so
 * the server render and hydration use UTC (named as UTC on the page) and React
 * re-renders in the reader's zone straight after.
 */
export function useReaderTimeZone(): string {
  return useSyncExternalStore(noSubscription, browserTimeZone, () => "UTC");
}

/**
 * An operational instant in the reader's own time zone, labelled with that
 * zone ("Oct 4, 2026, 7:35 PM EDT"). Hovering shows the same instant in UTC,
 * the zone staff in different places can quote to each other.
 *
 * Use this for "updated", "recorded" and deadline instants. Calendar dates with
 * a contractual or accounting meaning (invoice, notice and service-term dates)
 * are formatted in UTC by their own surfaces on purpose and do not use this.
 */
export function LocalTimestamp({
  value,
  locale: localeOverride,
  className,
}: {
  value: string;
  /** A server surface's formatting locale; defaults to the interface's. */
  locale?: string;
  className?: string;
}) {
  const interfaceLocale = useFormattingLocale();
  const locale = localeOverride ?? interfaceLocale;
  const timeZone = useReaderTimeZone();
  const local = formatOperationalTimestamp(value, locale, timeZone);
  const utc = formatOperationalTimestamp(value, locale, "UTC");
  return (
    <time
      className={className}
      dateTime={value}
      title={utc !== local ? utc : undefined}
    >
      {local}
    </time>
  );
}
