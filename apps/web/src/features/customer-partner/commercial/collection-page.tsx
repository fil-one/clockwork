import type { Route } from "next";
import Link from "next/link";

import { customerPartnerCopy } from "../copy";
import {
  collectionDefinitions,
  type CollectionKind,
  type CommercialRecord,
} from "./model";
import styles from "./commercial.module.css";
import {
  collectionUrl,
  filterAndSortRecords,
  parseCollectionState,
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

function RecordTable({ records }: { records: readonly CommercialRecord[] }) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Record</th>
            <th scope="col">Status</th>
            <th scope="col">Risk</th>
            <th scope="col">Owner</th>
            <th scope="col">Commercial context</th>
            <th scope="col">Timing</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr key={record.id}>
              <td>
                <Link className={styles.recordLink} href={record.href as Route}>
                  {record.title}
                </Link>
                <div className={styles.recordMeta}>
                  {record.description} · {record.id}
                </div>
              </td>
              <td>
                <span className={`${styles.badge} ${styles[record.tone]}`}>
                  {record.statusLabel}
                </span>
              </td>
              <td>
                <span className={styles.risk}>{record.risk}</span>
              </td>
              <td>{record.owner}</td>
              <td>
                <strong>{record.value}</strong>
                <div className={styles.recordMeta}>{record.valueLabel}</div>
              </td>
              <td>{record.dateLabel}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RecordCards({
  records,
  forced = false,
}: {
  records: readonly CommercialRecord[];
  forced?: boolean;
}) {
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
              <dt>Owner</dt>
              <dd>{record.owner}</dd>
            </div>
            <div>
              <dt>Risk</dt>
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
              Open record
            </Link>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function CommercialLoadingState() {
  return (
    <main className={styles.main} id="main-content">
      <section className={styles.state} role="status">
        <h1>{customerPartnerCopy.common.loadingTitle}</h1>
        <p>{customerPartnerCopy.common.loadingBody}</p>
      </section>
    </main>
  );
}

export function CommercialErrorState({ retry }: { retry?: () => void }) {
  return (
    <main className={styles.main} id="main-content">
      <section className={styles.state} role="alert">
        <h1>{customerPartnerCopy.common.errorTitle}</h1>
        <p>{customerPartnerCopy.common.errorBody}</p>
        {retry ? (
          <button className={styles.secondary} onClick={retry} type="button">
            Try again
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
  canUsePrimaryAction = true,
}: {
  kind: CollectionKind;
  searchParams: RawSearchParams;
  records: readonly CommercialRecord[];
  canUsePrimaryAction?: boolean;
}) {
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
        </div>
        {definition.primaryAction && canUsePrimaryAction ? (
          <Link className={styles.primary} href={definition.primaryAction.href}>
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
            {customerPartnerCopy.common.search}
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
            {customerPartnerCopy.common.status}
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
            {customerPartnerCopy.common.risk}
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
            {customerPartnerCopy.common.owner}
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
            {customerPartnerCopy.common.sort}
          </label>
          <select defaultValue={state.sort} id={`${kind}-sort`} name="sort">
            <option value="updated_desc">Recently updated</option>
            <option value="updated_asc">Oldest updated</option>
            <option value="title_asc">Title A–Z</option>
            <option value="value_desc">Highest value</option>
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor={`${kind}-size`}>
            {customerPartnerCopy.common.pageSize}
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
        <div className={styles.field}>
          <label htmlFor={`${kind}-view`}>
            {customerPartnerCopy.common.view}
          </label>
          <select defaultValue={state.view} id={`${kind}-view`} name="view">
            <option value="table">Comparison table</option>
            <option value="compact">Compact cards</option>
          </select>
        </div>
        <input name="page" type="hidden" value="1" />
        <button
          className={`${styles.primary} ${styles.filterSubmit}`}
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
          {hasFilters ? (
            <Link className={styles.secondary} href={pathname}>
              Clear filters
            </Link>
          ) : null}
        </div>
        {records.length ? (
          <>
            {state.view === "table" ? <RecordTable records={records} /> : null}
            <RecordCards forced={state.view === "compact"} records={records} />
            <nav className={styles.pagination} aria-label="Result pages">
              {page <= 1 ? (
                <span aria-disabled="true" className={styles.pageLink}>
                  {customerPartnerCopy.common.previous}
                </span>
              ) : (
                <Link
                  className={styles.pageLink}
                  href={collectionUrl(pathname, state, { page: page - 1 })}
                >
                  {customerPartnerCopy.common.previous}
                </Link>
              )}
              <span aria-live="polite">
                {page} / {totalPages}
              </span>
              {page >= totalPages ? (
                <span aria-disabled="true" className={styles.pageLink}>
                  {customerPartnerCopy.common.next}
                </span>
              ) : (
                <Link
                  className={styles.pageLink}
                  href={collectionUrl(pathname, state, { page: page + 1 })}
                >
                  {customerPartnerCopy.common.next}
                </Link>
              )}
            </nav>
          </>
        ) : (
          <div className={styles.state}>
            <h3>
              {hasFilters
                ? customerPartnerCopy.common.noMatchTitle
                : customerPartnerCopy.common.emptyTitle}
            </h3>
            <p>
              {hasFilters
                ? customerPartnerCopy.common.noMatchBody
                : customerPartnerCopy.common.emptyBody}
            </p>
            {hasFilters ? (
              <Link className={styles.secondary} href={pathname}>
                Clear filters
              </Link>
            ) : null}
          </div>
        )}
      </section>
    </main>
  );
}
