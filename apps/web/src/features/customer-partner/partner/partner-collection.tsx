"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { ApplicationStatePanel, Button } from "@clockwork/ui";

import { customerPartnerCopy } from "@/src/features/customer-partner/copy";
import { requestRenewal } from "@/src/features/contracts/commerce-client";

import type {
  PartnerRecord,
  PartnerSurfaceConfig,
  PartnerSurfaceKey,
} from "./partner-data";
import { partnerIds } from "./partner-data";
import {
  filterPartnerRecords,
  paginatePartnerRecords,
  parsePartnerQuery,
  updatePartnerQuery,
  type PartnerQueryKey,
} from "./partner-query";
import { renewalReviewSummary, roleCanUseSurface } from "./partner-rules";
import styles from "./partner.module.css";

const copy = customerPartnerCopy.common;
const partnerCopy = customerPartnerCopy.partner;

function StateView({
  view,
}: {
  view: "loading" | "empty" | "permission" | "error";
}) {
  const state =
    view === "loading"
      ? {
          state: "loading" as const,
          title: copy.loadingTitle,
          body: copy.loadingBody,
        }
      : view === "permission"
        ? {
            state: "permission" as const,
            title: copy.permissionTitle,
            body: copy.permissionBody,
          }
        : view === "error"
          ? {
              state: "recoverable-error" as const,
              title: copy.errorTitle,
              body: copy.errorBody,
            }
          : {
              state: "empty" as const,
              title: copy.emptyTitle,
              body: copy.emptyBody,
            };
  return (
    <div className={styles.state}>
      <ApplicationStatePanel
        state={state.state}
        title={state.title}
        description={state.body}
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

function RecordsTable({
  config,
  records,
}: {
  config: PartnerSurfaceConfig;
  records: readonly PartnerRecord[];
}) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <caption className="sr-only">{config.title}</caption>
        <thead>
          <tr>
            <th scope="col">{config.columns[0]}</th>
            <th scope="col">{copy.status}</th>
            <th scope="col">Risk and owner</th>
            <th scope="col">{config.columns[1]}</th>
            <th scope="col">{config.columns[2]}</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr key={record.id}>
              <td>
                <RecordTitle record={record} />
              </td>
              <td>
                <span className={styles.pill} data-tone={record.status}>
                  {record.status}
                </span>
              </td>
              <td>
                <span className={styles.pill} data-risk={record.risk}>
                  {record.risk} risk
                </span>
                <span className={styles.meta}>{record.owner}</span>
              </td>
              <td>
                <strong>{record.value}</strong>
              </td>
              <td>{record.secondary}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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

function PriceBoundary({ surface }: { surface: PartnerSurfaceKey }) {
  if (
    !["portfolio", "quotes", "billing", "renewals", "commissions"].includes(
      surface,
    )
  )
    return null;
  const merchant =
    surface === "billing"
      ? "Meridian Channel Group for end-client resale; Clockwork invoices Meridian"
      : "Meridian Channel Group on resale routes";
  return (
    <section className={styles.boundary} aria-label="Commercial price boundary">
      <div>
        <h2>{partnerCopy.transferPrice}</h2>
        <p>
          Private partner cost returned from the approved Clockwork price book.
        </p>
      </div>
      <div>
        <h2>{partnerCopy.partnerPrice}</h2>
        <p>Set and controlled by Meridian; shown to the named end client.</p>
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

function RenewalPanel() {
  const [reviewing, setReviewing] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [succeeded, setSucceeded] = useState(false);
  const [message, setMessage] = useState("");
  const idempotencyKeyRef = useRef<string | null>(null);
  const summary = renewalReviewSummary({
    client: "Halcyon Research Cooperative",
    action: "renew",
    currentEnd: "December 31, 2026",
    requestedMonths: 12,
    transferPrice: "$91,200 annually",
    resalePrice: "$112,000 annually",
    merchantOfRecord: "Meridian Channel Group",
  });
  async function submit() {
    if (!confirmed) return;
    setPending(true);
    setMessage("");
    try {
      idempotencyKeyRef.current ??= crypto.randomUUID();
      await requestRenewal(
        {
          orderId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          accountId: partnerIds.endClient,
          requestedAction: "renew",
          requestedTermMonths: 12,
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
          : "The renewal request could not be submitted. Nothing changed.",
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
            Review Halcyon renewal
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
              disabled={!confirmed || succeeded}
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
}: {
  surface: PartnerSurfaceKey;
  config: PartnerSurfaceConfig;
  roles: readonly string[];
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

  const explicitState = !canUse
    ? "permission"
    : ["loading", "empty", "permission", "error"].includes(state.view)
      ? state.view
      : null;
  const noMatch = !explicitState && filtered.length === 0;
  const canCreate = config.primaryAction?.roles.includes(role);

  return (
    <main className={styles.main} id="main-content">
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>{config.eyebrow}</p>
          <h1>{config.title}</h1>
          <p>{config.description}</p>
        </div>
        {config.primaryAction && canCreate ? (
          <Link className={styles.buttonLink} href={config.primaryAction.href}>
            {config.primaryAction.label}
          </Link>
        ) : null}
      </header>

      <PriceBoundary surface={surface} />
      {config.gate ? <p className={styles.gate}>{config.gate}</p> : null}

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
            <option value="name-asc">Name A–Z</option>
            <option value="name-desc">Name Z–A</option>
            <option value="risk-desc">Highest risk</option>
            <option value="status-asc">Status</option>
          </select>
        </label>
        <label className={styles.field}>
          {copy.view}
          <select
            value={state.view}
            onChange={(event) => setQuery("view", event.target.value)}
          >
            <option value="table">Responsive</option>
            <option value="cards">Cards</option>
            <option value="loading">Loading state</option>
            <option value="empty">Empty state</option>
            <option value="error">Error state</option>
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
          <p className={styles.count}>
            {filtered.length} {config.noun}
          </p>
        </div>
        {explicitState ? (
          <StateView
            view={explicitState as "loading" | "empty" | "permission" | "error"}
          />
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
            <RecordsTable config={config} records={page.records} />
            <RecordCards records={page.records} />
          </>
        )}
        {!explicitState && !noMatch ? (
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
      {surface === "renewals" && canUse ? <RenewalPanel /> : null}
    </main>
  );
}
