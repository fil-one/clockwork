/**
 * Every timestamp a customer or partner surface renders passes through here.
 *
 * Two things were wrong with the formatting these surfaces shipped with, and
 * both are fixed in one place because they are the same mistake:
 *
 * 1. The zone was `America/New_York`, hard-coded, for every reader. The
 *    persona catalog carries a `timeZone` and a `locale` per persona --
 *    `Europe/London` and `en-GB` for the reseller and the distributor,
 *    `America/Los_Angeles` for the end client -- and none of them were read.
 * 2. The zone was not labelled. A reader in London saw a New York wall clock
 *    presented as if it were theirs, with nothing on the page to say so, which
 *    is worse than an unfamiliar zone: it is a wrong number that looks right.
 *
 * `timeZoneName` cannot be combined with `dateStyle`/`timeStyle` -- that
 * combination throws `TypeError` -- so the field set is spelled out. That is
 * the reason this helper exists rather than an inline `dateStyle` call with a
 * `timeZoneName` bolted on.
 */
export interface SurfaceFormatting {
  /** BCP-47 tag, from the acting persona where one is resolved. */
  locale: string;
  /** IANA zone, from the acting persona where one is resolved. */
  timeZone: string;
}

/**
 * An unparseable timestamp is returned verbatim rather than rendered as
 * "Invalid Date". The value reaching a surface at all means something upstream
 * produced it, and showing it is what makes that visible.
 */
export function formatSurfaceTimestamp(
  value: string,
  { locale, timeZone }: SurfaceFormatting,
): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return value;
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
    timeZoneName: "short",
  }).format(parsed);
}
