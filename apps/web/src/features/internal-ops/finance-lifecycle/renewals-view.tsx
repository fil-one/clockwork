import { StatusBadge, Table } from "@clockwork/ui";

import { plural } from "@/src/i18n/en";

import { lifecycleCopy } from "./copy";
import { FinancePageFrame } from "./page-frame";
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
  return (
    <FinancePageFrame
      title={copy.title}
      description={copy.description}
      provenance={provenance}
    >
      <section
        className={styles.summaryGrid}
        aria-label="Orders by notice window"
      >
        {renewalWindows
          .filter((window) => window !== "unscheduled")
          .map((window) => (
            <article className={styles.summaryCard} key={window}>
              <p>{renewalWindowLabels[window]}</p>
              <strong>{windows[window].length}</strong>
              <span>{renewalWindowDescriptions[window]}</span>
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
                    {renewalWindowLabels[window]}
                  </h2>
                  <p>{renewalWindowDescriptions[window]}</p>
                </div>
                <span className={styles.sectionMeta}>
                  {plural(orders.length, "{count} order", "{count} orders")} ·
                  ordered by notice date
                </span>
              </header>
              <Table
                className={styles.dsTable ?? ""}
                caption={`${renewalWindowLabels[window]} orders`}
                captionHidden
                density="compact"
                headers={[
                  "Order",
                  "Route",
                  "Notice",
                  "Service term",
                  "Status",
                  copy.invoicedLabel,
                ]}
                rowKeys={orders.map((order) => order.id)}
                rows={orders.map((order) => [
                  <div className={styles.primaryCell}>
                    <strong>{order.reference}</strong>
                    <span className={riskClass(order)}>
                      {order.risk ? `${order.risk} risk` : "Risk not recorded"}
                    </span>
                    <details className={styles.disclosure}>
                      <summary>Record evidence</summary>
                      <p>
                        Order ID:{" "}
                        <span className={styles.id}>{order.orderId}</span>
                      </p>
                      {order.evidence.map((entry) => (
                        <p key={`${entry.label}-${entry.value}`}>
                          {entry.label}: {entry.value}
                        </p>
                      ))}
                    </details>
                  </div>,
                  order.route ?? copy.routeUnrecorded,
                  <strong>{order.noticeLabel}</strong>,
                  order.serviceTerm,
                  <StatusBadge
                    tone={
                      order.window === "notice-passed" ? "danger" : "neutral"
                    }
                  >
                    {order.statusLabel}
                  </StatusBadge>,
                  <div className={styles.truthStack}>
                    <strong>{order.invoicedToDate ?? copy.noInvoices}</strong>
                    {order.invoiceCount > 0 ? (
                      <span>
                        {plural(
                          order.invoiceCount,
                          "{count} invoice",
                          "{count} invoices",
                        )}{" "}
                        · invoice truth, not a forecast
                      </span>
                    ) : null}
                  </div>,
                ])}
                emptyState={copy.empty}
              />
            </section>
          );
        })}
      </div>
    </FinancePageFrame>
  );
}
