import { Table } from "@clockwork/ui";

import styles from "../finance-lifecycle/finance-lifecycle.module.css";
import { FinancePageFrame } from "../finance-lifecycle/page-frame";
import { revenueCopy } from "./copy";
import {
  basisLabel,
  formatMinor,
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
  return (
    <FinancePageFrame
      title={revenueCopy.page.title}
      description={revenueCopy.page.description}
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
        aria-label={revenueCopy.summary.label}
      >
        <article className={styles.summaryCard}>
          <p>{revenueCopy.summary.forecast.title}</p>
          <strong>{workspace.forecastRowCount}</strong>
          <span>{revenueCopy.summary.forecast.detail}</span>
        </article>
        <article className={styles.summaryCard}>
          <p>{revenueCopy.summary.remaining.title}</p>
          <strong>{workspace.remainingBacklogRowCount}</strong>
          <span>{revenueCopy.summary.remaining.detail}</span>
        </article>
        <article className={styles.summaryCard}>
          <p>{revenueCopy.summary.recurring.title}</p>
          <strong>{workspace.recurringContractCount}</strong>
          <span>{revenueCopy.summary.recurring.detail}</span>
        </article>
      </section>

      {workspace.readable ? null : (
        <div className={styles.warningNotice} role="alert">
          <strong>{revenueCopy.unreadable.title}</strong>
          <span>{revenueCopy.unreadable.detail}</span>
        </div>
      )}

      <section className={styles.notice} role="note">
        <strong>{revenueCopy.methodology.title}</strong>
        <span>{revenueCopy.methodology.detail}</span>
      </section>

      <section className={styles.section} aria-labelledby="revenue-stage">
        <header className={styles.sectionHeader}>
          <div>
            <h2 id="revenue-stage">{revenueCopy.stage.heading}</h2>
            <p>{revenueCopy.stage.subheading}</p>
          </div>
          <span className={styles.sectionMeta}>
            {workspace.stages.length} groups
          </span>
        </header>
        {workspace.stages.length === 0 && workspace.readable ? (
          <p className={styles.empty}>{revenueCopy.stage.empty}</p>
        ) : (
          <Table
            className={styles.dsTable ?? ""}
            caption={revenueCopy.stage.caption}
            captionHidden
            density="compact"
            headers={[...revenueCopy.stage.columns]}
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
            <h2 id="revenue-channel">{revenueCopy.channel.heading}</h2>
            <p>{revenueCopy.channel.subheading}</p>
          </div>
          <span className={styles.sectionMeta}>
            {workspace.channels.length} groups
          </span>
        </header>
        {workspace.channels.length === 0 && workspace.readable ? (
          <p className={styles.empty}>{revenueCopy.channel.empty}</p>
        ) : (
          <Table
            className={styles.dsTable ?? ""}
            caption={revenueCopy.channel.caption}
            captionHidden
            density="compact"
            headers={[...revenueCopy.channel.columns]}
            numericColumns={[4, 5]}
            rowKeys={workspace.channels.map(
              (row) =>
                `${row.channel}-${row.merchantOfRecord}-${row.currency}-${row.revenueBasis}`,
            )}
            rows={workspace.channels.map((row) => [
              row.channel,
              row.merchantOfRecord,
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
            <h2 id="revenue-monthly">{revenueCopy.monthly.heading}</h2>
            <p>{revenueCopy.monthly.subheading}</p>
          </div>
          <span className={styles.sectionMeta}>
            {workspace.months.length} groups
          </span>
        </header>
        {workspace.months.length === 0 && workspace.readable ? (
          <p className={styles.empty}>{revenueCopy.monthly.empty}</p>
        ) : (
          <Table
            className={styles.dsTable ?? ""}
            caption={revenueCopy.monthly.caption}
            captionHidden
            density="compact"
            headers={[...revenueCopy.monthly.columns]}
            numericColumns={[3, 4]}
            rowKeys={workspace.months.map(
              (row) => `${row.month}-${row.currency}-${row.revenueBasis}`,
            )}
            rows={workspace.months.map((row) => [
              row.month,
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
            <h2 id="revenue-recurring">{revenueCopy.recurring.heading}</h2>
            <p>{revenueCopy.recurring.subheading}</p>
          </div>
          <span className={styles.sectionMeta}>
            {workspace.recurring.length} groups
          </span>
        </header>
        {workspace.recurring.length === 0 && workspace.readable ? (
          <p className={styles.empty}>{revenueCopy.recurring.empty}</p>
        ) : (
          <Table
            className={styles.dsTable ?? ""}
            caption={revenueCopy.recurring.caption}
            captionHidden
            density="compact"
            headers={[...revenueCopy.recurring.columns]}
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
              row.methodologyVersion,
            ])}
          />
        )}
      </section>
    </FinancePageFrame>
  );
}
