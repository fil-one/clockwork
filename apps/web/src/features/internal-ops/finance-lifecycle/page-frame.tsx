import type { ReactNode } from "react";

import { plural } from "@/src/i18n/en";

import { lifecycleCopy } from "./copy";
import type { SurfaceProvenance } from "./provenance";
import styles from "./finance-lifecycle.module.css";

export type { SurfaceProvenance };

function ProvenanceLine({ provenance }: { provenance: SurfaceProvenance }) {
  if (provenance.kind === "projection")
    return (
      <div
        className={styles.freshness}
        aria-label={lifecycleCopy.provenance}
        role={provenance.stale ? "alert" : "status"}
      >
        <strong>
          {provenance.stale
            ? lifecycleCopy.projectionStale
            : lifecycleCopy.projectionCurrent}{" "}
          <time dateTime={provenance.generatedAt}>
            {provenance.generatedAt}
          </time>
        </strong>
        {lifecycleCopy.sourcePrefix} internal {provenance.channel} channel ·{" "}
        {plural(
          provenance.pagesRead,
          "{count} server page",
          "{count} server pages",
        )}{" "}
        · {plural(provenance.recordCount, "{count} record", "{count} records")}
      </div>
    );
  if (provenance.kind === "read")
    return (
      <div className={styles.freshness} aria-label={lifecycleCopy.provenance}>
        <strong>
          {lifecycleCopy.readAtLoad}{" "}
          <time dateTime={provenance.readAt}>{provenance.readAt}</time>
        </strong>
        {lifecycleCopy.sourcePrefix} {provenance.source}
      </div>
    );
  if (provenance.kind === "unreadable")
    return (
      <div
        className={styles.freshness}
        aria-label={lifecycleCopy.provenance}
        role="alert"
      >
        <strong>{lifecycleCopy.readFailed}</strong>
        {lifecycleCopy.sourcePrefix} {provenance.source}
      </div>
    );
  return (
    <div
      className={styles.freshness}
      aria-label={lifecycleCopy.provenance}
      role="alert"
    >
      <strong>{lifecycleCopy.notWired}</strong>
      {provenance.detail}
    </div>
  );
}

/**
 * Presentation only. Permission is resolved by the route before this frame is
 * reached: two of these surfaces are client components, and a gate that resolves
 * the session cannot run inside a client component graph.
 */
export function FinancePageFrame({
  title,
  description,
  provenance,
  children,
}: {
  title: string;
  description: string;
  provenance: SurfaceProvenance;
  children: ReactNode;
}) {
  return (
    <main className={styles.page} id="main-content">
      <header className={styles.header}>
        <div className={styles.headerCopy}>
          <p className={styles.eyebrow}>{lifecycleCopy.eyebrow}</p>
          <h1 className={styles.title}>{title}</h1>
          <p className={styles.description}>{description}</p>
        </div>
        <ProvenanceLine provenance={provenance} />
      </header>
      {children}
    </main>
  );
}
