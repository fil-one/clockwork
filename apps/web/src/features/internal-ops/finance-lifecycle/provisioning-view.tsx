import type { ReactNode } from "react";
import { getTranslations } from "@/src/i18n/server";
import { use } from "react";
import { localizeCopy } from "@/src/i18n/copy";
import Link from "next/link";

import { StatusBadge, Table } from "@clockwork/ui";

import { plural } from "@/src/i18n/en";

import { lifecycleCopy } from "./copy";
import {
  summarizeProvisioningWork,
  type ProvisioningWork,
} from "./provisioning-projection";
import { FinancePageFrame } from "./page-frame";
import type { SurfaceProvenance } from "./provenance";
import styles from "./finance-lifecycle.module.css";

const copy = lifecycleCopy.provisioning;

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
  const localizedcopy = localizeCopy(copy, t);
  const summary = summarizeProvisioningWork(work);

  return (
    <FinancePageFrame
      title={localizedcopy.title}
      description={localizedcopy.description}
      provenance={provenance}
    >
      {children}
      <section
        className={styles.summaryGrid}
        aria-label="Provisioning work by kind"
      >
        <article className={styles.summaryCard}>
          <p>{localizedcopy.providerOperations}</p>
          <strong>{summary.providerOperations}</strong>
          <span>Provider calls the platform is driving to completion</span>
        </article>
        <article className={styles.summaryCard}>
          <p>{localizedcopy.terminations}</p>
          <strong>{summary.terminations}</strong>
          <span>Services ending, with their teardown and final billing</span>
        </article>
        <article className={styles.summaryCard}>
          <p>{localizedcopy.highRisk}</p>
          <strong>{summary.highRisk}</strong>
          <span>Items that need immediate operator attention</span>
        </article>
      </section>

      <div className={styles.warningNotice} role="note">
        <strong>{localizedcopy.retryTitle}</strong>
        <span>{localizedcopy.retryBody}</span>
        <Link href="/internal/recovery">{localizedcopy.recoveryLink}</Link>
      </div>

      {summary.unclassified > 0 ? (
        <div className={styles.notice} role="note">
          <strong>{localizedcopy.unclassified(summary.unclassified)}</strong>
        </div>
      ) : null}

      <section className={styles.section} aria-labelledby="recovery-table">
        <header className={styles.sectionHeader}>
          <div>
            <h2 id="recovery-table">{localizedcopy.tableHeading}</h2>
            <p>{localizedcopy.description}</p>
          </div>
          <span className={styles.sectionMeta}>
            {plural(work.length, "{count} record", "{count} records")}
          </span>
        </header>
        {work.length === 0 ? (
          <p className={styles.empty}>{localizedcopy.empty}</p>
        ) : (
          <Table
            className={styles.dsTable ?? ""}
            caption={localizedcopy.caption}
            captionHidden
            density="compact"
            headers={[
              "Record",
              "Kind",
              "Provider",
              localizedcopy.attemptsLabel,
              "Status",
              "Next action",
            ]}
            numericColumns={[3]}
            rowKeys={work.map((item) => item.id)}
            rows={work.map((item) => [
              <div className={styles.primaryCell}>
                <strong>{item.title}</strong>
                <span className={styles.secondary}>{item.reference}</span>
                <details className={styles.disclosure}>
                  <summary>Technical evidence</summary>
                  <p className={styles.id}>{item.aggregateId}</p>
                  {item.evidence.map((entry) => (
                    <p key={`${entry.label}-${entry.value}`}>
                      {entry.label}: {entry.value}
                    </p>
                  ))}
                </details>
              </div>,
              item.kindLabel,
              item.provider ?? "Not recorded",
              item.attemptCount === null ? (
                localizedcopy.noAttempts
              ) : (
                <strong>{item.attemptCount}</strong>
              ),
              <>
                <StatusBadge tone={riskTone(item)}>
                  {item.statusLabel}
                </StatusBadge>
                <div className={styles.secondary}>
                  {item.nextAttemptLabel ?? item.description ?? ""}
                </div>
              </>,
              item.nextAction ?? "Not recorded",
            ])}
          />
        )}
      </section>
    </FinancePageFrame>
  );
}
