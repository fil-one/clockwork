"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";

import styles from "./queue-search.module.css";
import { QUEUE_COPY } from "./copy";
import {
  activeFilterLabels,
  DEFAULT_FILTERS,
  filterQueueItems,
  parseQueueFilters,
  PEOPLE,
  QUEUE_ITEMS,
  SAVED_VIEWS,
  selectQueueItem,
  serializeQueueFilters,
  slaFor,
  sortQueueItems,
  type QueueFilters,
  type QueueItem,
  type OperationalRole,
} from "./model";
import { QueueDetail } from "./queue-detail";

const OWNER_OPTIONS = PEOPLE.map((person) => ({
  value: person.id,
  label: person.label,
}));

function SelectFilter({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className={styles.filterField}>
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="all">All</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function QueueState({
  kind,
  onReset,
}: {
  kind: "empty" | "no-match" | "permission" | "error";
  onReset: () => void;
}) {
  const content = QUEUE_COPY.states[kind];
  return (
    <section
      className={styles.stateCard}
      role={kind === "error" ? "alert" : "status"}
    >
      <h2>{content[0]}</h2>
      <p>{content[1]}</p>
      <button
        className={styles.secondaryButton}
        type="button"
        onClick={onReset}
      >
        {kind === "error" ? "Try again" : "Clear filters"}
      </button>
    </section>
  );
}

function QueueTable({
  items,
  selected,
  onSelect,
}: {
  items: readonly QueueItem[];
  selected: QueueItem | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className={styles.tableScroller}>
      <table className={styles.table}>
        <caption className={styles.srOnly}>{QUEUE_COPY.resultCaption}</caption>
        <thead>
          <tr>
            {QUEUE_COPY.table.map((heading) => (
              <th key={heading} scope="col">
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr
              className={
                selected?.id === item.id ? styles.selectedRow : undefined
              }
              key={item.id}
            >
              <th scope="row">
                <button
                  className={styles.rowSelect}
                  type="button"
                  aria-label={`Show details for ${item.title}`}
                  aria-pressed={selected?.id === item.id}
                  onClick={() => onSelect(item.id)}
                >
                  <strong>{item.title}</strong>
                  <span>
                    {item.entity} · {item.type}
                  </span>
                </button>
                <Link
                  className={styles.mobileTitleLink}
                  href={`/internal/queues/${item.id}` as Route}
                >
                  {item.title}
                  <span>
                    {item.entity} · {item.type}
                  </span>
                </Link>
              </th>
              <td data-label="Owner">
                <strong>{item.owner}</strong>
                <span>
                  {item.backup ? `Backup ${item.backup}` : "Backup needed"}
                </span>
              </td>
              <td data-label="SLA">
                <span
                  className={`${styles.sla} ${styles[`sla_${slaFor(item)}`]}`}
                >
                  {slaFor(item) === "breached"
                    ? "Breached"
                    : slaFor(item) === "due-soon"
                      ? "Due soon"
                      : "Healthy"}
                </span>
                <time dateTime={item.dueAt}>
                  {new Date(item.dueAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                </time>
              </td>
              <td data-label="Risk">
                <span
                  className={`${styles.risk} ${styles[`risk_${item.risk}`]}`}
                >
                  {item.risk}
                </span>
              </td>
              <td data-label="Status">{item.status}</td>
              <td data-label="Age">{item.ageDays}d</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function QueueWorkspace({
  roles,
}: {
  roles: readonly OperationalRole[];
}) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const filters = useMemo(
    () => parseQueueFilters(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );
  const [searchDraft, setSearchDraft] = useState(filters.text);
  const effectiveFilters = useMemo(
    () =>
      filters.text.toLocaleLowerCase().startsWith("demo:")
        ? { ...filters, text: "" }
        : filters,
    [filters],
  );
  const filtered = useMemo(
    () =>
      sortQueueItems(
        filterQueueItems(QUEUE_ITEMS, effectiveFilters),
        effectiveFilters.sort,
      ),
    [effectiveFilters],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = selectQueueItem(filtered, selectedId);
  const labels = activeFilterLabels(filters);
  const pageCount = Math.max(1, Math.ceil(filtered.length / filters.pageSize));
  const page = Math.min(filters.page, pageCount);
  const paginated = filtered.slice(
    (page - 1) * filters.pageSize,
    page * filters.pageSize,
  );
  const state = filters.text.toLocaleLowerCase();
  const demoState =
    state === "demo:empty"
      ? "empty"
      : state === "demo:permission"
        ? "permission"
        : state === "demo:error"
          ? "error"
          : null;

  useEffect(() => {
    if (selectedId && !filtered.some((item) => item.id === selectedId))
      setSelectedId(null);
  }, [filtered, selectedId]);

  useEffect(() => setSearchDraft(filters.text), [filters.text]);

  function update(patch: Partial<QueueFilters>) {
    const next = { ...filters, ...patch, page: patch.page ?? 1 };
    const query = serializeQueueFilters(next).toString();
    startTransition(() =>
      router.replace(`${pathname}?${query}` as Route, { scroll: false }),
    );
  }

  function reset() {
    setSelectedId(null);
    update(DEFAULT_FILTERS);
  }

  return (
    <main className={styles.page} id="main-content">
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>{QUEUE_COPY.eyebrow}</p>
          <h1>{QUEUE_COPY.title}</h1>
          <p>{QUEUE_COPY.description}</p>
        </div>
        <p className={styles.freshness}>
          <span aria-hidden="true" />
          {QUEUE_COPY.freshness}
        </p>
      </header>

      {state === "demo:stale" ? (
        <section className={styles.staleBanner} role="alert">
          <strong>{QUEUE_COPY.staleTitle}</strong>
          <span>{QUEUE_COPY.staleDescription}</span>
          <button type="button" onClick={reset}>
            {QUEUE_COPY.staleAction}
          </button>
        </section>
      ) : null}

      <nav
        className={styles.savedViews}
        aria-label={QUEUE_COPY.savedViewsLabel}
      >
        {SAVED_VIEWS.map((view) => (
          <button
            className={filters.view === view.id ? styles.activeView : undefined}
            key={view.id}
            type="button"
            aria-current={filters.view === view.id ? "page" : undefined}
            title={view.description}
            onClick={() => update({ view: view.id })}
          >
            {view.label}
          </button>
        ))}
      </nav>

      <section className={styles.filters} aria-labelledby="queue-filters-title">
        <div className={styles.filterHeading}>
          <div>
            <h2 id="queue-filters-title">{QUEUE_COPY.filtersTitle}</h2>
            <p>{QUEUE_COPY.filtersDescription}</p>
          </div>
          <button type="button" onClick={reset}>
            {QUEUE_COPY.clearAll}
          </button>
        </div>
        <div className={styles.filterGrid}>
          <label className={`${styles.filterField} ${styles.searchField}`}>
            <span>{QUEUE_COPY.searchLabel}</span>
            <input
              type="search"
              value={searchDraft}
              placeholder={QUEUE_COPY.searchPlaceholder}
              onChange={(event) => {
                setSearchDraft(event.target.value);
                update({ text: event.target.value });
              }}
            />
          </label>
          <SelectFilter
            label={QUEUE_COPY.filterLabels.type}
            value={filters.type}
            onChange={(type) => update({ type })}
            options={[
              "pricing",
              "legal",
              "collections",
              "screening",
              "migration",
              "provisioning",
            ].map((value) => ({
              value,
              label: value.charAt(0).toUpperCase() + value.slice(1),
            }))}
          />
          <SelectFilter
            label={QUEUE_COPY.filterLabels.owner}
            value={filters.owner}
            onChange={(owner) => update({ owner })}
            options={OWNER_OPTIONS}
          />
          <SelectFilter
            label={QUEUE_COPY.filterLabels.backup}
            value={filters.backup}
            onChange={(backup) => update({ backup })}
            options={[
              ...OWNER_OPTIONS,
              { value: "unassigned", label: "Unassigned" },
            ]}
          />
          <SelectFilter
            label={QUEUE_COPY.filterLabels.sla}
            value={filters.sla}
            onChange={(sla) => update({ sla })}
            options={[
              { value: "breached", label: "Breached" },
              { value: "due-soon", label: "Due in 24 hours" },
              { value: "healthy", label: "Healthy" },
            ]}
          />
          <SelectFilter
            label={QUEUE_COPY.filterLabels.risk}
            value={filters.risk}
            onChange={(risk) => update({ risk })}
            options={[
              { value: "high", label: "High" },
              { value: "medium", label: "Medium" },
              { value: "low", label: "Low" },
            ]}
          />
          <SelectFilter
            label={QUEUE_COPY.filterLabels.status}
            value={filters.status}
            onChange={(status) => update({ status })}
            options={[
              { value: "open", label: "Open" },
              { value: "pending", label: "Pending" },
              { value: "blocked", label: "Blocked" },
              { value: "resolved", label: "Resolved" },
            ]}
          />
          <SelectFilter
            label={QUEUE_COPY.filterLabels.age}
            value={filters.age}
            onChange={(age) => update({ age })}
            options={[
              { value: "7", label: "0–7 days" },
              { value: "8-30", label: "8–30 days" },
              { value: "30+", label: "More than 30 days" },
            ]}
          />
          <SelectFilter
            label={QUEUE_COPY.filterLabels.sort}
            value={filters.sort}
            onChange={(sort) => update({ sort })}
            options={[
              { value: "sla-risk-age", label: "SLA, risk, oldest" },
              { value: "risk", label: "Highest risk" },
              { value: "oldest", label: "Oldest" },
              { value: "updated", label: "Recently updated" },
            ]}
          />
        </div>
      </section>

      <section
        className={styles.resultSummary}
        aria-live="polite"
        aria-atomic="true"
      >
        <strong>
          {filtered.length} {filtered.length === 1 ? "result" : "results"}
        </strong>
        {labels.length ? (
          <ul aria-label={QUEUE_COPY.activeFilters}>
            {labels.map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
        ) : (
          <span>{QUEUE_COPY.noActiveFilters}</span>
        )}
      </section>

      {isPending ? (
        <div className={styles.loading} role="status">
          <span aria-hidden="true" />
          {QUEUE_COPY.updating}
        </div>
      ) : null}
      {demoState ? (
        <QueueState kind={demoState} onReset={reset} />
      ) : filtered.length === 0 ? (
        <QueueState kind="no-match" onReset={reset} />
      ) : (
        <div className={styles.workspace} aria-busy={isPending}>
          <section
            className={styles.tablePanel}
            aria-label={QUEUE_COPY.resultTableLabel}
          >
            <QueueTable
              items={paginated}
              selected={selected}
              onSelect={setSelectedId}
            />
            <div className={styles.pagination}>
              <label>
                {QUEUE_COPY.rowsPerPage}
                <select
                  value={filters.pageSize}
                  onChange={(event) =>
                    update({ pageSize: Number(event.target.value) })
                  }
                >
                  <option value="10">10</option>
                  <option value="25">25</option>
                  <option value="50">50</option>
                </select>
              </label>
              <span>
                Page {page} of {pageCount}
              </span>
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => update({ page: page - 1 })}
              >
                {QUEUE_COPY.previous}
              </button>
              <button
                type="button"
                disabled={page >= pageCount}
                onClick={() => update({ page: page + 1 })}
              >
                {QUEUE_COPY.next}
              </button>
            </div>
          </section>
          <aside
            className={styles.splitPanel}
            aria-label={QUEUE_COPY.detailLabel}
          >
            {selected ? <QueueDetail item={selected} roles={roles} /> : null}
          </aside>
        </div>
      )}
    </main>
  );
}
