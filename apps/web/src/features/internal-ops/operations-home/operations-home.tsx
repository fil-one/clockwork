import { getTranslations, getLocale } from "@/src/i18n/server";
import { use } from "react";
import { localizeCopy, translateInterfaceText } from "@/src/i18n/copy";
import Link from "next/link";

import { internalOpsCopy } from "../copy";
import { formatOperationalTimestamp } from "../presentation";
import type { OperationsHomeData, OperationalSignal } from "./server-loader";
import styles from "./operations-home.module.css";

function SignalRows({ signals }: { signals: readonly OperationalSignal[] }) {
  const t = use(getTranslations());
  const locale = use(getLocale());
  const localizedinternalOpsCopy = localizeCopy(internalOpsCopy, t);
  const areaLabels: Readonly<Record<string, string>> = {
    queues: "Approvals",
    provisioning: "Provisioning",
    collections: "Collections",
    orders: "Renewals",
    reports: "Reports",
  };
  return signals.map((signal) => (
    <tr key={signal.label} data-tone={signal.tone}>
      <th scope="row">
        <span className={styles.signalLabel}>{signal.label}</span>
        <strong className={styles.signalValue}>{signal.value}</strong>
      </th>
      <td>{signal.detail}</td>
      <td>
        {translateInterfaceText(
          areaLabels[signal.channel] ?? signal.channel,
          t,
        )}
      </td>
      <td>
        <time dateTime={signal.generatedAt}>
          {formatOperationalTimestamp(signal.generatedAt, locale)}
        </time>
        {signal.stale ? ` · ${localizedinternalOpsCopy.home.staleSuffix}` : ""}
      </td>
      <td>
        <Link href={signal.href}>
          {signal.action}
          <span aria-hidden="true"> →</span>
        </Link>
      </td>
    </tr>
  ));
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
  const locale = use(getLocale());
  const localizedinternalOpsCopy = localizeCopy(internalOpsCopy, t);
  return (
    <main className={styles.main} id="main-content">
      <header className={styles.taskHeader}>
        <div>
          <h1>{localizedinternalOpsCopy.home.title}</h1>
          <p>{localizedinternalOpsCopy.home.description}</p>
        </div>
        <p className={styles.freshness} role="status">
          {t("ui.9")}{" "}
          <time dateTime={data.generatedAt}>
            {formatOperationalTimestamp(data.generatedAt, locale)}
          </time>
        </p>
      </header>

      {data.staleChannels.length > 0 ? (
        <p className={styles.freshness} role="alert">
          {t("operations.stale", {
            channels: data.staleChannels
              .map((channel) =>
                translateInterfaceText(
                  (
                    {
                      queues: "Approvals",
                      provisioning: "Provisioning",
                      collections: "Collections",
                      orders: "Renewals",
                      reports: "Reports",
                    } as Record<string, string>
                  )[channel] ?? channel,
                  t,
                ),
              )
              .join(", "),
          })}
        </p>
      ) : null}

      <section aria-labelledby="action-health-title">
        <div className={styles.sectionHeading}>
          <div>
            <h2 id="action-health-title">
              {localizedinternalOpsCopy.home.healthHeading}
            </h2>
            <p>{localizedinternalOpsCopy.home.healthDescription}</p>
          </div>
          <Link className={styles.primaryLink} href={MY_QUEUE_HREF}>
            {localizedinternalOpsCopy.home.openQueue}
          </Link>
        </div>
        <div
          className={styles.tableRegion}
          role="region"
          aria-label={localizedinternalOpsCopy.home.tableLabel}
          tabIndex={0}
        >
          <table className={styles.signalTable}>
            <thead>
              <tr>
                <th scope="col">{t("ui.6")}</th>
                <th scope="col">{t("ui.7")}</th>
                <th scope="col">{t("ui.8")}</th>
                <th scope="col">{t("ui.9")}</th>
                <th scope="col">
                  <span className="sr-only">{t("ui.10")}</span>
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
