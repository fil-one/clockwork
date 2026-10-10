import type { Route } from "next";
import Link from "next/link";

import {
  handoffListLimit,
  handoffStatuses,
  type HandoffRequestRecord,
  type HandoffStatus,
} from "@clockwork/contracts";
import {
  EmptyState,
  InlineNotice,
  PageHeader,
  StatusBadge,
  Table,
} from "@clockwork/ui";

import type { Translator } from "@/src/i18n";
import { getFormattingLocale, getTranslations } from "@/src/i18n/server";

import { formatContractDate } from "../contracts/copy";
import {
  handoffDay,
  handoffSideLabels,
  handoffStatusLabels,
  handoffStatusTone,
} from "./model";
import styles from "./handoff.module.css";

/** What the queue could read: the requests, or why there are none to show. */
export type HandoffQueueState =
  | {
      kind: "ready";
      requests: readonly HandoffRequestRecord[];
      /** The newest requests of every status, for the filter counts. */
      recent: readonly HandoffRequestRecord[];
    }
  | { kind: "demo" }
  | { kind: "unavailable" };

const requestHref = (request: HandoffRequestRecord) =>
  `/internal/handoffs/${request.id}` as Route;

function Filters({
  t,
  status,
  recent,
}: {
  t: Translator;
  status: HandoffStatus | undefined;
  recent: readonly HandoffRequestRecord[] | null;
}) {
  // A count is only true while the recent list holds every request.
  const counted = recent !== null && recent.length < handoffListLimit;
  const label = (text: string, count: number) =>
    counted
      ? t("operations.handoff.queue.filter.withCount", { label: text, count })
      : text;
  const filters: { value: HandoffStatus | undefined; href: string }[] = [
    { value: undefined, href: "/internal/handoffs" },
    ...handoffStatuses.map((value) => ({
      value,
      href: `/internal/handoffs?status=${value}`,
    })),
  ];
  return (
    <nav aria-label={t("operations.handoff.queue.filter.label")}>
      <ul className={styles.pills}>
        {filters.map((filter) => (
          <li key={filter.href}>
            <Link
              className={styles.pill}
              href={filter.href as Route}
              aria-current={filter.value === status ? "page" : undefined}
            >
              {filter.value
                ? label(
                    t(handoffStatusLabels[filter.value]),
                    recent?.filter((r) => r.status === filter.value).length ??
                      0,
                  )
                : label(
                    t("operations.handoff.queue.filter.all"),
                    recent?.length ?? 0,
                  )}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Status({
  request,
  t,
}: {
  request: HandoffRequestRecord;
  t: Translator;
}) {
  return (
    <StatusBadge tone={handoffStatusTone[request.status]}>
      {t(handoffStatusLabels[request.status])}
    </StatusBadge>
  );
}

/** The operations queue at /internal/handoffs. */
export async function HandoffQueue({
  state,
  status,
}: {
  state: HandoffQueueState;
  status: HandoffStatus | undefined;
}) {
  const [t, locale] = await Promise.all([
    getTranslations(),
    getFormattingLocale(),
  ]);
  const requested = (request: HandoffRequestRecord) =>
    formatContractDate(handoffDay(request.createdAt), locale);
  const assignee = (request: HandoffRequestRecord) =>
    request.assigneeName ?? t("operations.handoff.unassigned");
  return (
    <main className={styles.main} id="main-content">
      <PageHeader
        title={t("operations.handoff.queue.title")}
        description={t("operations.handoff.queue.description")}
      />
      {state.kind === "demo" ? (
        <InlineNotice
          tone="info"
          title={t("operations.handoff.queue.demoTitle")}
          description={t("operations.handoff.queue.demoBody")}
        />
      ) : state.kind === "unavailable" ? (
        <InlineNotice
          tone="danger"
          title={t("operations.handoff.queue.unavailable")}
        />
      ) : (
        <>
          <Filters t={t} status={status} recent={state.recent} />
          {state.requests.length === 0 ? (
            <EmptyState
              title={t("operations.handoff.queue.empty.title")}
              description={t("operations.handoff.queue.empty.description")}
            />
          ) : (
            <>
              <div className={styles.desktopOnly}>
                <Table
                  caption={t("operations.handoff.queue.title")}
                  captionHidden
                  density="compact"
                  headers={[
                    t("operations.handoff.column.counterparty"),
                    t("operations.handoff.column.side"),
                    t("operations.handoff.column.status"),
                    t("operations.handoff.column.assignee"),
                    t("operations.handoff.column.requestedBy"),
                    t("operations.handoff.column.requested"),
                  ]}
                  rowKeys={state.requests.map((request) => request.id)}
                  rows={state.requests.map((request) => [
                    <Link
                      key="name"
                      className={styles.rowLink}
                      href={requestHref(request)}
                    >
                      {request.counterpartyLegalName}
                    </Link>,
                    t(handoffSideLabels[request.requestedSide]),
                    <Status key="status" request={request} t={t} />,
                    assignee(request),
                    request.requestedByName,
                    requested(request),
                  ])}
                />
              </div>
              <ul className={`${styles.mobileOnly} ${styles.mobileList}`}>
                {state.requests.map((request) => (
                  <li className={styles.mobileCard} key={request.id}>
                    <h2>
                      <Link href={requestHref(request)}>
                        {request.counterpartyLegalName}
                      </Link>
                    </h2>
                    <span>
                      <Status request={request} t={t} />
                    </span>
                    <dl>
                      <div>
                        <dt>{t("operations.handoff.column.side")}</dt>
                        <dd>{t(handoffSideLabels[request.requestedSide])}</dd>
                      </div>
                      <div>
                        <dt>{t("operations.handoff.column.assignee")}</dt>
                        <dd>{assignee(request)}</dd>
                      </div>
                      <div>
                        <dt>{t("operations.handoff.column.requestedBy")}</dt>
                        <dd>{request.requestedByName}</dd>
                      </div>
                      <div>
                        <dt>{t("operations.handoff.column.requested")}</dt>
                        <dd>{requested(request)}</dd>
                      </div>
                    </dl>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </main>
  );
}
