import type { Route } from "next";
import Link from "next/link";

import {
  handoffStatuses,
  type HandoffRequestRecord,
  type HandoffStatus,
} from "@clockwork/contracts";
import { EmptyState, StateBanner, StatusBadge } from "@clockwork/ui";

import { getFormattingLocale, getTranslations } from "@/src/i18n/server";

import { formatContractDate } from "../contracts/copy";
import {
  handoffDay,
  handoffSideLabels,
  handoffStatusLabels,
  handoffStatusTone,
} from "./model";
import styles from "./handoff.module.css";

/** The operations queue at /internal/handoffs. */
export async function HandoffQueue({
  requests,
  status,
}: {
  /** Null when the queue could not be read. */
  requests: readonly HandoffRequestRecord[] | null;
  status: HandoffStatus | undefined;
}) {
  const [t, locale] = await Promise.all([
    getTranslations(),
    getFormattingLocale(),
  ]);
  const filters: { value: HandoffStatus | undefined; href: string }[] = [
    { value: undefined, href: "/internal/handoffs" },
    ...handoffStatuses.map((value) => ({
      value,
      href: `/internal/handoffs?status=${value}`,
    })),
  ];
  return (
    <main className={styles.main} id="main-content">
      <header className={styles.header}>
        <h1>{t("operations.handoff.queue.title")}</h1>
        <p>{t("operations.handoff.queue.description")}</p>
      </header>
      <nav aria-label={t("operations.handoff.queue.filter.label")}>
        <ul className={styles.filters}>
          {filters.map((filter) => (
            <li key={filter.href}>
              <Link
                href={filter.href as Route}
                aria-current={filter.value === status ? "page" : undefined}
              >
                {filter.value
                  ? t(handoffStatusLabels[filter.value])
                  : t("operations.handoff.queue.filter.all")}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {requests === null ? (
        <StateBanner
          tone="danger"
          title={t("operations.handoff.queue.unavailable")}
        />
      ) : requests.length === 0 ? (
        <EmptyState
          title={t("operations.handoff.queue.empty.title")}
          description={t("operations.handoff.queue.empty.description")}
        />
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">
                  {t("operations.handoff.column.counterparty")}
                </th>
                <th scope="col">{t("operations.handoff.column.side")}</th>
                <th scope="col">{t("operations.handoff.column.status")}</th>
                <th scope="col">{t("operations.handoff.column.assignee")}</th>
                <th scope="col">
                  {t("operations.handoff.column.requestedBy")}
                </th>
                <th scope="col">{t("operations.handoff.column.requested")}</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((request) => (
                <tr key={request.id}>
                  <td>
                    <Link href={`/internal/handoffs/${request.id}` as Route}>
                      {request.counterpartyLegalName}
                    </Link>
                  </td>
                  <td>{t(handoffSideLabels[request.requestedSide])}</td>
                  <td>
                    <StatusBadge tone={handoffStatusTone[request.status]}>
                      {t(handoffStatusLabels[request.status])}
                    </StatusBadge>
                  </td>
                  <td>
                    {request.assigneeName ?? t("operations.handoff.unassigned")}
                  </td>
                  <td>{request.requestedByName}</td>
                  <td>
                    {formatContractDate(handoffDay(request.createdAt), locale)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
