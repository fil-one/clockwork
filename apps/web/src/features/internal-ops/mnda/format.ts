/** A calendar date in the reader's language. Date-only values are read as UTC
 * so "2026-10-02" never shows as October 1 west of Greenwich. */
export function formatMndaDate(value: string, locale: string): string {
  const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    ...(value.length === 10 ? { timeZone: "UTC" } : {}),
  }).format(date);
}
