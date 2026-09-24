"use client";
import { useFormattingLocale, useTranslations } from "@/src/i18n/client";
import { localizeCopy } from "@/src/i18n/copy";

import type { Route } from "next";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { formatOperationalTimestamp } from "../presentation";
import styles from "./queue-search.module.css";
import { QUEUE_COPY } from "./copy";
import {
  activeFilterLabels,
  decodeQueueQuery,
  DEFAULT_FILTERS,
  encodeQueueQuery,
  filterQueueItems,
  paginateQueueItems,
  parseQueueFilters,
  queueOwnerOptions,
  queueTypeOptions,
  selectQueueItem,
  serializeQueueFilters,
  slaFor,
  sortQueueItems,
  SAVED_VIEWS,
  type QueueFilters,
  type QueueItem,
  type OperationalRole,
} from "./model";
import { QueueDetail } from "./queue-detail";

const NOT_RECORDED = "Not recorded";

/**
 * How long typing has to settle before the filter reaches the URL. Short
 * enough that a deliberate pause reads as instant, long enough that an
 * ordinary typing burst is one navigation rather than one per character.
 */
const SEARCH_COMMIT_DELAY_MS = 180;

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
  const t = useTranslations();
  return (
    <label className={styles.filterField}>
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="all">{t("ui.113")}</option>
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
  kind: "empty" | "no-match";
  onReset: () => void;
}) {
  const t = useTranslations();
  const localizedQUEUE_COPY = localizeCopy(QUEUE_COPY, t);
  const content = localizedQUEUE_COPY.states[kind];
  return (
    <section className={styles.stateCard} role="status">
      <h2>{content[0]}</h2>
      <p>{content[1]}</p>
      {kind === "no-match" ? (
        <button
          className={styles.secondaryButton}
          type="button"
          onClick={onReset}
        >
          {localizedQUEUE_COPY.clearAll}
        </button>
      ) : null}
    </section>
  );
}

function SlaCell({ item, now }: { item: QueueItem; now: Date }) {
  const formattingLocale = useFormattingLocale();
  const sla = slaFor(item, now);
  if (!sla || !item.dueAt) return <span>{NOT_RECORDED}</span>;
  return (
    <>
      <span className={`${styles.sla} ${styles[`sla_${sla}`]}`}>
        {sla === "breached"
          ? "Breached"
          : sla === "due-soon"
            ? "Due soon"
            : "Healthy"}
      </span>
      <time dateTime={item.dueAt}>
        {new Intl.DateTimeFormat(formattingLocale, {
          month: "short",
          day: "numeric",
          timeZone: "UTC",
        }).format(new Date(item.dueAt))}
      </time>
    </>
  );
}

function QueueTable({
  items,
  selected,
  now,
  onSelect,
}: {
  items: readonly QueueItem[];
  selected: QueueItem | null;
  now: Date;
  onSelect: (id: string) => void;
}) {
  const t = useTranslations();
  const localizedQUEUE_COPY = localizeCopy(QUEUE_COPY, t);
  return (
    // The table is wider than the panel on a narrow viewport, so this element
    // scrolls. A scroll container that holds no focusable element of its own
    // cannot be scrolled from the keyboard at all, so it takes a tab stop and
    // an accessible name of its own rather than trapping the rows behind a
    // pointer gesture.
    <div
      className={styles.tableScroller}
      role="region"
      aria-label={localizedQUEUE_COPY.tableRegionLabel}
      tabIndex={0}
    >
      <table className={styles.table}>
        <caption className={styles.srOnly}>
          {localizedQUEUE_COPY.resultCaption}
        </caption>
        <thead>
          <tr>
            {localizedQUEUE_COPY.table.map((heading) => (
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
                    {[item.entity, item.type].filter(Boolean).join(" · ") ||
                      item.id}
                  </span>
                </button>
                <Link
                  className={styles.mobileTitleLink}
                  href={`/internal/queues/${item.id}` as Route}
                >
                  {item.title}
                  <span>
                    {[item.entity, item.type].filter(Boolean).join(" · ") ||
                      item.id}
                  </span>
                </Link>
              </th>
              <td data-label="Owner">
                <strong>{item.owner ?? NOT_RECORDED}</strong>
                <span>
                  {item.backup ? `Backup ${item.backup}` : "No backup"}
                </span>
              </td>
              <td data-label="SLA">
                <SlaCell item={item} now={now} />
              </td>
              <td data-label="Risk">
                {item.risk ? (
                  <span
                    className={`${styles.risk} ${styles[`risk_${item.risk}`]}`}
                  >
                    {item.risk}
                  </span>
                ) : (
                  NOT_RECORDED
                )}
              </td>
              <td data-label="Status">
                {item.statusLabel ?? item.status ?? NOT_RECORDED}
              </td>
              <td data-label="Age">
                {item.ageDays === null ? NOT_RECORDED : `${item.ageDays}d`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function QueueWorkspace({
  roles,
  items,
  generatedAt,
  stale,
  actorId = null,
  demoRefreshEnabled = false,
}: {
  roles: readonly OperationalRole[];
  items: readonly QueueItem[];
  generatedAt: string;
  stale: boolean;
  actorId?: string | null;
  demoRefreshEnabled?: boolean;
}) {
  const t = useTranslations();
  const formattingLocale = useFormattingLocale();
  const localizedQUEUE_COPY = localizeCopy(QUEUE_COPY, t);
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [refreshState, setRefreshState] = useState<
    "idle" | "pending" | "failed"
  >("idle");
  const refreshIdempotencyKey = useRef<string | null>(null);
  // The server already chose this request's projection time. Reusing it keeps
  // SLA labels and ordering identical when the browser hydrates later (or in a
  // different time zone) instead of evaluating the same row against two
  // different clocks.
  const now = useMemo(() => new Date(generatedAt), [generatedAt]);
  const filters = useMemo(
    () => parseQueueFilters(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );
  /**
   * What the search field holds, when that is not yet what the URL holds.
   *
   * The field used to be state seeded from the URL and reset by an effect on
   * every URL change, while every keystroke pushed a fresh URL through a
   * transition. A transition is interruptible and the round trip is not
   * instant, so a keystroke that landed while an earlier URL was still in
   * flight was overwritten by the older value the effect replayed: typed
   * characters disappeared, and the field jumped backwards under anyone typing
   * at speed -- worst for switch, voice, and screen-reader input, where
   * recovering from a field that rewrites itself is expensive.
   *
   * Now the field is the authority while an edit is outstanding, the URL is the
   * authority the rest of the time, and the commit is debounced so a burst of
   * typing costs one navigation rather than one per character.
   */
  const [pendingText, setPendingText] = useState<string | null>(null);
  const searchDraft = pendingText ?? filters.text;
  /**
   * The last commit handed to the router, and the URL it was built from.
   *
   * Recorded so the debounce can tell "already sent, waiting for the URL" from
   * "not sent yet". Without it, a filter change that carried the text away is
   * followed by a second, debounced commit built from the filters the URL still
   * held, which silently undoes the filter change. It is scoped to the URL it
   * was sent from so it expires the moment the URL moves, rather than
   * suppressing a later edit that happens to type the same characters.
   */
  const lastCommit = useRef<{ text: string; from: QueueFilters } | null>(null);
  const people = useMemo(() => queueOwnerOptions(items), [items]);
  const typeOptions = useMemo(() => queueTypeOptions(items), [items]);
  const ownerOptions = useMemo(
    () => people.map((person) => ({ value: person.id, label: person.label })),
    [people],
  );
  const filtered = useMemo(
    () =>
      sortQueueItems(
        filterQueueItems(items, filters, { actorId, now }),
        filters.sort,
        now,
      ),
    [actorId, filters, items, now],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = selectQueueItem(filtered, selectedId);
  const labels = activeFilterLabels(filters, people);
  const {
    items: paginated,
    page,
    pageCount,
  } = paginateQueueItems(filtered, filters.page, filters.pageSize);

  useEffect(() => {
    if (selectedId && !filtered.some((item) => item.id === selectedId))
      setSelectedId(null);
  }, [filtered, selectedId]);

  function commitFilters(next: QueueFilters) {
    lastCommit.current = { text: next.text, from: filters };
    const query = serializeQueueFilters(next).toString();
    startTransition(() =>
      router.replace(`${pathname}?${query}` as Route, { scroll: false }),
    );
  }

  function update(patch: Partial<QueueFilters>) {
    // An outstanding keystroke is part of the operator's intent, so a filter
    // or a page change carries it into the URL instead of discarding it.
    const next = {
      ...filters,
      text: searchDraft,
      ...patch,
      page: patch.page ?? 1,
    };
    if (next.text !== filters.text) setPendingText(next.text);
    commitFilters(next);
  }

  /**
   * The URL now says what the field says, so the URL owns the field again.
   *
   * The comparison is between encoded queries rather than raw strings because
   * the URL is a normalizing round trip: it trims, it collapses runs of
   * whitespace, and it lifts `sla:breached` out of the text and into its own
   * filter. Comparing raw text would leave the field permanently ahead of a URL
   * that had in fact absorbed every character, and it would then stop accepting
   * external changes such as the back button.
   */
  const settled =
    pendingText !== null &&
    encodeQueueQuery(decodeQueueQuery(pendingText)) ===
      encodeQueueQuery(filters);
  useEffect(() => {
    if (settled) setPendingText(null);
  }, [settled]);

  /** This exact text was already sent from this exact URL; the URL owes a reply. */
  const awaitingCommit =
    lastCommit.current !== null &&
    lastCommit.current.from === filters &&
    lastCommit.current.text === pendingText;

  // Commit the outstanding keystrokes once typing pauses. Each further
  // keystroke restarts the wait, so only the settled value reaches the router
  // and no in-flight navigation is left to overwrite the field.
  useEffect(() => {
    if (pendingText === null || settled || awaitingCommit) return;
    const timer = setTimeout(
      () => commitFilters({ ...filters, text: pendingText, page: 1 }),
      SEARCH_COMMIT_DELAY_MS,
    );
    return () => clearTimeout(timer);
    // `commitFilters` closes over the same `filters` this effect reads, so the
    // pair stays consistent without adding a per-render identity to the deps.
  }, [awaitingCommit, filters, pendingText, settled]);

  function reset() {
    setSelectedId(null);
    // Clearing is the one case that must not carry the outstanding keystrokes
    // forward, and dropping them here also cancels the debounced commit that
    // would otherwise land after the reset and restore the filters it cleared.
    setPendingText(null);
    commitFilters(DEFAULT_FILTERS);
  }

  async function refreshProjection(): Promise<void> {
    if (!demoRefreshEnabled) {
      router.refresh();
      return;
    }
    if (refreshState === "pending") return;
    setRefreshState("pending");
    const key = refreshIdempotencyKey.current ?? crypto.randomUUID();
    refreshIdempotencyKey.current = key;
    const token = document.cookie
      .split(";")
      .map((part) => part.trim().split("="))
      .find(([name]) => name === "clockwork-csrf")
      ?.slice(1)
      .join("=");
    try {
      const response = await fetch("/api/demo/projections/queues/refresh", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          "idempotency-key": key,
          ...(token ? { "x-csrf-token": token } : {}),
        },
      });
      if (!response.ok) throw new Error("Projection refresh was refused");
      refreshIdempotencyKey.current = null;
      setRefreshState("idle");
      router.refresh();
    } catch {
      setRefreshState("failed");
    }
  }

  return (
    <main className={styles.page} id="main-content">
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>{localizedQUEUE_COPY.eyebrow}</p>
          <h1>{localizedQUEUE_COPY.title}</h1>
          <p>{localizedQUEUE_COPY.description}</p>
        </div>
        <p className={styles.freshness}>
          <span aria-hidden="true" />
          {localizedQUEUE_COPY.freshness}{" "}
          <time dateTime={generatedAt}>
            {formatOperationalTimestamp(generatedAt, formattingLocale)}
          </time>
        </p>
      </header>

      {stale ? (
        <section className={styles.staleBanner} role="alert">
          <strong>{localizedQUEUE_COPY.staleTitle}</strong>
          <span>{localizedQUEUE_COPY.staleDescription}</span>
          <button
            type="button"
            disabled={refreshState === "pending"}
            onClick={() => void refreshProjection()}
          >
            {refreshState === "pending"
              ? localizedQUEUE_COPY.staleRefreshing
              : refreshState === "failed"
                ? localizedQUEUE_COPY.staleRetry
                : localizedQUEUE_COPY.staleAction}
          </button>
          {refreshState === "failed" ? (
            <span role="status">{localizedQUEUE_COPY.staleRefreshFailed}</span>
          ) : null}
        </section>
      ) : null}

      <nav
        className={styles.savedViews}
        aria-label={localizedQUEUE_COPY.savedViewsLabel}
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
            <h2 id="queue-filters-title">{localizedQUEUE_COPY.filtersTitle}</h2>
            <p>{localizedQUEUE_COPY.filtersDescription}</p>
          </div>
          <button type="button" onClick={reset}>
            {localizedQUEUE_COPY.clearAll}
          </button>
        </div>
        <div className={styles.filterGrid}>
          <label className={`${styles.filterField} ${styles.searchField}`}>
            <span>{localizedQUEUE_COPY.searchLabel}</span>
            <input
              type="search"
              value={searchDraft}
              placeholder={localizedQUEUE_COPY.searchPlaceholder}
              onChange={(event) => setPendingText(event.target.value)}
            />
          </label>
          <SelectFilter
            label={localizedQUEUE_COPY.filterLabels.type}
            value={filters.type}
            onChange={(type) => update({ type })}
            options={typeOptions}
          />
          <SelectFilter
            label={localizedQUEUE_COPY.filterLabels.owner}
            value={filters.owner}
            onChange={(owner) => update({ owner })}
            options={ownerOptions}
          />
          <SelectFilter
            label={localizedQUEUE_COPY.filterLabels.backup}
            value={filters.backup}
            onChange={(backup) => update({ backup })}
            options={[
              ...ownerOptions,
              { value: "unassigned", label: "Unassigned" },
            ]}
          />
          <SelectFilter
            label={localizedQUEUE_COPY.filterLabels.sla}
            value={filters.sla}
            onChange={(sla) => update({ sla })}
            options={[
              { value: "breached", label: "Breached" },
              { value: "due-soon", label: "Due in 24 hours" },
              { value: "healthy", label: "Healthy" },
            ]}
          />
          <SelectFilter
            label={localizedQUEUE_COPY.filterLabels.risk}
            value={filters.risk}
            onChange={(risk) => update({ risk })}
            options={[
              { value: "high", label: "High" },
              { value: "medium", label: "Medium" },
              { value: "low", label: "Low" },
            ]}
          />
          <SelectFilter
            label={localizedQUEUE_COPY.filterLabels.status}
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
            label={localizedQUEUE_COPY.filterLabels.age}
            value={filters.age}
            onChange={(age) => update({ age })}
            options={[
              { value: "7", label: "0–7 days" },
              { value: "8-30", label: "8–30 days" },
              { value: "30+", label: "More than 30 days" },
            ]}
          />
          <SelectFilter
            label={localizedQUEUE_COPY.filterLabels.sort}
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
          <ul aria-label={localizedQUEUE_COPY.activeFilters}>
            {labels.map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
        ) : (
          <span>{localizedQUEUE_COPY.noActiveFilters}</span>
        )}
      </section>

      {isPending ? (
        <div className={styles.loading} role="status">
          <span aria-hidden="true" />
          {localizedQUEUE_COPY.updating}
        </div>
      ) : null}
      {items.length === 0 ? (
        <QueueState kind="empty" onReset={reset} />
      ) : filtered.length === 0 ? (
        <QueueState kind="no-match" onReset={reset} />
      ) : (
        <div className={styles.workspace} aria-busy={isPending}>
          <section
            className={styles.tablePanel}
            aria-label={localizedQUEUE_COPY.resultTableLabel}
          >
            <QueueTable
              items={paginated}
              selected={selected}
              now={now}
              onSelect={setSelectedId}
            />
            <div className={styles.pagination}>
              <label>
                {localizedQUEUE_COPY.rowsPerPage}
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
                {localizedQUEUE_COPY.previous}
              </button>
              <button
                type="button"
                disabled={page >= pageCount}
                onClick={() => update({ page: page + 1 })}
              >
                {localizedQUEUE_COPY.next}
              </button>
            </div>
          </section>
          <aside
            className={styles.splitPanel}
            aria-label={localizedQUEUE_COPY.detailLabel}
          >
            {selected ? (
              <QueueDetail item={selected} roles={roles} now={now} />
            ) : null}
          </aside>
        </div>
      )}
    </main>
  );
}
