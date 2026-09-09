"use client";
import { useTranslations } from "@/src/i18n/client";
import { localizeCopy } from "@/src/i18n/copy";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import {
  PriceBookCloneCommandSchema,
  exportPriceBookExchange,
  type RateCard,
} from "@clockwork/domain/core";
import { PriceBookImport } from "./price-book-import";
import { DiscountMatrixEditor } from "./price-book-discounts";
import { PriceBookImpactPanel } from "./price-book-impact";
import type { PriceBookImpactResult } from "../price-books/price-book-impact-model";
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
  | "request_activation"
  | "activate"
  | "retire"
  | "reject_activation"
  | "schedule_activation"
  | "cancel_schedule";

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
  today: string,
): readonly { action: Decision; label: string; hint: string }[] {
  if (book.activationSchedule?.status === "approved")
    return [
      {
        action: "cancel_schedule",
        label: "Cancel approved schedule",
        hint: "Retains the decision history and current active pricing. The draft becomes editable and needs a new proposal and approval.",
      },
    ];
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
    ...(book.effectiveFrom > today
      ? [
          {
            action: "schedule_activation" as const,
            label: "Approve scheduled activation",
            hint: "Locks this exact version for execution from its effective date. Current pricing remains active until execution. Only one approved schedule per currency is allowed.",
          },
        ]
      : []),
    ...(book.effectiveFrom <= today &&
    (!book.effectiveTo || book.effectiveTo >= today)
      ? [
          {
            action: "activate" as const,
            label: activationCopy.approveLabel,
            hint: activationCopy.approveHint,
          },
        ]
      : []),
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
  impact,
}: {
  roles: readonly string[];
  userId: string;
  books: readonly PriceBookAdministrationRecord[];
  source: PriceBookSource;
  availability: PriceBookAvailability;
  readAt: string;
  impact?: PriceBookImpactResult;
}) {
  const t = useTranslations();
  const localizedactivationCopy = localizeCopy(activationCopy, t);
  const localizedadminSafetyCopy = localizeCopy(adminSafetyCopy, t);
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [currency, setCurrency] = useState("All");
  const [state, setState] = useState("All");
  const [selectedId, setSelectedId] = useState(
    books.find(
      (book) =>
        book.status === "draft" &&
        book.effectiveFrom <= readAt.slice(0, 10) &&
        (!book.effectiveTo || book.effectiveTo >= readAt.slice(0, 10)),
    )?.id ??
      books.find((book) => book.status === "draft")?.id ??
      books[0]?.id ??
      "",
  );
  const [reason, setReason] = useState("");
  const [summary, setSummary] = useState<{
    bookId: string;
    rowVersion: number;
    value: ReviewSummary;
  } | null>(null);
  const [awaitingRead, setAwaitingRead] = useState<Record<string, number>>({});
  // A mutation receipt precedes the refreshed server projection, especially on
  // hosted deployments. Do not review or edit economics we know are obsolete.
  const refreshPending = Object.entries(awaitingRead).some(
    ([id, version]) =>
      !books.some((book) => book.id === id && book.rowVersion >= version),
  );
  useEffect(() => {
    setAwaitingRead((current) => {
      const remaining = Object.fromEntries(
        Object.entries(current).filter(
          ([id, version]) =>
            !books.some((book) => book.id === id && book.rowVersion >= version),
        ),
      );
      return Object.keys(remaining).length === Object.keys(current).length
        ? current
        : remaining;
    });
  }, [books]);
  function refreshAfterMutation(id: string, minimumVersion: number) {
    setSummary(null);
    setAwaitingRead((current) => ({
      ...current,
      [id]: Math.max(current[id] ?? 0, minimumVersion),
    }));
    router.refresh();
  }
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
  const authoringAvailable =
    permitted && availability !== "unavailable" && !refreshPending && !pending;
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
    return books
      .filter(
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
      )
      .sort(
        (a, b) =>
          a.currency.localeCompare(b.currency) ||
          b.version - a.version ||
          a.id.localeCompare(b.id),
      );
  }, [books, currency, query, state]);
  const selected = books.find((book) => book.id === selectedId) ?? books[0];
  const reviewCurrent = Boolean(
    summary &&
    selected &&
    summary.bookId === selected.id &&
    summary.rowVersion === selected.rowVersion,
  );
  const otherSchedule = selected
    ? books.find(
        (book) =>
          book.id !== selected.id &&
          book.currency === selected.currency &&
          book.activationSchedule?.status === "approved",
      )
    : undefined;
  const decisions = selected
    ? decisionsFor(selected, userId, readAt.slice(0, 10)).filter(
        (decision) =>
          !otherSchedule ||
          !["activate", "schedule_activation"].includes(decision.action),
      )
    : [];
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
    if (
      !selected ||
      !summary ||
      !reviewCurrent ||
      pending ||
      refreshPending ||
      authoringPending
    )
      return;
    setPending(true);
    setOutcome(null);
    try {
      const saved = await sendCoreCommand({
        resource: "price_books",
        id: selected.id,
        action,
        expectedVersion: summary.rowVersion,
        payload: { reason: summary.value.reason },
      });
      setOutcome({
        tone: "done",
        message:
          action === "schedule_activation"
            ? "Scheduled activation approved. The exact reviewed version is locked until execution or cancellation."
            : action === "cancel_schedule"
              ? "Schedule cancelled. Current pricing is unchanged; the draft needs a new approval."
              : action === "reject_activation"
                ? "Activation rejected. The draft can be edited and proposed again."
                : action === "request_activation"
                  ? localizedactivationCopy.proposed
                  : action === "activate"
                    ? localizedactivationCopy.activated
                    : localizedactivationCopy.retired,
      });
      setReason("");
      refreshAfterMutation(
        selected.id,
        saved?.record?.rowVersion ?? selected.rowVersion + 1,
      );
    } catch (error) {
      setOutcome({
        tone: "problem",
        message:
          error instanceof CommerceApiError && error.code === "conflict"
            ? localizedactivationCopy.stale
            : error instanceof CommerceApiError
              ? error.message
              : localizedactivationCopy.failed,
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <AdministrationPage {...localizedadminSafetyCopy.priceBooks}>
      <section className={styles.notice} role="note">
        <strong>Only activated versions set price.</strong>
        {localizedactivationCopy.authorities}
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
                {t("ui.120")}
                <select name="currency" defaultValue="USD">
                  <option>USD</option>
                  <option>EUR</option>
                  <option>GBP</option>
                </select>
              </label>
              <label className={styles.field}>
                {t("ui.122")}
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
                  refreshAfterMutation(draft.id, draft.rowVersion + 1);
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
            <fieldset disabled={authoringPending || refreshPending || pending}>
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
                disabled={authoringPending || refreshPending || pending}
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
                disabled={authoringPending || refreshPending || pending}
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
            {t("ui.120")}
            <select
              value={currency}
              onChange={(event) => setCurrency(event.currentTarget.value)}
            >
              <option>{t("ui.113")}</option>
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
              <option>{t("ui.113")}</option>
              <option>{t("status.draft")}</option>
              <option>{t("status.active")}</option>
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
            book.activationSchedule?.status === "approved"
              ? `Scheduled · ${book.activationSchedule.effectiveFrom}`
              : book.activationRequestedByEmail
                ? `Proposed by ${book.activationRequestedByEmail}`
                : book.status === "draft"
                  ? "Not proposed"
                  : "Decided",
          ])}
          emptyState={
            books.length
              ? localizedactivationCopy.noMatches
              : availability === "empty"
                ? localizedactivationCopy.empty
                : localizedactivationCopy.unreadable
          }
        />
      </section>

      <PriceBookImport
        books={books}
        permitted={authoringAvailable && !authoringPending}
        readAt={readAt}
        onBusy={setAuthoringPending}
        onImported={(id) => {
          setSelectedId(id);
          setDraft(null);
          setEditingRate(null);
          setReason("");
          setSummary(null);
          setOutcome(null);
          refreshAfterMutation(id, 1);
        }}
      />
      {selected ? (
        <section
          className={styles.panel}
          aria-labelledby="price-book-review-title"
        >
          <div className={styles.panelHeading}>
            <div>
              <h2 id="price-book-review-title">
                {selected.activationSchedule?.status === "approved"
                  ? "Schedule cancellation review"
                  : "Finance activation review"}
              </h2>
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
              if (refreshPending || authoringPending || pending || !permitted)
                return;
              setOutcome(null);
              const cancelling =
                selected.activationSchedule?.status === "approved";
              setSummary({
                bookId: selected.id,
                rowVersion: selected.rowVersion,
                value: buildReviewSummary({
                  entity: `${selected.name} v${selected.version} · ${selected.currency}`,
                  impact: cancelling
                    ? "Cancels the approved schedule and unlocks this draft for editing. Current active pricing stays in place."
                    : `Approves ${selected.rateCardCount} rate cards across ${selected.regions.join(", ") || "no region"} from ${selected.effectiveFrom}.`,
                  evidence: [
                    `${selected.rateCardCount} rate cards persisted`,
                    cancelling
                      ? `Approved schedule effective ${selected.activationSchedule?.effectiveFrom}`
                      : selected.activationRequestedByEmail
                        ? `Proposed by ${selected.activationRequestedByEmail}`
                        : "Not yet proposed",
                    selected.lastDecisionReason ?? "No prior decision recorded",
                  ],
                  policyBasis:
                    "Commercial policy CP-2 requires versioned rate cards, explicit routes, regional floors, and two finance authorities.",
                  downstreamEffect: cancelling
                    ? "No price book is activated or retired. The cancellation and prior approval remain in history; this draft requires a new proposal and distinct finance approval before any later activation."
                    : "Activation makes the version eligible for new pricing resolutions. Retained quote, order, invoice, and collection economics stay unchanged; retiring the current book stops its draft issuance and revisions.",
                  reason,
                }),
              });
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
                disabled={!selected.rateCardCount || refreshPending}
                onClick={() => {
                  let exported: ReturnType<typeof exportPriceBookExchange>;
                  try {
                    exported = exportPriceBookExchange(selected, readAt);
                  } catch {
                    setAuthoringMessage(
                      "This price book cannot use the strict v2 exchange format. Check that all rates are complete and supported before exporting.",
                    );
                    return;
                  }
                  const url = URL.createObjectURL(
                    new Blob([JSON.stringify(exported)], {
                      type: "application/json",
                    }),
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
                  disabled={authoringPending || refreshPending || pending}
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
                      disabled={authoringPending || refreshPending || pending}
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
                      disabled={authoringPending || refreshPending || pending}
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
                            refreshAfterMutation(
                              selected.id,
                              selected.rowVersion + 1,
                            );
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
            <PriceBookImpactPanel
              candidate={selected}
              incumbent={incumbent}
              impact={impact}
            />
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
                <strong>{localizedactivationCopy.financeOnlyTitle}</strong>
                {localizedactivationCopy.financeOnlyBody}
              </div>
            ) : null}
            {permitted &&
            selected.status === "draft" &&
            selected.activationRequestedBy === userId &&
            selected.activationSchedule?.status !== "approved" ? (
              <div className={styles.roleNotice} role="note">
                <strong>{localizedactivationCopy.awaitingSecondTitle}</strong>
                {localizedactivationCopy.awaitingSecondBody}
              </div>
            ) : null}
            {otherSchedule ? (
              <p role="note">
                {otherSchedule.name} v{otherSchedule.version} has an approved
                schedule for {selected.currency}. Cancel that schedule before
                approving another scheduled or immediate activation.
              </p>
            ) : null}
            {selected.activationSchedule ? (
              <div role="status" className={styles.roleNotice}>
                <strong>
                  Activation schedule · {selected.activationSchedule.status}
                </strong>
                <p>
                  Effective from {selected.activationSchedule.effectiveFrom}{" "}
                  (UTC)
                  {selected.activationSchedule.effectiveTo
                    ? ` through ${selected.activationSchedule.effectiveTo}`
                    : ""}
                  .
                </p>
                {selected.activationSchedule.status === "approved" ? (
                  <p>
                    This reviewed version is locked.{" "}
                    {source === "Deterministic demo fixture"
                      ? "This fictional schedule demonstrates advance approval and cancellation; it does not run the production worker."
                      : "The worker checks each minute from the effective date, and rechecks finance authority and the new-business control before changing current pricing."}{" "}
                    Cancel this schedule to reopen the draft.
                  </p>
                ) : (
                  <p>{selected.activationSchedule.completionReason}</p>
                )}
              </div>
            ) : null}
            {selected.activationSchedule?.status !== "approved" &&
            selected.status === "draft" &&
            selected.effectiveFrom > readAt.slice(0, 10) ? (
              <p role="note">
                Activation is available on or after {selected.effectiveFrom}{" "}
                (UTC). A different finance approver can approve its schedule
                now, or return then for immediate activation. Current active
                pricing stays in place until execution.
              </p>
            ) : selected.status === "draft" &&
              selected.effectiveTo &&
              selected.effectiveTo < readAt.slice(0, 10) ? (
              <p role="note">
                This draft’s effective period has expired. Return it for changes
                or create a new draft with current dates before approval.
              </p>
            ) : null}
            {refreshPending ? (
              <div className={styles.actions}>
                <p role="status">
                  Loading saved price-book changes before review…
                </p>
                <button
                  type="button"
                  className={styles.buttonSecondary}
                  onClick={() => router.refresh()}
                >
                  Refresh saved changes
                </button>
              </div>
            ) : summary && !reviewCurrent ? (
              <p role="status">
                The price book changed after your review. Review the current
                version before recording a decision.
              </p>
            ) : null}
            <div className={styles.actions}>
              <button
                className={styles.button}
                type="submit"
                disabled={
                  !permitted || refreshPending || authoringPending || pending
                }
              >
                Review price-book approval
              </button>
            </div>
          </form>
          <details
            className={styles.panelBody}
            key={`clone:${selected.id}:${selected.rowVersion}`}
          >
            <summary>Clone this version into a draft</summary>
            <p>
              Copy {selected.rateCardCount} saved rates, floors, transfer
              prices, tax/accounting codes and discount rules into a new{" "}
              {selected.currency} draft. The source stays unchanged. Approval
              history and provider resource bindings are not copied; review
              catalog mappings before proposing the new version.
            </p>
            <form
              aria-label="Clone price book"
              onSubmit={(event) => {
                event.preventDefault();
                if (!authoringAvailable || authoringPending || pending) return;
                const values = new FormData(event.currentTarget);
                const parsed = PriceBookCloneCommandSchema.safeParse({
                  sourceId: selected.id,
                  sourceRowVersion: selected.rowVersion,
                  name: formString(values, "cloneName"),
                  version: Number(values.get("cloneVersion")),
                  effectiveFrom: formString(values, "cloneEffectiveFrom"),
                  reason: formString(values, "cloneReason"),
                });
                if (!parsed.success) {
                  setAuthoringMessage(
                    "Check the clone name, new version, effective date and reason.",
                  );
                  return;
                }
                if (
                  books.some(
                    (book) =>
                      book.currency === selected.currency &&
                      book.version === parsed.data.version,
                  )
                ) {
                  setAuthoringMessage(
                    `${selected.currency} version ${parsed.data.version} already exists. Choose a new version.`,
                  );
                  return;
                }
                const id = crypto.randomUUID();
                setAuthoringPending(true);
                setSummary(null);
                setAuthoringMessage("");
                void sendCoreCommand({
                  resource: "price_books",
                  id,
                  action: "clone",
                  payload: parsed.data,
                })
                  .then(() => {
                    setSelectedId(id);
                    setDraft(null);
                    setEditingRate(null);
                    setReason("");
                    setOutcome(null);
                    setAuthoringMessage(
                      "Draft cloned. Review its copied economics and configure catalog mappings before requesting fresh approval.",
                    );
                    refreshAfterMutation(id, 1);
                  })
                  .catch((error: unknown) =>
                    setAuthoringMessage(
                      error instanceof CommerceApiError
                        ? error.problemCode === "DUPLICATE"
                          ? "The destination identity or currency/version already exists. Choose a new version."
                          : error.message
                        : "The draft was not cloned. Refresh the source and check that the new currency/version is unused.",
                    ),
                  )
                  .finally(() => setAuthoringPending(false));
              }}
            >
              <fieldset
                className={styles.formGrid}
                disabled={
                  !authoringAvailable ||
                  authoringPending ||
                  selected.rateCardCount === 0
                }
              >
                <legend>New draft · {selected.currency}</legend>
                <label className={styles.field}>
                  Cloned price-book name
                  <input
                    name="cloneName"
                    minLength={3}
                    maxLength={120}
                    defaultValue={selected.name}
                    required
                  />
                </label>
                <label className={styles.field}>
                  Cloned price-book version
                  <input
                    name="cloneVersion"
                    type="number"
                    min={1}
                    step={1}
                    defaultValue={
                      Math.max(
                        0,
                        ...books
                          .filter((book) => book.currency === selected.currency)
                          .map((book) => book.version),
                      ) + 1
                    }
                    required
                  />
                </label>
                <label className={styles.field}>
                  Cloned effective date
                  <input
                    name="cloneEffectiveFrom"
                    type="date"
                    defaultValue={readAt.slice(0, 10)}
                    required
                  />
                </label>
                <label className={styles.field}>
                  Clone reason
                  <textarea
                    name="cloneReason"
                    minLength={8}
                    maxLength={1000}
                    required
                  />
                </label>
                <button
                  type="submit"
                  className={styles.button}
                  disabled={
                    !authoringAvailable ||
                    authoringPending ||
                    selected.rateCardCount === 0
                  }
                >
                  {authoringPending ? "Cloning…" : "Create cloned draft"}
                </button>
              </fieldset>
              {selected.rateCardCount === 0 ? (
                <p>Add at least one rate before cloning this price book.</p>
              ) : null}
            </form>
          </details>
          <DiscountMatrixEditor
            key={`${selected.id}:${selected.rowVersion}`}
            book={selected}
            permitted={authoringAvailable}
            onSaved={() => {
              refreshAfterMutation(selected.id, selected.rowVersion + 1);
            }}
          />
        </section>
      ) : null}

      {summary && selected && reviewCurrent && !refreshPending ? (
        <>
          <ReviewSummaryCard
            summary={summary.value}
            title={
              selected.activationSchedule?.status === "approved"
                ? "Schedule cancellation review"
                : "Price-book activation review"
            }
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
                      disabled={
                        !permitted ||
                        pending ||
                        authoringPending ||
                        reason.length < 8
                      }
                      onClick={() => void submit(decision.action)}
                    >
                      {pending ? "Recording…" : decision.label}
                    </button>
                    <p className={styles.resultMeta}>{decision.hint}</p>
                  </div>
                ))
              ) : (
                <p className={styles.resultMeta}>
                  {localizedactivationCopy.noDecision}
                </p>
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
