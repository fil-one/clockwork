"use client";

import { useMemo, useState } from "react";

import { adminSafetyCopy } from "./copy";
import { priceBookVersions } from "./data";
import { buildReviewSummary, canDecide, type ReviewSummary } from "./policy";
import {
  AdministrationPage,
  HumanSelector,
  ReviewSummaryCard,
  StatusPill,
  TechnicalEvidence,
  styles,
} from "./ui";

export function PriceBookAdministration({
  roles,
}: {
  roles: readonly string[];
}) {
  const [query, setQuery] = useState("");
  const [currency, setCurrency] = useState("All");
  const [route, setRoute] = useState("All");
  const [selectedId, setSelectedId] = useState(
    priceBookVersions.find((version) => version.state === "Draft")?.id ??
      priceBookVersions[0]?.id ??
      "",
  );
  const [reason, setReason] = useState("");
  const [summary, setSummary] = useState<ReviewSummary | null>(null);
  const [message, setMessage] = useState("");
  const permitted = canDecide(roles, "finance");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return priceBookVersions.filter(
      (book) =>
        (currency === "All" || book.currency === currency) &&
        (route === "All" ||
          book.route.toLowerCase().includes(route.toLowerCase())) &&
        (!needle ||
          [
            book.label,
            book.version,
            book.currency,
            book.route,
            book.scan,
            book.variance,
          ].some((value) => value.toLowerCase().includes(needle))),
    );
  }, [currency, query, route]);
  const selected =
    priceBookVersions.find((version) => version.id === selectedId) ??
    priceBookVersions[0];

  if (!selected) return null;

  return (
    <AdministrationPage {...adminSafetyCopy.priceBooks}>
      <section className={styles.notice} role="note">
        <strong>Value state is explicit.</strong>
        Estimated variance is planning data, pending reconciliation is not
        final, and only activated server records are pricing truth.
      </section>

      <section
        className={styles.panel}
        aria-labelledby="price-book-versions-title"
      >
        <div className={styles.panelHeading}>
          <div>
            <h2 id="price-book-versions-title">Version scan</h2>
            <p>Pricing service · Fresh as of Jul 31, 2026 at 11:46 AM EDT</p>
          </div>
          <StatusPill state="Fresh" />
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
              placeholder="Name, version, route, or variance"
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
              <option>USD</option>
              <option>EUR</option>
              <option>GBP</option>
            </select>
          </label>
          <label className={styles.field}>
            Route
            <select
              value={route}
              onChange={(event) => setRoute(event.currentTarget.value)}
            >
              <option>All</option>
              <option>Direct</option>
              <option>Referral</option>
              <option>Resale</option>
            </select>
          </label>
        </div>
        <p className={styles.resultMeta} aria-live="polite">
          {filtered.length} of {priceBookVersions.length} versions · Active
          first, then effective date
        </p>
        {filtered.length ? (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <caption className={styles.srOnly}>
                Price book version and variance scan
              </caption>
              <thead>
                <tr>
                  <th scope="col">Price book</th>
                  <th scope="col">Version</th>
                  <th scope="col">Currency</th>
                  <th scope="col">Route</th>
                  <th scope="col">Effective</th>
                  <th scope="col">SKUs</th>
                  <th scope="col">State</th>
                  <th scope="col">Variance state</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((book) => (
                  <tr key={book.id}>
                    <td>
                      <strong>{book.label}</strong>
                      <small>{book.scan}</small>
                    </td>
                    <td>{book.version}</td>
                    <td>{book.currency}</td>
                    <td>{book.route}</td>
                    <td>{book.effectiveOn}</td>
                    <td>{book.skuCount}</td>
                    <td>
                      <StatusPill state={book.state} />
                    </td>
                    <td>{book.variance}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={styles.empty}>
            No price-book versions match these filters.
          </p>
        )}
      </section>

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
                entity: `${selected.label} v${selected.version} · ${selected.currency}`,
                impact: `Approves ${selected.skuCount} SKU definitions for ${selected.route.toLowerCase()} pricing from ${selected.effectiveOn}.`,
                evidence: [
                  selected.scan,
                  selected.variance,
                  "Floor and route coverage scan completed",
                ],
                policyBasis:
                  "Commercial policy CP-2 requires versioned rate cards, explicit routes, regional floors, and finance authority.",
                downstreamEffect:
                  "Activation makes the version eligible for new pricing resolutions. Existing quotes, orders, invoices, and collections remain unchanged.",
                reason,
              }),
            );
            setMessage("");
          }}
        >
          <HumanSelector
            label="Price book version"
            name="priceBookId"
            options={priceBookVersions.map((book) => ({
              ...book,
              label: `${book.label} v${book.version}`,
              description: `${book.currency} · ${book.route} · ${book.state}`,
            }))}
            value={selectedId}
            onChange={(id) => {
              if (id) setSelectedId(id);
              setReason("");
              setSummary(null);
              setMessage("");
            }}
          />
          <dl className={styles.metaGrid}>
            <div>
              <dt>Route</dt>
              <dd>{selected.route}</dd>
            </div>
            <div>
              <dt>Effective</dt>
              <dd>{selected.effectiveOn}</dd>
            </div>
            <div>
              <dt>Scan</dt>
              <dd>{selected.scan}</dd>
            </div>
            <div>
              <dt>Value state</dt>
              <dd>{selected.variance}</dd>
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
                setMessage("");
              }}
            />
          </label>
          <TechnicalEvidence
            identifiers={[{ label: "Price book ID", value: selected.id }]}
          />
          {!permitted ? (
            <div className={styles.roleNotice} role="note">
              <strong>Finance approval authority is required.</strong>
              Other internal roles may scan versions, but only finance may
              approve activation.
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

      {summary ? (
        <>
          <ReviewSummaryCard
            summary={summary}
            title="Price-book activation review"
            identifiers={[{ label: "Price book ID", value: selected.id }]}
          />
          <div className={styles.actions}>
            <button
              className={styles.button}
              type="button"
              onClick={() =>
                setMessage(
                  "Activation is ready for secure submission. The pricing service will revalidate finance authority, version state, route coverage, and floors.",
                )
              }
            >
              Approve activation
            </button>
          </div>
        </>
      ) : null}
      {message ? (
        <p className={styles.statusMessage} role="status">
          {message}
        </p>
      ) : null}
    </AdministrationPage>
  );
}
