import { getFormattingLocale, getTranslations } from "@/src/i18n/server";
import { use } from "react";
import { StatusBadge, Table } from "@clockwork/ui";

import { lifecycleCopy } from "./copy";
import { FinancePageFrame, IdentifierLine, RecordEvidence } from "./page-frame";
import {
  formatCalendarDay,
  formatCalendarRange,
  formatCount,
  formatMinorAmount,
  formatRelativeDays,
  orderStatusMessages,
  routeText,
  statusText,
} from "./projection-fields";
import type { SurfaceProvenance } from "./provenance";
import {
  renewalWindowDescriptions,
  renewalWindowLabels,
  renewalWindows,
  type RenewalOrder,
  type RenewalWindow,
} from "./renewals-projection";
import styles from "./finance-lifecycle.module.css";

const copy = lifecycleCopy.renewals;

const riskChips = {
  low: "risk.chip.low",
  medium: "risk.chip.medium",
  high: "risk.chip.high",
} as const;

function riskClass(order: RenewalOrder): string {
  if (order.window === "notice-passed" || order.risk === "high")
    return styles.riskHigh ?? "";
  if (order.risk === "medium") return styles.riskMedium ?? "";
  return styles.riskLow ?? "";
}

export function RenewalsView({
  windows,
  provenance,
}: {
  windows: Readonly<Record<RenewalWindow, readonly RenewalOrder[]>>;
  provenance: SurfaceProvenance;
  invoiceProvenance: SurfaceProvenance;
}) {
  const t = use(getTranslations());
  const locale = use(getFormattingLocale());

  /** The notice date and how far away it is, both in the reader's language. */
  function notice(order: RenewalOrder): string {
    const date = formatCalendarDay(order.noticeOn, locale);
    if (!date || order.daysToNotice === null) return t(copy.noNoticeDate);
    return t("common.join.labels", {
      first: date,
      second: formatRelativeDays(order.daysToNotice, locale),
    });
  }

  return (
    <FinancePageFrame
      title={t(copy.title)}
      description={t(copy.description)}
      provenance={provenance}
    >
      <section className={styles.summaryGrid} aria-label={t(copy.summaryLabel)}>
        {renewalWindows
          .filter((window) => window !== "unscheduled")
          .map((window) => (
            <article className={styles.summaryCard} key={window}>
              <p>{t(renewalWindowLabels[window])}</p>
              <strong>{formatCount(windows[window].length, locale)}</strong>
              <span>{t(renewalWindowDescriptions[window])}</span>
            </article>
          ))}
      </section>

      <div>
        {renewalWindows.map((window) => {
          const orders = windows[window];
          if (window === "unscheduled" && orders.length === 0) return null;
          return (
            <section
              className={styles.section}
              aria-labelledby={`renewal-${window}`}
              key={window}
            >
              <header className={styles.sectionHeader}>
                <div>
                  <h2 id={`renewal-${window}`}>
                    {t(renewalWindowLabels[window])}
                  </h2>
                  <p>{t(renewalWindowDescriptions[window])}</p>
                </div>
                <span className={styles.sectionMeta}>
                  {t(copy.windowMeta, { count: orders.length })}
                </span>
              </header>
              <Table
                className={styles.dsTable ?? ""}
                caption={t(copy.caption, {
                  window: t(renewalWindowLabels[window]),
                })}
                captionHidden
                density="compact"
                headers={[
                  t("recordKind.order"),
                  t(copy.columns.route),
                  t(copy.columns.notice),
                  t(copy.columns.serviceTerm),
                  t("common.status"),
                  t(copy.invoicedLabel),
                ]}
                rowKeys={orders.map((order) => order.id)}
                rows={orders.map((order) => [
                  <div className={styles.primaryCell}>
                    <strong>{order.reference}</strong>
                    <span className={riskClass(order)}>
                      {order.risk
                        ? t(riskChips[order.risk])
                        : t(copy.riskUnrecorded)}
                    </span>
                    <details className={styles.disclosure}>
                      <summary>{t(lifecycleCopy.evidence.record)}</summary>
                      <IdentifierLine
                        label={lifecycleCopy.evidence.orderId}
                        value={order.orderId}
                      />
                      <RecordEvidence
                        entries={order.evidence}
                        version={order.version}
                        updatedAt={order.updatedAt}
                      />
                    </details>
                  </div>,
                  order.route
                    ? routeText(t, order.route)
                    : t(copy.routeUnrecorded),
                  <strong>{notice(order)}</strong>,
                  formatCalendarRange(
                    order.serviceStartsOn,
                    order.serviceEndsOn,
                    locale,
                  ) ?? t(copy.termUnrecorded),
                  <StatusBadge
                    tone={
                      order.window === "notice-passed" ? "danger" : "neutral"
                    }
                  >
                    {statusText(
                      t,
                      [order.orderStatus, order.status],
                      order.statusLabel,
                      orderStatusMessages,
                    )}
                  </StatusBadge>,
                  <div className={styles.truthStack}>
                    <strong>
                      {order.invoicedToDate
                        ? formatMinorAmount(
                            order.invoicedToDate.minor,
                            order.invoicedToDate.currency,
                            locale,
                          )
                        : t(copy.noInvoices)}
                    </strong>
                    {order.invoiceCount > 0 ? (
                      <span>
                        {t(copy.invoiceCount, { count: order.invoiceCount })}
                      </span>
                    ) : null}
                  </div>,
                ])}
                emptyState={t(copy.empty)}
              />
            </section>
          );
        })}
      </div>
    </FinancePageFrame>
  );
}
