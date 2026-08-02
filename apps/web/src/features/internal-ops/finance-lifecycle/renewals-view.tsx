import { Table } from "@clockwork/ui";

import { lifecycleCopy } from "./copy";
import {
  renewals,
  renewalWindowLabels,
  renewalWindows,
  type RenewalRecord,
} from "./lifecycle-data";
import { formatMoney, groupRenewals } from "./lifecycle-logic";
import { FinancePageFrame } from "./page-frame";
import styles from "./finance-lifecycle.module.css";

function riskClass(risk: RenewalRecord["risk"]): string {
  if (risk === "High") return styles.riskHigh ?? "";
  if (risk === "Medium") return styles.riskMedium ?? "";
  return styles.riskLow ?? "";
}

export function RenewalsView() {
  const grouped = groupRenewals(renewals);

  return (
    <FinancePageFrame
      title={lifecycleCopy.renewals.title}
      description={lifecycleCopy.renewals.description}
      freshness={lifecycleCopy.renewals.freshness}
      source={lifecycleCopy.renewals.source}
    >
      <section className={styles.summaryGrid} aria-label="Exposure by horizon">
        {renewalWindows.map((window) => {
          const records = grouped[window];
          const exposure = records.reduce(
            (total, record) => total + record.exposureCents,
            0,
          );
          return (
            <article className={styles.summaryCard} key={window}>
              <p>{renewalWindowLabels[window]}</p>
              <strong>{formatMoney(exposure)}</strong>
              <span>
                Exposure estimate · {records.length} account
                {records.length === 1 ? "" : "s"}
              </span>
            </article>
          );
        })}
      </section>

      <div className={styles.warningNotice} role="note">
        <strong>Exposure is planning data.</strong>
        <span>
          It is not an invoice, payment, or collected-revenue total. Invoice and
          collection truth remain labeled on each account.
        </span>
      </div>

      <div>
        {renewalWindows.map((window) => {
          const records = grouped[window];
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
                  <p>
                    Route, deadline, owner, value, and recommended next action.
                  </p>
                </div>
                <span className={styles.sectionMeta}>
                  {records.length} active · ordered by deadline
                </span>
              </header>
              <Table
                className={styles.dsTable ?? ""}
                caption={`${renewalWindowLabels[window]} renewal exposure`}
                captionHidden
                density="compact"
                headers={[
                  "Account",
                  "Route",
                  "Deadline",
                  "Owner",
                  "Value truth",
                  "Next action",
                ]}
                rowKeys={records.map((record) => record.id)}
                rows={records.map((record) => [
                  <div className={styles.primaryCell}>
                    <strong>{record.account}</strong>
                    <span className={riskClass(record.risk)}>
                      {record.risk} risk
                    </span>
                    <details className={styles.disclosure}>
                      <summary>Record evidence</summary>
                      <p>
                        Renewal <span className={styles.id}>{record.id}</span>
                        <br />
                        Account ID:{" "}
                        <span className={styles.id}>{record.accountId}</span>
                      </p>
                    </details>
                  </div>,
                  record.route,
                  <strong>{record.deadlineLabel}</strong>,
                  record.owner,
                  <div className={styles.truthStack}>
                    <strong>
                      {formatMoney(record.exposureCents)} estimated exposure
                    </strong>
                    <span>Invoice truth: {record.invoiceTruth}</span>
                    <span>Collection truth: {record.collectedTruth}</span>
                  </div>,
                  record.nextAction,
                ])}
                emptyState="No renewals fall in this window."
              />
            </section>
          );
        })}
      </div>
    </FinancePageFrame>
  );
}
