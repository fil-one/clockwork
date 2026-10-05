/**
 * Product-facing timestamp used across operator surfaces.
 *
 * Staff surfaces render through `LocalTimestamp`, which passes the reader's
 * own time zone; UTC is the fallback for the first server render, before the
 * browser has said where the reader is. The zone is always named, so a time
 * is never read as local when it is not.
 *
 * An instant that does not parse is shown as a dash. It used to read
 * "Recently", which claimed a freshness nothing had measured, and in English
 * to every reader whatever their language.
 */
export function formatOperationalTimestamp(
  value: string,
  /** The reader's formatting locale; there is deliberately no default. */
  locale: string,
  /** IANA zone to convert to and label with. */
  timeZone = "UTC",
): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return "—";
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
    timeZoneName: "short",
  }).format(parsed);
}
