import type { ReactNode } from "react";
import { getFormattingLocale, getTranslations } from "@/src/i18n/server";
import { use } from "react";
import Link from "next/link";

import { StatusBadge, Table } from "@clockwork/ui";

import { lifecycleCopy } from "./copy";
import {
  summarizeProvisioningWork,
  type ProvisioningKind,
  type ProvisioningWork,
} from "./provisioning-projection";
import { FinancePageFrame, IdentifierLine, RecordEvidence } from "./page-frame";
import {
  formatCalendarDay,
  formatCount,
  statusText,
} from "./projection-fields";
import type { SurfaceProvenance } from "./provenance";
import styles from "./finance-lifecycle.module.css";

const copy = lifecycleCopy.provisioning;

const kindLabels = {
  provider_operation: copy.kinds.providerOperation,
  termination: copy.kinds.termination,
} as const satisfies Readonly<Record<ProvisioningKind, string>>;

function riskTone(
  work: ProvisioningWork,
): "neutral" | "warning" | "danger" | "success" {
  if (work.risk === "high") return "danger";
  if (work.risk === "medium") return "warning";
  if (work.status === "complete") return "success";
  return "neutral";
}

export function ProvisioningView({
  work,
  provenance,
  children,
}: {
  children?: ReactNode;
  work: readonly ProvisioningWork[];
  provenance: SurfaceProvenance;
}) {
  const t = use(getTranslations());
  const locale = use(getFormattingLocale());
  const summary = summarizeProvisioningWork(work);

  /** The timing that matters for this kind of work, from its own dates. */
  function timing(item: ProvisioningWork): string {
    if (item.kind === "provider_operation") {
      const next = formatCalendarDay(item.nextAttemptAt, locale);
      return next ? t(copy.nextAttempt, { date: next }) : t(copy.noRetry);
    }
    if (item.kind === "termination") {
      const ends = formatCalendarDay(item.effectiveAt, locale);
      return ends ? t(copy.endsOn, { date: ends }) : "";
    }
    return item.description ?? "";
  }

  return (
    <FinancePageFrame
      title={t(copy.title)}
      description={t(copy.description)}
      provenance={provenance}
    >
      {children}
      <section className={styles.summaryGrid} aria-label={t(copy.summaryLabel)}>
        <article className={styles.summaryCard}>
          <p>{t(copy.providerOperations)}</p>
          <strong>{formatCount(summary.providerOperations, locale)}</strong>
          <span>{t(copy.providerOperationsDetail)}</span>
        </article>
        <article className={styles.summaryCard}>
          <p>{t(copy.terminations)}</p>
          <strong>{formatCount(summary.terminations, locale)}</strong>
          <span>{t(copy.terminationsDetail)}</span>
        </article>
        <article className={styles.summaryCard}>
          <p>{t("risk.chip.high")}</p>
          <strong>{formatCount(summary.highRisk, locale)}</strong>
          <span>{t(copy.highRiskDetail)}</span>
        </article>
      </section>

      <div className={styles.warningNotice} role="note">
        <strong>{t(copy.retryTitle)}</strong>
        <span>{t(copy.retryBody)}</span>
        <Link href="/internal/recovery">{t(copy.recoveryLink)}</Link>
      </div>

      {summary.unclassified > 0 ? (
        <div className={styles.notice} role="note">
          <strong>
            {t(copy.unclassified, { count: summary.unclassified })}
          </strong>
        </div>
      ) : null}

      <section className={styles.section} aria-labelledby="recovery-table">
        <header className={styles.sectionHeader}>
          <div>
            <h2 id="recovery-table">{t(copy.tableHeading)}</h2>
            <p>{t(copy.description)}</p>
          </div>
          <span className={styles.sectionMeta}>
            {t(copy.recordCount, { count: work.length })}
          </span>
        </header>
        {work.length === 0 ? (
          <p className={styles.empty}>{t(copy.empty)}</p>
        ) : (
          <Table
            className={styles.dsTable ?? ""}
            caption={t(copy.caption)}
            captionHidden
            density="compact"
            headers={[
              t(copy.columns.record),
              t(copy.columns.kind),
              t(copy.columns.provider),
              t(copy.columns.attempts),
              t("common.status"),
              t("common.nextAction"),
            ]}
            numericColumns={[3]}
            rowKeys={work.map((item) => item.id)}
            rows={work.map((item) => [
              <div className={styles.primaryCell}>
                <strong>{item.title}</strong>
                <span className={styles.secondary}>{item.reference}</span>
                <details className={styles.disclosure}>
                  <summary>{t(lifecycleCopy.evidence.technical)}</summary>
                  <IdentifierLine
                    label={lifecycleCopy.evidence.recordId}
                    value={item.aggregateId}
                  />
                  <RecordEvidence
                    entries={item.evidence}
                    version={item.version}
                    updatedAt={item.updatedAt}
                  />
                </details>
              </div>,
              t(item.kind ? kindLabels[item.kind] : copy.kinds.unclassified),
              item.provider ?? t("common.notRecorded"),
              item.attemptCount === null ? (
                t(copy.noAttempts)
              ) : (
                <strong>{formatCount(item.attemptCount, locale)}</strong>
              ),
              <>
                <StatusBadge tone={riskTone(item)}>
                  {statusText(t, [item.status], item.statusLabel)}
                </StatusBadge>
                <div className={styles.secondary}>{timing(item)}</div>
              </>,
              item.nextAction ?? t("common.notRecorded"),
            ])}
          />
        )}
      </section>
    </FinancePageFrame>
  );
}
