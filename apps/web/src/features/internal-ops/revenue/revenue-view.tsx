import { getFormattingLocale, getTranslations } from "@/src/i18n/server";
import { use } from "react";
import { localizeCopy } from "@/src/i18n/copy";
import { Table } from "@clockwork/ui";

import styles from "../finance-lifecycle/finance-lifecycle.module.css";
import { FinancePageFrame } from "../finance-lifecycle/page-frame";
import { revenueCopy } from "./copy";
import {
  basisLabel,
  businessLabel,
  formatMinor,
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
  const formattingLocale = use(getFormattingLocale());
  const localizedrevenueCopy = localizeCopy(revenueCopy, t);
  return (
    <FinancePageFrame
      title={localizedrevenueCopy.page.title}
      description={localizedrevenueCopy.page.description}
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
        aria-label={localizedrevenueCopy.summary.label}
      >
        <article className={styles.summaryCard}>
          <p>{localizedrevenueCopy.summary.forecast.title}</p>
          <strong>{workspace.forecastRowCount}</strong>
          <span>{localizedrevenueCopy.summary.forecast.detail}</span>
        </article>
        <article className={styles.summaryCard}>
          <p>{localizedrevenueCopy.summary.remaining.title}</p>
          <strong>{workspace.remainingBacklogRowCount}</strong>
          <span>{localizedrevenueCopy.summary.remaining.detail}</span>
        </article>
        <article className={styles.summaryCard}>
          <p>{localizedrevenueCopy.summary.recurring.title}</p>
          <strong>{workspace.recurringContractCount}</strong>
          <span>{localizedrevenueCopy.summary.recurring.detail}</span>
        </article>
      </section>

      {workspace.readable ? null : (
        <div className={styles.warningNotice} role="alert">
          <strong>{localizedrevenueCopy.unreadable.title}</strong>
          <span>{localizedrevenueCopy.unreadable.detail}</span>
        </div>
      )}

      <section className={styles.section} aria-labelledby="revenue-stage">
        <header className={styles.sectionHeader}>
          <div>
            <h2 id="revenue-stage">{localizedrevenueCopy.stage.heading}</h2>
            <p>{localizedrevenueCopy.stage.subheading}</p>
          </div>
          <span className={styles.sectionMeta}>
            {workspace.stages.length} groups
          </span>
        </header>
        {workspace.stages.length === 0 && workspace.readable ? (
          <p className={styles.empty}>{localizedrevenueCopy.stage.empty}</p>
        ) : (
          <Table
            className={styles.dsTable ?? ""}
            caption={localizedrevenueCopy.stage.caption}
            captionHidden
            density="compact"
            headers={[...localizedrevenueCopy.stage.columns]}
            numericColumns={[3, 4, 5]}
            rowKeys={workspace.stages.map(
              (row) => `${row.stage}-${row.currency}-${row.revenueBasis}`,
            )}
            rows={workspace.stages.map((row) => [
              stageLabel(row.stage),
              row.currency,
              basisLabel(row.revenueBasis),
              formatMinor(row.revenueMinor, row.currency),
              row.quoteCount,
              row.orderCount,
            ])}
          />
        )}
      </section>

      <section className={styles.section} aria-labelledby="revenue-channel">
        <header className={styles.sectionHeader}>
          <div>
            <h2 id="revenue-channel">{localizedrevenueCopy.channel.heading}</h2>
            <p>{localizedrevenueCopy.channel.subheading}</p>
          </div>
          <span className={styles.sectionMeta}>
            {workspace.channels.length} groups
          </span>
        </header>
        {workspace.channels.length === 0 && workspace.readable ? (
          <p className={styles.empty}>{localizedrevenueCopy.channel.empty}</p>
        ) : (
          <Table
            className={styles.dsTable ?? ""}
            caption={localizedrevenueCopy.channel.caption}
            captionHidden
            density="compact"
            headers={[...localizedrevenueCopy.channel.columns]}
            numericColumns={[4, 5]}
            rowKeys={workspace.channels.map(
              (row) =>
                `${row.channel}-${row.merchantOfRecord}-${row.currency}-${row.revenueBasis}`,
            )}
            rows={workspace.channels.map((row) => [
              businessLabel(row.channel),
              businessLabel(row.merchantOfRecord),
              row.currency,
              basisLabel(row.revenueBasis),
              formatMinor(row.revenueMinor, row.currency),
              row.orderCount,
            ])}
          />
        )}
      </section>

      <section className={styles.section} aria-labelledby="revenue-monthly">
        <header className={styles.sectionHeader}>
          <div>
            <h2 id="revenue-monthly">{localizedrevenueCopy.monthly.heading}</h2>
            <p>{localizedrevenueCopy.monthly.subheading}</p>
          </div>
          <span className={styles.sectionMeta}>
            {workspace.months.length} groups
          </span>
        </header>
        {workspace.months.length === 0 && workspace.readable ? (
          <p className={styles.empty}>{localizedrevenueCopy.monthly.empty}</p>
        ) : (
          <Table
            className={styles.dsTable ?? ""}
            caption={localizedrevenueCopy.monthly.caption}
            captionHidden
            density="compact"
            headers={[...localizedrevenueCopy.monthly.columns]}
            numericColumns={[3, 4]}
            rowKeys={workspace.months.map(
              (row) => `${row.month}-${row.currency}-${row.revenueBasis}`,
            )}
            rows={workspace.months.map((row) => [
              monthLabel(row.month, formattingLocale),
              row.currency,
              basisLabel(row.revenueBasis),
              formatMinor(row.revenueMinor, row.currency),
              row.orderCount,
            ])}
          />
        )}
      </section>

      <section className={styles.section} aria-labelledby="revenue-recurring">
        <header className={styles.sectionHeader}>
          <div>
            <h2 id="revenue-recurring">
              {localizedrevenueCopy.recurring.heading}
            </h2>
            <p>{localizedrevenueCopy.recurring.subheading}</p>
          </div>
          <span className={styles.sectionMeta}>
            {workspace.recurring.length} groups
          </span>
        </header>
        {workspace.recurring.length === 0 && workspace.readable ? (
          <p className={styles.empty}>{localizedrevenueCopy.recurring.empty}</p>
        ) : (
          <Table
            className={styles.dsTable ?? ""}
            caption={localizedrevenueCopy.recurring.caption}
            captionHidden
            density="compact"
            headers={[...localizedrevenueCopy.recurring.columns]}
            numericColumns={[2, 3, 4]}
            rowKeys={workspace.recurring.map(
              (row) =>
                `${row.currency}-${row.revenueBasis}-${row.methodologyVersion}`,
            )}
            rows={workspace.recurring.map((row) => [
              row.currency,
              basisLabel(row.revenueBasis),
              formatMinor(row.mrrMinor, row.currency),
              formatMinor(row.arrMinor, row.currency),
              row.contractCount,
              businessLabel(row.methodologyVersion),
            ])}
          />
        )}
      </section>
    </FinancePageFrame>
  );
}
