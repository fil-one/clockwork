"use client";
import { useTranslations } from "@/src/i18n/client";
import type { MessageId, Translator } from "@/src/i18n";

import type { Route } from "next";
import Link from "next/link";

import { buttonClassName, Table } from "@clockwork/ui";

import type { SurfaceFormatting } from "../formatting";
import {
  ProjectionFreshnessNotice,
  type ProjectionFreshness,
} from "../projection-freshness";
import {
  columnSortDirection,
  columnSortLabel,
  nextColumnSort,
  type SortableColumn,
} from "../sortable-column";
import {
  collectionDefinitions,
  type CollectionDefinition,
  type CollectionKind,
  type CommercialRecord,
} from "./model";
import styles from "./commercial.module.css";
import {
  commercialDisplay,
  commercialStatusLabel,
} from "./record-presentation";
import {
  collectionUrl,
  filterAndSortRecords,
  parseCollectionState,
  type CollectionState,
  type RawSearchParams,
} from "./url-state";

function unique(records: readonly CommercialRecord[], key: "status" | "owner") {
  return Array.from(new Set(records.map((record) => record[key]))).sort();
}

const riskLevels = {
  low: "risk.level.low",
  medium: "risk.level.medium",
  high: "risk.level.high",
} as const satisfies Record<CommercialRecord["risk"], MessageId>;

/**
 * Each record as this reader sees it: every display string rendered from the
 * record's facts in the reader's language, and a numeric sort key for the
 * value column. Filtering, sorting and search all run on this, so a reader
 * searching in Portuguese matches the Portuguese status they see.
 */
function displayed(
  records: readonly CommercialRecord[],
  t: Translator,
  locale: string,
): CommercialRecord[] {
  return records.map((record) => {
    const display = commercialDisplay(record, t, locale);
    return {
      ...record,
      description: display.description,
      statusLabel: display.statusLabel,
      value: display.value,
      valueLabel: display.valueLabel,
      dateLabel: display.timing,
      term: display.term,
      nextAction: display.nextAction,
      ...(display.valueSort === null ? {} : { valueSort: display.valueSort }),
    };
  });
}

/** The status filter's option for a status no displayed record is in. */
function statusOption(
  kind: CollectionKind,
  status: string,
  records: readonly CommercialRecord[],
  t: Translator,
): string {
  return (
    commercialStatusLabel(kind, status, t) ??
    records.find((record) => record.status === status)?.statusLabel ??
    status
  );
}

/**
 * The commercial context column holds a magnitude in these collections and free
 * text in the others (a term end for agreements, an evaluation outcome for
 * proofs of concept), so only these align it numerically.
 */
const numericValueKinds: readonly CollectionKind[] = [
  "quotes",
  "orders",
  "services",
  "billing",
];

/**
 * The three columns whose ordering `filterAndSortRecords` can express, and the
 * table index each one occupies.
 *
 * Status, risk and owner are deliberately absent: this collection has no sort
 * for them, and a header advertising `aria-sort` that nothing can act on is a
 * worse lie than an inert header. They are filters here, and the filter panel
 * above the table is where they are answered.
 */
const sortableColumns: Readonly<
  Record<
    number,
    { name: MessageId; column: SortableColumn<CollectionState["sort"]> }
  >
> = {
  0: {
    name: "customer.commercial.column.record",
    column: { ascending: "title_asc", descending: "title_desc" },
  },
  4: {
    name: "customer.commercial.column.context",
    column: {
      ascending: "value_asc",
      descending: "value_desc",
      first: "descending",
    },
  },
  5: {
    name: "customer.commercial.column.timing",
    column: {
      ascending: "updated_asc",
      descending: "updated_desc",
      first: "descending",
    },
  },
};

function RecordTable({
  definition,
  records,
  pathname,
  state,
}: {
  definition: CollectionDefinition;
  records: readonly CommercialRecord[];
  pathname: Route;
  state: CollectionState;
}) {
  const t = useTranslations();
  const headers = [
    t("customer.commercial.column.record"),
    t("common.status"),
    t("common.risk"),
    t("common.owner"),
    t("customer.commercial.column.context"),
    t("customer.commercial.column.timing"),
  ];
  return (
    <Table
      caption={t(definition.title)}
      captionHidden
      className={styles.tableWrap ?? ""}
      columnSort={headers.map((header, index) => {
        const sortable = sortableColumns[index];
        if (!sortable) return null;
        return {
          direction: columnSortDirection(sortable.column, state.sort),
          control: (
            <Link
              aria-label={columnSortLabel(
                sortable.column,
                state.sort,
                t(sortable.name),
                t,
              )}
              className={styles.sortLink}
              // Sorting reorders the whole filtered set, so the reader is put
              // back on its first page rather than on page four of an
              // ordering that no longer exists.
              href={collectionUrl(pathname, state, {
                page: 1,
                sort: nextColumnSort(sortable.column, state.sort),
              })}
            >
              {header}
            </Link>
          ),
        };
      })}
      headers={headers}
      numericColumns={numericValueKinds.includes(definition.kind) ? [4] : []}
      rowKeys={records.map((record) => record.id)}
      rows={records.map((record) => [
        <>
          <Link className={styles.recordLink} href={record.href as Route}>
            {record.title}
          </Link>
          <div className={styles.recordMeta}>
            {t("common.join.labels", {
              first: record.description,
              second: record.id,
            })}
          </div>
        </>,
        <span className={`${styles.badge} ${styles[record.tone]}`}>
          {record.statusLabel}
        </span>,
        <span className={styles.risk}>{t(riskLevels[record.risk])}</span>,
        record.owner,
        <>
          <strong>{record.value}</strong>
          <div className={styles.recordMeta}>{record.valueLabel}</div>
        </>,
        record.dateLabel,
      ])}
    />
  );
}

function RecordCards({
  records,
  forced = false,
}: {
  records: readonly CommercialRecord[];
  forced?: boolean;
}) {
  const t = useTranslations();
  return (
    <ul className={`${styles.cards} ${forced ? styles.cardsForced : ""}`}>
      {records.map((record) => (
        <li className={styles.card} key={record.id}>
          <div className={styles.cardTop}>
            <div>
              <Link className={styles.cardLink} href={record.href as Route}>
                {record.title}
              </Link>
              <div className={styles.recordMeta}>{record.description}</div>
            </div>
            <span className={`${styles.badge} ${styles[record.tone]}`}>
              {record.statusLabel}
            </span>
          </div>
          <dl>
            <div>
              <dt>{record.valueLabel}</dt>
              <dd>{record.value}</dd>
            </div>
            <div>
              <dt>{t("common.owner")}</dt>
              <dd>{record.owner}</dd>
            </div>
            <div>
              <dt>{t("common.risk")}</dt>
              <dd className={styles.risk}>{t(riskLevels[record.risk])}</dd>
            </div>
            <div>
              <dt>{t("customer.commercial.column.timing")}</dt>
              <dd>{record.dateLabel}</dd>
            </div>
          </dl>
          <div className={styles.cardBottom}>
            <span className={styles.muted}>{record.id}</span>
            <Link className={styles.textButton} href={record.href as Route}>
              {t("customer.commercial.openRecord")}
            </Link>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function CommercialLoadingState() {
  const t = useTranslations();
  return (
    <main className={styles.main} id="main-content">
      <section className={styles.state} role="status">
        <h1>{t("customer.commercial.state.loadingTitle")}</h1>
        <p>{t("customer.commercial.state.loadingBody")}</p>
      </section>
    </main>
  );
}

export function CommercialErrorState({ retry }: { retry?: () => void }) {
  const t = useTranslations();
  return (
    <main className={styles.main} id="main-content">
      <section className={styles.state} role="alert">
        <h1>{t("customer.commercial.state.errorTitle")}</h1>
        <p>{t("customer.commercial.state.errorBody")}</p>
        {retry ? (
          <button
            className={buttonClassName({ variant: "secondary" })}
            onClick={retry}
            type="button"
          >
            {t("customer.commercial.buy.tryAgain")}
          </button>
        ) : null}
      </section>
    </main>
  );
}

export function CommercialCollectionPage({
  kind,
  searchParams,
  records: projectedRecords,
  freshness,
  formatting,
  canUsePrimaryAction = true,
}: {
  kind: CollectionKind;
  searchParams: RawSearchParams;
  records: readonly CommercialRecord[];
  /** The `stale`/`generatedAt` pair the loader returned for this read. */
  freshness: ProjectionFreshness;
  /** Locale and zone of the person reading, from the active route session. */
  formatting: SurfaceFormatting;
  canUsePrimaryAction?: boolean;
}) {
  const t = useTranslations();
  const definition = collectionDefinitions[kind];
  const state = parseCollectionState(searchParams);
  const allRecords = displayed(projectedRecords, t, formatting.locale);
  const filtered = filterAndSortRecords(allRecords, state);
  const totalPages = Math.max(1, Math.ceil(filtered.length / state.pageSize));
  const page = Math.min(state.page, totalPages);
  const start = (page - 1) * state.pageSize;
  const records = filtered.slice(start, start + state.pageSize);
  const hasFilters = Boolean(
    state.q || state.status || state.risk || state.owner,
  );
  const pathname = `/${kind}` as Route;
  const statusValues = unique(allRecords, "status");
  const ownerValues = unique(allRecords, "owner");

  return (
    <main className={styles.main} id="main-content">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>{t(definition.eyebrow)}</p>
          <h1>{t(definition.title)}</h1>
          <p className={styles.description}>{t(definition.description)}</p>
          <ProjectionFreshnessNotice
            formatting={formatting}
            freshness={freshness}
          />
        </div>
        {definition.primaryAction && canUsePrimaryAction ? (
          <Link
            className={buttonClassName()}
            href={definition.primaryAction.href}
          >
            {t(definition.primaryAction.label)}
          </Link>
        ) : definition.primaryAction ? (
          <p className={styles.muted}>
            {t("customer.commercial.collection.restricted")}
          </p>
        ) : null}
      </header>

      <form className={`${styles.panel} ${styles.filters}`} method="get">
        <div className={styles.field}>
          <label htmlFor={`${kind}-search`}>{t("common.search")}</label>
          <input
            defaultValue={state.q}
            id={`${kind}-search`}
            name="q"
            placeholder={t(definition.searchPlaceholder)}
            type="search"
          />
        </div>
        <div className={styles.field}>
          <label htmlFor={`${kind}-status`}>{t("common.status")}</label>
          <select
            defaultValue={state.status}
            id={`${kind}-status`}
            name="status"
          >
            <option value="">{t("common.allStatuses")}</option>
            {statusValues.map((status) => (
              <option key={status} value={status}>
                {statusOption(kind, status, allRecords, t)}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor={`${kind}-risk`}>{t("common.risk")}</label>
          <select defaultValue={state.risk} id={`${kind}-risk`} name="risk">
            <option value="">{t("common.allRiskLevels")}</option>
            <option value="high">{t("risk.level.high")}</option>
            <option value="medium">{t("risk.level.medium")}</option>
            <option value="low">{t("risk.level.low")}</option>
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor={`${kind}-owner`}>{t("common.owner")}</label>
          <select defaultValue={state.owner} id={`${kind}-owner`} name="owner">
            <option value="">{t("common.allOwners")}</option>
            {ownerValues.map((owner) => (
              <option key={owner} value={owner}>
                {owner}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor={`${kind}-sort`}>{t("common.sort")}</label>
          <select defaultValue={state.sort} id={`${kind}-sort`} name="sort">
            {/*
              Every token `parseCollectionState` accepts has an option here.
              A header sort that produced a value this list does not carry
              would leave the control showing no selection at all, which is
              the same page silently disagreeing with itself.
            */}
            <option value="updated_desc">
              {t("customer.commercial.sort.updatedDesc")}
            </option>
            <option value="updated_asc">
              {t("customer.commercial.sort.updatedAsc")}
            </option>
            <option value="title_asc">
              {t("customer.commercial.sort.titleAsc")}
            </option>
            <option value="title_desc">
              {t("customer.commercial.sort.titleDesc")}
            </option>
            <option value="value_desc">
              {t("customer.commercial.sort.valueDesc")}
            </option>
            <option value="value_asc">
              {t("customer.commercial.sort.valueAsc")}
            </option>
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor={`${kind}-size`}>{t("common.rowsPerPage")}</label>
          <select
            defaultValue={state.pageSize}
            id={`${kind}-size`}
            name="pageSize"
          >
            <option value="5">5</option>
            <option value="10">10</option>
            <option value="20">20</option>
          </select>
        </div>
        <input name="view" type="hidden" value={state.view} />
        <input name="page" type="hidden" value="1" />
        <button
          className={buttonClassName({ className: styles.filterSubmit ?? "" })}
          type="submit"
        >
          {t("common.apply")}
        </button>
      </form>

      <section className={styles.panel} aria-labelledby={`${kind}-results`}>
        <div className={styles.resultHeader}>
          <div>
            <h2 id={`${kind}-results`}>
              {t("common.results", { count: filtered.length })}
            </h2>
            <p>
              {t("customer.commercial.collection.pageStatus", {
                page,
                pages: totalPages,
              })}
            </p>
          </div>
          <div className={styles.resultActions}>
            <div className={styles.viewControls}>
              <span className={styles.viewLabel}>{t("common.view")}</span>
              <Link
                className={styles.viewLink}
                href={collectionUrl(pathname, state, {
                  view: "table",
                  page: 1,
                })}
                aria-current={state.view === "table" ? "true" : undefined}
              >
                {t("common.view.table")}
              </Link>
              <Link
                className={styles.viewLink}
                href={collectionUrl(pathname, state, {
                  view: "compact",
                  page: 1,
                })}
                aria-current={state.view === "compact" ? "true" : undefined}
              >
                {t("common.view.cards")}
              </Link>
            </div>
            {hasFilters ? (
              <Link
                className={buttonClassName({ variant: "secondary" })}
                href={pathname}
              >
                {t("common.clearFilters")}
              </Link>
            ) : null}
          </div>
        </div>
        {records.length ? (
          <>
            {state.view === "table" ? (
              <RecordTable
                definition={definition}
                pathname={pathname}
                records={records}
                state={state}
              />
            ) : null}
            <RecordCards forced={state.view === "compact"} records={records} />
            <nav
              className={styles.pagination}
              aria-label={t("common.pagination")}
            >
              {page <= 1 ? (
                <span aria-disabled="true" className={styles.pageLink}>
                  {t("common.pagination.previous")}
                </span>
              ) : (
                <Link
                  className={styles.pageLink}
                  href={collectionUrl(pathname, state, { page: page - 1 })}
                >
                  {t("common.pagination.previous")}
                </Link>
              )}
              <span aria-live="polite">
                {page} / {totalPages}
              </span>
              {page >= totalPages ? (
                <span aria-disabled="true" className={styles.pageLink}>
                  {t("common.pagination.next")}
                </span>
              ) : (
                <Link
                  className={styles.pageLink}
                  href={collectionUrl(pathname, state, { page: page + 1 })}
                >
                  {t("common.pagination.next")}
                </Link>
              )}
            </nav>
          </>
        ) : (
          <div className={styles.state}>
            <h3>
              {hasFilters
                ? t("customer.commercial.state.noMatchTitle")
                : t("customer.commercial.state.emptyTitle")}
            </h3>
            <p>
              {hasFilters
                ? t("customer.commercial.state.noMatchBody")
                : t("customer.commercial.state.emptyBody")}
            </p>
            {hasFilters ? (
              <Link
                className={buttonClassName({ variant: "secondary" })}
                href={pathname}
              >
                {t("common.clearFilters")}
              </Link>
            ) : null}
          </div>
        )}
      </section>
      <p className={styles.ruleFooter}>{t(definition.rule)}</p>
    </main>
  );
}
