"use client";
import type { MessageId } from "@/src/i18n";
import { useFormattingLocale, useTranslations } from "@/src/i18n/client";
import { richText } from "@/src/i18n/rich";

import type { ReactNode } from "react";

import { lifecycleCopy } from "./copy";
import type { EvidenceEntry } from "./projection-fields";
import type { SurfaceProvenance } from "./provenance";
import { formatOperationalTimestamp } from "../presentation";
import styles from "./finance-lifecycle.module.css";

export type { SurfaceProvenance };

const copy = lifecycleCopy.frame;

function ProvenanceLine({ provenance }: { provenance: SurfaceProvenance }) {
  const t = useTranslations();
  const formattingLocale = useFormattingLocale();
  const at = (instant: string) => (
    <time dateTime={instant}>
      {formatOperationalTimestamp(instant, formattingLocale)}
    </time>
  );
  if (provenance.kind === "projection")
    return (
      <div
        className={styles.freshness}
        aria-label={t(copy.provenance)}
        role={provenance.stale ? "alert" : "status"}
      >
        <strong>
          {t(provenance.stale ? copy.projectionStale : copy.projectionCurrent)}
        </strong>
        <span>
          {richText(t, "common.updatedAt", {
            time: at(provenance.generatedAt),
          })}
        </span>
      </div>
    );
  if (provenance.kind === "read")
    return (
      <div className={styles.freshness} aria-label={t(copy.provenance)}>
        <strong>{t(copy.readAtLoad)}</strong>
        <span>
          {richText(t, "common.readAt", { time: at(provenance.readAt) })}
        </span>
      </div>
    );
  if (provenance.kind === "guided")
    return (
      <div className={styles.freshness} aria-label={t(copy.provenance)}>
        <strong>{t(copy.guidedTitle)}</strong>
        <span>{t(copy.guidedDetail)}</span>
      </div>
    );
  if (provenance.kind === "unreadable")
    return (
      <div
        className={styles.freshness}
        aria-label={t(copy.provenance)}
        role="alert"
      >
        <strong>{t(copy.readFailed)}</strong>
        <span>{t(copy.readFailedDetail)}</span>
      </div>
    );
  return (
    <div
      className={styles.freshness}
      aria-label={t(copy.provenance)}
      role="alert"
    >
      <strong>{t(copy.notWired)}</strong>
      <span>{t(copy.notWiredDetail)}</span>
    </div>
  );
}

/**
 * The evidence disclosure every operator row carries: the context lines the
 * projection stated, then the identity and version the decision is taken
 * against, so two operators reading the same row agree on which revision they
 * saw. Labels and values in `entries` arrive as the read boundary supplied
 * them; the joining punctuation and the source-record sentence are this
 * surface's, in the reader's language.
 */
export function RecordEvidence({
  entries,
  version,
  updatedAt,
}: {
  entries: readonly EvidenceEntry[];
  version: number;
  updatedAt: string;
}) {
  const t = useTranslations();
  const formattingLocale = useFormattingLocale();
  return (
    <>
      {entries.map((entry) => (
        <p key={`${entry.label}-${entry.value}`}>
          {t(lifecycleCopy.evidence.entry, {
            label: entry.label,
            value: entry.value,
          })}
        </p>
      ))}
      <p>
        {richText(t, lifecycleCopy.evidence.sourceRecord, {
          version: String(version),
          time: (
            <time dateTime={updatedAt}>
              {formatOperationalTimestamp(updatedAt, formattingLocale)}
            </time>
          ),
        })}
      </p>
    </>
  );
}

/**
 * An identifier after its label ("Invoice ID: 5f0c…"), with the identifier in
 * the monospaced identity style and the label's punctuation in the reader's
 * language.
 */
export function IdentifierLine({
  label,
  value,
}: {
  /** A message with one `{id}` placeholder. */
  label: MessageId;
  value: string;
}) {
  const t = useTranslations();
  return (
    <p>
      {richText(t, label, {
        // <bdi> keeps a Latin identifier from reordering an Arabic sentence.
        id: <bdi className={styles.id}>{value}</bdi>,
      })}
    </p>
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
  return (
    <main className={styles.page} id="main-content">
      <header className={styles.header}>
        <div className={styles.headerCopy}>
          <p className={styles.eyebrow}>{t(copy.eyebrow)}</p>
          <h1 className={styles.title}>{title}</h1>
          <p className={styles.description}>{description}</p>
        </div>
        <ProvenanceLine provenance={provenance} />
      </header>
      {children}
    </main>
  );
}
