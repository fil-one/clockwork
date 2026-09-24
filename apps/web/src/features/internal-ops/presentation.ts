/**
 * Product-facing timestamp used across operator surfaces.
 *
 * An instant that does not parse is shown as a dash. It used to read
 * "Recently", which claimed a freshness nothing had measured, and in English
 * to every reader whatever their language.
 */
export function formatOperationalTimestamp(
  value: string,
  /** The reader's formatting locale; there is deliberately no default. */
  locale: string,
): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return "—";
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(parsed);
}
