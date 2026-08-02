"use client";

import { useMemo, useState } from "react";

import type { PriceBookAdministrationRecord } from "@clockwork/db";

import {
  CommerceApiError,
  sendCoreCommand,
} from "@/src/features/contracts/commerce-client";

import { adminSafetyCopy } from "./copy";
import { buildReviewSummary, canDecide, type ReviewSummary } from "./policy";
import {
  AdministrationPage,
  HumanSelector,
  ReviewSummaryCard,
  StatusPill,
  TechnicalEvidence,
  styles,
} from "./ui";

type Decision = "request_activation" | "activate" | "retire";

const activationCopy = adminSafetyCopy.priceBookActivation;

const stateLabel = {
  draft: "Draft",
  active: "Active",
  retired: "Retired",
} as const;

function decisionsFor(
  book: PriceBookAdministrationRecord,
  userId: string,
): readonly { action: Decision; label: string; hint: string }[] {
  if (book.status === "active")
    return [
      {
        action: "retire",
        label: activationCopy.retireLabel,
        hint: activationCopy.retireHint,
      },
    ];
  if (book.status !== "draft") return [];
  if (!book.activationRequestedBy)
    return [
      {
        action: "request_activation",
        label: activationCopy.proposeLabel,
        hint: activationCopy.proposeHint,
      },
    ];
  if (book.activationRequestedBy === userId) return [];
  return [
    {
      action: "activate",
      label: activationCopy.approveLabel,
      hint: activationCopy.approveHint,
    },
  ];
}

export function PriceBookAdministration({
  roles,
  userId,
  books,
  source,
  readAt,
}: {
  roles: readonly string[];
  userId: string;
  books: readonly PriceBookAdministrationRecord[];
  source: string;
  readAt: string;
}) {
  const [query, setQuery] = useState("");
  const [currency, setCurrency] = useState("All");
  const [state, setState] = useState("All");
  const [selectedId, setSelectedId] = useState(
    books.find((book) => book.status === "draft")?.id ?? books[0]?.id ?? "",
  );
  const [reason, setReason] = useState("");
  const [summary, setSummary] = useState<ReviewSummary | null>(null);
  const [outcome, setOutcome] = useState<{
    tone: "done" | "problem";
    message: string;
  } | null>(null);
  const [pending, setPending] = useState(false);
  const permitted = canDecide(roles, "finance");

  const currencies = useMemo(
    () => [...new Set(books.map((book) => book.currency))].sort(),
    [books],
  );
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return books.filter(
      (book) =>
        (currency === "All" || book.currency === currency) &&
        (state === "All" || stateLabel[book.status] === state) &&
        (!needle ||
          [
            book.name,
            String(book.version),
            book.currency,
            ...book.regions,
          ].some((value) => value.toLowerCase().includes(needle))),
    );
  }, [books, currency, query, state]);
  const selected = books.find((book) => book.id === selectedId) ?? books[0];
  const decisions = selected ? decisionsFor(selected, userId) : [];

  async function submit(action: Decision) {
    if (!selected) return;
    setPending(true);
    setOutcome(null);
    try {
      await sendCoreCommand({
        resource: "price_books",
        id: selected.id,
        action,
        expectedVersion: selected.rowVersion,
        payload: { reason },
      });
      setOutcome({
        tone: "done",
        message:
          action === "request_activation"
            ? activationCopy.proposed
            : action === "activate"
              ? activationCopy.activated
              : activationCopy.retired,
      });
      setReason("");
      setSummary(null);
    } catch (error) {
      setOutcome({
        tone: "problem",
        message:
          error instanceof CommerceApiError && error.code === "conflict"
            ? activationCopy.stale
            : error instanceof CommerceApiError
              ? error.message
              : activationCopy.failed,
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <AdministrationPage {...adminSafetyCopy.priceBooks}>
      <section className={styles.notice} role="note">
        <strong>Only activated versions set price.</strong>
        {activationCopy.authorities}
      </section>

      <section
        className={styles.panel}
        aria-labelledby="price-book-versions-title"
      >
        <div className={styles.panelHeading}>
          <div>
            <h2 id="price-book-versions-title">Version scan</h2>
            <p>
              {source} · Read at {readAt}
            </p>
          </div>
          <StatusPill state={books.length ? "Fresh" : "Unavailable"} />
        </div>
        <div
          className={styles.toolbar}
          role="search"
          aria-label="Price book filters"
        >
          <label className={styles.field}>
            Search price books
            <input
              type="search"
              value={query}
              placeholder="Name, version, currency, or region"
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
          </label>
          <label className={styles.field}>
            Currency
            <select
              value={currency}
              onChange={(event) => setCurrency(event.currentTarget.value)}
            >
              <option>All</option>
              {currencies.map((code) => (
                <option key={code}>{code}</option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            State
            <select
              value={state}
              onChange={(event) => setState(event.currentTarget.value)}
            >
              <option>All</option>
              <option>Draft</option>
              <option>Active</option>
              <option>Retired</option>
            </select>
          </label>
        </div>
        <p className={styles.resultMeta} aria-live="polite">
          {filtered.length} of {books.length} versions · Currency, then newest
          version
        </p>
        {filtered.length ? (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <caption className={styles.srOnly}>
                Price book versions and activation readiness
              </caption>
              <thead>
                <tr>
                  <th scope="col">Price book</th>
                  <th scope="col">Version</th>
                  <th scope="col">Currency</th>
                  <th scope="col">Regions</th>
                  <th scope="col">Effective</th>
                  <th scope="col">Rate cards</th>
                  <th scope="col">State</th>
                  <th scope="col">Activation</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((book) => (
                  <tr key={book.id}>
                    <td>
                      <strong>{book.name}</strong>
                    </td>
                    <td>{book.version}</td>
                    <td>{book.currency}</td>
                    <td>{book.regions.join(", ") || "None"}</td>
                    <td>
                      {book.effectiveFrom}
                      {book.effectiveTo ? ` to ${book.effectiveTo}` : ""}
                    </td>
                    <td>{book.rateCardCount}</td>
                    <td>
                      <StatusPill state={stateLabel[book.status]} />
                    </td>
                    <td>
                      {book.activationRequestedByEmail
                        ? `Proposed by ${book.activationRequestedByEmail}`
                        : book.status === "draft"
                          ? "Not proposed"
                          : "Decided"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={styles.empty}>
            {books.length
              ? activationCopy.noMatches
              : activationCopy.unreadable}
          </p>
        )}
      </section>

      {selected ? (
        <section
          className={styles.panel}
          aria-labelledby="price-book-review-title"
        >
          <div className={styles.panelHeading}>
            <div>
              <h2 id="price-book-review-title">Finance activation review</h2>
              <p>
                Review creates no quote, order, invoice, or collected-value
                assertion.
              </p>
            </div>
            <StatusPill state={permitted ? "Finance authority" : "Read only"} />
          </div>
          <form
            className={styles.panelBody}
            onSubmit={(event) => {
              event.preventDefault();
              setSummary(
                buildReviewSummary({
                  entity: `${selected.name} v${selected.version} · ${selected.currency}`,
                  impact: `Approves ${selected.rateCardCount} rate cards across ${selected.regions.join(", ") || "no region"} from ${selected.effectiveFrom}.`,
                  evidence: [
                    `${selected.rateCardCount} rate cards persisted`,
                    selected.activationRequestedByEmail
                      ? `Proposed by ${selected.activationRequestedByEmail}`
                      : "Not yet proposed",
                    selected.lastDecisionReason ?? "No prior decision recorded",
                  ],
                  policyBasis:
                    "Commercial policy CP-2 requires versioned rate cards, explicit routes, regional floors, and two finance authorities.",
                  downstreamEffect:
                    "Activation makes the version eligible for new pricing resolutions. Existing quotes, orders, invoices, and collections remain unchanged.",
                  reason,
                }),
              );
            }}
          >
            <HumanSelector
              label="Price book version"
              name="priceBookId"
              options={books.map((book) => ({
                ...book,
                label: `${book.name} v${book.version}`,
                description: `${book.currency} · ${stateLabel[book.status]} · ${book.rateCardCount} rate cards`,
              }))}
              value={selectedId}
              onChange={(id) => {
                if (id) setSelectedId(id);
                setReason("");
                setSummary(null);
                setOutcome(null);
              }}
            />
            <dl className={styles.metaGrid}>
              <div>
                <dt>Regions</dt>
                <dd>{selected.regions.join(", ") || "None"}</dd>
              </div>
              <div>
                <dt>Effective</dt>
                <dd>{selected.effectiveFrom}</dd>
              </div>
              <div>
                <dt>Rate cards</dt>
                <dd>{selected.rateCardCount}</dd>
              </div>
              <div>
                <dt>Proposed by</dt>
                <dd>{selected.activationRequestedByEmail ?? "Not proposed"}</dd>
              </div>
            </dl>
            <label className={styles.field}>
              Finance decision reason
              <textarea
                value={reason}
                required
                minLength={8}
                placeholder="Explain the commercial evidence and activation rationale."
                onChange={(event) => {
                  setReason(event.currentTarget.value);
                  setSummary(null);
                }}
              />
            </label>
            <TechnicalEvidence
              identifiers={[{ label: "Price book ID", value: selected.id }]}
            />
            {!permitted ? (
              <div className={styles.roleNotice} role="note">
                <strong>{activationCopy.financeOnlyTitle}</strong>
                {activationCopy.financeOnlyBody}
              </div>
            ) : null}
            {permitted &&
            selected.status === "draft" &&
            selected.activationRequestedBy === userId ? (
              <div className={styles.roleNotice} role="note">
                <strong>{activationCopy.awaitingSecondTitle}</strong>
                {activationCopy.awaitingSecondBody}
              </div>
            ) : null}
            <div className={styles.actions}>
              <button
                className={styles.button}
                type="submit"
                disabled={!permitted}
              >
                Review price-book approval
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {summary && selected ? (
        <>
          <ReviewSummaryCard
            summary={summary}
            title="Price-book activation review"
            identifiers={[{ label: "Price book ID", value: selected.id }]}
          />
          <section className={styles.panel} aria-label="Record the decision">
            <div className={styles.panelBody}>
              {decisions.length ? (
                decisions.map((decision) => (
                  <div key={decision.action} className={styles.actions}>
                    <button
                      className={styles.button}
                      type="button"
                      disabled={!permitted || pending || reason.length < 8}
                      onClick={() => void submit(decision.action)}
                    >
                      {pending ? "Recording…" : decision.label}
                    </button>
                    <p className={styles.resultMeta}>{decision.hint}</p>
                  </div>
                ))
              ) : (
                <p className={styles.resultMeta}>{activationCopy.noDecision}</p>
              )}
              {outcome ? (
                <p
                  className={styles.resultMeta}
                  role="status"
                  aria-live="polite"
                >
                  {outcome.message}
                </p>
              ) : null}
            </div>
          </section>
        </>
      ) : null}
    </AdministrationPage>
  );
}
