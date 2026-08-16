import { customerPartnerCopy } from "./copy";
import { formatSurfaceTimestamp, type SurfaceFormatting } from "./formatting";
import styles from "./projection-freshness.module.css";
import { RefreshProjection } from "./refresh-projection";

const copy = customerPartnerCopy.common;

/**
 * What `loadPortalRecords` already knows about the read a surface is rendering.
 *
 * The loader has returned `stale` and `generatedAt` for as long as it has
 * existed. `/internal/queues` renders both and offers a refresh; every customer
 * and partner collection dropped them on the floor and rendered the records as
 * though they were current. An operator was told the projection had not caught
 * up; the customer looking at the same rows was not. This type is what makes
 * that impossible to do accidentally again -- the collections take it as a
 * required prop, so a new collection surface cannot be added without answering
 * the question.
 */
export interface ProjectionFreshness {
  /** ISO-8601 instant the projection page was generated at. */
  generatedAt: string;
  /** True when any record in the read is behind its source. */
  stale: boolean;
  /**
   * True when the read stopped at the loader's page ceiling.
   *
   * Distinct from `stale`, and worse. Stale means the rows may be behind their
   * source; partial means rows are *missing*, so the result count, the owner
   * and status choices in the filter panel, any total on the page, and any
   * ordering applied to it describe a prefix rather than the collection. A
   * sorted view is the sharpest case: `filterAndSortRecords` orders the whole
   * *read* set, so a list sorted by highest value renders confidently and
   * correctly ordered while the record the sort was meant to surface may be in
   * the unread tail. `loadPortalRecords` sets `stale` too on a truncated read,
   * but "may be out of date" is not what happened and a refresh is not the
   * answer, so the two are said separately.
   *
   * Required, not optional, for the same reason the collections take this
   * whole object as a required prop: it was optional while the customer
   * collection routes were still dropping the loader's `truncated` flag, and
   * every one of them shipped the generic stale banner over a cut-off ledger.
   * Now that every route passes it, a surface that cannot answer the question
   * is a surface that must not compile.
   */
  partial: boolean;
}

/**
 * The disclosure itself.
 *
 * Fresh reads get a quiet `role="status"` line, because a reader who has to
 * step over a banner on every visit stops reading banners. Stale reads get the
 * `role="alert"` treatment `/internal/queues` uses, and the same refresh
 * control, because at that point the page is asserting something it cannot
 * stand behind.
 *
 * The timestamp is always rendered in the reader's own zone with the zone
 * named, so "read at 9:04" is never ambiguous about whose nine o'clock.
 */
export function ProjectionFreshnessNotice({
  freshness,
  formatting,
  className = "",
}: {
  freshness: ProjectionFreshness;
  formatting: SurfaceFormatting;
  className?: string;
}) {
  const readAt = (
    <time dateTime={freshness.generatedAt}>
      {formatSurfaceTimestamp(freshness.generatedAt, formatting)}
    </time>
  );
  if (freshness.partial)
    return (
      <section
        className={`${styles.staleBanner} ${styles.partialBanner} ${className}`.trim()}
        role="alert"
      >
        <strong>{copy.freshnessPartialTitle}</strong>
        <span>
          {copy.freshnessPartialBody} {copy.freshnessReadAt} {readAt}
        </span>
      </section>
    );
  if (!freshness.stale)
    return (
      <p className={`${styles.freshness} ${className}`.trim()} role="status">
        <span aria-hidden="true" className={styles.dot} />
        {copy.freshnessCurrent} · {copy.freshnessReadAt} {readAt}
      </p>
    );
  return (
    <section
      className={`${styles.staleBanner} ${className}`.trim()}
      role="alert"
    >
      <strong>{copy.freshnessStaleTitle}</strong>
      <span>
        {copy.freshnessStaleBody} {copy.freshnessReadAt} {readAt}
      </span>
      <RefreshProjection label={copy.freshnessAction} />
    </section>
  );
}
