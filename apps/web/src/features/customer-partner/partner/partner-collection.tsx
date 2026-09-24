"use client";
import type { Route } from "next";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { ApplicationStatePanel, Button, Table } from "@clockwork/ui";

import { requestRenewal } from "@/src/features/contracts/commerce-client";
import { sendProjectionAction } from "@/src/features/contracts/experience-client";
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
import type { MessageId } from "@/src/i18n";
import { useTranslations } from "@/src/i18n/client";

import type {
  PartnerRecord,
  PartnerSurfaceConfig,
  PartnerSurfaceKey,
} from "./partner-data";
import {
  partnerRiskChips,
  partnerRiskLevels,
  partnerStatusLabels,
} from "./partner-presentation";
import {
  filterPartnerRecords,
  paginatePartnerRecords,
  parsePartnerQuery,
  updatePartnerQuery,
  type PartnerQueryKey,
  type PartnerSort,
} from "./partner-query";
import { registrationCreditLabel, roleCanUseSurface } from "./partner-rules";
import styles from "./partner.module.css";

/*
 * Every word on this page is a message ID rendered with `t`. Record facts
 * (names, references, owners, amounts) arrive already formatted for the reader
 * from the read boundary and are placed into messages as values; nothing here
 * joins translated fragments into a sentence.
 */

export function PartnerSurfacePermission() {
  const t = useTranslations();
  return (
    <div className={styles.state}>
      <ApplicationStatePanel
        state="permission"
        title={t("cp.common.permissionTitle")}
        description={t("cp.common.permissionBody")}
      />
    </div>
  );
}

function RecordTitle({ record }: { record: PartnerRecord }) {
  const t = useTranslations();
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
      <span className={styles.id}>
        {t("common.reference", { reference: record.id })}
      </span>
      {!record.href ? (
        <span className={styles.meta}>
          {t("partner.collection.summaryOnly")}
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
  surface,
  sort,
  onSort,
}: {
  config: PartnerSurfaceConfig;
  records: readonly PartnerRecord[];
  surface: PartnerSurfaceKey;
  sort: PartnerSort;
  onSort: (next: PartnerSort) => void;
}) {
  const t = useTranslations();
  const headers = [
    t(config.columns[0]),
    t("common.status"),
    t("partner.collection.riskAndOwner"),
    t(config.columns[1]),
    t(config.columns[2]),
  ];
  return (
    <Table
      caption={t(config.title)}
      captionHidden
      className={styles.tableWrap ?? ""}
      columnSort={headers.map((header, index) => {
        const column = sortableColumns[index];
        if (!column) return null;
        return {
          direction: columnSortDirection(column, sort),
          control: (
            <button
              aria-label={columnSortLabel(column, sort, header, t)}
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
          {t(partnerStatusLabels[record.status])}
        </span>,
        <>
          <span className={styles.pill} data-risk={record.risk}>
            {t(partnerRiskChips[record.risk])}
          </span>
          <span className={styles.meta}>{record.owner}</span>
        </>,
        <strong>{record.value}</strong>,
        <>
          {record.secondary}
          {surface === "registrations" ? (
            <span className={styles.meta}>
              {t(registrationCreditLabel(record.status))}
            </span>
          ) : null}
        </>,
      ])}
    />
  );
}

function RecordCards({
  records,
  surface,
}: {
  records: readonly PartnerRecord[];
  surface: PartnerSurfaceKey;
}) {
  const t = useTranslations();
  return (
    <div className={styles.mobileCards}>
      {records.map((record) => (
        <article className={styles.mobileCard} key={record.id}>
          <div className={styles.cardTop}>
            <div>
              <RecordTitle record={record} />
            </div>
            <span className={styles.pill} data-tone={record.status}>
              {t(partnerStatusLabels[record.status])}
            </span>
          </div>
          <div className={styles.cardValues}>
            <div>
              <span>{t("partner.detail.position")}</span>
              <strong>{record.value}</strong>
            </div>
            <div>
              <span>{t("partner.detail.milestone")}</span>
              <strong>{record.secondary}</strong>
              {surface === "registrations" ? (
                <span className={styles.meta}>
                  {t(registrationCreditLabel(record.status))}
                </span>
              ) : null}
            </div>
            <div>
              <span>{t("common.owner")}</span>
              <strong>{record.owner}</strong>
            </div>
            <div>
              <span>{t("common.risk")}</span>
              <strong>{t(partnerRiskLevels[record.risk])}</strong>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

const surfacesWithPriceBoundary: readonly PartnerSurfaceKey[] = [
  "portfolio",
  "quotes",
  "billing",
  "renewals",
  "commissions",
];

function PriceBoundary({
  surface,
  partnerName,
}: {
  surface: PartnerSurfaceKey;
  partnerName: string;
}) {
  const t = useTranslations();
  if (!surfacesWithPriceBoundary.includes(surface)) return null;
  // One message per sentence set. The partner's name is a value inside it, so
  // each language puts it where its grammar needs it.
  const merchant: MessageId =
    surface === "billing"
      ? "partner.collection.merchantBilling"
      : "partner.collection.merchantResale";
  return (
    <section
      className={styles.boundary}
      aria-label={t("partner.collection.boundaryLabel")}
    >
      <div>
        <h2>{t("cp.partner.transferPrice")}</h2>
        <p>{t("partner.collection.transferPriceBody")}</p>
      </div>
      <div>
        <h2>{t("cp.partner.partnerPrice")}</h2>
        <p>
          {t("partner.collection.resalePriceBody", { partner: partnerName })}
        </p>
      </div>
      <div>
        <h2>{t("cp.partner.merchantOfRecord")}</h2>
        <p>{t(merchant, { partner: partnerName })}</p>
      </div>
    </section>
  );
}

interface RenewalCommandContext {
  readonly accountId: string;
  readonly orderId: string;
}

function RenewalPanel({
  record,
  renewalContext,
}: {
  record: PartnerRecord | undefined;
  renewalContext?: RenewalCommandContext;
}) {
  const t = useTranslations();
  const router = useRouter();
  const [reviewing, setReviewing] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [succeeded, setSucceeded] = useState(false);
  const [message, setMessage] = useState<MessageId | null>(null);
  const idempotencyKeyRef = useRef<string | null>(null);
  const canRequest = renewalContext
    ? Boolean(
        record && record.status !== "pending" && record.status !== "canceled",
      )
    : Boolean(
        record?.projectionId &&
        record.recordKey &&
        record.recordVersion &&
        record.allowedActions?.includes("request_renewal"),
      );
  const summary = record
    ? [record.name, record.context, record.value, record.secondary]
    : [];
  async function submit() {
    if (!confirmed || !record || !canRequest) return;
    setPending(true);
    setMessage(null);
    try {
      idempotencyKeyRef.current ??= crypto.randomUUID();
      if (renewalContext)
        await requestRenewal(
          {
            ...renewalContext,
            requestedAction: "renew",
            requestedTermMonths: 12,
          },
          { idempotencyKey: idempotencyKeyRef.current },
        );
      else {
        if (
          !record.projectionId ||
          !record.recordKey ||
          !record.recordVersion
        ) {
          setMessage("partner.renewal.notActionable");
          return;
        }
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
      }
      setSucceeded(true);
      setMessage("partner.renewal.submitted");
      router.refresh();
    } catch {
      // The server's own wording is not shown: it is not in the reader's
      // language, and the only fact the reader needs is that nothing changed.
      setMessage("partner.renewal.failed");
    } finally {
      setPending(false);
    }
  }
  return (
    <section className={styles.workflow} aria-labelledby="renewal-review-title">
      <h2 id="renewal-review-title">{t("cp.partner.renewalReview")}</h2>
      {!reviewing ? (
        <>
          <p className={styles.muted}>{t("partner.renewal.explainer")}</p>
          <Button onClick={() => setReviewing(true)}>
            {record
              ? t("partner.renewal.reviewRecord", { name: record.name })
              : t("partner.renewal.noneSelected")}
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
            <span>{t("partner.renewal.confirmation")}</span>
          </label>
          <div className={styles.actions}>
            <Button
              variant="secondary"
              onClick={() => {
                setReviewing(false);
                setConfirmed(false);
              }}
            >
              {t("common.back")}
            </Button>
            <Button
              disabled={!confirmed || succeeded || !canRequest}
              loading={pending}
              onClick={() => {
                void submit();
              }}
            >
              {t("partner.renewal.submit")}
            </Button>
          </div>
        </>
      )}
      {message ? (
        <p className={styles.success} role="status">
          {t(message)}
        </p>
      ) : null}
    </section>
  );
}

/** Status filter choices, in the order the select offers them. */
const statusFilters: readonly {
  value: string;
  label: MessageId;
}[] = [
  { value: "all", label: "common.allStatuses" },
  { value: "attention", label: "status.attention" },
  { value: "draft", label: "status.draft" },
  { value: "open", label: "status.open" },
  { value: "active", label: "status.active" },
  { value: "pending", label: "status.pending" },
  { value: "accepted", label: "status.accepted" },
  { value: "paid", label: "status.paid" },
  { value: "blocked", label: "status.blocked" },
];

/**
 * Every sort the URL accepts is offered here. A column header that produced a
 * token this list did not carry would leave a controlled `<select>` with a
 * value matching no option, and React would fall back to showing the first
 * one -- the page telling the reader it is sorted by something it is not.
 */
const sortOptions: readonly { value: PartnerSort; label: MessageId }[] = [
  { value: "name-asc", label: "common.sort.nameAsc" },
  { value: "name-desc", label: "common.sort.nameDesc" },
  { value: "risk-desc", label: "common.sort.riskDesc" },
  { value: "risk-asc", label: "common.sort.riskAsc" },
  { value: "status-asc", label: "common.sort.statusAsc" },
  { value: "status-desc", label: "common.sort.statusDesc" },
];

export function PartnerCollection({
  surface,
  config,
  roles,
  partnerName,
  freshness,
  formatting,
  actions,
  renewalContext,
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
  /**
   * Guided-demo binding to the hidden renewal order. Production collection
   * records continue through their projection action and never receive this.
   */
  renewalContext?: RenewalCommandContext;
}) {
  const t = useTranslations();
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
          <p className={styles.eyebrow}>{t(config.eyebrow)}</p>
          <h1>{t(config.title)}</h1>
          <p>{t(config.description)}</p>
          <ProjectionFreshnessNotice
            formatting={formatting}
            freshness={freshness}
          />
        </div>
        {config.primaryAction && canCreate ? (
          <Link className={styles.buttonLink} href={config.primaryAction.href}>
            {t(config.primaryAction.label)}
          </Link>
        ) : null}
      </header>

      <PriceBoundary partnerName={partnerName} surface={surface} />
      {config.gate ? <p className={styles.gate}>{t(config.gate)}</p> : null}

      {actions}

      <form
        className={styles.filters}
        aria-label={t("common.filters")}
        onSubmit={(event) => {
          event.preventDefault();
          setQuery("q", queryDraft);
        }}
      >
        <label className={styles.field}>
          {t("common.search")}
          <span className={styles.searchControl}>
            <input
              type="search"
              value={queryDraft}
              placeholder={t(config.searchPlaceholder)}
              onChange={(event) => setQueryDraft(event.target.value)}
            />
            <Button size="small" type="submit">
              {t("common.apply")}
            </Button>
          </span>
        </label>
        <label className={styles.field}>
          {t("common.status")}
          <select
            value={state.status}
            onChange={(event) => setQuery("status", event.target.value)}
          >
            {statusFilters.map((option) => (
              <option key={option.value} value={option.value}>
                {t(option.label)}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          {t("common.risk")}
          <select
            value={state.risk}
            onChange={(event) => setQuery("risk", event.target.value)}
          >
            <option value="all">{t("common.allRiskLevels")}</option>
            <option value="high">{t("risk.level.high")}</option>
            <option value="medium">{t("risk.level.medium")}</option>
            <option value="low">{t("risk.level.low")}</option>
          </select>
        </label>
        <label className={styles.field}>
          {t("common.owner")}
          <select
            value={state.owner}
            onChange={(event) => setQuery("owner", event.target.value)}
          >
            <option value="all">{t("common.allOwners")}</option>
            {owners.map((owner) => (
              <option value={owner} key={owner}>
                {owner}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          {t("common.sort")}
          <select
            value={state.sort}
            onChange={(event) => setQuery("sort", event.target.value)}
          >
            {sortOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {t(option.label)}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          {t("common.rowsPerPage")}
          <select
            value={state.pageSize}
            onChange={(event) => setQuery("pageSize", event.target.value)}
          >
            {[5, 10, 20].map((size) => (
              <option key={size} value={size}>
                {new Intl.NumberFormat(formatting.locale).format(size)}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          {t("common.view")}
          <select
            value={state.view}
            onChange={(event) => setQuery("view", event.target.value)}
          >
            <option value="table">{t("common.view.table")}</option>
            <option value="cards">{t("common.view.cards")}</option>
          </select>
        </label>
      </form>

      <section
        className={`${styles.section} ${state.view === "cards" ? styles.cardsOnly : ""}`}
        aria-labelledby="partner-results-title"
      >
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.eyebrow}>{t("common.resultsHeading")}</p>
            <h2 id="partner-results-title">{t(config.title)}</h2>
          </div>
          <p className={styles.count} aria-live="polite">
            {t(config.count, { count: filtered.length })}
          </p>
        </div>
        {!canUse ? (
          <PartnerSurfacePermission />
        ) : noMatch ? (
          <div className={styles.state}>
            <ApplicationStatePanel
              state="empty"
              title={t("cp.common.noMatchTitle")}
              description={t("cp.common.noMatchBody")}
              action={
                <Button
                  variant="secondary"
                  onClick={() => router.replace(pathname as Route)}
                >
                  {t("common.clearFilters")}
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
              surface={surface}
              sort={state.sort}
            />
            <RecordCards records={page.records} surface={surface} />
          </>
        )}
        {canUse && !noMatch ? (
          <nav
            className={styles.pagination}
            aria-label={t("common.pagination")}
          >
            <p>
              {t("common.pagination.pageOf", {
                page: page.page,
                pages: page.pageCount,
              })}
            </p>
            <div className={styles.actions}>
              <Button
                size="small"
                variant="secondary"
                disabled={page.page <= 1}
                onClick={() => setQuery("page", page.page - 1)}
              >
                {t("common.pagination.previous")}
              </Button>
              <Button
                size="small"
                variant="secondary"
                disabled={page.page >= page.pageCount}
                onClick={() => setQuery("page", page.page + 1)}
              >
                {t("common.pagination.next")}
              </Button>
            </div>
          </nav>
        ) : null}
      </section>
      <p className={styles.ruleFooter}>{t(config.rule)}</p>
      {surface === "renewals" && canUse ? (
        <RenewalPanel
          record={config.records[0]}
          {...(renewalContext ? { renewalContext } : {})}
        />
      ) : null}
    </main>
  );
}
