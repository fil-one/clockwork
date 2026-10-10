import type { Route } from "next";
import Link from "next/link";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  EmptyState,
  InlineNotice,
  PageHeader,
  Table,
  buttonClassName,
} from "@clockwork/ui";
import {
  contractExportLimit,
  mndaRegisterSearchParams,
  type ContractListQuery,
  type ContractListRow,
  type ContractSort,
} from "@clockwork/contracts";
import type { Translator } from "@/src/i18n";
import type { ContractListResult } from "@clockwork/db";
import {
  DateValue,
  DeadlineValue,
  StatusValue,
  Tags,
  TermBoundaryValue,
} from "./cells";
import { contractTypeLabels } from "./copy";
import { RegisterFilters } from "./register-filters";
import { registerHref } from "./register-href";
import styles from "./contracts.module.css";

type Query = ContractListQuery;

export { registerHref };

export const exportHref = (query: Query) =>
  registerHref({ ...query, page: 1 }).replace(
    "/internal/contracts",
    "/internal/contracts/export",
  ) as Route;

/** An MNDA row opens the MNDA register on that counterparty's signed MNDAs. */
const rowHref = (row: ContractListRow) =>
  (row.source === "mnda"
    ? `/internal/mndas?${mndaRegisterSearchParams({ status: ["completed"], q: row.counterpartyName }).toString()}`
    : `/internal/contracts/${row.id}`) as Route;

/** The counterparty as a link, unless it points somewhere the reader may
 * not open. */
function RowLink({
  row,
  canOpenMndas,
}: {
  row: ContractListRow;
  canOpenMndas: boolean;
}) {
  return row.source === "mnda" && !canOpenMndas ? (
    <span>{row.counterpartyName}</span>
  ) : (
    <Link href={rowHref(row)}>{row.counterpartyName}</Link>
  );
}

const columns: readonly {
  sort: ContractSort | null;
  label: Parameters<Translator>[0];
}[] = [
  { sort: "counterparty", label: "operations.contracts.field.counterparty" },
  { sort: "type", label: "operations.contracts.field.type" },
  { sort: "status", label: "operations.contracts.field.status" },
  { sort: "effective", label: "operations.contracts.field.effectiveDate" },
  { sort: "renewal", label: "operations.contracts.column.renewsOrEnds" },
  { sort: "notice", label: "operations.contracts.field.noticeDeadline" },
  { sort: null, label: "operations.contracts.field.owner" },
];

function SortControl({
  query,
  sort,
  label,
  t,
}: {
  query: Query;
  sort: ContractSort;
  label: string;
  t: Translator;
}) {
  const active = query.sort === sort;
  const current = query.direction ?? (sort === "updated" ? "desc" : "asc");
  const next = active && current === "asc" ? "desc" : "asc";
  const Icon = !active ? ArrowUpDown : current === "asc" ? ArrowUp : ArrowDown;
  return (
    <Link
      className={styles.sortLink}
      href={registerHref({ ...query, sort, direction: next, page: 1 })}
      aria-label={t(
        next === "asc"
          ? "operations.contracts.sort.ascending"
          : "operations.contracts.sort.descending",
        { column: label },
      )}
    >
      {label}
      <Icon aria-hidden="true" />
    </Link>
  );
}

function Counterparty({
  row,
  t,
  canOpenMndas,
}: {
  row: ContractListRow;
  t: Translator;
  canOpenMndas: boolean;
}) {
  return (
    <span className={styles.primaryCell}>
      <RowLink row={row} canOpenMndas={canOpenMndas} />
      {row.source === "mnda" ? (
        <span className={styles.secondaryText}>
          {t("operations.contracts.source.mndaRow")}
        </span>
      ) : row.title ? (
        <span className={styles.secondaryText}>{row.title}</span>
      ) : null}
      <Tags tags={row.tags} />
    </span>
  );
}

export function RegisterView({
  t,
  locale,
  query,
  result,
  today,
  canWrite,
  canOpenMndas,
  demo = false,
}: {
  t: Translator;
  locale: string;
  query: Query;
  result: ContractListResult;
  today: string;
  canWrite: boolean;
  canOpenMndas: boolean;
  /** The fictional demo register: read-only, with no stored documents. */
  demo?: boolean;
}) {
  const filtered = Boolean(
    query.q || query.type || query.status || query.window || query.mine,
  );
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  return (
    <main className={styles.page} id="main-content">
      <PageHeader
        title={t("operations.contracts.title")}
        description={t("operations.contracts.description")}
        actions={
          <div className={styles.headerActions}>
            {canWrite ? (
              <>
                <Link
                  className={buttonClassName()}
                  href="/internal/contracts/new"
                >
                  {t("operations.contracts.action.record")}
                </Link>
                <Link
                  className={buttonClassName({ variant: "secondary" })}
                  href="/internal/contracts/templates"
                >
                  {t("operations.contracts.action.fromTemplate")}
                </Link>
              </>
            ) : null}
            <Link
              className={buttonClassName({ variant: "secondary" })}
              href="/internal/contracts/notices"
            >
              {t("operations.contracts.action.renewals")}
            </Link>
          </div>
        }
      />
      {demo ? (
        <InlineNotice tone="info" title={t("operations.contracts.demo")} />
      ) : null}
      <RegisterFilters query={query} />

      {result.total === 0 ? (
        filtered ? (
          <EmptyState
            title={t("operations.contracts.empty.filteredTitle")}
            description={t("operations.contracts.empty.filteredBody")}
            action={
              <Link
                className={buttonClassName({ variant: "secondary" })}
                href="/internal/contracts"
              >
                {t("operations.contracts.filters.clear")}
              </Link>
            }
          />
        ) : (
          <EmptyState
            title={t("operations.contracts.empty.title")}
            description={t("operations.contracts.empty.body")}
            {...(canWrite
              ? {
                  action: (
                    <Link
                      className={buttonClassName()}
                      href="/internal/contracts/new"
                    >
                      {t("operations.contracts.action.record")}
                    </Link>
                  ),
                }
              : {})}
          />
        )
      ) : (
        <section aria-labelledby="contract-results" className={styles.stack}>
          <div className={styles.resultBar}>
            <h2 id="contract-results" className="cw-sr-only">
              {t("operations.contracts.results")}
            </h2>
            <span role="status">
              {t("operations.contracts.count", { count: result.total })}
            </span>
            <a
              className={buttonClassName({ variant: "quiet", size: "small" })}
              href={exportHref(query)}
              download
            >
              {t("operations.contracts.action.export")}
            </a>
          </div>
          {result.total > contractExportLimit ? (
            <p className={styles.muted} role="note">
              {t("operations.contracts.export.truncated", {
                limit: new Intl.NumberFormat(locale).format(
                  contractExportLimit,
                ),
              })}
            </p>
          ) : null}
          <div className={styles.desktopOnly}>
            <Table
              caption={t("operations.contracts.title")}
              captionHidden
              density="compact"
              headers={columns.map((c) => t(c.label))}
              columnSort={columns.map((c) =>
                c.sort
                  ? {
                      direction:
                        query.sort === c.sort
                          ? (query.direction ??
                              (c.sort === "updated" ? "desc" : "asc")) === "asc"
                            ? "ascending"
                            : "descending"
                          : null,
                      control: (
                        <SortControl
                          query={query}
                          sort={c.sort}
                          label={t(c.label)}
                          t={t}
                        />
                      ),
                    }
                  : null,
              )}
              rowKeys={result.rows.map((row) => row.id)}
              rows={result.rows.map((row) => [
                <Counterparty
                  key="name"
                  row={row}
                  t={t}
                  canOpenMndas={canOpenMndas}
                />,
                t(contractTypeLabels[row.contractType]),
                <StatusValue key="status" row={row} t={t} />,
                <DateValue
                  key="effective"
                  date={row.effectiveDate}
                  t={t}
                  locale={locale}
                />,
                <TermBoundaryValue
                  key="term"
                  row={row}
                  t={t}
                  locale={locale}
                />,
                <DeadlineValue
                  key="notice"
                  date={row.noticeDeadline}
                  today={today}
                  t={t}
                  locale={locale}
                />,
                row.ownerName,
              ])}
            />
          </div>
          <ul className={`${styles.mobileOnly} ${styles.mobileList}`}>
            {result.rows.map((row) => (
              <li className={styles.mobileCard} key={row.id}>
                <h3>
                  <RowLink row={row} canOpenMndas={canOpenMndas} />
                </h3>
                <StatusValue row={row} t={t} />
                <dl>
                  <div>
                    <dt>{t("operations.contracts.field.type")}</dt>
                    <dd>{t(contractTypeLabels[row.contractType])}</dd>
                  </div>
                  <div>
                    <dt>{t("operations.contracts.field.owner")}</dt>
                    <dd>{row.ownerName}</dd>
                  </div>
                  <div>
                    <dt>{t("operations.contracts.column.renewsOrEnds")}</dt>
                    <dd>
                      <TermBoundaryValue row={row} t={t} locale={locale} />
                    </dd>
                  </div>
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
                </dl>
                <Tags tags={row.tags} />
              </li>
            ))}
          </ul>
          {pages > 1 ? (
            <nav
              className={styles.pagination}
              aria-label={t("operations.contracts.pagination.label")}
            >
              <span>
                {t("operations.contracts.pagination.position", {
                  page: query.page,
                  pages,
                })}
              </span>
              <span className={styles.paginationLinks}>
                {query.page > 1 ? (
                  <Link
                    className={buttonClassName({
                      variant: "secondary",
                      size: "small",
                    })}
                    href={registerHref({ ...query, page: query.page - 1 })}
                  >
                    {t("operations.contracts.pagination.previous")}
                  </Link>
                ) : null}
                {query.page < pages ? (
                  <Link
                    className={buttonClassName({
                      variant: "secondary",
                      size: "small",
                    })}
                    href={registerHref({ ...query, page: query.page + 1 })}
                  >
                    {t("operations.contracts.pagination.next")}
                  </Link>
                ) : null}
              </span>
            </nav>
          ) : null}
        </section>
      )}
    </main>
  );
}
