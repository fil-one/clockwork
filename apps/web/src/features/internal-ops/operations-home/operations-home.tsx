import {
  getFormattingLocale,
  getLocale,
  getTranslations,
} from "@/src/i18n/server";
import { use } from "react";
import Link from "next/link";

import { rtlLocales, type MessageId } from "@/src/i18n";
import { richText } from "@/src/i18n/rich";

import { formatOperationalTimestamp } from "../presentation";
import type { OperationsHomeData, OperationalSignal } from "./server-loader";
import styles from "./operations-home.module.css";

/** The workspace each signal's channel belongs to, as the column names it. */
const areaLabels: Readonly<Record<string, MessageId>> = {
  queues: "operations.home.area.approvals",
  provisioning: "operations.home.area.provisioning",
  collections: "operations.home.area.collections",
  orders: "operations.home.area.renewals",
  reports: "operations.home.area.reports",
};

function SignalRows({ signals }: { signals: readonly OperationalSignal[] }) {
  const t = use(getTranslations());
  const locale = use(getFormattingLocale());
  // The arrow points the way the line reads, so it turns round in Arabic.
  const forward = rtlLocales.has(use(getLocale())) ? "←" : "→";
  return signals.map((signal) => {
    const area = areaLabels[signal.channel];
    const time = (
      <time dateTime={signal.generatedAt}>
        {formatOperationalTimestamp(signal.generatedAt, locale)}
      </time>
    );
    return (
      <tr key={signal.channel} data-tone={signal.tone}>
        <th scope="row">
          <span className={styles.signalLabel}>{signal.label}</span>
          <strong className={styles.signalValue}>{signal.value}</strong>
        </th>
        <td>{signal.detail}</td>
        <td>{area ? t(area) : signal.channel}</td>
        <td>
          {signal.stale
            ? richText(t, "common.join.labels", {
                first: time,
                second: t("operations.home.signal.stale"),
              })
            : time}
        </td>
        <td>
          <Link href={signal.href}>
            {signal.action}
            <span aria-hidden="true"> {forward}</span>
          </Link>
        </td>
      </tr>
    );
  });
}

/**
 * Where "Open my queue" goes.
 *
 * The label names the operator's own work, so the link states the saved view
 * that holds it. `/internal/queues` on its own opens `DEFAULT_FILTERS.view`,
 * which is `all` -- every operator's work, not this one's -- and a label that
 * says "my queue" over that destination is the same defect as a freshness
 * string with no read behind it. `QueueWorkspace` parses all four parameters
 * out of `useSearchParams`, so the destination arrives on the assigned view
 * rather than resetting to the default.
 *
 * `sort` is `sla-risk-age`, not the `priority` the earlier link carried:
 * `sortQueueItems` has no `priority` branch and no filter control offers one,
 * so that value fell through to this same ordering while leaving the sort
 * control matching no option and reading "All". The link now names the
 * ordering the page actually applies.
 */
const MY_QUEUE_HREF =
  "/internal/queues?view=assigned-to-me&sort=sla-risk-age&page=1&pageSize=25" as const;

export function OperationsHome({ data }: { data: OperationsHomeData }) {
  const t = use(getTranslations());
  const locale = use(getFormattingLocale());
  const staleAreas = data.staleChannels.map((channel) => {
    const area = areaLabels[channel];
    return area ? t(area) : channel;
  });
  return (
    <main className={styles.main} id="main-content">
      <header className={styles.taskHeader}>
        <div>
          <h1>{t("operations.home.title")}</h1>
          <p>{t("operations.home.description")}</p>
        </div>
        <p className={styles.freshness} role="status">
          {richText(t, "common.updatedAt", {
            time: (
              <time dateTime={data.generatedAt}>
                {formatOperationalTimestamp(data.generatedAt, locale)}
              </time>
            ),
          })}
        </p>
      </header>

      {staleAreas.length > 0 ? (
        <p className={styles.freshness} role="alert">
          {t("operations.home.stale", {
            channels: new Intl.ListFormat(locale, {
              style: "long",
              type: "conjunction",
            }).format(staleAreas),
          })}
        </p>
      ) : null}

      <section aria-labelledby="action-health-title">
        <div className={styles.sectionHeading}>
          <div>
            <h2 id="action-health-title">
              {t("operations.home.overview.title")}
            </h2>
            <p>{t("operations.home.overview.description")}</p>
          </div>
          <Link className={styles.primaryLink} href={MY_QUEUE_HREF}>
            {t("operations.home.openMyQueue")}
          </Link>
        </div>
        <div
          className={styles.tableRegion}
          role="region"
          aria-label={t("operations.home.overview.tableLabel")}
          tabIndex={0}
        >
          <table className={styles.signalTable}>
            <thead>
              <tr>
                <th scope="col">{t("operations.home.column.signal")}</th>
                <th scope="col">{t("operations.home.column.summary")}</th>
                <th scope="col">{t("operations.home.column.area")}</th>
                <th scope="col">{t("operations.home.column.updated")}</th>
                <th scope="col">
                  <span className="sr-only">
                    {t("operations.home.column.action")}
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              <SignalRows signals={data.signals} />
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
