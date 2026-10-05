import type { Route } from "next";
import Link from "next/link";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Button,
  EmptyState,
  Input,
  PageHeader,
  Select,
  Table,
  buttonClassName,
} from "@clockwork/ui";
import {
  contractRenewalWindows,
  contractStatuses,
  contractTypes,
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
import { contractStatusLabels, contractTypeLabels } from "./copy";
import styles from "./contracts.module.css";

type Query = ContractListQuery;

/** The register URL for a query, without defaults, so links stay short. */
export function registerHref(query: Partial<Query>): Route {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.type) params.set("type", query.type);
  if (query.status) params.set("status", query.status);
  if (query.window) params.set("window", String(query.window));
  if (query.sort && query.sort !== "updated") params.set("sort", query.sort);
  if (query.direction) params.set("direction", query.direction);
  if (query.page && query.page > 1) params.set("page", String(query.page));
  const search = params.toString();
  return search ? `/internal/contracts?${search}` : "/internal/contracts";
}

export const exportHref = (query: Query) =>
  registerHref({ ...query, page: 1 }).replace(
    "/internal/contracts",
    "/internal/contracts/export",
  ) as Route;

const rowHref = (row: ContractListRow) =>
  (row.source === "mnda"
    ? "/internal/mndas"
    : `/internal/contracts/${row.id}`) as Route;

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

function Counterparty({ row, t }: { row: ContractListRow; t: Translator }) {
  return (
    <span className={styles.primaryCell}>
      <Link href={rowHref(row)}>{row.counterpartyName}</Link>
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
}: {
  t: Translator;
  locale: string;
  query: Query;
  result: ContractListResult;
  today: string;
  canWrite: boolean;
}) {
  const filtered = Boolean(
    query.q || query.type || query.status || query.window,
  );
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const typeOptions = contractTypes.map((type) => ({
    value: type,
    label: t(contractTypeLabels[type]),
  }));
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
      <form
        className={`${styles.card} ${styles.filters}`}
        method="get"
        action="/internal/contracts"
        role="search"
        aria-label={t("operations.contracts.filters.label")}
      >
        <Input
          type="search"
          name="q"
          label={t("operations.contracts.filters.search")}
          placeholder={t("operations.contracts.filters.searchPlaceholder")}
          defaultValue={query.q}
          maxLength={100}
        />
        <Select
          name="type"
          label={t("operations.contracts.field.type")}
          defaultValue={query.type ?? ""}
          options={[
            { value: "", label: t("operations.contracts.filters.allTypes") },
            ...typeOptions,
          ]}
        />
        <Select
          name="status"
          label={t("operations.contracts.field.status")}
          defaultValue={query.status ?? ""}
          options={[
            { value: "", label: t("operations.contracts.filters.allStatuses") },
            ...contractStatuses.map((status) => ({
              value: status,
              label: t(contractStatusLabels[status]),
            })),
          ]}
        />
        <Select
          name="window"
          label={t("operations.contracts.column.renewsOrEnds")}
          defaultValue={query.window ? String(query.window) : ""}
          options={[
            { value: "", label: t("operations.contracts.filters.anyDate") },
            ...contractRenewalWindows.map((days) => ({
              value: String(days),
              label: t("operations.contracts.filters.within", { count: days }),
            })),
          ]}
        />
        {query.sort !== "updated" ? (
          <input type="hidden" name="sort" value={query.sort} />
        ) : null}
        {query.direction ? (
          <input type="hidden" name="direction" value={query.direction} />
        ) : null}
        <div className={styles.filterActions}>
          <Button type="submit">
            {t("operations.contracts.filters.apply")}
          </Button>
          {filtered ? (
            <Link
              className={buttonClassName({ variant: "quiet" })}
              href="/internal/contracts"
            >
              {t("operations.contracts.filters.clear")}
            </Link>
          ) : null}
        </div>
      </form>

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
                <Counterparty key="name" row={row} t={t} />,
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
                  <Link href={rowHref(row)}>{row.counterpartyName}</Link>
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
