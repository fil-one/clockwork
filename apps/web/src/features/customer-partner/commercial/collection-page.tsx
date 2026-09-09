"use client";
import { useTranslations } from "@/src/i18n/client";

import { localizeCopy } from "@/src/i18n/copy";
import type { Route } from "next";
import Link from "next/link";

import { buttonClassName, Table } from "@clockwork/ui";

import { customerPartnerCopy } from "../copy";
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
  collectionUrl,
  filterAndSortRecords,
  parseCollectionState,
  type CollectionState,
  type RawSearchParams,
} from "./url-state";

function unique(records: readonly CommercialRecord[], key: "status" | "owner") {
  return Array.from(new Set(records.map((record) => record[key]))).sort();
}

function titleCase(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
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
    { name: string; column: SortableColumn<CollectionState["sort"]> }
  >
> = {
  0: {
    name: "Record",
    column: { ascending: "title_asc", descending: "title_desc" },
  },
  4: {
    name: "Commercial context",
    column: {
      ascending: "value_asc",
      descending: "value_desc",
      first: "descending",
    },
  },
  5: {
    name: "Timing",
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
  const localizedcustomerPartnerCopy = localizeCopy(customerPartnerCopy, t);
  const headers = [
    "Record",
    localizedcustomerPartnerCopy.common.status,
    localizedcustomerPartnerCopy.common.risk,
    localizedcustomerPartnerCopy.common.owner,
    "Commercial context",
    "Timing",
  ];
  return (
    <Table
      caption={`${definition.title} results`}
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
                sortable.name,
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
            {record.description} · {record.id}
          </div>
        </>,
        <span className={`${styles.badge} ${styles[record.tone]}`}>
          {record.statusLabel}
        </span>,
        <span className={styles.risk}>{record.risk}</span>,
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
              <dt>{t("partner.detail.owner")}</dt>
              <dd>{record.owner}</dd>
            </div>
            <div>
              <dt>{t("ui.89")}</dt>
              <dd className={styles.risk}>{record.risk}</dd>
            </div>
            <div>
              <dt>Timing</dt>
              <dd>{record.dateLabel}</dd>
            </div>
          </dl>
          <div className={styles.cardBottom}>
            <span className={styles.muted}>{record.id}</span>
            <Link className={styles.textButton} href={record.href as Route}>
              {t("action.open")}
            </Link>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function CommercialLoadingState() {
  const t = useTranslations();
  const localizedcustomerPartnerCopy = localizeCopy(customerPartnerCopy, t);
  return (
    <main className={styles.main} id="main-content">
      <section className={styles.state} role="status">
        <h1>{localizedcustomerPartnerCopy.common.loadingTitle}</h1>
        <p>{localizedcustomerPartnerCopy.common.loadingBody}</p>
      </section>
    </main>
  );
}

export function CommercialErrorState({ retry }: { retry?: () => void }) {
  const t = useTranslations();
  const localizedcustomerPartnerCopy = localizeCopy(customerPartnerCopy, t);
  return (
    <main className={styles.main} id="main-content">
      <section className={styles.state} role="alert">
        <h1>{localizedcustomerPartnerCopy.common.errorTitle}</h1>
        <p>{localizedcustomerPartnerCopy.common.errorBody}</p>
        {retry ? (
          <button
            className={buttonClassName({ variant: "secondary" })}
            onClick={retry}
            type="button"
          >
            {t("action.retry")}
          </button>
        ) : null}
      </section>
    </main>
  );
}

export function CommercialCollectionPage({
  kind,
  searchParams,
  records: allRecords,
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
  const localizedcustomerPartnerCopy = localizeCopy(customerPartnerCopy, t);
  const definition = collectionDefinitions[kind];
  const state = parseCollectionState(searchParams);
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
          <p className={styles.eyebrow}>{definition.eyebrow}</p>
          <h1>{definition.title}</h1>
          <p className={styles.description}>{definition.description}</p>
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
            {definition.primaryAction.label}
          </Link>
        ) : definition.primaryAction ? (
          <p className={styles.muted}>
            An account owner or administrator can take this action.
          </p>
        ) : null}
      </header>

      <form className={`${styles.panel} ${styles.filters}`} method="get">
        <div className={styles.field}>
          <label htmlFor={`${kind}-search`}>
            {localizedcustomerPartnerCopy.common.search}
          </label>
          <input
            defaultValue={state.q}
            id={`${kind}-search`}
            name="q"
            placeholder={`Search ${definition.title.toLocaleLowerCase()}`}
            type="search"
          />
        </div>
        <div className={styles.field}>
          <label htmlFor={`${kind}-status`}>
            {localizedcustomerPartnerCopy.common.status}
          </label>
          <select
            defaultValue={state.status}
            id={`${kind}-status`}
            name="status"
          >
            <option value="">All statuses</option>
            {statusValues.map((status) => (
              <option key={status} value={status}>
                {titleCase(status)}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor={`${kind}-risk`}>
            {localizedcustomerPartnerCopy.common.risk}
          </label>
          <select defaultValue={state.risk} id={`${kind}-risk`} name="risk">
            <option value="">All risk levels</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor={`${kind}-owner`}>
            {localizedcustomerPartnerCopy.common.owner}
          </label>
          <select defaultValue={state.owner} id={`${kind}-owner`} name="owner">
            <option value="">All owners</option>
            {ownerValues.map((owner) => (
              <option key={owner} value={owner}>
                {owner}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor={`${kind}-sort`}>
            {localizedcustomerPartnerCopy.common.sort}
          </label>
          <select defaultValue={state.sort} id={`${kind}-sort`} name="sort">
            {/*
              Every token `parseCollectionState` accepts has an option here.
              A header sort that produced a value this list does not carry
              would leave the control showing no selection at all, which is
              the same page silently disagreeing with itself.
            */}
            <option value="updated_desc">Recently updated</option>
            <option value="updated_asc">Oldest updated</option>
            <option value="title_asc">Title A–Z</option>
            <option value="title_desc">Title Z–A</option>
            <option value="value_desc">Highest value</option>
            <option value="value_asc">Lowest value</option>
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor={`${kind}-size`}>
            {localizedcustomerPartnerCopy.common.pageSize}
          </label>
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
          Apply
        </button>
      </form>

      <section className={styles.panel} aria-labelledby={`${kind}-results`}>
        <div className={styles.resultHeader}>
          <div>
            <h2 id={`${kind}-results`}>
              {filtered.length} {filtered.length === 1 ? "result" : "results"}
            </h2>
            <p>
              Page {page} of {totalPages} · filters stay in the URL
            </p>
          </div>
          <div className={styles.resultActions}>
            <div className={styles.viewControls}>
              <span className={styles.viewLabel}>
                {localizedcustomerPartnerCopy.common.view}
              </span>
              <Link
                className={styles.viewLink}
                href={collectionUrl(pathname, state, {
                  view: "table",
                  page: 1,
                })}
                aria-current={state.view === "table" ? "true" : undefined}
              >
                Table
              </Link>
              <Link
                className={styles.viewLink}
                href={collectionUrl(pathname, state, {
                  view: "compact",
                  page: 1,
                })}
                aria-current={state.view === "compact" ? "true" : undefined}
              >
                Cards
              </Link>
            </div>
            {hasFilters ? (
              <Link
                className={buttonClassName({ variant: "secondary" })}
                href={pathname}
              >
                Clear filters
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
            <nav className={styles.pagination} aria-label="Result pages">
              {page <= 1 ? (
                <span aria-disabled="true" className={styles.pageLink}>
                  {localizedcustomerPartnerCopy.common.previous}
                </span>
              ) : (
                <Link
                  className={styles.pageLink}
                  href={collectionUrl(pathname, state, { page: page - 1 })}
                >
                  {localizedcustomerPartnerCopy.common.previous}
                </Link>
              )}
              <span aria-live="polite">
                {page} / {totalPages}
              </span>
              {page >= totalPages ? (
                <span aria-disabled="true" className={styles.pageLink}>
                  {localizedcustomerPartnerCopy.common.next}
                </span>
              ) : (
                <Link
                  className={styles.pageLink}
                  href={collectionUrl(pathname, state, { page: page + 1 })}
                >
                  {localizedcustomerPartnerCopy.common.next}
                </Link>
              )}
            </nav>
          </>
        ) : (
          <div className={styles.state}>
            <h3>
              {hasFilters
                ? localizedcustomerPartnerCopy.common.noMatchTitle
                : localizedcustomerPartnerCopy.common.emptyTitle}
            </h3>
            <p>
              {hasFilters
                ? localizedcustomerPartnerCopy.common.noMatchBody
                : localizedcustomerPartnerCopy.common.emptyBody}
            </p>
            {hasFilters ? (
              <Link
                className={buttonClassName({ variant: "secondary" })}
                href={pathname}
              >
                Clear filters
              </Link>
            ) : null}
          </div>
        )}
      </section>
      <p className={styles.ruleFooter}>{definition.rule}</p>
    </main>
  );
}
