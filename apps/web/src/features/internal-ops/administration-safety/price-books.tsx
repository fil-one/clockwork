"use client";
import { useFormattingLocale, useTranslations } from "@/src/i18n/client";
import type { MessageId, Translator } from "@/src/i18n";

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
import { formatDate } from "@/src/features/shared/format";
import type {
  PriceBookAvailability,
  PriceBookSource,
} from "@/src/features/internal-ops/price-books/server-price-book-loader";

import {
  PriceBookStatusPill,
  PricingPill,
  bookMoney,
  commerceErrorText,
  commitTypeLabel,
  egressTreatmentLabel,
  formatQuantity,
  priceBookStatusLabels,
  rateQuantityText,
  type PriceBookStatus,
} from "./price-book-presentation";
import { buildReviewSummary, canDecide, type ReviewSummary } from "./policy";
import {
  AdministrationPage,
  HumanSelector,
  ReviewSummaryCard,
  TechnicalEvidence,
  styles,
} from "./ui";

/*
 * Every word on this page is a message ID. Book names, e-mail addresses, SKU
 * and region codes are record facts and are placed into messages as values;
 * amounts and dates are formatted for the reader first.
 */

type Decision =
  | "request_activation"
  | "activate"
  | "retire"
  | "reject_activation"
  | "schedule_activation"
  | "cancel_schedule";

type StateFilter = "all" | PriceBookStatus;

const sourceLabels: Readonly<Record<PriceBookSource, MessageId>> = {
  service: "adminPricing.priceBooks.source.service",
  demo: "adminPricing.priceBooks.source.demo",
  unavailable: "adminPricing.priceBooks.source.unavailable",
};

const scheduleStatusLabels: Readonly<
  Record<
    NonNullable<PriceBookAdministrationRecord["activationSchedule"]>["status"],
    MessageId
  >
> = {
  approved: "adminPricing.priceBooks.schedule.status.approved",
  executed: "adminPricing.priceBooks.schedule.status.executed",
  cancelled: "adminPricing.priceBooks.schedule.status.cancelled",
  expired: "adminPricing.priceBooks.schedule.status.expired",
};

const decisionCopy: Readonly<
  Record<Decision, { label: MessageId; hint: MessageId; outcome: MessageId }>
> = {
  cancel_schedule: {
    label: "adminPricing.priceBooks.decision.cancelSchedule",
    hint: "adminPricing.priceBooks.decision.cancelScheduleHint",
    outcome: "adminPricing.priceBooks.outcome.cancelled",
  },
  retire: {
    label: "adminPricing.priceBooks.activation.retireLabel",
    hint: "adminPricing.priceBooks.activation.retireHint",
    outcome: "adminPricing.priceBooks.activation.retired",
  },
  request_activation: {
    label: "adminPricing.priceBooks.activation.proposeLabel",
    hint: "adminPricing.priceBooks.activation.proposeHint",
    outcome: "adminPricing.priceBooks.activation.proposed",
  },
  schedule_activation: {
    label: "adminPricing.priceBooks.decision.schedule",
    hint: "adminPricing.priceBooks.decision.scheduleHint",
    outcome: "adminPricing.priceBooks.outcome.scheduled",
  },
  activate: {
    label: "adminPricing.priceBooks.activation.approveLabel",
    hint: "adminPricing.priceBooks.activation.approveHint",
    outcome: "adminPricing.priceBooks.activation.activated",
  },
  reject_activation: {
    label: "adminPricing.priceBooks.decision.reject",
    hint: "adminPricing.priceBooks.decision.rejectHint",
    outcome: "adminPricing.priceBooks.outcome.rejected",
  },
};

function formString(values: FormData, name: string): string {
  const value = values.get(name);
  return typeof value === "string" ? value : "";
}

/** Minor units as the plain decimal an input edits ("150.00"). */
function minorDecimal(value: string): string {
  const minor = BigInt(value);
  return `${minor / 100n}.${(minor % 100n).toString().padStart(2, "0")}`;
}

/**
 * A typed price in minor units. Either decimal separator is accepted, so a
 * reader who writes "150,00" is not refused; at most two decimals, never a
 * grouping separator, so "1.500" cannot be read as fifteen hundred.
 */
function currencyMinor(value: string): string | undefined {
  const match = /^(\d+)(?:[.,](\d{1,2}))?$/u.exec(value.trim());
  if (!match?.[1]) return undefined;
  return (
    BigInt(match[1]) * 100n +
    BigInt((match[2] ?? "").padEnd(2, "0") || "0")
  ).toString();
}

const decimalPattern = "[0-9]+(?:[.,][0-9]{1,2})?";

function decisionsFor(
  book: PriceBookAdministrationRecord,
  userId: string,
  today: string,
): readonly Decision[] {
  if (book.activationSchedule?.status === "approved")
    return ["cancel_schedule"];
  if (book.status === "active") return ["retire"];
  if (book.status !== "draft") return [];
  if (!book.activationRequestedBy) return ["request_activation"];
  if (book.activationRequestedBy === userId) return [];
  return [
    ...(book.effectiveFrom > today ? (["schedule_activation"] as const) : []),
    ...(book.effectiveFrom <= today &&
    (!book.effectiveTo || book.effectiveTo >= today)
      ? (["activate"] as const)
      : []),
    "reject_activation",
  ];
}

function bookTitle(
  book: Pick<PriceBookAdministrationRecord, "name" | "version">,
  t: Translator,
): string {
  return t("adminPricing.bookName", {
    name: book.name,
    version: String(book.version),
  });
}

/**
 * Region codes joined the reader's way ("us-east-2 and us-west-2",
 * "us-east-2、us-west-2"). Each code is wrapped in a directional isolate:
 * Arabic joins the last item with a prefixed "و", and without the isolate the
 * bidi algorithm pulls the trailing digit of one Latin code across the next.
 */
function regionList(regions: readonly string[], locale: string): string {
  return new Intl.ListFormat(locale, { style: "long", type: "conjunction" })
    .formatToParts(regions)
    .map((part) =>
      part.type === "element" ? `\u2068${part.value}\u2069` : part.value,
    )
    .join("");
}

/**
 * The same list as elements for a table cell: each code is isolated and kept
 * on one line, so a narrow column wraps between codes, never inside one.
 */
function RegionList({
  regions,
  locale,
}: {
  regions: readonly string[];
  locale: string;
}) {
  return new Intl.ListFormat(locale, { style: "long", type: "conjunction" })
    .formatToParts(regions)
    .map((part, index) =>
      part.type === "element" ? (
        <bdi key={index} style={{ whiteSpace: "nowrap" }}>
          {part.value}
        </bdi>
      ) : (
        part.value
      ),
    );
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
  const formattingLocale = useFormattingLocale();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [currency, setCurrency] = useState("all");
  const [state, setState] = useState<StateFilter>("all");
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
  const today = readAt.slice(0, 10);
  const updatedLabel = new Intl.DateTimeFormat(formattingLocale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(new Date(readAt));
  const date = (value: string) => formatDate(value, formattingLocale);
  const count = (value: number) =>
    new Intl.NumberFormat(formattingLocale).format(value);

  const currencies = useMemo(
    () => [...new Set(books.map((book) => book.currency))].sort(),
    [books],
  );
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase(formattingLocale);
    return books
      .filter(
        (book) =>
          (currency === "all" || book.currency === currency) &&
          (state === "all" || book.status === state) &&
          (!needle ||
            [
              book.name,
              String(book.version),
              book.currency,
              ...book.regions,
            ].some((value) =>
              value.toLocaleLowerCase(formattingLocale).includes(needle),
            )),
      )
      .sort(
        (a, b) =>
          a.currency.localeCompare(b.currency) ||
          b.version - a.version ||
          a.id.localeCompare(b.id),
      );
  }, [books, currency, formattingLocale, query, state]);
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
    ? decisionsFor(selected, userId, today).filter(
        (decision) =>
          !otherSchedule ||
          !["activate", "schedule_activation"].includes(decision),
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
    selected && incumbent
      ? priceBookEconomicDiff(selected, incumbent, t, formattingLocale)
      : [];
  const cancelling = selected?.activationSchedule?.status === "approved";

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
      setOutcome({ tone: "done", message: t(decisionCopy[action].outcome) });
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
            ? t("adminPricing.priceBooks.activation.stale")
            : commerceErrorText(
                error,
                t,
                "adminPricing.priceBooks.activation.failed",
              ),
      });
    } finally {
      setPending(false);
    }
  }

  // These pills keep the neutral tone they had when their tone was guessed
  // from English words; only the price-book states carry a colour.
  const availabilityPill = (
    <PricingPill
      label={t(
        availability === "unavailable"
          ? "adminPricing.pill.unavailable"
          : availability === "empty"
            ? "adminPricing.pill.noVersions"
            : "adminPricing.pill.upToDate",
      )}
      tone="warning"
    />
  );
  const authorityPill = (available: boolean, unavailable: MessageId) => (
    <PricingPill
      label={t(available ? "adminPricing.pill.financeAuthority" : unavailable)}
      tone="warning"
    />
  );

  return (
    <AdministrationPage
      eyebrow={t("adminPricing.priceBooks.eyebrow")}
      title={t("adminPricing.priceBooks.title")}
      description={t("adminPricing.priceBooks.description")}
    >
      <section className={styles.notice} role="note">
        <strong>{t("adminPricing.priceBooks.notice.title")}</strong>
        {t("adminPricing.priceBooks.activation.authorities")}
        <p>
          <Link href="/internal/payg-offers">
            {t("adminPricing.priceBooks.link.payg")}
          </Link>
          {" · "}
          <Link href="/internal/channel-policy">
            {t("adminPricing.priceBooks.link.channel")}
          </Link>
        </p>
      </section>

      <section
        className={styles.panel}
        aria-labelledby="price-book-author-title"
      >
        <div className={styles.panelHeading}>
          <div>
            <h2 id="price-book-author-title">
              {t("adminPricing.priceBooks.author.title")}
            </h2>
            <p>{t("adminPricing.priceBooks.author.description")}</p>
          </div>
          {authorityPill(authoringAvailable, "adminPricing.pill.unavailable")}
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
                    t("adminPricing.priceBooks.author.created"),
                  );
                  router.refresh();
                })
                .catch((error: unknown) => {
                  setAuthoringMessage(
                    commerceErrorText(
                      error,
                      t,
                      "adminPricing.priceBooks.author.createFailed",
                    ),
                  );
                })
                .finally(() => setAuthoringPending(false));
            }}
          >
            <div className={styles.metaGrid}>
              <label className={styles.field}>
                {t("adminPricing.priceBooks.author.name")}
                <input name="name" required minLength={3} maxLength={120} />
              </label>
              <label className={styles.field}>
                {t("common.currency")}
                <select name="currency" defaultValue="USD">
                  <option>USD</option>
                  <option>EUR</option>
                  <option>GBP</option>
                </select>
              </label>
              <label className={styles.field}>
                {t("adminPricing.version")}
                <input name="version" type="number" min={1} step={1} required />
              </label>
              <label className={styles.field}>
                {t("adminPricing.priceBooks.author.effectiveFrom")}
                <input name="effectiveFrom" type="date" required />
              </label>
            </div>
            <p className={styles.resultMeta}>
              {t("adminPricing.priceBooks.author.firstStep")}
            </p>
            <div className={styles.actions}>
              <button
                className={styles.button}
                type="submit"
                disabled={!authoringAvailable || authoringPending}
              >
                {authoringPending
                  ? t("adminPricing.priceBooks.author.creating")
                  : t("adminPricing.priceBooks.author.create")}
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
                  t("adminPricing.priceBooks.rateForm.decimalError", {
                    currency: draft.currency,
                  }),
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
                    t("adminPricing.priceBooks.rateForm.tierError"),
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
                    t("adminPricing.priceBooks.rateForm.saved"),
                  );
                  refreshAfterMutation(draft.id, draft.rowVersion + 1);
                })
                .catch((error: unknown) => {
                  setAuthoringMessage(
                    commerceErrorText(
                      error,
                      t,
                      "adminPricing.priceBooks.rateForm.saveFailed",
                    ),
                  );
                })
                .finally(() => setAuthoringPending(false));
            }}
          >
            <TechnicalEvidence
              label={t("common.technicalDetails")}
              identifiers={[
                {
                  label: t("adminPricing.priceBooks.draftId"),
                  value: draft.id,
                },
              ]}
            />
            <div className={styles.metaGrid}>
              <label className={styles.field}>
                {t("adminPricing.rate.sku")}
                <input
                  name="sku"
                  defaultValue={editingRate?.sku}
                  required
                  maxLength={80}
                />
              </label>
              <label className={styles.field}>
                {t("common.region")}
                <input
                  name="region"
                  defaultValue={editingRate?.region}
                  required
                  maxLength={80}
                />
              </label>
              <label className={styles.field}>
                {t("adminPricing.rate.unit")}
                <input
                  name="unit"
                  defaultValue={editingRate?.unit ?? "TB-month"}
                  required
                  maxLength={40}
                />
              </label>
              <label className={styles.field}>
                {t("adminPricing.rate.minimumQuantity")}
                <input
                  name="minimumQuantity"
                  defaultValue={editingRate?.minimumQuantity ?? "1"}
                  required
                />
              </label>
              <label className={styles.field}>
                {t("adminPricing.priceBooks.rateForm.unitPrice", {
                  currency: draft.currency,
                })}
                <input
                  name="unitPrice"
                  defaultValue={
                    editingRate?.unitPrice
                      ? minorDecimal(editingRate.unitPrice.minor)
                      : ""
                  }
                  inputMode="decimal"
                  required
                  pattern={decimalPattern}
                  placeholder="150.00"
                />
              </label>
              <label className={styles.field}>
                {t("adminPricing.priceBooks.rateForm.floorPrice", {
                  currency: draft.currency,
                })}
                <input
                  name="floorPrice"
                  defaultValue={
                    editingRate?.floorPrice
                      ? minorDecimal(editingRate.floorPrice.minor)
                      : ""
                  }
                  inputMode="decimal"
                  required
                  pattern={decimalPattern}
                  placeholder="100.00"
                />
              </label>
              <label className={styles.field}>
                {t("adminPricing.priceBooks.rateForm.overageRate", {
                  currency: draft.currency,
                })}
                <input
                  name="overageRate"
                  defaultValue={
                    editingRate?.overageRate
                      ? minorDecimal(editingRate.overageRate.minor)
                      : ""
                  }
                  inputMode="decimal"
                  required
                  pattern={decimalPattern}
                  placeholder="180.00"
                />
              </label>
              <label className={styles.field}>
                {t("adminPricing.rate.commitType")}
                <select
                  name="commitType"
                  defaultValue={editingRate?.commitType ?? "term_drawdown"}
                >
                  <option value="term_drawdown">
                    {t("adminPricing.commitType.termDrawdown")}
                  </option>
                  <option value="period_allowance">
                    {t("adminPricing.commitType.periodAllowance")}
                  </option>
                </select>
              </label>
              <label className={styles.field}>
                {t("adminPricing.rate.egressTreatment")}
                <input
                  name="egressTreatment"
                  defaultValue={editingRate?.egressTreatment ?? "metered"}
                  required
                />
              </label>
              <label className={styles.field}>
                {t("adminPricing.rate.stripeTaxCode")}
                <input
                  name="stripeTaxCode"
                  defaultValue={editingRate?.stripeTaxCode ?? ""}
                  placeholder={t(
                    "adminPricing.priceBooks.rateForm.taxCodeExample",
                    { code: "txcd_10103000" },
                  )}
                  required
                />
              </label>
              <label className={styles.field}>
                {t("adminPricing.rate.qboIncomeAccount")}
                <input
                  name="qboIncomeAccount"
                  defaultValue={editingRate?.qboIncomeAccount ?? "4000-Storage"}
                  required
                />
              </label>
            </div>
            <fieldset disabled={authoringPending || refreshPending || pending}>
              <legend>{t("adminPricing.priceBooks.transfer.legend")}</legend>
              <p className={styles.resultMeta}>
                {t("adminPricing.priceBooks.transfer.help", {
                  currency: draft.currency,
                })}
              </p>
              {transferRows.map((entry, index) => (
                <div className={styles.metaGrid} key={index}>
                  <label className={styles.field}>
                    {t("adminPricing.priceBooks.transfer.tier", {
                      number: index + 1,
                    })}
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
                    {t("adminPricing.priceBooks.transfer.price", {
                      number: index + 1,
                      currency: draft.currency,
                    })}
                    <input
                      required
                      inputMode="decimal"
                      pattern={decimalPattern}
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
                    {t("adminPricing.priceBooks.transfer.remove", {
                      number: index + 1,
                    })}
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
                {t("adminPricing.priceBooks.transfer.add")}
              </button>
            </fieldset>
            <label className={styles.field}>
              {t("adminPricing.rate.approvedClaim")}
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
                  ? t("adminPricing.priceBooks.rateForm.validating")
                  : editingRate
                    ? t("adminPricing.priceBooks.rateForm.save")
                    : t("adminPricing.priceBooks.rateForm.add")}
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
                {t("adminPricing.priceBooks.rateForm.close")}
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
            <h2 id="price-book-versions-title">
              {t("adminPricing.priceBooks.versions.title")}
            </h2>
            <p>
              {t("common.join.labels", {
                first: t(sourceLabels[source]),
                second: t("common.updatedAt", { time: updatedLabel }),
              })}
            </p>
          </div>
          {availabilityPill}
        </div>
        <div
          className={styles.toolbar}
          role="search"
          aria-label={t("adminPricing.priceBooks.filters.label")}
        >
          <label className={styles.field}>
            {t("adminPricing.priceBooks.filters.search")}
            <input
              type="search"
              value={query}
              placeholder={t("adminPricing.priceBooks.filters.placeholder")}
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
          </label>
          <label className={styles.field}>
            {t("common.currency")}
            <select
              value={currency}
              onChange={(event) => setCurrency(event.currentTarget.value)}
            >
              <option value="all">{t("common.all")}</option>
              {currencies.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            {t("common.status")}
            <select
              value={state}
              onChange={(event) =>
                setState(event.currentTarget.value as StateFilter)
              }
            >
              <option value="all">{t("common.all")}</option>
              {(["draft", "active", "retired"] as const).map((status) => (
                <option key={status} value={status}>
                  {t(priceBookStatusLabels[status])}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className={styles.resultMeta} aria-live="polite">
          {t("common.join.labels", {
            first: t("adminPricing.priceBooks.versions.count", {
              shown: count(filtered.length),
              count: books.length,
            }),
            second: t("adminPricing.priceBooks.versions.sortNote"),
          })}
        </p>
        <Table
          className={styles.scanTable ?? ""}
          caption={t("adminPricing.priceBooks.versions.caption")}
          captionHidden
          density="compact"
          headers={[
            t("recordKind.priceBook"),
            t("adminPricing.version"),
            t("common.currency"),
            t("adminPricing.priceBooks.col.regions"),
            t("adminPricing.priceBooks.col.effective"),
            t("adminPricing.priceBooks.col.rateCards"),
            t("common.status"),
            t("adminPricing.priceBooks.col.activation"),
          ]}
          numericColumns={[5]}
          rowKeys={filtered.map((book) => book.id)}
          rows={filtered.map((book) => [
            <span className={styles.stackCell}>
              <strong>{book.name}</strong>
            </span>,
            book.version,
            book.currency,
            book.regions.length ? (
              <RegionList regions={book.regions} locale={formattingLocale} />
            ) : (
              t("common.none")
            ),
            book.effectiveTo
              ? t("adminPricing.priceBooks.effectiveRange", {
                  from: date(book.effectiveFrom),
                  to: date(book.effectiveTo),
                })
              : t("adminPricing.priceBooks.effectiveFrom", {
                  from: date(book.effectiveFrom),
                }),
            count(book.rateCardCount),
            <PriceBookStatusPill status={book.status} t={t} />,
            book.activationSchedule?.status === "approved"
              ? t("adminPricing.priceBooks.activation.scheduled", {
                  date: date(book.activationSchedule.effectiveFrom),
                })
              : book.activationRequestedByEmail
                ? t("adminPricing.priceBooks.activation.proposedBy", {
                    email: book.activationRequestedByEmail,
                  })
                : book.status === "draft"
                  ? t("adminPricing.priceBooks.activation.notProposed")
                  : t("adminPricing.priceBooks.activation.decided"),
          ])}
          emptyState={
            books.length
              ? t("adminPricing.priceBooks.activation.noMatches")
              : availability === "empty"
                ? t("adminPricing.priceBooks.activation.empty")
                : t("adminPricing.priceBooks.activation.unreadable")
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
                {cancelling
                  ? t("adminPricing.priceBooks.review.cancelTitle")
                  : t("adminPricing.priceBooks.review.activationTitle")}
              </h2>
              <p>{t("adminPricing.priceBooks.review.scope")}</p>
            </div>
            {authorityPill(permitted, "adminPricing.pill.readOnly")}
          </div>
          <form
            className={styles.panelBody}
            onSubmit={(event) => {
              event.preventDefault();
              if (refreshPending || authoringPending || pending || !permitted)
                return;
              setOutcome(null);
              setSummary({
                bookId: selected.id,
                rowVersion: selected.rowVersion,
                value: buildReviewSummary({
                  entity: t("common.join.labels", {
                    first: bookTitle(selected, t),
                    second: selected.currency,
                  }),
                  impact: cancelling
                    ? t("adminPricing.priceBooks.review.impact.cancel")
                    : selected.regions.length
                      ? t("adminPricing.priceBooks.review.impact.approve", {
                          count: selected.rateCardCount,
                          regions: regionList(
                            selected.regions,
                            formattingLocale,
                          ),
                          date: date(selected.effectiveFrom),
                        })
                      : t(
                          "adminPricing.priceBooks.review.impact.approveEmpty",
                          {
                            date: date(selected.effectiveFrom),
                          },
                        ),
                  evidence: [
                    t("adminPricing.priceBooks.review.evidence.saved", {
                      count: selected.rateCardCount,
                    }),
                    cancelling && selected.activationSchedule
                      ? t(
                          "adminPricing.priceBooks.review.evidence.scheduleEffective",
                          {
                            date: date(
                              selected.activationSchedule.effectiveFrom,
                            ),
                          },
                        )
                      : selected.activationRequestedByEmail
                        ? t("adminPricing.priceBooks.activation.proposedBy", {
                            email: selected.activationRequestedByEmail,
                          })
                        : t(
                            "adminPricing.priceBooks.review.evidence.notProposed",
                          ),
                    selected.lastDecisionReason ??
                      t(
                        "adminPricing.priceBooks.review.evidence.noPriorDecision",
                      ),
                  ],
                  policyBasis: t("adminPricing.priceBooks.review.policyBasis"),
                  downstreamEffect: cancelling
                    ? t("adminPricing.priceBooks.review.downstream.cancel")
                    : t("adminPricing.priceBooks.review.downstream.approve"),
                  reason,
                }),
              });
            }}
          >
            <HumanSelector
              label={t("adminPricing.priceBooks.review.selector")}
              hint={t("adminPricing.priceBooks.review.selectorHint")}
              name="priceBookId"
              options={books.map((book) => ({
                ...book,
                label: bookTitle(book, t),
                description: [
                  book.currency,
                  t(priceBookStatusLabels[book.status]),
                  t("adminPricing.priceBooks.rateCardCount", {
                    count: book.rateCardCount,
                  }),
                ].reduce((first, second) =>
                  t("common.join.labels", { first, second }),
                ),
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
                <dt>{t("adminPricing.priceBooks.col.regions")}</dt>
                <dd>
                  {selected.regions.length ? (
                    <RegionList
                      regions={selected.regions}
                      locale={formattingLocale}
                    />
                  ) : (
                    t("common.none")
                  )}
                </dd>
              </div>
              <div>
                <dt>{t("adminPricing.priceBooks.col.effective")}</dt>
                <dd>{date(selected.effectiveFrom)}</dd>
              </div>
              <div>
                <dt>{t("adminPricing.priceBooks.col.rateCards")}</dt>
                <dd>{count(selected.rateCardCount)}</dd>
              </div>
              <div>
                <dt>{t("adminPricing.priceBooks.review.proposedBy")}</dt>
                <dd>
                  {selected.activationRequestedByEmail ??
                    t("adminPricing.priceBooks.activation.notProposed")}
                </dd>
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
                      t("adminPricing.priceBooks.export.unsupported"),
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
                {t("adminPricing.priceBooks.export.download")}
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
                      t("adminPricing.priceBooks.review.reopened"),
                    );
                    document
                      .getElementById("price-book-author-title")
                      ?.scrollIntoView({ behavior: "smooth" });
                  }}
                >
                  {t("adminPricing.priceBooks.review.addRate")}
                </button>
              ) : null}
            </div>
            <Table
              caption={t("adminPricing.priceBooks.rates.caption")}
              density="compact"
              headers={[
                t("adminPricing.priceBooks.rates.skuRegion"),
                t("adminPricing.rate.listPrice"),
                t("adminPricing.rate.floorPrice"),
                t("adminPricing.rate.overageRate"),
                t("adminPricing.rate.minimumQuantity"),
                t("adminPricing.priceBooks.rates.terms"),
                t("common.actions"),
              ]}
              rowKeys={(selected.rateCards ?? []).map((rate) => rate.id)}
              rows={(selected.rateCards ?? []).map((rate) => [
                <span className={styles.stackCell}>
                  <strong>{rate.sku}</strong>
                  <small>{rate.region}</small>
                </span>,
                bookMoney(rate.unitPrice, formattingLocale),
                rate.floorPrice
                  ? bookMoney(rate.floorPrice, formattingLocale)
                  : t("adminPricing.rate.notConfigured"),
                bookMoney(rate.overageRate, formattingLocale),
                rateQuantityText(
                  rate.minimumQuantity,
                  rate.unit,
                  t,
                  formattingLocale,
                ),
                <details>
                  <summary>
                    {t("adminPricing.priceBooks.rates.details")}
                  </summary>
                  <dl>
                    <dt>{t("adminPricing.rate.approvedClaim")}</dt>
                    <dd>{rate.approvedClaim}</dd>
                    <dt>{t("adminPricing.rate.commitType")}</dt>
                    <dd>{commitTypeLabel(rate.commitType, t)}</dd>
                    <dt>{t("adminPricing.rate.egressTreatment")}</dt>
                    <dd>{egressTreatmentLabel(rate.egressTreatment, t)}</dd>
                    <dt>{t("adminPricing.rate.taxCode")}</dt>
                    <dd>{rate.stripeTaxCode}</dd>
                    <dt>{t("adminPricing.rate.incomeAccount")}</dt>
                    <dd>{rate.qboIncomeAccount}</dd>
                    <dt>{t("adminPricing.rate.transferPrices")}</dt>
                    <dd>
                      {Object.keys(rate.partnerTransferPrices).length
                        ? Object.entries(rate.partnerTransferPrices).map(
                            ([tier, value]) => (
                              <div key={tier}>
                                {t("adminPricing.rate.transferPrice", {
                                  tier,
                                  amount: bookMoney(value, formattingLocale),
                                })}
                              </div>
                            ),
                          )
                        : t("common.none")}
                    </dd>
                    {rate.trialLimit ? (
                      <>
                        <dt>{t("adminPricing.rate.legacyTrialQuantity")}</dt>
                        <dd>
                          {formatQuantity(rate.trialLimit, formattingLocale)}
                        </dd>
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
                      aria-label={t("adminPricing.priceBooks.rates.editLabel", {
                        sku: rate.sku,
                        region: rate.region,
                      })}
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
                      {t("common.edit")}
                    </button>
                    <button
                      type="button"
                      className={styles.button}
                      disabled={authoringPending || refreshPending || pending}
                      aria-label={t(
                        "adminPricing.priceBooks.rates.removeLabel",
                        { sku: rate.sku, region: rate.region },
                      )}
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
                              t("adminPricing.priceBooks.rates.removed"),
                            );
                            refreshAfterMutation(
                              selected.id,
                              selected.rowVersion + 1,
                            );
                          })
                          .catch((error: unknown) =>
                            setAuthoringMessage(
                              commerceErrorText(
                                error,
                                t,
                                "adminPricing.priceBooks.rates.removeFailed",
                              ),
                            ),
                          )
                          .finally(() => setAuthoringPending(false));
                      }}
                    >
                      {t("common.remove")}
                    </button>
                  </div>
                ) : (
                  t("adminPricing.pill.readOnly")
                ),
              ])}
              emptyState={t("adminPricing.priceBooks.rates.empty")}
            />
            {incumbent ? (
              <p className={styles.notice}>
                {t("adminPricing.priceBooks.review.replaces", {
                  book: bookTitle(incumbent, t),
                  currency: selected.currency,
                })}
              </p>
            ) : null}
            {incumbent && selected.rateCards && incumbent.rateCards ? (
              <Table
                caption={t("adminPricing.priceBooks.diff.caption", {
                  book: bookTitle(incumbent, t),
                })}
                density="compact"
                headers={[
                  t("adminPricing.priceBooks.diff.field"),
                  t("adminPricing.priceBooks.diff.current"),
                  t("adminPricing.priceBooks.diff.candidate"),
                ]}
                rowKeys={economicDiff.map((change) => change.key)}
                rows={economicDiff.map((change) => [
                  change.field,
                  change.before,
                  change.after,
                ])}
                emptyState={t("adminPricing.priceBooks.diff.empty")}
              />
            ) : selected.status === "draft" ? (
              <p className={styles.muted}>
                {t("adminPricing.priceBooks.review.noActive")}
              </p>
            ) : null}
            <PriceBookImpactPanel
              candidate={selected}
              incumbent={incumbent}
              impact={impact}
            />
            <label className={styles.field}>
              {t("adminPricing.priceBooks.review.reason")}
              <textarea
                value={reason}
                required
                minLength={8}
                placeholder={t(
                  "adminPricing.priceBooks.review.reasonPlaceholder",
                )}
                onChange={(event) => {
                  setReason(event.currentTarget.value);
                  setSummary(null);
                }}
              />
            </label>
            <TechnicalEvidence
              label={t("common.technicalDetails")}
              identifiers={[
                { label: t("adminPricing.priceBookId"), value: selected.id },
              ]}
            />
            {!permitted ? (
              <div className={styles.roleNotice} role="note">
                <strong>
                  {t("adminPricing.priceBooks.activation.financeOnlyTitle")}
                </strong>
                {t("adminPricing.priceBooks.activation.financeOnlyBody")}
              </div>
            ) : null}
            {permitted &&
            selected.status === "draft" &&
            selected.activationRequestedBy === userId &&
            selected.activationSchedule?.status !== "approved" ? (
              <div className={styles.roleNotice} role="note">
                <strong>
                  {t("adminPricing.priceBooks.activation.awaitingSecondTitle")}
                </strong>
                {t("adminPricing.priceBooks.activation.awaitingSecondBody")}
              </div>
            ) : null}
            {otherSchedule ? (
              <p role="note">
                {t("adminPricing.priceBooks.review.otherSchedule", {
                  book: bookTitle(otherSchedule, t),
                  currency: selected.currency,
                })}
              </p>
            ) : null}
            {selected.activationSchedule ? (
              <div role="status" className={styles.roleNotice}>
                <strong>
                  {t("common.join.labels", {
                    first: t("adminPricing.priceBooks.schedule.heading"),
                    second: t(
                      scheduleStatusLabels[selected.activationSchedule.status],
                    ),
                  })}
                </strong>
                <p>
                  {selected.activationSchedule.effectiveTo
                    ? t("adminPricing.priceBooks.schedule.window", {
                        from: date(selected.activationSchedule.effectiveFrom),
                        to: date(selected.activationSchedule.effectiveTo),
                      })
                    : t("adminPricing.priceBooks.schedule.windowOpen", {
                        from: date(selected.activationSchedule.effectiveFrom),
                      })}
                </p>
                {selected.activationSchedule.status === "approved" ? (
                  <p>
                    {[
                      t("adminPricing.priceBooks.schedule.locked"),
                      source === "demo"
                        ? t("adminPricing.priceBooks.schedule.demoNote")
                        : t("adminPricing.priceBooks.schedule.workerNote"),
                      t("adminPricing.priceBooks.schedule.cancelToReopen"),
                    ].reduce((first, second) =>
                      t("common.join.sentences", { first, second }),
                    )}
                  </p>
                ) : (
                  <p>{selected.activationSchedule.completionReason}</p>
                )}
              </div>
            ) : null}
            {selected.activationSchedule?.status !== "approved" &&
            selected.status === "draft" &&
            selected.effectiveFrom > today ? (
              <p role="note">
                {t("adminPricing.priceBooks.review.futureEffective", {
                  date: date(selected.effectiveFrom),
                })}
              </p>
            ) : selected.status === "draft" &&
              selected.effectiveTo &&
              selected.effectiveTo < today ? (
              <p role="note">{t("adminPricing.priceBooks.review.expired")}</p>
            ) : null}
            {refreshPending ? (
              <div className={styles.actions}>
                <p role="status">
                  {t("adminPricing.priceBooks.review.loadingSaved")}
                </p>
                <button
                  type="button"
                  className={styles.buttonSecondary}
                  onClick={() => router.refresh()}
                >
                  {t("adminPricing.priceBooks.review.refreshSaved")}
                </button>
              </div>
            ) : summary && !reviewCurrent ? (
              <p role="status">{t("adminPricing.priceBooks.review.changed")}</p>
            ) : null}
            <div className={styles.actions}>
              <button
                className={styles.button}
                type="submit"
                disabled={
                  !permitted || refreshPending || authoringPending || pending
                }
              >
                {t("adminPricing.priceBooks.review.submit")}
              </button>
            </div>
          </form>
          <details
            className={styles.panelBody}
            key={`clone:${selected.id}:${selected.rowVersion}`}
          >
            <summary>{t("adminPricing.priceBooks.clone.summary")}</summary>
            <p>
              {t("common.join.sentences", {
                first: t("adminPricing.priceBooks.clone.copies", {
                  count: selected.rateCardCount,
                  currency: selected.currency,
                }),
                second: t("adminPricing.priceBooks.clone.notes"),
              })}
            </p>
            <form
              aria-label={t("adminPricing.priceBooks.clone.formLabel")}
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
                    t("adminPricing.priceBooks.clone.invalid"),
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
                    t("adminPricing.priceBooks.versionExists", {
                      currency: selected.currency,
                      version: String(parsed.data.version),
                    }),
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
                      t("adminPricing.priceBooks.clone.done"),
                    );
                    refreshAfterMutation(id, 1);
                  })
                  .catch((error: unknown) =>
                    setAuthoringMessage(
                      error instanceof CommerceApiError &&
                        error.problemCode === "DUPLICATE"
                        ? t("adminPricing.priceBooks.clone.duplicate")
                        : error instanceof CommerceApiError &&
                            error.code === "conflict"
                          ? t("adminPricing.priceBooks.clone.conflict")
                          : commerceErrorText(
                              error,
                              t,
                              "adminPricing.priceBooks.clone.failed",
                            ),
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
                <legend>
                  {t("adminPricing.priceBooks.clone.legend", {
                    currency: selected.currency,
                  })}
                </legend>
                <label className={styles.field}>
                  {t("adminPricing.priceBooks.clone.name")}
                  <input
                    name="cloneName"
                    minLength={3}
                    maxLength={120}
                    defaultValue={selected.name}
                    required
                  />
                </label>
                <label className={styles.field}>
                  {t("adminPricing.priceBooks.clone.version")}
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
                  {t("adminPricing.priceBooks.clone.effective")}
                  <input
                    name="cloneEffectiveFrom"
                    type="date"
                    defaultValue={today}
                    required
                  />
                </label>
                <label className={styles.field}>
                  {t("adminPricing.priceBooks.clone.reason")}
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
                  {authoringPending
                    ? t("adminPricing.priceBooks.clone.busy")
                    : t("adminPricing.priceBooks.clone.submit")}
                </button>
              </fieldset>
              {selected.rateCardCount === 0 ? (
                <p>{t("adminPricing.priceBooks.clone.needsRate")}</p>
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
              cancelling
                ? t("adminPricing.priceBooks.review.cancelTitle")
                : t("adminPricing.priceBooks.review.summaryTitle")
            }
            identifiers={[
              { label: t("adminPricing.priceBookId"), value: selected.id },
            ]}
          />
          <section
            className={styles.panel}
            aria-label={t("adminPricing.priceBooks.decision.label")}
          >
            <div className={styles.panelBody}>
              {decisions.length ? (
                decisions.map((decision) => (
                  <div key={decision} className={styles.actions}>
                    <button
                      className={styles.button}
                      type="button"
                      disabled={
                        !permitted ||
                        pending ||
                        authoringPending ||
                        reason.length < 8
                      }
                      onClick={() => void submit(decision)}
                    >
                      {pending
                        ? t("adminPricing.priceBooks.decision.recording")
                        : t(decisionCopy[decision].label)}
                    </button>
                    <p className={styles.resultMeta}>
                      {t(decisionCopy[decision].hint)}
                    </p>
                  </div>
                ))
              ) : (
                <p className={styles.resultMeta}>
                  {t("adminPricing.priceBooks.activation.noDecision")}
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
