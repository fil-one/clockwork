"use client";
import { useTranslations } from "@/src/i18n/client";

import { localizeCopy } from "@/src/i18n/copy";
import type { ReactNode } from "react";

import { lifecycleCopy } from "./copy";
import type { SurfaceProvenance } from "./provenance";
import { formatOperationalTimestamp } from "../presentation";
import styles from "./finance-lifecycle.module.css";

export type { SurfaceProvenance };

function ProvenanceLine({ provenance }: { provenance: SurfaceProvenance }) {
  const t = useTranslations();
  const localizedlifecycleCopy = localizeCopy(lifecycleCopy, t);
  if (provenance.kind === "projection")
    return (
      <div
        className={styles.freshness}
        aria-label={localizedlifecycleCopy.provenance}
        role={provenance.stale ? "alert" : "status"}
      >
        <strong>
          {provenance.stale
            ? localizedlifecycleCopy.projectionStale
            : localizedlifecycleCopy.projectionCurrent}
        </strong>
        <span>
          {t("ui.9")}{" "}
          <time dateTime={provenance.generatedAt}>
            {formatOperationalTimestamp(provenance.generatedAt)}
          </time>
        </span>
      </div>
    );
  if (provenance.kind === "read")
    return (
      <div
        className={styles.freshness}
        aria-label={localizedlifecycleCopy.provenance}
      >
        <strong>{localizedlifecycleCopy.readAtLoad}</strong>
        <span>
          {t("ui.9")}{" "}
          <time dateTime={provenance.readAt}>
            {formatOperationalTimestamp(provenance.readAt)}
          </time>
        </span>
      </div>
    );
  if (provenance.kind === "guided")
    return (
      <div
        className={styles.freshness}
        aria-label={localizedlifecycleCopy.provenance}
      >
        <strong>Guided demo workspace</strong>
        <span>Changes can be reset from Demo controls.</span>
      </div>
    );
  if (provenance.kind === "unreadable")
    return (
      <div
        className={styles.freshness}
        aria-label={localizedlifecycleCopy.provenance}
        role="alert"
      >
        <strong>{localizedlifecycleCopy.readFailed}</strong>
        <span>Refresh the page or try again shortly.</span>
      </div>
    );
  return (
    <div
      className={styles.freshness}
      aria-label={localizedlifecycleCopy.provenance}
      role="alert"
    >
      <strong>{localizedlifecycleCopy.notWired}</strong>
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
  const t = useTranslations();
  const localizedlifecycleCopy = localizeCopy(lifecycleCopy, t);
  return (
    <main className={styles.page} id="main-content">
      <header className={styles.header}>
        <div className={styles.headerCopy}>
          <p className={styles.eyebrow}>{localizedlifecycleCopy.eyebrow}</p>
          <h1 className={styles.title}>{title}</h1>
          <p className={styles.description}>{description}</p>
        </div>
        <ProvenanceLine provenance={provenance} />
      </header>
      {children}
    </main>
  );
}
