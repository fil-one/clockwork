import { StatusBadge, Table } from "@clockwork/ui";

import { SurfaceActionGate } from "@/src/features/shell/permission-gate";

import styles from "../finance-lifecycle/finance-lifecycle.module.css";
import { FinancePageFrame } from "../finance-lifecycle/page-frame";
import { use } from "react";

import { getFormattingLocale } from "@/src/i18n/server";

import { formatOperationalTimestamp } from "../presentation";
import { reconciliationCopy } from "./copy";
import {
  blockingVariances,
  formatMinor,
  untiedPeriods,
  varianceClassificationLabels,
  type ReconciliationWorkspace,
} from "./model";
import { VarianceDisposition } from "./variance-disposition";

const { page, summary, unreadable, periods, variances } = reconciliationCopy;

export function ReconciliationView({
  workspace,
  now = new Date(),
}: {
  workspace: ReconciliationWorkspace;
  now?: Date;
}) {
  const { readable, source } = workspace;
  const formattingLocale = use(getFormattingLocale());
  const untied = untiedPeriods(workspace.periods);
  const blocking = blockingVariances(workspace.variances);

  return (
    <FinancePageFrame
      title={page.title}
      description={page.description}
      provenance={
        readable
          ? { kind: "read", source, readAt: now.toISOString() }
          : { kind: "unreadable", source }
      }
    >
      <section className={styles.summaryGrid} aria-label={summary.label}>
        <article className={styles.summaryCard}>
          <p>{summary.periods.title}</p>
          <strong>{workspace.periods.length}</strong>
          <span>{summary.periods.detail}</span>
        </article>
        <article className={styles.summaryCard}>
          <p>{summary.untied.title}</p>
          <strong>{untied.length}</strong>
          <span>{summary.untied.detail}</span>
        </article>
        <article className={styles.summaryCard}>
          <p>{summary.blocking.title}</p>
          <strong>{blocking.length}</strong>
          <span>{summary.blocking.detail}</span>
        </article>
      </section>

      {readable ? null : (
        <div className={styles.warningNotice} role="alert">
          <strong>{unreadable.title}</strong>
          <span>{unreadable.detail}</span>
        </div>
      )}

      <section className={styles.section} aria-labelledby="tie-out-periods">
        <header className={styles.sectionHeader}>
          <div>
            <h2 id="tie-out-periods">{periods.heading}</h2>
            <p>{periods.subheading}</p>
          </div>
          <span className={styles.sectionMeta}>
            {periods.count(workspace.periods.length)}
          </span>
        </header>
        {workspace.periods.length === 0 && readable ? (
          <p className={styles.empty}>{periods.empty}</p>
        ) : (
          <Table
            className={styles.dsTable ?? ""}
            caption={periods.caption}
            captionHidden
            density="compact"
            headers={[
              periods.columns.period,
              periods.columns.currency,
              periods.columns.platform,
              periods.columns.billing,
              periods.columns.accounting,
              periods.columns.variance,
              periods.columns.state,
            ]}
            numericColumns={[2, 3, 4, 5]}
            rowKeys={workspace.periods.map((period) => period.id)}
            rows={workspace.periods.map((period) => [
              `${period.periodStartsOn} to ${period.periodEndsOn}`,
              period.currency,
              formatMinor(period.platformRevenueMinor, period.currency),
              formatMinor(period.billingProviderRevenueMinor, period.currency),
              formatMinor(period.accountingRevenueMinor, period.currency),
              <div className={styles.primaryCell}>
                <strong>
                  {formatMinor(
                    period.billingProviderVarianceMinor,
                    period.currency,
                  )}
                </strong>
                <span className={styles.secondary}>
                  ledger{" "}
                  {formatMinor(period.accountingVarianceMinor, period.currency)}
                </span>
              </div>,
              <StatusBadge
                tone={period.mathematicallyTied ? "success" : "danger"}
              >
                {period.mathematicallyTied ? periods.tied : periods.untied}
              </StatusBadge>,
            ])}
          />
        )}
      </section>

      <section
        className={styles.section}
        aria-labelledby="reconciliation-variances"
      >
        <header className={styles.sectionHeader}>
          <div>
            <h2 id="reconciliation-variances">{variances.heading}</h2>
            <p>{variances.subheading}</p>
          </div>
          <span className={styles.sectionMeta}>
            {variances.count(workspace.variances.length)}
          </span>
        </header>
        {workspace.variances.length === 0 && readable ? (
          <p className={styles.empty}>{variances.empty}</p>
        ) : (
          <Table
            className={styles.dsTable ?? ""}
            caption={variances.caption}
            captionHidden
            density="compact"
            headers={[
              variances.columns.subject,
              variances.columns.owner,
              variances.columns.opened,
              variances.columns.target,
              variances.columns.classification,
              variances.columns.action,
            ]}
            rowKeys={workspace.variances.map((variance) => variance.caseId)}
            rows={workspace.variances.map((variance) => [
              <div className={styles.primaryCell}>
                <strong>
                  {variance.objectType} {variance.objectId.slice(0, 8)}
                </strong>
                <span className={styles.secondary}>
                  case {variance.caseId.slice(0, 8)}
                </span>
              </div>,
              variance.ownerEmail ?? variance.ownerUserId.slice(0, 8),
              <time dateTime={variance.openedAt}>
                {formatOperationalTimestamp(
                  variance.openedAt,
                  formattingLocale,
                )}
              </time>,
              <time dateTime={variance.targetAt}>
                {formatOperationalTimestamp(
                  variance.targetAt,
                  formattingLocale,
                )}
              </time>,
              variance.latestClassification ? (
                <div className={styles.primaryCell}>
                  <strong>
                    {
                      varianceClassificationLabels[
                        variance.latestClassification
                      ]
                    }
                  </strong>
                  <span className={styles.secondary}>
                    {variance.expectedClearingPeriod
                      ? variances.clearing(variance.expectedClearingPeriod)
                      : (variance.latestClassificationReason ?? "")}
                  </span>
                </div>
              ) : (
                <StatusBadge tone="warning">
                  {variances.unclassified}
                </StatusBadge>
              ),
              <div className={styles.actionStack}>
                <SurfaceActionGate
                  audience="internal"
                  requiredPermission="report:read"
                >
                  <VarianceDisposition
                    caseId={variance.caseId}
                    expectedRowVersion={variance.rowVersion}
                    subject={`${variance.objectType} ${variance.objectId.slice(0, 8)}`}
                  />
                </SurfaceActionGate>
              </div>,
            ])}
          />
        )}
      </section>
    </FinancePageFrame>
  );
}
