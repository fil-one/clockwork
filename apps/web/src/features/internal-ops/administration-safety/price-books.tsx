"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import type { RateCard } from "@clockwork/domain/core";
import { DiscountMatrixEditor } from "./price-book-discounts";
import { priceBookEconomicDiff } from "./price-book-diff";
import type { PriceBookAdministrationRecord } from "@clockwork/db";
import { Table } from "@clockwork/ui";

import {
  CommerceApiError,
  sendCoreCommand,
} from "@/src/features/contracts/commerce-client";
import type {
  PriceBookAvailability,
  PriceBookSource,
} from "@/src/features/internal-ops/price-books/server-price-book-loader";

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

type Decision =
  "request_activation" | "activate" | "retire" | "reject_activation";

const activationCopy = adminSafetyCopy.priceBookActivation;

const stateLabel = {
  draft: "Draft",
  active: "Active",
  retired: "Retired",
} as const;

function formString(values: FormData, name: string): string {
  const value = values.get(name);
  return typeof value === "string" ? value : "";
}

function minorDecimal(value: string): string {
  const minor = BigInt(value);
  return `${minor / 100n}.${(minor % 100n).toString().padStart(2, "0")}`;
}

function currencyMinor(value: string): string | undefined {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/u.exec(value.trim());
  if (!match?.[1]) return undefined;
  return (
    BigInt(match[1]) * 100n +
    BigInt((match[2] ?? "").padEnd(2, "0") || "0")
  ).toString();
}

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
    {
      action: "reject_activation",
      label: "Return draft for changes",
      hint: "Records your reason and reopens the draft for editing. A new proposal is required before activation.",
    },
  ];
}

export function PriceBookAdministration({
  roles,
  userId,
  books,
  source,
  availability,
  readAt,
}: {
  roles: readonly string[];
  userId: string;
  books: readonly PriceBookAdministrationRecord[];
  source: PriceBookSource;
  availability: PriceBookAvailability;
  readAt: string;
}) {
  const router = useRouter();
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
  const [authoringPending, setAuthoringPending] = useState(false);
  const [draft, setDraft] = useState<{
    id: string;
    rowVersion: number;
    currency: "EUR" | "GBP" | "USD";
  } | null>(null);
  const [editingRate, setEditingRate] = useState<RateCard | null>(null);
  const [transferRows, setTransferRows] = useState<
    { tier: string; amount: string }[]
  >([]);
  const [authoringMessage, setAuthoringMessage] = useState("");
  const permitted = canDecide(roles, "finance");
  const authoringAvailable = permitted && availability !== "unavailable";
  const sourceLabel =
    source === "Deterministic demo fixture" ? "Guided demo data" : source;
  const updatedLabel = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(readAt));

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
  const incumbent = selected
    ? books.find(
        (book) =>
          book.id !== selected.id &&
          book.currency === selected.currency &&
          book.status === "active",
      )
    : undefined;
  const economicDiff =
    selected && incumbent ? priceBookEconomicDiff(selected, incumbent) : [];

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
          action === "reject_activation"
            ? "Activation rejected. The draft can be edited and proposed again."
            : action === "request_activation"
              ? activationCopy.proposed
              : action === "activate"
                ? activationCopy.activated
                : activationCopy.retired,
      });
      setReason("");
      setSummary(null);
      router.refresh();
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
        <p>
          <Link href="/internal/payg-offers">
            Configure PAYG billing and trial offer policies
          </Link>
          {" · "}
          <Link href="/internal/channel-policy">
            Configure channel and acquisition controls
          </Link>
        </p>
      </section>

      <section
        className={styles.panel}
        aria-labelledby="price-book-author-title"
      >
        <div className={styles.panelHeading}>
          <div>
            <h2 id="price-book-author-title">Author a priced draft</h2>
            <p>
              Create the version metadata, then add its first validated rate
              card. An empty draft can never be proposed for activation.
            </p>
          </div>
          <StatusPill
            state={authoringAvailable ? "Finance authority" : "Unavailable"}
          />
        </div>
        {!draft ? (
          <form
            className={styles.panelBody}
            onSubmit={(event) => {
              event.preventDefault();
              if (!authoringAvailable) return;
              const values = new FormData(event.currentTarget);
              const id = crypto.randomUUID();
              const currency = formString(values, "currency") as
                "EUR" | "GBP" | "USD";
              setAuthoringPending(true);
              setAuthoringMessage("");
              void sendCoreCommand({
                resource: "price_books",
                id,
                action: "create",
                payload: {
                  name: formString(values, "name").trim(),
                  currency,
                  effectiveFrom: formString(values, "effectiveFrom"),
                  version: Number(values.get("version")),
                },
              })
                .then(() => {
                  setDraft({ id, rowVersion: 1, currency });
                  setTransferRows([]);
                  setAuthoringMessage(
                    "Draft metadata recorded. Add its first rate card next.",
                  );
                  router.refresh();
                })
                .catch((error: unknown) => {
                  setAuthoringMessage(
                    error instanceof CommerceApiError
                      ? error.message
                      : "The draft was not created. Nothing changed.",
                  );
                })
                .finally(() => setAuthoringPending(false));
            }}
          >
            <div className={styles.metaGrid}>
              <label className={styles.field}>
                Price-book name
                <input name="name" required minLength={3} maxLength={120} />
              </label>
              <label className={styles.field}>
                Currency
                <select name="currency" defaultValue="USD">
                  <option>USD</option>
                  <option>EUR</option>
                  <option>GBP</option>
                </select>
              </label>
              <label className={styles.field}>
                Version
                <input name="version" type="number" min={1} step={1} required />
              </label>
              <label className={styles.field}>
                Effective from
                <input name="effectiveFrom" type="date" required />
              </label>
            </div>
            <p className={styles.resultMeta}>
              This first step creates a draft only. It cannot price a quote
              until the next step adds a complete rate card and finance later
              completes the two-authority activation.
            </p>
            <div className={styles.actions}>
              <button
                className={styles.button}
                type="submit"
                disabled={!authoringAvailable || authoringPending}
              >
                {authoringPending
                  ? "Creating draft…"
                  : "Create draft and continue"}
              </button>
            </div>
          </form>
        ) : (
          <form
            key={`${draft.id}:${editingRate?.id ?? "new"}`}
            className={styles.panelBody}
            onSubmit={(event) => {
              event.preventDefault();
              const values = new FormData(event.currentTarget);
              const minor = (name: string) => formString(values, name);
              const unitPriceMinor = currencyMinor(minor("unitPrice"));
              const floorPriceMinor = currencyMinor(minor("floorPrice"));
              const overageRateMinor = currencyMinor(minor("overageRate"));
              if (!unitPriceMinor || !floorPriceMinor || !overageRateMinor) {
                setAuthoringMessage(
                  `Enter each ${draft.currency} price with no more than two decimal places.`,
                );
                return;
              }
              const partnerTransferPrices: Record<
                string,
                { currency: typeof draft.currency; minor: string }
              > = {};
              for (const entry of transferRows) {
                const tier = entry.tier.trim();
                const amount = currencyMinor(entry.amount);
                if (
                  !tier ||
                  amount === undefined ||
                  Object.hasOwn(partnerTransferPrices, tier)
                ) {
                  setAuthoringMessage(
                    "Each transfer tier needs a unique name and a valid price with at most two decimal places.",
                  );
                  return;
                }
                partnerTransferPrices[tier] = {
                  currency: draft.currency,
                  minor: amount,
                };
              }
              setAuthoringPending(true);
              setAuthoringMessage("");
              void sendCoreCommand({
                resource: "price_books",
                id: draft.id,
                action: editingRate ? "update_rate" : "add_rate",
                expectedVersion: draft.rowVersion,
                payload: {
                  ...(editingRate ?? {}),
                  sku: minor("sku").trim(),
                  region: minor("region").trim(),
                  unit: minor("unit").trim(),
                  approvedClaim: minor("approvedClaim").trim(),
                  unitPrice: {
                    currency: draft.currency,
                    minor: unitPriceMinor,
                  },
                  floorPrice: {
                    currency: draft.currency,
                    minor: floorPriceMinor,
                  },
                  overageRate: {
                    currency: draft.currency,
                    minor: overageRateMinor,
                  },
                  minimumQuantity: minor("minimumQuantity"),
                  egressTreatment: minor("egressTreatment").trim(),
                  commitType: minor("commitType"),
                  stripeTaxCode: minor("stripeTaxCode").trim(),
                  qboIncomeAccount: minor("qboIncomeAccount").trim(),
                  partnerTransferPrices,
                },
              })
                .then(() => {
                  setSelectedId(draft.id);
                  setDraft(null);
                  setEditingRate(null);
                  setAuthoringMessage(
                    "Rate card saved. Reopen this draft to add or edit more rates, then review before proposing activation.",
                  );
                  router.refresh();
                })
                .catch((error: unknown) => {
                  setAuthoringMessage(
                    error instanceof CommerceApiError
                      ? error.message
                      : "The rate card was not added. The draft remains unchanged.",
                  );
                })
                .finally(() => setAuthoringPending(false));
            }}
          >
            <TechnicalEvidence
              identifiers={[{ label: "Draft ID", value: draft.id }]}
            />
            <div className={styles.metaGrid}>
              <label className={styles.field}>
                SKU
                <input
                  name="sku"
                  defaultValue={editingRate?.sku}
                  required
                  maxLength={80}
                />
              </label>
              <label className={styles.field}>
                Region
                <input
                  name="region"
                  defaultValue={editingRate?.region}
                  required
                  maxLength={80}
                />
              </label>
              <label className={styles.field}>
                Unit
                <input
                  name="unit"
                  defaultValue={editingRate?.unit ?? "TB-month"}
                  required
                  maxLength={40}
                />
              </label>
              <label className={styles.field}>
                Minimum quantity
                <input
                  name="minimumQuantity"
                  defaultValue={editingRate?.minimumQuantity ?? "1"}
                  required
                />
              </label>
              <label className={styles.field}>
                Unit price · {draft.currency}
                <input
                  name="unitPrice"
                  defaultValue={
                    editingRate?.unitPrice
                      ? minorDecimal(editingRate.unitPrice.minor)
                      : ""
                  }
                  inputMode="decimal"
                  required
                  pattern="[0-9]+(?:\.[0-9]{1,2})?"
                  placeholder="150.00"
                />
              </label>
              <label className={styles.field}>
                Floor price · {draft.currency}
                <input
                  name="floorPrice"
                  defaultValue={
                    editingRate?.floorPrice
                      ? minorDecimal(editingRate.floorPrice.minor)
                      : ""
                  }
                  inputMode="decimal"
                  required
                  pattern="[0-9]+(?:\.[0-9]{1,2})?"
                  placeholder="100.00"
                />
              </label>
              <label className={styles.field}>
                Overage rate · {draft.currency}
                <input
                  name="overageRate"
                  defaultValue={
                    editingRate?.overageRate
                      ? minorDecimal(editingRate.overageRate.minor)
                      : ""
                  }
                  inputMode="decimal"
                  required
                  pattern="[0-9]+(?:\.[0-9]{1,2})?"
                  placeholder="180.00"
                />
              </label>
              <label className={styles.field}>
                Commitment model
                <select
                  name="commitType"
                  defaultValue={editingRate?.commitType ?? "term_drawdown"}
                >
                  <option value="term_drawdown">Term drawdown</option>
                  <option value="period_allowance">Period allowance</option>
                </select>
              </label>
              <label className={styles.field}>
                Egress treatment
                <input
                  name="egressTreatment"
                  defaultValue={editingRate?.egressTreatment ?? "metered"}
                  required
                />
              </label>
              <label className={styles.field}>
                Stripe tax code
                <input
                  name="stripeTaxCode"
                  defaultValue={editingRate?.stripeTaxCode ?? ""}
                  placeholder="e.g. txcd_10103000"
                  required
                />
              </label>
              <label className={styles.field}>
                QBO income account
                <input
                  name="qboIncomeAccount"
                  defaultValue={editingRate?.qboIncomeAccount ?? "4000-Storage"}
                  required
                />
              </label>
            </div>
            <fieldset disabled={authoringPending}>
              <legend>Partner transfer prices</legend>
              <p className={styles.resultMeta}>
                Wholesale prices by tier, in {draft.currency}. These apply only
                to resale and distributor routes and remain subject to the
                floor. Leave empty for a direct-only rate.
              </p>
              {transferRows.map((entry, index) => (
                <div className={styles.metaGrid} key={index}>
                  <label className={styles.field}>
                    Transfer tier {index + 1}
                    <input
                      required
                      maxLength={80}
                      value={entry.tier}
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        setTransferRows((rows) =>
                          rows.map((row, position) =>
                            position === index ? { ...row, tier: value } : row,
                          ),
                        );
                      }}
                    />
                  </label>
                  <label className={styles.field}>
                    Transfer price {index + 1} · {draft.currency}
                    <input
                      required
                      inputMode="decimal"
                      pattern="[0-9]+(?:\.[0-9]{1,2})?"
                      value={entry.amount}
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        setTransferRows((rows) =>
                          rows.map((row, position) =>
                            position === index
                              ? { ...row, amount: value }
                              : row,
                          ),
                        );
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    className={styles.button}
                    onClick={() =>
                      setTransferRows((rows) =>
                        rows.filter((_, position) => position !== index),
                      )
                    }
                  >
                    Remove transfer tier {index + 1}
                  </button>
                </div>
              ))}
              <button
                type="button"
                className={styles.button}
                onClick={() =>
                  setTransferRows((rows) => [...rows, { tier: "", amount: "" }])
                }
              >
                Add transfer tier
              </button>
            </fieldset>
            <label className={styles.field}>
              Approved commercial claim
              <textarea
                name="approvedClaim"
                defaultValue={editingRate?.approvedClaim ?? ""}
                required
                maxLength={500}
              />
            </label>
            <div className={styles.actions}>
              <button
                className={styles.button}
                type="submit"
                disabled={authoringPending}
              >
                {authoringPending
                  ? "Validating rate…"
                  : editingRate
                    ? "Save rate card"
                    : "Add rate card"}
              </button>
              <button
                className={styles.button}
                type="button"
                disabled={authoringPending}
                onClick={() => {
                  setDraft(null);
                  setEditingRate(null);
                }}
              >
                Close draft editor
              </button>
            </div>
          </form>
        )}
        {authoringMessage ? (
          <p className={styles.resultMeta} role="status" aria-live="polite">
            {authoringMessage}
          </p>
        ) : null}
      </section>

      <section
        className={styles.panel}
        aria-labelledby="price-book-versions-title"
      >
        <div className={styles.panelHeading}>
          <div>
            <h2 id="price-book-versions-title">Price book versions</h2>
            <p>
              {sourceLabel} · Updated {updatedLabel} UTC
            </p>
          </div>
          <StatusPill
            state={
              availability === "unavailable"
                ? "Unavailable"
                : availability === "empty"
                  ? "Empty"
                  : "Fresh"
            }
          />
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
        <Table
          className={styles.scanTable ?? ""}
          caption="Price book versions and activation readiness"
          captionHidden
          density="compact"
          headers={[
            "Price book",
            "Version",
            "Currency",
            "Regions",
            "Effective",
            "Rate cards",
            "State",
            "Activation",
          ]}
          numericColumns={[5]}
          rowKeys={filtered.map((book) => book.id)}
          rows={filtered.map((book) => [
            <span className={styles.stackCell}>
              <strong>{book.name}</strong>
            </span>,
            book.version,
            book.currency,
            book.regions.join(", ") || "None",
            `${book.effectiveFrom}${book.effectiveTo ? ` to ${book.effectiveTo}` : ""}`,
            book.rateCardCount,
            <StatusPill state={stateLabel[book.status]} />,
            book.activationRequestedByEmail
              ? `Proposed by ${book.activationRequestedByEmail}`
              : book.status === "draft"
                ? "Not proposed"
                : "Decided",
          ])}
          emptyState={
            books.length
              ? activationCopy.noMatches
              : availability === "empty"
                ? activationCopy.empty
                : activationCopy.unreadable
          }
        />
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
            <div className={styles.actions}>
              <button
                className={styles.button}
                type="button"
                onClick={() => {
                  const url = URL.createObjectURL(
                    new Blob(
                      [
                        JSON.stringify(
                          {
                            format: "clockwork.price-book.v1",
                            source: sourceLabel,
                            readAt,
                            priceBook: selected,
                          },
                          null,
                          2,
                        ),
                      ],
                      { type: "application/json" },
                    ),
                  );
                  const link = document.createElement("a");
                  link.href = url;
                  link.download = `price-book-${selected.currency}-v${selected.version}-${selected.id}.json`;
                  link.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                }}
              >
                Download price book
              </button>
              {selected.status === "draft" &&
              !selected.activationRequestedBy &&
              authoringAvailable ? (
                <button
                  className={styles.button}
                  type="button"
                  disabled={authoringPending}
                  onClick={() => {
                    setEditingRate(null);
                    setTransferRows([]);
                    setDraft({
                      id: selected.id,
                      rowVersion: selected.rowVersion,
                      currency: selected.currency as "USD" | "EUR" | "GBP",
                    });
                    setAuthoringMessage(
                      "Draft reopened. Add another SKU or region, or edit a rate below.",
                    );
                    document
                      .getElementById("price-book-author-title")
                      ?.scrollIntoView({ behavior: "smooth" });
                  }}
                >
                  Add a rate to this draft
                </button>
              ) : null}
            </div>
            <Table
              caption="Rate card economics"
              density="compact"
              headers={[
                "SKU / region",
                "List",
                "Floor",
                "Overage",
                "Minimum",
                "Commercial terms",
                "Actions",
              ]}
              rowKeys={(selected.rateCards ?? []).map((rate) => rate.id)}
              rows={(selected.rateCards ?? []).map((rate) => [
                `${rate.sku} / ${rate.region}`,
                `${selected.currency} ${minorDecimal(rate.unitPrice.minor)}`,
                rate.floorPrice
                  ? `${selected.currency} ${minorDecimal(rate.floorPrice.minor)}`
                  : "Not configured",
                `${selected.currency} ${minorDecimal(rate.overageRate.minor)}`,
                `${rate.minimumQuantity} ${rate.unit}`,
                <details>
                  <summary>Claims, mappings and transfer prices</summary>
                  <dl>
                    <dt>Approved claim</dt>
                    <dd>{rate.approvedClaim}</dd>
                    <dt>Commitment / egress</dt>
                    <dd>
                      {rate.commitType} / {rate.egressTreatment}
                    </dd>
                    <dt>Tax code / income account</dt>
                    <dd>
                      {rate.stripeTaxCode} / {rate.qboIncomeAccount}
                    </dd>
                    <dt>Transfer prices</dt>
                    <dd>
                      {Object.entries(rate.partnerTransferPrices)
                        .map(
                          ([tier, value]) =>
                            `${tier}: ${value.currency} ${minorDecimal(value.minor)}`,
                        )
                        .join("; ") || "None"}
                    </dd>
                    {rate.trialLimit ? (
                      <>
                        <dt>Legacy trial quantity</dt>
                        <dd>{rate.trialLimit}</dd>
                      </>
                    ) : null}
                  </dl>
                </details>,
                selected.status === "draft" &&
                !selected.activationRequestedBy &&
                authoringAvailable ? (
                  <div className={styles.actions}>
                    <button
                      type="button"
                      className={styles.button}
                      disabled={authoringPending}
                      aria-label={`Edit ${rate.sku} ${rate.region}`}
                      onClick={() => {
                        setEditingRate(rate);
                        setTransferRows(
                          Object.entries(rate.partnerTransferPrices).map(
                            ([tier, value]) => ({
                              tier,
                              amount: minorDecimal(value.minor),
                            }),
                          ),
                        );
                        setDraft({
                          id: selected.id,
                          rowVersion: selected.rowVersion,
                          currency: selected.currency as "USD" | "EUR" | "GBP",
                        });
                        document
                          .getElementById("price-book-author-title")
                          ?.scrollIntoView({ behavior: "smooth" });
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className={styles.button}
                      disabled={authoringPending}
                      aria-label={`Remove ${rate.sku} ${rate.region}`}
                      onClick={() => {
                        setAuthoringPending(true);
                        setSummary(null);
                        void sendCoreCommand({
                          resource: "price_books",
                          id: selected.id,
                          action: "remove_rate",
                          expectedVersion: selected.rowVersion,
                          payload: { id: rate.id },
                        })
                          .then(() => {
                            setDraft(null);
                            setEditingRate(null);
                            setAuthoringMessage(
                              "Rate removed from the draft. Review the remaining rates before proposing activation.",
                            );
                            router.refresh();
                          })
                          .catch((error: unknown) =>
                            setAuthoringMessage(
                              error instanceof Error
                                ? error.message
                                : "The rate was not removed.",
                            ),
                          )
                          .finally(() => setAuthoringPending(false));
                      }}
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  "Read only"
                ),
              ])}
              emptyState="No rate cards available. Add a rate before proposing activation."
            />
            {incumbent ? (
              <p className={styles.notice}>
                Activation replaces {incumbent.name} v{incumbent.version} for{" "}
                {selected.currency}. Only one price book can be active per
                currency, even when the new version has a different name. Review
                removed rates before approval.
              </p>
            ) : null}
            {incumbent && selected.rateCards && incumbent.rateCards ? (
              <Table
                caption={`Economic changes from ${incumbent.name} v${incumbent.version}`}
                density="compact"
                headers={[
                  "Changed field",
                  "Current active value",
                  "Candidate value",
                ]}
                rowKeys={economicDiff.map((change) => change.field)}
                rows={economicDiff.map((change) => [
                  change.field,
                  change.before,
                  change.after,
                ])}
                emptyState="No rate or discount authority changes from the active version."
              />
            ) : selected.status === "draft" ? (
              <p className={styles.muted}>
                No active price book exists for this currency. Review the
                complete rate table above.
              </p>
            ) : null}
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
          <DiscountMatrixEditor
            key={`${selected.id}:${selected.rowVersion}`}
            book={selected}
            permitted={authoringAvailable}
            onSaved={() => {
              setSummary(null);
              router.refresh();
            }}
          />
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
