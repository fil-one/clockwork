import type { ReactNode } from "react";

import { lifecycleCopy } from "./copy";
import styles from "./finance-lifecycle.module.css";

/**
 * Presentation only. Permission is resolved by the route before this frame is
 * reached: two of these surfaces are client components, and a gate that resolves
 * the session cannot run inside a client component graph.
 */
export function FinancePageFrame({
  title,
  description,
  freshness,
  source,
  children,
}: {
  title: string;
  description: string;
  freshness: string;
  source: string;
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
        <div className={styles.freshness} aria-label={lifecycleCopy.provenance}>
          <strong>{freshness}</strong>
          {lifecycleCopy.sourcePrefix} {source}
        </div>
      </header>
      {children}
    </main>
  );
}
