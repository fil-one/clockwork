import { getFormattingLocale, getTranslations } from "@/src/i18n/server";
import { use } from "react";
import { Table } from "@clockwork/ui";

import styles from "../finance-lifecycle/finance-lifecycle.module.css";
import { FinancePageFrame } from "../finance-lifecycle/page-frame";
import {
  formatCount,
  formatMinorAmount,
  routeText,
} from "../finance-lifecycle/projection-fields";
import { revenueCopy } from "./copy";
import {
  basisLabel,
  merchantLabel,
  methodologyLabel,
  monthLabel,
  stageLabel,
  type RevenueWorkspace,
} from "./model";

export function RevenueView({
  workspace,
  now = new Date(),
}: {
  workspace: RevenueWorkspace;
  now?: Date;
}) {
  const t = use(getTranslations());
  const locale = use(getFormattingLocale());
  const copy = revenueCopy;
  const money = (minor: string, currency: string) =>
    formatMinorAmount(minor, currency, locale);
  const count = (value: number) => formatCount(value, locale);
  return (
    <FinancePageFrame
      title={t(copy.page.title)}
      description={t(copy.page.description)}
      provenance={
        workspace.readable
          ? {
              kind: "read",
              source: workspace.source,
              readAt: now.toISOString(),
            }
          : { kind: "unreadable", source: workspace.source }
      }
    >
      <section
        className={styles.summaryGrid}
        aria-label={t(copy.summary.label)}
      >
        <article className={styles.summaryCard}>
          <p>{t(copy.summary.forecast.title)}</p>
          <strong>{count(workspace.forecastRowCount)}</strong>
          <span>{t(copy.summary.forecast.detail)}</span>
        </article>
        <article className={styles.summaryCard}>
          <p>{t(copy.summary.remaining.title)}</p>
          <strong>{count(workspace.remainingBacklogRowCount)}</strong>
          <span>{t(copy.summary.remaining.detail)}</span>
        </article>
        <article className={styles.summaryCard}>
          <p>{t(copy.summary.recurring.title)}</p>
          <strong>{count(workspace.recurringContractCount)}</strong>
          <span>{t(copy.summary.recurring.detail)}</span>
        </article>
      </section>

      {workspace.readable ? null : (
        <div className={styles.warningNotice} role="alert">
          <strong>{t(copy.unreadable.title)}</strong>
          <span>{t(copy.unreadable.detail)}</span>
        </div>
      )}

      <section className={styles.section} aria-labelledby="revenue-stage">
        <header className={styles.sectionHeader}>
          <div>
            <h2 id="revenue-stage">{t(copy.stage.heading)}</h2>
            <p>{t(copy.stage.subheading)}</p>
          </div>
          <span className={styles.sectionMeta}>
            {t(copy.groups, { count: workspace.stages.length })}
          </span>
        </header>
        {workspace.stages.length === 0 && workspace.readable ? (
          <p className={styles.empty}>{t(copy.stage.empty)}</p>
        ) : (
          <Table
            className={styles.dsTable ?? ""}
            caption={t(copy.stage.caption)}
            captionHidden
            density="compact"
            headers={copy.stage.columns.map((column) => t(column))}
            numericColumns={[3, 4, 5]}
            rowKeys={workspace.stages.map(
              (row) => `${row.stage}-${row.currency}-${row.revenueBasis}`,
            )}
            rows={workspace.stages.map((row) => [
              stageLabel(row.stage, t),
              row.currency,
              basisLabel(row.revenueBasis, t),
              money(row.revenueMinor, row.currency),
              count(row.quoteCount),
              count(row.orderCount),
            ])}
          />
        )}
      </section>

      <section className={styles.section} aria-labelledby="revenue-channel">
        <header className={styles.sectionHeader}>
          <div>
            <h2 id="revenue-channel">{t(copy.channel.heading)}</h2>
            <p>{t(copy.channel.subheading)}</p>
          </div>
          <span className={styles.sectionMeta}>
            {t(copy.groups, { count: workspace.channels.length })}
          </span>
        </header>
        {workspace.channels.length === 0 && workspace.readable ? (
          <p className={styles.empty}>{t(copy.channel.empty)}</p>
        ) : (
          <Table
            className={styles.dsTable ?? ""}
            caption={t(copy.channel.caption)}
            captionHidden
            density="compact"
            headers={copy.channel.columns.map((column) => t(column))}
            numericColumns={[4, 5]}
            rowKeys={workspace.channels.map(
              (row) =>
                `${row.channel}-${row.merchantOfRecord}-${row.currency}-${row.revenueBasis}`,
            )}
            rows={workspace.channels.map((row) => [
              routeText(t, row.channel),
              merchantLabel(row.merchantOfRecord, t),
              row.currency,
              basisLabel(row.revenueBasis, t),
              money(row.revenueMinor, row.currency),
              count(row.orderCount),
            ])}
          />
        )}
      </section>

      <section className={styles.section} aria-labelledby="revenue-monthly">
        <header className={styles.sectionHeader}>
          <div>
            <h2 id="revenue-monthly">{t(copy.monthly.heading)}</h2>
            <p>{t(copy.monthly.subheading)}</p>
          </div>
          <span className={styles.sectionMeta}>
            {t(copy.groups, { count: workspace.months.length })}
          </span>
        </header>
        {workspace.months.length === 0 && workspace.readable ? (
          <p className={styles.empty}>{t(copy.monthly.empty)}</p>
        ) : (
          <Table
            className={styles.dsTable ?? ""}
            caption={t(copy.monthly.caption)}
            captionHidden
            density="compact"
            headers={copy.monthly.columns.map((column) => t(column))}
            numericColumns={[3, 4]}
            rowKeys={workspace.months.map(
              (row) => `${row.month}-${row.currency}-${row.revenueBasis}`,
            )}
            rows={workspace.months.map((row) => [
              monthLabel(row.month, locale),
              row.currency,
              basisLabel(row.revenueBasis, t),
              money(row.revenueMinor, row.currency),
              count(row.orderCount),
            ])}
          />
        )}
      </section>

      <section className={styles.section} aria-labelledby="revenue-recurring">
        <header className={styles.sectionHeader}>
          <div>
            <h2 id="revenue-recurring">{t(copy.recurring.heading)}</h2>
            <p>{t(copy.recurring.subheading)}</p>
          </div>
          <span className={styles.sectionMeta}>
            {t(copy.groups, { count: workspace.recurring.length })}
          </span>
        </header>
        {workspace.recurring.length === 0 && workspace.readable ? (
          <p className={styles.empty}>{t(copy.recurring.empty)}</p>
        ) : (
          <Table
            className={styles.dsTable ?? ""}
            caption={t(copy.recurring.caption)}
            captionHidden
            density="compact"
            headers={copy.recurring.columns.map((column) => t(column))}
            numericColumns={[2, 3, 4]}
            rowKeys={workspace.recurring.map(
              (row) =>
                `${row.currency}-${row.revenueBasis}-${row.methodologyVersion}`,
            )}
            rows={workspace.recurring.map((row) => [
              row.currency,
              basisLabel(row.revenueBasis, t),
              money(row.mrrMinor, row.currency),
              money(row.arrMinor, row.currency),
              count(row.contractCount),
              methodologyLabel(row.methodologyVersion, t),
            ])}
          />
        )}
      </section>
    </FinancePageFrame>
  );
}
