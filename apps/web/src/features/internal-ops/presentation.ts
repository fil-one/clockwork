/** Product-facing timestamp used across operator surfaces. */
export function formatOperationalTimestamp(
  value: string,
  locale = "en-US",
): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return "Recently";
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
