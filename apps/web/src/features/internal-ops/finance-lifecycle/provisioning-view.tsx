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
}: {
  work: readonly ProvisioningWork[];
  provenance: SurfaceProvenance;
}) {
  const summary = summarizeProvisioningWork(work);

  return (
    <FinancePageFrame
      title={copy.title}
      description={copy.description}
      provenance={provenance}
    >
      <section
        className={styles.summaryGrid}
        aria-label="Provisioning work by kind"
      >
        <article className={styles.summaryCard}>
          <p>{copy.providerOperations}</p>
          <strong>{summary.providerOperations}</strong>
          <span>Provider calls the platform is driving to completion</span>
        </article>
        <article className={styles.summaryCard}>
          <p>{copy.terminations}</p>
          <strong>{summary.terminations}</strong>
          <span>Services ending, with their teardown and final billing</span>
        </article>
        <article className={styles.summaryCard}>
          <p>{copy.highRisk}</p>
          <strong>{summary.highRisk}</strong>
          <span>Items that need immediate operator attention</span>
        </article>
      </section>

      <div className={styles.warningNotice} role="note">
        <strong>{copy.retryTitle}</strong>
        <span>{copy.retryBody}</span>
        <Link href="/internal/recovery">{copy.recoveryLink}</Link>
      </div>

      {summary.unclassified > 0 ? (
        <div className={styles.notice} role="note">
          <strong>{copy.unclassified(summary.unclassified)}</strong>
        </div>
      ) : null}

      <section className={styles.section} aria-labelledby="recovery-table">
        <header className={styles.sectionHeader}>
          <div>
            <h2 id="recovery-table">{copy.tableHeading}</h2>
            <p>{copy.description}</p>
          </div>
          <span className={styles.sectionMeta}>
            {plural(work.length, "{count} record", "{count} records")}
          </span>
        </header>
        {work.length === 0 ? (
          <p className={styles.empty}>{copy.empty}</p>
        ) : (
          <Table
            className={styles.dsTable ?? ""}
            caption={copy.caption}
            captionHidden
            density="compact"
            headers={[
              "Record",
              "Kind",
              "Provider",
              copy.attemptsLabel,
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
                copy.noAttempts
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
