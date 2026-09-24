import { StatusBadge, Table } from "@clockwork/ui";

import { SurfaceActionGate } from "@/src/features/shell/permission-gate";

import styles from "../finance-lifecycle/finance-lifecycle.module.css";
import { FinancePageFrame } from "../finance-lifecycle/page-frame";
import {
  formatCalendarRange,
  formatCount,
  formatMinorAmount,
} from "../finance-lifecycle/projection-fields";
import { use } from "react";

import type { Translator } from "@/src/i18n";
import { getFormattingLocale, getTranslations } from "@/src/i18n/server";

import { formatOperationalTimestamp } from "../presentation";
import { reconciliationCopy } from "./copy";
import {
  blockingVariances,
  untiedPeriods,
  type ReconciliationVariance,
  type ReconciliationWorkspace,
} from "./model";
import { VarianceDisposition } from "./variance-disposition";

const { page, summary, unreadable, periods, variances } = reconciliationCopy;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/**
 * A UUID is shortened to its first block, as the operator surfaces do
 * elsewhere; a human reference such as `INV-2026-0781` is shown whole, since
 * cutting it to eight characters names a different record.
 */
function shortId(id: string): string {
  return UUID.test(id) ? id.slice(0, 8) : id;
}

/** "Invoice 5f0c21ab": the case's object, named in the reader's language. */
function subjectText(t: Translator, variance: ReconciliationVariance): string {
  const kind = reconciliationCopy.objectTypes[variance.objectType];
  return t(variances.subject, {
    kind: kind ? t(kind) : variance.objectType,
    id: shortId(variance.objectId),
  });
}

/** `YYYY-MM` as the reader's language names the month. */
function monthText(period: string, locale: string): string {
  const date = new Date(`${period}-01T00:00:00.000Z`);
  return Number.isNaN(date.getTime())
    ? period
    : new Intl.DateTimeFormat(locale, {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }).format(date);
}

export function ReconciliationView({
  workspace,
  now = new Date(),
}: {
  workspace: ReconciliationWorkspace;
  now?: Date;
}) {
  const { readable, source } = workspace;
  const t = use(getTranslations());
  const formattingLocale = use(getFormattingLocale());
  const untied = untiedPeriods(workspace.periods);
  const blocking = blockingVariances(workspace.variances);
  const money = (minor: string, currency: string) =>
    formatMinorAmount(minor, currency, formattingLocale);

  return (
    <FinancePageFrame
      title={t(page.title)}
      description={t(page.description)}
      provenance={
        readable
          ? { kind: "read", source, readAt: now.toISOString() }
          : { kind: "unreadable", source }
      }
    >
      <section className={styles.summaryGrid} aria-label={t(summary.label)}>
        <article className={styles.summaryCard}>
          <p>{t(summary.periods.title)}</p>
          <strong>
            {formatCount(workspace.periods.length, formattingLocale)}
          </strong>
          <span>{t(summary.periods.detail)}</span>
        </article>
        <article className={styles.summaryCard}>
          <p>{t(summary.untied.title)}</p>
          <strong>{formatCount(untied.length, formattingLocale)}</strong>
          <span>{t(summary.untied.detail)}</span>
        </article>
        <article className={styles.summaryCard}>
          <p>{t(summary.blocking.title)}</p>
          <strong>{formatCount(blocking.length, formattingLocale)}</strong>
          <span>{t(summary.blocking.detail)}</span>
        </article>
      </section>

      {readable ? null : (
        <div className={styles.warningNotice} role="alert">
          <strong>{t(unreadable.title)}</strong>
          <span>{t(unreadable.detail)}</span>
        </div>
      )}

      <section className={styles.section} aria-labelledby="tie-out-periods">
        <header className={styles.sectionHeader}>
          <div>
            <h2 id="tie-out-periods">{t(periods.heading)}</h2>
            <p>{t(periods.subheading)}</p>
          </div>
          <span className={styles.sectionMeta}>
            {t(periods.count, { count: workspace.periods.length })}
          </span>
        </header>
        {workspace.periods.length === 0 && readable ? (
          <p className={styles.empty}>{t(periods.empty)}</p>
        ) : (
          <Table
            className={styles.dsTable ?? ""}
            caption={t(periods.caption)}
            captionHidden
            density="compact"
            headers={[
              t(periods.columns.period),
              t(periods.columns.currency),
              t(periods.columns.platform),
              t(periods.columns.billing),
              t(periods.columns.accounting),
              t(periods.columns.variance),
              t(periods.columns.state),
            ]}
            numericColumns={[2, 3, 4, 5]}
            rowKeys={workspace.periods.map((period) => period.id)}
            rows={workspace.periods.map((period) => [
              formatCalendarRange(
                period.periodStartsOn,
                period.periodEndsOn,
                formattingLocale,
              ) ?? `${period.periodStartsOn} – ${period.periodEndsOn}`,
              period.currency,
              money(period.platformRevenueMinor, period.currency),
              money(period.billingProviderRevenueMinor, period.currency),
              money(period.accountingRevenueMinor, period.currency),
              <div className={styles.primaryCell}>
                <strong>
                  {money(period.billingProviderVarianceMinor, period.currency)}
                </strong>
                <span className={styles.secondary}>
                  {t(periods.ledgerVariance, {
                    amount: money(
                      period.accountingVarianceMinor,
                      period.currency,
                    ),
                  })}
                </span>
              </div>,
              <StatusBadge
                tone={period.mathematicallyTied ? "success" : "danger"}
              >
                {t(period.mathematicallyTied ? periods.tied : periods.untied)}
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
            <h2 id="reconciliation-variances">{t(variances.heading)}</h2>
            <p>{t(variances.subheading)}</p>
          </div>
          <span className={styles.sectionMeta}>
            {t(variances.count, { count: workspace.variances.length })}
          </span>
        </header>
        {workspace.variances.length === 0 && readable ? (
          <p className={styles.empty}>{t(variances.empty)}</p>
        ) : (
          <Table
            className={styles.dsTable ?? ""}
            caption={t(variances.caption)}
            captionHidden
            density="compact"
            headers={[
              t(variances.columns.subject),
              t(variances.columns.owner),
              t(variances.columns.opened),
              t(variances.columns.target),
              t(variances.columns.classification),
              t(variances.columns.action),
            ]}
            rowKeys={workspace.variances.map((variance) => variance.caseId)}
            rows={workspace.variances.map((variance) => [
              <div className={styles.primaryCell}>
                <strong>{subjectText(t, variance)}</strong>
                <span className={styles.secondary}>
                  {t(variances.caseId, { id: shortId(variance.caseId) })}
                </span>
              </div>,
              variance.ownerEmail ?? shortId(variance.ownerUserId),
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
                    {t(
                      reconciliationCopy.classifications[
                        variance.latestClassification
                      ],
                    )}
                  </strong>
                  <span className={styles.secondary}>
                    {variance.expectedClearingPeriod
                      ? t(variances.clearing, {
                          period: monthText(
                            variance.expectedClearingPeriod,
                            formattingLocale,
                          ),
                        })
                      : (variance.latestClassificationReason ?? "")}
                  </span>
                </div>
              ) : (
                <StatusBadge tone="warning">
                  {t(variances.unclassified)}
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
                    subject={subjectText(t, variance)}
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
