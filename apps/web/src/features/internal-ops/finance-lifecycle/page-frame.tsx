import type { ReactNode } from "react";

import { lifecycleCopy } from "./copy";
import type { SurfaceProvenance } from "./provenance";
import { formatOperationalTimestamp } from "../presentation";
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
            : lifecycleCopy.projectionCurrent}
        </strong>
        <span>
          Updated{" "}
          <time dateTime={provenance.generatedAt}>
            {formatOperationalTimestamp(provenance.generatedAt)}
          </time>
        </span>
      </div>
    );
  if (provenance.kind === "read")
    return (
      <div className={styles.freshness} aria-label={lifecycleCopy.provenance}>
        <strong>{lifecycleCopy.readAtLoad}</strong>
        <span>
          Updated{" "}
          <time dateTime={provenance.readAt}>
            {formatOperationalTimestamp(provenance.readAt)}
          </time>
        </span>
      </div>
    );
  if (provenance.kind === "guided")
    return (
      <div className={styles.freshness} aria-label={lifecycleCopy.provenance}>
        <strong>Guided demo workspace</strong>
        <span>Changes can be reset from Demo controls.</span>
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
        <span>Refresh the page or try again shortly.</span>
      </div>
    );
  return (
    <div
      className={styles.freshness}
      aria-label={lifecycleCopy.provenance}
      role="alert"
    >
      <strong>{lifecycleCopy.notWired}</strong>
      <span>This workflow is not enabled for the current environment.</span>
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
