import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import {
  ApplicationStatePanel,
  buttonClassName,
  StatusBadge,
  Table,
} from "@clockwork/ui";

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
  collectionPageSizes,
  collectionRisks,
  collectionSorts,
  collectionStatuses,
  filterAndSortRecords,
  paginateRecords,
  parseCollectionState,
  serializeCollectionState,
  type CollectionSort,
  type CollectionUrlState,
  type CustomerCollectionRecord,
  type RawCollectionSearchParams,
} from "./collection-state";
import type { CustomerCollectionConfig } from "./customer-data";
import styles from "./customer-collection.module.css";
import { EvidenceUploadControl } from "@/src/features/experience-server/evidence-upload-control";

const common = customerPartnerCopy.common;

function asRoute(path: string): Route {
  return path as Route;
}

function optionLabel(value: string): string {
  if (value === "all") return "All";
  if (value === "updated-desc") return "Newest update";
  if (value === "updated-asc") return "Oldest update";
  if (value === "title-asc") return "Title A–Z";
  if (value === "title-desc") return "Title Z–A";
  if (value === "value-desc") return "Highest value";
  if (value === "value-asc") return "Lowest value";
  return value.charAt(0).toLocaleUpperCase() + value.slice(1);
}

function tone(record: CustomerCollectionRecord) {
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
  record: CustomerCollectionRecord,
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
  records: readonly CustomerCollectionRecord[];
  params: URLSearchParams;
  state: CollectionUrlState;
}) {
  const headers = [
    config.recordLabel,
    common.status,
    config.ownerLabel,
    config.valueLabel,
    "Updated",
  ];
  return (
    <Table
      caption={`${config.title} results`}
      captionHidden
      className={styles.tableWrap ?? ""}
      columnSort={headers.map((header, index) => {
        const column = sortableColumns[index];
        if (!column) return null;
        return {
          direction: columnSortDirection(column, state.sort),
          control: (
            <Link
              aria-label={columnSortLabel(column, state.sort, header)}
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
        <strong className={styles.value}>{record.value}</strong>,
        <>
          {record.updatedLabel}
          <span className={styles.updated}>
            Risk: {optionLabel(record.risk)}
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
  records: readonly CustomerCollectionRecord[];
  params: URLSearchParams;
}) {
  return (
    <div className={styles.cards} aria-label={`${config.title} compact cards`}>
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
                <dt>{config.ownerLabel}</dt>
                <dd>{record.owner}</dd>
              </div>
              <div>
                <dt>{config.valueLabel}</dt>
                <dd>{record.value}</dd>
              </div>
              <div>
                <dt>{common.risk}</dt>
                <dd>{optionLabel(record.risk)}</dd>
              </div>
              <div>
                <dt>Updated</dt>
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
  record: CustomerCollectionRecord;
  closeHref: Route;
  config: CustomerCollectionConfig;
}) {
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
          Close details
        </Link>
      </div>
      <dl className={styles.selectedDetails}>
        <div>
          <dt>{common.status}</dt>
          <dd>{record.statusLabel}</dd>
        </div>
        <div>
          <dt>{common.owner}</dt>
          <dd>{record.owner}</dd>
        </div>
        <div>
          <dt>Commercial context</dt>
          <dd>{record.value}</dd>
        </div>
        {record.context.map((item) => (
          <div key={item.label}>
            <dt>{item.label}</dt>
            <dd>{item.value}</dd>
          </div>
        ))}
      </dl>
      <details className={styles.technical}>
        <summary>{common.technicalDetails}</summary>
        <p>Record reference: {record.id}</p>
      </details>
      {config.key === "procurement" && record.aggregateId ? (
        <EvidenceUploadControl
          journey="procurement"
          targetId={record.aggregateId}
          kind="approval"
          label="Attach procurement evidence"
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
  const state = parseCollectionState(searchParams);
  const filtered = filterAndSortRecords(config.records, state);
  const page = paginateRecords(filtered, state);
  const activeParams = serializeCollectionState(state, { page: page.page });
  const owners = [
    ...new Set(config.records.map((record) => record.owner)),
  ].toSorted();
  const selectedId = Array.isArray(searchParams.record)
    ? searchParams.record[0]
    : searchParams.record;
  const selected = config.records.find((record) => record.id === selectedId);
  const noResults = filtered.length === 0;
  const clearHref = asRoute(config.path);
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
          <p className={styles.eyebrow}>Customer workspace</p>
          <h1>{config.title}</h1>
          <p className={styles.description}>{config.description}</p>
        </div>
        <ProjectionFreshnessNotice
          formatting={formatting}
          freshness={freshness}
        />
      </header>

      {config.providerNote ? (
        <aside className={styles.providerNote}>
          <strong>External source</strong>
          <span>{config.providerNote}</span>
        </aside>
      ) : null}

      {actions}

      <form className={styles.filters} action={config.path} method="get">
        <label className={styles.field}>
          <span>{common.search}</span>
          <input
            type="search"
            name="q"
            defaultValue={state.q}
            placeholder={config.searchPlaceholder}
            maxLength={120}
          />
        </label>
        <label className={styles.field}>
          <span>{common.status}</span>
          <select name="status" defaultValue={state.status}>
            {collectionStatuses.map((status) => (
              <option value={status} key={status}>
                {optionLabel(status)}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>{common.risk}</span>
          <select name="risk" defaultValue={state.risk}>
            {collectionRisks.map((risk) => (
              <option value={risk} key={risk}>
                {optionLabel(risk)}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>{common.owner}</span>
          <select name="owner" defaultValue={state.owner}>
            <option value="all">All owners</option>
            {owners.map((owner) => (
              <option value={owner} key={owner}>
                {owner}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>{common.sort}</span>
          <select name="sort" defaultValue={state.sort}>
            {collectionSorts.map((sort) => (
              <option value={sort} key={sort}>
                {optionLabel(sort)}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>{common.pageSize}</span>
          <select name="pageSize" defaultValue={state.pageSize}>
            {collectionPageSizes.map((pageSize) => (
              <option value={pageSize} key={pageSize}>
                {pageSize}
              </option>
            ))}
          </select>
        </label>
        <input type="hidden" name="view" value={state.view} />
        <input type="hidden" name="page" value="1" />
        <div className={styles.filterActions}>
          <Link className={styles.clearLink} href={clearHref}>
            Clear filters
          </Link>
          <button className={buttonClassName()} type="submit">
            Apply filters
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
            <strong>{filtered.length}</strong>{" "}
            {filtered.length === 1 ? "result" : "results"}
            {filtered.length > 0
              ? ` · showing ${page.firstResult}–${page.lastResult}`
              : ""}
          </p>
          <div className={styles.viewControls} aria-label={common.view}>
            <span className={styles.viewLabel}>{common.view}</span>
            <Link
              className={styles.viewLink}
              href={tableHref}
              aria-current={state.view === "table" ? "true" : undefined}
            >
              Table
            </Link>
            <Link
              className={styles.viewLink}
              href={cardsHref}
              aria-current={state.view === "cards" ? "true" : undefined}
            >
              Cards
            </Link>
          </div>
        </div>

        {noResults ? (
          <ApplicationStatePanel
            {...(styles.statePanel ? { className: styles.statePanel } : {})}
            state="empty"
            title={
              config.records.length === 0
                ? common.emptyTitle
                : common.noMatchTitle
            }
            description={
              config.records.length === 0
                ? common.emptyBody
                : common.noMatchBody
            }
            {...(config.records.length > 0
              ? {
                  action: (
                    <Link className={styles.clearLink} href={clearHref}>
                      Clear filters
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

      {selected ? (
        <SelectedRecord
          record={selected}
          closeHref={stateHref(config.path, activeParams)}
          config={config}
        />
      ) : null}

      <nav
        className={styles.pagination}
        aria-label={`${config.title} pagination`}
      >
        <p>
          Page {page.page} of {page.pageCount}
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
              {common.previous}
            </Link>
          ) : (
            <span className={styles.pageDisabled} aria-disabled="true">
              {common.previous}
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
              {common.next}
            </Link>
          ) : (
            <span className={styles.pageDisabled} aria-disabled="true">
              {common.next}
            </span>
          )}
        </div>
      </nav>
    </main>
  );
}
