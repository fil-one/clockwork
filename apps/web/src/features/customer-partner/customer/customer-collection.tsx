import { getTranslations } from "@/src/i18n/server";
import { use } from "react";
import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import {
  ApplicationStatePanel,
  buttonClassName,
  StatusBadge,
  Table,
} from "@clockwork/ui";

import type { MessageId, Translator } from "@/src/i18n";
import { richText } from "@/src/i18n/rich";

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
  collectionPageSizes,
  collectionRisks,
  collectionSorts,
  collectionStatuses,
  filterAndSortRecords,
  paginateRecords,
  parseCollectionState,
  serializeCollectionState,
  type CollectionRisk,
  type CollectionSort,
  type CollectionStatus,
  type CollectionUrlState,
  type CustomerCollectionRow,
  type RawCollectionSearchParams,
} from "./collection-state";
import { presentCustomerRecord } from "./collection-record";
import type { CustomerCollectionConfig } from "./customer-data";
import styles from "./customer-collection.module.css";
import { EvidenceUploadControl } from "@/src/features/experience-server/evidence-upload-control";

function asRoute(path: string): Route {
  return path as Route;
}

const statusOptions: Readonly<Record<CollectionStatus, MessageId>> = {
  all: "common.allStatuses",
  active: "status.active",
  pending: "status.pending",
  review: "status.review",
  complete: "status.complete",
  blocked: "status.blocked",
};

/** "All risk levels" in the filter; the levels themselves are "Low", "High". */
const riskOptions: Readonly<Record<CollectionRisk, MessageId>> = {
  all: "common.allRiskLevels",
  low: "risk.level.low",
  medium: "risk.level.medium",
  high: "risk.level.high",
};

const sortOptions: Readonly<Record<CollectionSort, MessageId>> = {
  "updated-desc": "common.sort.newest",
  "updated-asc": "common.sort.oldest",
  "title-asc": "customer.collection.sort.titleAsc",
  "title-desc": "customer.collection.sort.titleDesc",
  "value-desc": "common.sort.valueDesc",
  "value-asc": "common.sort.valueAsc",
};

function riskLevel(record: CustomerCollectionRow, t: Translator): string {
  return t(riskOptions[record.risk]);
}

function tone(record: CustomerCollectionRow) {
  if (record.status === "active" || record.status === "complete")
    return "success" as const;
  if (record.status === "blocked") return "danger" as const;
  return "warning" as const;
}

function stateHref(path: string, params: URLSearchParams, hash = ""): Route {
  const query = params.toString();
  return asRoute(`${path}${query ? `?${query}` : ""}${hash}`);
}

function recordHref(
  config: CustomerCollectionConfig,
  record: CustomerCollectionRow,
  params: URLSearchParams,
): Route {
  if (record.href) return asRoute(record.href);
  const next = new URLSearchParams(params);
  next.set("record", record.id);
  return stateHref(config.path, next, "#selected-record");
}

/**
 * Table column index to the pair of sort tokens that column can produce.
 *
 * Status and owner are filters on this surface, not orderings -- there is no
 * `status-asc` for `filterAndSortRecords` to apply -- so their headers stay
 * inert and carry no `aria-sort`.
 */
const sortableColumns: Readonly<
  Record<number, SortableColumn<CollectionSort>>
> = {
  0: { ascending: "title-asc", descending: "title-desc" },
  3: { ascending: "value-asc", descending: "value-desc", first: "descending" },
  4: {
    ascending: "updated-asc",
    descending: "updated-desc",
    first: "descending",
  },
};

function CollectionTable({
  config,
  records,
  params,
  state,
}: {
  config: CustomerCollectionConfig;
  records: readonly CustomerCollectionRow[];
  params: URLSearchParams;
  state: CollectionUrlState;
}) {
  const t = use(getTranslations());
  const headers = [
    t(config.recordLabel),
    t("common.status"),
    t(config.ownerLabel),
    t(config.valueLabel),
    t("customer.collection.column.updated"),
  ];
  return (
    <Table
      caption={t("customer.collection.resultsCaption", {
        collection: t(config.title),
      })}
      captionHidden
      className={styles.tableWrap ?? ""}
      columnSort={headers.map((header, index) => {
        const column = sortableColumns[index];
        if (!column) return null;
        return {
          direction: columnSortDirection(column, state.sort),
          control: (
            <Link
              aria-label={columnSortLabel(column, state.sort, header, t)}
              className={styles.sortLink}
              // A new ordering starts at its own first page; keeping the old
              // page number would land the reader in the middle of a list
              // they have not seen the top of.
              href={stateHref(
                config.path,
                serializeCollectionState(state, {
                  page: 1,
                  sort: nextColumnSort(column, state.sort),
                }),
              )}
            >
              {header}
            </Link>
          ),
        };
      })}
      headers={headers}
      rowKeys={records.map((record) => record.id)}
      rows={records.map((record) => [
        <>
          <Link
            className={styles.recordLink}
            href={recordHref(config, record, params)}
          >
            {record.title}
          </Link>
          <span className={styles.recordDescription}>{record.description}</span>
          <span className={styles.recordId}>{record.id}</span>
        </>,
        <StatusBadge tone={tone(record)}>{record.statusLabel}</StatusBadge>,
        record.owner,
        // The value is a record fact (an amount, an address, a reference):
        // <bdi> keeps it whole -- never hyphenated -- and in its own direction.
        <strong className={styles.value}>
          <bdi>{record.value}</bdi>
        </strong>,
        <>
          {record.updatedLabel}
          <span className={styles.updated}>
            {t("customer.collection.riskLine", {
              level: riskLevel(record, t),
            })}
          </span>
        </>,
      ])}
    />
  );
}

function CollectionCards({
  config,
  records,
  params,
}: {
  config: CustomerCollectionConfig;
  records: readonly CustomerCollectionRow[];
  params: URLSearchParams;
}) {
  const t = use(getTranslations());
  return (
    <div
      className={styles.cards}
      aria-label={t("customer.collection.cardsLabel", {
        collection: t(config.title),
      })}
    >
      {records.map((record) => (
        <Link
          className={styles.cardLink}
          href={recordHref(config, record, params)}
          key={record.id}
        >
          <article className={styles.card}>
            <div className={styles.cardTop}>
              <div>
                <h2>{record.title}</h2>
                <span className={styles.recordId}>{record.id}</span>
              </div>
              <StatusBadge tone={tone(record)}>
                {record.statusLabel}
              </StatusBadge>
            </div>
            <p>{record.description}</p>
            <dl className={styles.cardMeta}>
              <div>
                <dt>{t(config.ownerLabel)}</dt>
                <dd>{record.owner}</dd>
              </div>
              <div>
                <dt>{t(config.valueLabel)}</dt>
                <dd>
                  <bdi>{record.value}</bdi>
                </dd>
              </div>
              <div>
                <dt>{t("common.risk")}</dt>
                <dd>{riskLevel(record, t)}</dd>
              </div>
              <div>
                <dt>{t("customer.collection.column.updated")}</dt>
                <dd>{record.updatedLabel}</dd>
              </div>
            </dl>
          </article>
        </Link>
      ))}
    </div>
  );
}

function SelectedRecord({
  record,
  closeHref,
  config,
}: {
  record: CustomerCollectionRow;
  closeHref: Route;
  config: CustomerCollectionConfig;
}) {
  const t = use(getTranslations());
  return (
    <section
      className={styles.selectedRecord}
      id="selected-record"
      aria-labelledby="selected-record-title"
    >
      <div className={styles.selectedHeading}>
        <div>
          <h2 id="selected-record-title">{record.title}</h2>
          <p>{record.description}</p>
        </div>
        <Link className={styles.clearLink} href={closeHref}>
          {t("customer.collection.closeDetails")}
        </Link>
      </div>
      <dl className={styles.selectedDetails}>
        <div>
          <dt>{t("common.status")}</dt>
          <dd>{record.statusLabel}</dd>
        </div>
        <div>
          <dt>{t("common.owner")}</dt>
          <dd>{record.owner}</dd>
        </div>
        <div>
          <dt>{t(config.valueLabel)}</dt>
          <dd>
            <bdi>{record.value}</bdi>
          </dd>
        </div>
        {record.context.map((item) => (
          <div key={item.label}>
            <dt>{item.label}</dt>
            <dd>{item.value}</dd>
          </div>
        ))}
      </dl>
      <details className={styles.technical}>
        <summary>{t("common.technicalDetails")}</summary>
        <p>{t("common.reference", { reference: record.id })}</p>
      </details>
      {config.key === "procurement" && record.aggregateId ? (
        <EvidenceUploadControl
          journey="procurement"
          targetId={record.aggregateId}
          kind="approval"
          label={t("customer.collection.procurement.attachEvidence")}
        />
      ) : null}
    </section>
  );
}

export function CustomerCollection({
  config,
  searchParams,
  freshness,
  formatting,
  actions,
}: {
  config: CustomerCollectionConfig;
  searchParams: RawCollectionSearchParams;
  /**
   * The `stale`/`generatedAt` pair the loader returned for this read.
   *
   * Required, not optional. The loader has returned both since it was written
   * and every route here discarded them, so the rows a customer acted on could
   * be behind their source with nothing on the page saying so, while an
   * operator looking at the same projection on `/internal/queues` was told.
   * Making it required is what stops the next collection surface from
   * repeating that by omission.
   */
  freshness: ProjectionFreshness;
  /** Locale and zone of the person reading, from the active route session. */
  formatting: SurfaceFormatting;
  /**
   * Server-backed action for this collection, supplied by the route so the
   * panel carries the route's own permission gate rather than a second guess
   * at it.
   */
  actions?: ReactNode;
}) {
  const t = use(getTranslations());
  const state = parseCollectionState(searchParams);
  // Facts become the reader's text first, so search, filters and sorting run
  // on what the reader sees rather than on the fixture's English.
  const rows = config.records.map((record) =>
    presentCustomerRecord(record, t, formatting),
  );
  const filtered = filterAndSortRecords(rows, state);
  const page = paginateRecords(filtered, state);
  const activeParams = serializeCollectionState(state, { page: page.page });
  const owners = [...new Set(rows.map((record) => record.owner))].toSorted(
    (left, right) => left.localeCompare(right, formatting.locale),
  );
  const selectedId = Array.isArray(searchParams.record)
    ? searchParams.record[0]
    : searchParams.record;
  const selected = rows.find((record) => record.id === selectedId);
  const noResults = filtered.length === 0;
  const clearHref = asRoute(config.path);
  const count = new Intl.NumberFormat(formatting.locale);
  const tableHref = stateHref(
    config.path,
    serializeCollectionState(state, { view: "table", page: 1 }),
  );
  const cardsHref = stateHref(
    config.path,
    serializeCollectionState(state, { view: "cards", page: 1 }),
  );

  return (
    <main className={styles.main} id="main-content">
      <header className={styles.header}>
        <div className={styles.headerCopy}>
          <p className={styles.eyebrow}>{t(config.eyebrow)}</p>
          <h1>{t(config.title)}</h1>
          <p className={styles.description}>{t(config.description)}</p>
        </div>
        <ProjectionFreshnessNotice
          formatting={formatting}
          freshness={freshness}
        />
      </header>

      {config.providerNote ? (
        <aside className={styles.providerNote}>
          <strong>{t("customer.collection.externalSource")}</strong>
          <span>{t(config.providerNote)}</span>
        </aside>
      ) : null}

      {actions}

      <form className={styles.filters} action={config.path} method="get">
        <label className={styles.field}>
          <span>{t("common.search")}</span>
          <input
            type="search"
            name="q"
            defaultValue={state.q}
            placeholder={t(config.searchPlaceholder)}
            maxLength={120}
          />
        </label>
        <label className={styles.field}>
          <span>{t("common.status")}</span>
          <select name="status" defaultValue={state.status}>
            {collectionStatuses.map((status) => (
              <option value={status} key={status}>
                {t(statusOptions[status])}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>{t("common.risk")}</span>
          <select name="risk" defaultValue={state.risk}>
            {collectionRisks.map((risk) => (
              <option value={risk} key={risk}>
                {t(riskOptions[risk])}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>{t("common.owner")}</span>
          <select name="owner" defaultValue={state.owner}>
            <option value="all">{t("common.allOwners")}</option>
            {owners.map((owner) => (
              <option value={owner} key={owner}>
                {owner}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>{t("common.sort")}</span>
          <select name="sort" defaultValue={state.sort}>
            {collectionSorts.map((sort) => (
              <option value={sort} key={sort}>
                {t(sortOptions[sort])}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>{t("common.rowsPerPage")}</span>
          <select name="pageSize" defaultValue={state.pageSize}>
            {collectionPageSizes.map((pageSize) => (
              <option value={pageSize} key={pageSize}>
                {count.format(pageSize)}
              </option>
            ))}
          </select>
        </label>
        <input type="hidden" name="view" value={state.view} />
        <input type="hidden" name="page" value="1" />
        <div className={styles.filterActions}>
          <Link className={styles.clearLink} href={clearHref}>
            {t("common.clearFilters")}
          </Link>
          <button className={buttonClassName()} type="submit">
            {t("customer.collection.applyFilters")}
          </button>
        </div>
      </form>

      <section
        className={`${styles.results} ${state.view === "cards" ? styles.cardsRequested : ""}`}
        aria-labelledby="results-title"
      >
        <div className={styles.resultsToolbar}>
          <p
            className={styles.resultCount}
            id="results-title"
            aria-live="polite"
          >
            {filtered.length > 0 ? (
              richText(t, "common.join.labels", {
                first: (
                  <strong>
                    {t("common.results", { count: filtered.length })}
                  </strong>
                ),
                second: t("customer.collection.showing", {
                  first: count.format(page.firstResult),
                  last: count.format(page.lastResult),
                }),
              })
            ) : (
              <strong>{t("common.results", { count: 0 })}</strong>
            )}
          </p>
          <div className={styles.viewControls} aria-label={t("common.view")}>
            <span className={styles.viewLabel}>{t("common.view")}</span>
            <Link
              className={styles.viewLink}
              href={tableHref}
              aria-current={state.view === "table" ? "true" : undefined}
            >
              {t("common.view.table")}
            </Link>
            <Link
              className={styles.viewLink}
              href={cardsHref}
              aria-current={state.view === "cards" ? "true" : undefined}
            >
              {t("common.view.cards")}
            </Link>
          </div>
        </div>

        {noResults ? (
          <ApplicationStatePanel
            {...(styles.statePanel ? { className: styles.statePanel } : {})}
            state="empty"
            title={
              config.records.length === 0
                ? t("cp.common.emptyTitle")
                : t("cp.common.noMatchTitle")
            }
            description={
              config.records.length === 0
                ? t("cp.common.emptyBody")
                : t("cp.common.noMatchBody")
            }
            {...(config.records.length > 0
              ? {
                  action: (
                    <Link className={styles.clearLink} href={clearHref}>
                      {t("common.clearFilters")}
                    </Link>
                  ),
                }
              : {})}
          />
        ) : (
          <>
            <CollectionTable
              config={config}
              records={page.records}
              params={activeParams}
              state={state}
            />
            <CollectionCards
              config={config}
              records={page.records}
              params={activeParams}
            />
          </>
        )}
      </section>

      <p className={styles.ruleFooter}>{t(config.rule)}</p>

      {selected ? (
        <SelectedRecord
          record={selected}
          closeHref={stateHref(config.path, activeParams)}
          config={config}
        />
      ) : null}

      <nav
        className={styles.pagination}
        aria-label={t("customer.collection.paginationLabel", {
          collection: t(config.title),
        })}
      >
        <p>
          {t("common.pagination.pageOf", {
            page: count.format(page.page),
            pages: count.format(page.pageCount),
          })}
        </p>
        <div className={styles.pageActions}>
          {page.page > 1 ? (
            <Link
              className={styles.pageLink}
              href={stateHref(
                config.path,
                serializeCollectionState(state, { page: page.page - 1 }),
              )}
              rel="prev"
            >
              {t("common.pagination.previous")}
            </Link>
          ) : (
            <span className={styles.pageDisabled} aria-disabled="true">
              {t("common.pagination.previous")}
            </span>
          )}
          {page.page < page.pageCount ? (
            <Link
              className={styles.pageLink}
              href={stateHref(
                config.path,
                serializeCollectionState(state, { page: page.page + 1 }),
              )}
              rel="next"
            >
              {t("common.pagination.next")}
            </Link>
          ) : (
            <span className={styles.pageDisabled} aria-disabled="true">
              {t("common.pagination.next")}
            </span>
          )}
        </div>
      </nav>
    </main>
  );
}
