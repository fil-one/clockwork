import type { Route } from "next";
import Link from "next/link";
import {
  contractRenewalWindows,
  type ContractListRow,
} from "@clockwork/contracts";
import { EmptyState, PageHeader, Table, buttonClassName } from "@clockwork/ui";
import type { Translator } from "@/src/i18n";
import { DateValue, DeadlineValue } from "./cells";
import { contractTypeLabels } from "./copy";
import styles from "./contracts.module.css";

export function RenewalsView({
  t,
  locale,
  days,
  rows,
  today,
}: {
  t: Translator;
  locale: string;
  days: number;
  rows: readonly ContractListRow[];
  today: string;
}) {
  return (
    <main className={styles.page} id="main-content">
      <PageHeader
        title={t("operations.contracts.renewals.title")}
        description={t("operations.contracts.renewals.description")}
        actions={
          <Link
            className={buttonClassName({ variant: "secondary" })}
            href="/internal/contracts"
          >
            {t("operations.contracts.backToRegister")}
          </Link>
        }
      />
      <nav
        className={styles.windowTabs}
        aria-label={t("operations.contracts.renewals.windowLabel")}
      >
        {contractRenewalWindows.map((window) => (
          <Link
            key={window}
            className={styles.windowTab}
            href={`/internal/contracts/renewals?window=${window}` as Route}
            aria-current={window === days ? "page" : undefined}
          >
            {t("operations.contracts.renewals.window", { count: window })}
          </Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <EmptyState
          title={t("operations.contracts.renewals.emptyTitle", { count: days })}
          description={t("operations.contracts.renewals.emptyBody")}
        />
      ) : (
        <section className={styles.stack} aria-labelledby="renewals-results">
          <div className={styles.resultBar}>
            <h2 id="renewals-results" className="cw-sr-only">
              {t("operations.contracts.renewals.title")}
            </h2>
            <span role="status">
              {t("operations.contracts.renewals.count", { count: rows.length })}
            </span>
          </div>
          <div className={styles.desktopOnly}>
            <Table
              caption={t("operations.contracts.renewals.title")}
              captionHidden
              density="compact"
              headers={[
                t("operations.contracts.field.counterparty"),
                t("operations.contracts.field.type"),
                t("operations.contracts.field.noticeDeadline"),
                t("operations.contracts.field.renewsOn"),
                t("operations.contracts.field.noticePeriod"),
                t("operations.contracts.field.owner"),
              ]}
              rowKeys={rows.map((row) => row.id)}
              rows={rows.map((row) => [
                <span className={styles.primaryCell} key="name">
                  <Link href={`/internal/contracts/${row.id}` as Route}>
                    {row.counterpartyName}
                  </Link>
                  {row.title ? (
                    <span className={styles.secondaryText}>{row.title}</span>
                  ) : null}
                </span>,
                t(contractTypeLabels[row.contractType]),
                <DeadlineValue
                  key="deadline"
                  date={row.noticeDeadline}
                  today={today}
                  t={t}
                  locale={locale}
                />,
                <DateValue
                  key="renews"
                  date={row.renewalDate}
                  t={t}
                  locale={locale}
                />,
                row.noticePeriodDays === null
                  ? t("operations.contracts.notSet")
                  : t("operations.contracts.days", {
                      count: row.noticePeriodDays,
                    }),
                row.ownerName,
              ])}
            />
          </div>
          <ul className={`${styles.mobileOnly} ${styles.mobileList}`}>
            {rows.map((row) => (
              <li className={styles.mobileCard} key={row.id}>
                <h3>
                  <Link href={`/internal/contracts/${row.id}` as Route}>
                    {row.counterpartyName}
                  </Link>
                </h3>
                <dl>
                  <div>
                    <dt>{t("operations.contracts.field.noticeDeadline")}</dt>
                    <dd>
                      <DeadlineValue
                        date={row.noticeDeadline}
                        today={today}
                        t={t}
                        locale={locale}
                      />
                    </dd>
                  </div>
                  <div>
                    <dt>{t("operations.contracts.field.renewsOn")}</dt>
                    <dd>
                      <DateValue date={row.renewalDate} t={t} locale={locale} />
                    </dd>
                  </div>
                  <div>
                    <dt>{t("operations.contracts.field.type")}</dt>
                    <dd>{t(contractTypeLabels[row.contractType])}</dd>
                  </div>
                  <div>
                    <dt>{t("operations.contracts.field.owner")}</dt>
                    <dd>{row.ownerName}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
          <p className={styles.muted}>
            {t("operations.contracts.renewals.footnote")}
          </p>
        </section>
      )}
    </main>
  );
}
