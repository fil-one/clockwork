"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { ApplicationStatePanel, Button, Table } from "@clockwork/ui";

import { customerPartnerCopy } from "@/src/features/customer-partner/copy";
import type { SurfaceFormatting } from "@/src/features/customer-partner/formatting";
import {
  ProjectionFreshnessNotice,
  type ProjectionFreshness,
} from "@/src/features/customer-partner/projection-freshness";
import {
  columnSortDirection,
  columnSortLabel,
  nextColumnSort,
  type SortableColumn,
} from "@/src/features/customer-partner/sortable-column";
import { sendProjectionAction } from "@/src/features/contracts/experience-client";

import type {
  PartnerRecord,
  PartnerSurfaceConfig,
  PartnerSurfaceKey,
} from "./partner-data";
import {
  filterPartnerRecords,
  paginatePartnerRecords,
  parsePartnerQuery,
  updatePartnerQuery,
  type PartnerQueryKey,
  type PartnerSort,
} from "./partner-query";
import { roleCanUseSurface } from "./partner-rules";
import styles from "./partner.module.css";

const copy = customerPartnerCopy.common;
const partnerCopy = customerPartnerCopy.partner;

function PermissionView() {
  return (
    <div className={styles.state}>
      <ApplicationStatePanel
        state="permission"
        title={copy.permissionTitle}
        description={copy.permissionBody}
      />
    </div>
  );
}

function RecordTitle({ record }: { record: PartnerRecord }) {
  return (
    <>
      {record.href ? (
        <Link className={styles.recordLink} href={record.href}>
          {record.name}
        </Link>
      ) : (
        <strong>{record.name}</strong>
      )}
      <span className={styles.meta}>{record.context}</span>
      <span className={styles.id}>Reference {record.id}</span>
      {!record.href ? (
        <span className={styles.meta}>
          Summary only · follow the contextual gate on this page
        </span>
      ) : null}
    </>
  );
}

/**
 * Which ledger columns can be ordered, by table index.
 *
 * The last two columns are per-surface free text -- a commission basis here, a
 * renewal date there -- with no ordering `sortPartnerRecords` can express, so
 * they stay inert rather than advertising a sort that would do nothing.
 */
const sortableColumns: Readonly<Record<number, SortableColumn<PartnerSort>>> = {
  0: { ascending: "name-asc", descending: "name-desc" },
  1: { ascending: "status-asc", descending: "status-desc" },
  2: { ascending: "risk-asc", descending: "risk-desc", first: "descending" },
};

function RecordsTable({
  config,
  records,
  sort,
  onSort,
}: {
  config: PartnerSurfaceConfig;
  records: readonly PartnerRecord[];
  sort: PartnerSort;
  onSort: (next: PartnerSort) => void;
}) {
  const headers = [
    config.columns[0],
    copy.status,
    "Risk and owner",
    config.columns[1],
    config.columns[2],
  ];
  return (
    <Table
      caption={config.title}
      captionHidden
      className={styles.tableWrap ?? ""}
      columnSort={headers.map((header, index) => {
        const column = sortableColumns[index];
        if (!column) return null;
        return {
          direction: columnSortDirection(column, sort),
          control: (
            <button
              aria-label={columnSortLabel(column, sort, String(header))}
              className={styles.sortButton}
              onClick={() => onSort(nextColumnSort(column, sort))}
              type="button"
            >
              {header}
            </button>
          ),
        };
      })}
      headers={headers}
      numericColumns={
        config.amountColumn === undefined ? [] : [config.amountColumn]
      }
      rowKeys={records.map((record) => record.id)}
      rows={records.map((record) => [
        <RecordTitle record={record} />,
        <span className={styles.pill} data-tone={record.status}>
          {record.status}
        </span>,
        <>
          <span className={styles.pill} data-risk={record.risk}>
            {record.risk} risk
          </span>
          <span className={styles.meta}>{record.owner}</span>
        </>,
        <strong>{record.value}</strong>,
        record.secondary,
      ])}
    />
  );
}

function RecordCards({ records }: { records: readonly PartnerRecord[] }) {
  return (
    <div className={styles.mobileCards}>
      {records.map((record) => (
        <article className={styles.mobileCard} key={record.id}>
          <div className={styles.cardTop}>
            <div>
              <RecordTitle record={record} />
            </div>
            <span className={styles.pill} data-tone={record.status}>
              {record.status}
            </span>
          </div>
          <div className={styles.cardValues}>
            <div>
              <span>Commercial position</span>
              <strong>{record.value}</strong>
            </div>
            <div>
              <span>Next milestone</span>
              <strong>{record.secondary}</strong>
            </div>
            <div>
              <span>Owner</span>
              <strong>{record.owner}</strong>
            </div>
            <div>
              <span>Risk</span>
              <strong>{record.risk}</strong>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

function PriceBoundary({
  surface,
  partnerName,
}: {
  surface: PartnerSurfaceKey;
  partnerName: string;
}) {
  if (
    !["portfolio", "quotes", "billing", "renewals", "commissions"].includes(
      surface,
    )
  )
    return null;
  const merchant =
    surface === "billing"
      ? `${partnerName} for end-client resale; Fil One invoices the selected partner account`
      : `${partnerName} on resale routes`;
  return (
    <section className={styles.boundary} aria-label="Commercial price boundary">
      <div>
        <h2>{partnerCopy.transferPrice}</h2>
        <p>Private partner cost from the approved Fil One price book.</p>
      </div>
      <div>
        <h2>{partnerCopy.partnerPrice}</h2>
        <p>
          Set and controlled by {partnerName}; shown to the named end client.
        </p>
      </div>
      <div>
        <h2>{partnerCopy.merchantOfRecord}</h2>
        <p>
          {merchant}. {partnerCopy.boundary}
        </p>
      </div>
    </section>
  );
}

function RenewalPanel({ record }: { record: PartnerRecord | undefined }) {
  const [reviewing, setReviewing] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [succeeded, setSucceeded] = useState(false);
  const [message, setMessage] = useState("");
  const idempotencyKeyRef = useRef<string | null>(null);
  const canRequest = Boolean(
    record?.projectionId &&
    record.recordKey &&
    record.recordVersion &&
    record.allowedActions?.includes("request_renewal"),
  );
  const summary = record
    ? [record.name, record.context, record.value, record.secondary]
    : [];
  async function submit() {
    if (
      !confirmed ||
      !record?.projectionId ||
      !record.recordKey ||
      !record.recordVersion
    )
      return;
    setPending(true);
    setMessage("");
    try {
      idempotencyKeyRef.current ??= crypto.randomUUID();
      await sendProjectionAction(
        {
          audience: "partner",
          channel: "renewals",
          recordKey: record.recordKey,
          projectionId: record.projectionId,
          action: "request_renewal",
          expectedVersion: record.recordVersion,
          payload: {},
        },
        { idempotencyKey: idempotencyKeyRef.current },
      );
      setSucceeded(true);
      setMessage(
        "Renewal request submitted. The current term remains authoritative until the server confirms a change.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The renewal request could not be submitted.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <section className={styles.workflow} aria-labelledby="renewal-review-title">
      <h2 id="renewal-review-title">{partnerCopy.renewalReview}</h2>
      {!reviewing ? (
        <>
          <p className={styles.muted}>
            A renewal request affects the next financial commitment and requires
            an explicit review.
          </p>
          <Button onClick={() => setReviewing(true)}>
            {record ? `Review ${record.name}` : "No renewal selected"}
          </Button>
        </>
      ) : (
        <>
          <ul className={styles.summaryList}>
            {summary.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <label className={styles.confirm}>
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            <span>
              I reviewed the end client, term, transfer price, resale price, and
              merchant-of-record boundary.
            </span>
          </label>
          <div className={styles.actions}>
            <Button
              variant="secondary"
              onClick={() => {
                setReviewing(false);
                setConfirmed(false);
              }}
            >
              Back
            </Button>
            <Button
              disabled={!confirmed || succeeded || !canRequest}
              loading={pending}
              onClick={() => {
                void submit();
              }}
            >
              Confirm renewal request
            </Button>
          </div>
        </>
      )}
      {message ? (
        <p className={styles.success} role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}

export function PartnerCollection({
  surface,
  config,
  roles,
  partnerName,
  freshness,
  formatting,
  actions,
}: {
  surface: PartnerSurfaceKey;
  config: PartnerSurfaceConfig;
  roles: readonly string[];
  partnerName: string;
  /** The `stale`/`generatedAt` pair the loader returned for this read. */
  freshness: ProjectionFreshness;
  /** Locale and zone of the partner reading, from the active route session. */
  formatting: SurfaceFormatting;
  /**
   * Server-backed action for this surface, supplied by the route so the panel
   * carries the route's own permission gate rather than a second guess at it.
   */
  actions?: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const state = useMemo(
    () => parsePartnerQuery(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );
  const [queryDraft, setQueryDraft] = useState(state.q);
  useEffect(() => setQueryDraft(state.q), [state.q]);
  const filtered = useMemo(
    () => filterPartnerRecords(config.records, state),
    [config.records, state],
  );
  const page = paginatePartnerRecords(filtered, state.page, state.pageSize);
  const canUse = roleCanUseSurface(roles, config.roles);
  const role = roles.includes("partner_admin")
    ? "partner_admin"
    : "partner_seller";
  const owners = [
    ...new Set(config.records.map((record) => record.owner)),
  ].sort();

  function setQuery(key: PartnerQueryKey, value: string | number) {
    const next = updatePartnerQuery(
      new URLSearchParams(searchParams.toString()),
      { [key]: value },
    );
    const href =
      `${pathname}${next.size ? `?${next.toString()}` : ""}` as Route;
    router.push(href, { scroll: false });
  }

  const noMatch = canUse && filtered.length === 0;
  const canCreate = config.primaryAction?.roles.includes(role);

  return (
    <main className={styles.main} id="main-content">
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>{config.eyebrow}</p>
          <h1>{config.title}</h1>
          <p>{config.description}</p>
          <ProjectionFreshnessNotice
            formatting={formatting}
            freshness={freshness}
          />
        </div>
        {config.primaryAction && canCreate ? (
          <Link className={styles.buttonLink} href={config.primaryAction.href}>
            {config.primaryAction.label}
          </Link>
        ) : null}
      </header>

      <PriceBoundary partnerName={partnerName} surface={surface} />
      {config.gate ? <p className={styles.gate}>{config.gate}</p> : null}

      {actions}

      <form
        className={styles.filters}
        aria-label={copy.filters}
        onSubmit={(event) => {
          event.preventDefault();
          setQuery("q", queryDraft);
        }}
      >
        <label className={styles.field}>
          {copy.search}
          <span className={styles.searchControl}>
            <input
              type="search"
              value={queryDraft}
              placeholder={`Search ${config.noun}`}
              onChange={(event) => setQueryDraft(event.target.value)}
            />
            <Button size="small" type="submit">
              Apply
            </Button>
          </span>
        </label>
        <label className={styles.field}>
          {copy.status}
          <select
            value={state.status}
            onChange={(event) => setQuery("status", event.target.value)}
          >
            <option value="all">All statuses</option>
            <option value="attention">Needs attention</option>
            <option value="draft">Draft</option>
            <option value="open">Open</option>
            <option value="active">Active</option>
            <option value="pending">Pending</option>
            <option value="accepted">Accepted</option>
            <option value="paid">Paid</option>
            <option value="blocked">Blocked</option>
          </select>
        </label>
        <label className={styles.field}>
          {copy.risk}
          <select
            value={state.risk}
            onChange={(event) => setQuery("risk", event.target.value)}
          >
            <option value="all">All risk</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </label>
        <label className={styles.field}>
          {copy.owner}
          <select
            value={state.owner}
            onChange={(event) => setQuery("owner", event.target.value)}
          >
            <option value="all">All owners</option>
            {owners.map((owner) => (
              <option value={owner} key={owner}>
                {owner}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          {copy.sort}
          <select
            value={state.sort}
            onChange={(event) => setQuery("sort", event.target.value)}
          >
            {/*
              Every sort the URL accepts is offered here. A column header that
              produced a token this list did not carry would leave a
              controlled `<select>` with a value matching no option, and React
              would fall back to showing the first one -- the page telling the
              reader it is sorted by something it is not.
            */}
            <option value="name-asc">Name A–Z</option>
            <option value="name-desc">Name Z–A</option>
            <option value="risk-desc">Highest risk</option>
            <option value="risk-asc">Lowest risk</option>
            <option value="status-asc">Status A–Z</option>
            <option value="status-desc">Status Z–A</option>
          </select>
        </label>
        <label className={styles.field}>
          {copy.pageSize}
          <select
            value={state.pageSize}
            onChange={(event) => setQuery("pageSize", event.target.value)}
          >
            <option value="5">5</option>
            <option value="10">10</option>
            <option value="20">20</option>
          </select>
        </label>
        <label className={styles.field}>
          {copy.view}
          <select
            value={state.view}
            onChange={(event) => setQuery("view", event.target.value)}
          >
            <option value="table">Table</option>
            <option value="cards">Cards</option>
          </select>
        </label>
      </form>

      <section
        className={`${styles.section} ${state.view === "cards" ? styles.cardsOnly : ""}`}
        aria-labelledby="partner-results-title"
      >
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.eyebrow}>Results</p>
            <h2 id="partner-results-title">{config.title}</h2>
          </div>
          <p className={styles.count} aria-live="polite">
            {filtered.length} {config.noun}
          </p>
        </div>
        {!canUse ? (
          <PermissionView />
        ) : noMatch ? (
          <div className={styles.state}>
            <ApplicationStatePanel
              state="empty"
              title={copy.noMatchTitle}
              description={copy.noMatchBody}
              action={
                <Button
                  variant="secondary"
                  onClick={() => router.replace(pathname as Route)}
                >
                  Clear filters
                </Button>
              }
            />
          </div>
        ) : (
          <>
            <RecordsTable
              config={config}
              onSort={(next) => setQuery("sort", next)}
              records={page.records}
              sort={state.sort}
            />
            <RecordCards records={page.records} />
          </>
        )}
        {canUse && !noMatch ? (
          <nav className={styles.pagination} aria-label="Results pages">
            <p>
              Page {page.page} of {page.pageCount}
            </p>
            <div className={styles.actions}>
              <Button
                size="small"
                variant="secondary"
                disabled={page.page <= 1}
                onClick={() => setQuery("page", page.page - 1)}
              >
                {copy.previous}
              </Button>
              <Button
                size="small"
                variant="secondary"
                disabled={page.page >= page.pageCount}
                onClick={() => setQuery("page", page.page + 1)}
              >
                {copy.next}
              </Button>
            </div>
          </nav>
        ) : null}
      </section>
      <p className={styles.ruleFooter}>{config.rule}</p>
      {surface === "renewals" && canUse ? (
        <RenewalPanel record={config.records[0]} />
      ) : null}
    </main>
  );
}
