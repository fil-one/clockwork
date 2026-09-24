"use client";

import { useFormattingLocale, useTranslations } from "@/src/i18n/client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";

import { uuidV7 } from "@clockwork/contracts";

import { sendCoreCommand } from "@/src/features/contracts/commerce-client";

import type { MessageId, Translator } from "@/src/i18n";

import { draftIsDirty } from "../draft-state";
import {
  LeaveDraftControl,
  useUnsavedChangesWarning,
} from "../unsaved-changes";
import styles from "./commercial.module.css";
import { CommercialStop, commercialFailureText } from "./failure-message";
import {
  QuoteLines,
  validateAdditionalLines,
  type EditableQuoteLine,
} from "./quote-lines";
import { SearchableSelector } from "./searchable-selector";
import {
  emptyQuoteDraft,
  customerQuoteRoute,
  quoteStageLabels,
  firstQuoteError,
  quotePayload,
  prefilledQuoteDraft,
  resolveSelectorId,
  validateQuoteStage,
  type QuoteDraft,
  type QuoteErrors,
  type QuoteField,
  type QuoteOfferOption,
  type QuoteStage,
  type SelectorOption,
} from "./workflow-model";

export interface QuoteAccount {
  id: string;
  name: string;
}

export interface QuoteOrigin {
  kind: "revision" | "poc";
  reference: string;
  resolved: boolean;
  revision?: {
    quoteId: string;
    version: number;
    seriesId: string;
    priceBookId: string;
  };
}

function originLabel(origin: QuoteOrigin, t: Translator): string {
  if (!origin.resolved)
    return t("customer.commercial.builder.origin.unavailable");
  return origin.kind === "revision"
    ? t("customer.commercial.builder.origin.revision", {
        reference: origin.reference,
      })
    : t("customer.commercial.builder.origin.poc", {
        reference: origin.reference,
      });
}

function labelFor(value: string, t: Translator) {
  return value.trim() || t("customer.commercial.accept.notSelected");
}

const regionSites: Readonly<Record<string, MessageId>> = {
  "us-east": "region.usEast.site",
  "eu-west": "region.euWest.site",
  "uk-south": "region.ukSouth.site",
};

function regionLabel(value: string, t: Translator) {
  const site = regionSites[value];
  return site ? t(site) : labelFor(value, t);
}

function expiryLabel(value: string, locale: string, t: Translator) {
  if (!value) return t("customer.commercial.builder.notSet");
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf())
    ? value
    : new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(parsed);
}

/** "120 TB" (fr "120 To") from what the reader typed; the input as typed otherwise. */
function capacityLabel(value: string, locale: string): string {
  const capacity = Number(value);
  return value.trim() && Number.isFinite(capacity)
    ? new Intl.NumberFormat(locale, {
        style: "unit",
        unit: "terabyte",
        maximumFractionDigits: 3,
      }).format(capacity)
    : value;
}

function monthsLabel(value: string, t: Translator): string {
  const months = Number(value);
  return value.trim() && Number.isInteger(months)
    ? t("customer.commercial.months", { count: months })
    : value;
}

function Summary({
  draft,
  lines,
  offers,
}: {
  draft: QuoteDraft;
  lines: readonly EditableQuoteLine[];
  offers: readonly QuoteOfferOption[];
}) {
  const t = useTranslations();
  const formattingLocale = useFormattingLocale();
  return (
    <aside
      className={`${styles.summary} ${styles.commitmentSummary}`}
      aria-labelledby="quote-summary-title"
    >
      <div>
        <p className={styles.taskContext}>
          {t("customer.commercial.builder.draftFacts")}
        </p>
        <h2 id="quote-summary-title">
          {t("customer.commercial.builder.summaryTitle")}
        </h2>
      </div>
      <dl>
        <div>
          <dt>{t("customer.commercial.builder.customer")}</dt>
          <dd>{labelFor(draft.account, t)}</dd>
        </div>
        <div>
          <dt>{t("customer.commercial.builder.offer")}</dt>
          <dd>{labelFor(draft.offer, t)}</dd>
        </div>
        <div>
          <dt>{t("customer.commercial.builder.region")}</dt>
          <dd>{regionLabel(draft.region, t)}</dd>
        </div>
        <div>
          <dt>{t("customer.commercial.builder.capacity")}</dt>
          <dd>
            {draft.capacity
              ? capacityLabel(draft.capacity, formattingLocale)
              : t("customer.commercial.builder.notSet")}
          </dd>
        </div>
        <div>
          <dt>{t("customer.commercial.builder.termAndRoute")}</dt>
          <dd>
            {t("customer.commercial.builder.termDirect", {
              term: draft.termMonths
                ? monthsLabel(draft.termMonths, t)
                : t("customer.commercial.builder.notSet"),
            })}
          </dd>
        </div>
        <div>
          <dt>{t("customer.commercial.builder.expiry")}</dt>
          <dd>{expiryLabel(draft.expiresAt, formattingLocale, t)}</dd>
        </div>
      </dl>
      {lines.length ? (
        <ul>
          {lines.map((line, index) => (
            <li key={index}>
              {t("customer.commercial.builder.lineSummary", {
                line: index + 2,
                offer:
                  offers.find((offer) => offer.id === line.offerId)?.label ??
                  t("customer.commercial.builder.chooseOffer"),
                capacity: line.capacity
                  ? capacityLabel(line.capacity, formattingLocale)
                  : "—",
                term: line.termMonths ? monthsLabel(line.termMonths, t) : "—",
              })}
            </li>
          ))}
        </ul>
      ) : null}
      <p className={styles.notice}>
        {t("customer.commercial.builder.summaryNotice")}
      </p>
    </aside>
  );
}

function Field({
  id,
  label,
  error,
  children,
  span = false,
}: {
  id: QuoteField;
  label: string;
  error?: MessageId | undefined;
  children: React.ReactNode;
  span?: boolean;
}) {
  const t = useTranslations();
  return (
    <div
      className={`${styles.field} ${span ? styles.spanTwo : ""}`}
      data-field={id}
    >
      <label htmlFor={id}>{label}</label>
      {children}
      {error ? (
        <p className={styles.fieldError} id={`${id}-error`} role="alert">
          {t(error)}
        </p>
      ) : null}
    </div>
  );
}

export function QuoteBuilder({
  account,
  initialDraft,
  initialLines = [],
  offers,
  origin,
}: {
  account: QuoteAccount;
  catalogueMode: "authoritative" | "simulated";
  initialDraft?: Partial<Omit<QuoteDraft, "account">>;
  initialLines?: readonly EditableQuoteLine[];
  offers: readonly QuoteOfferOption[];
  origin?: QuoteOrigin;
}) {
  const t = useTranslations();
  const formattingLocale = useFormattingLocale();
  const stages = quoteStageLabels.map((id) => t(id));
  const accountOptions: readonly SelectorOption[] = [
    {
      id: account.id,
      label: account.name,
      description: t("customer.commercial.builder.accountDescription"),
    },
  ];
  const [stage, setStage] = useState<QuoteStage>(1);
  const [draft, setDraft] = useState<QuoteDraft>(() =>
    initialDraft
      ? prefilledQuoteDraft(account.name, initialDraft)
      : emptyQuoteDraft(account.name),
  );
  const [lines, setLines] =
    useState<readonly EditableQuoteLine[]>(initialLines);
  const [lineError, setLineError] = useState<string>();
  const selectedOffer = offers.find(
    (item) => item.id === resolveSelectorId(draft.offer, offers),
  );
  const [errors, setErrors] = useState<QuoteErrors>({});
  const [pending, setPending] = useState(false);
  const [createdQuoteId, setCreatedQuoteId] = useState("");
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const workflowRef = useRef<HTMLDivElement>(null);
  const idempotencyKeyRef = useRef<string | null>(null);
  const quoteIdRef = useRef<string | null>(null);
  const quoteInputRef = useRef<ReturnType<typeof quotePayload> | null>(null);

  /**
   * Armed while, and only while, the reader has changed something away from
   * the state the form opened in and the server has not accepted it.
   *
   * An authoritative created ID disarms the warning when `sendCoreCommand`
   * returns. `update()` clears that outcome,
   * so editing after that response re-arms. A form still holding exactly
   * `emptyQuoteDraft(account.name)` is never armed, so opening the builder and
   * changing your mind costs nothing.
   */
  const pristine = useMemo(
    () =>
      initialDraft
        ? prefilledQuoteDraft(account.name, initialDraft)
        : emptyQuoteDraft(account.name),
    [account.name, initialDraft],
  );
  const unsaved =
    (draftIsDirty(draft, pristine) ||
      JSON.stringify(lines) !== JSON.stringify(initialLines)) &&
    !createdQuoteId;
  useUnsavedChangesWarning(unsaved);

  const update = (field: QuoteField, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    idempotencyKeyRef.current = null;
    quoteIdRef.current = null;
    quoteInputRef.current = null;
    setCreatedQuoteId("");
    setMessage("");
    setErrorMessage("");
  };

  const focusField = (field: QuoteField | undefined) => {
    if (!field) return;
    window.setTimeout(() => {
      workflowRef.current
        ?.querySelector<HTMLElement>(
          `[data-field="${field}"] input, [data-field="${field}"] select`,
        )
        ?.focus();
    }, 0);
  };

  const updateLines = (nextLines: EditableQuoteLine[]) => {
    setLines(nextLines);
    setLineError(undefined);
    update("expiresAt", draft.expiresAt);
  };
  const next = () => {
    if (stage === 2) {
      const problem = validateAdditionalLines(
        lines,
        offers,
        selectedOffer?.priceBookId,
        t,
      );
      setLineError(problem);
      if (problem) return;
    }
    const nextErrors = validateQuoteStage(stage, draft, accountOptions, offers);
    setErrors(nextErrors);
    const firstError = firstQuoteError(nextErrors);
    if (firstError) {
      focusField(firstError);
      return;
    }
    setStage((current) => Math.min(3, current + 1) as QuoteStage);
    workflowRef.current?.focus();
  };

  const issue = async () => {
    const problem = validateAdditionalLines(
      lines,
      offers,
      selectedOffer?.priceBookId,
      t,
    );
    setLineError(problem);
    if (problem) {
      setStage(2);
      return;
    }
    const allErrors = {
      ...validateQuoteStage(1, draft, accountOptions, offers),
      ...validateQuoteStage(2, draft, accountOptions, offers),
    };
    setErrors(allErrors);
    const firstError = firstQuoteError(allErrors);
    if (firstError) {
      setStage(
        firstError === "account" ||
          firstError === "offer" ||
          firstError === "region"
          ? 1
          : 2,
      );
      focusField(firstError);
      return;
    }

    setPending(true);
    setMessage("");
    setErrorMessage("");
    try {
      if (origin?.kind === "revision" && !origin.revision)
        throw new CommercialStop(
          "customer.commercial.builder.error.revisionUnavailable",
        );
      if (!quoteInputRef.current) {
        const input = quotePayload(draft, accountOptions, offers);
        input.payload.lines.push(
          ...lines.map((line) => {
            const offer = offers.find((item) => item.id === line.offerId);
            if (!offer)
              throw new CommercialStop(
                "customer.commercial.builder.error.lineOffer",
              );
            return {
              lineId: uuidV7(),
              sku: offer.sku,
              region: offer.region,
              quantity: line.capacity,
              termMonths: Number(line.termMonths),
            };
          }),
        );
        quoteInputRef.current = input;
      }
      const input = quoteInputRef.current;
      idempotencyKeyRef.current ??= crypto.randomUUID();
      quoteIdRef.current ??= uuidV7();
      if (!input.accountId)
        throw new CommercialStop(
          "customer.commercial.builder.error.accountRequired",
        );
      await sendCoreCommand(
        {
          resource: "quotes",
          id: origin?.revision?.quoteId ?? quoteIdRef.current,
          accountId: input.accountId,
          action: origin?.revision ? "revise" : "create",
          ...(origin?.revision
            ? { expectedVersion: origin.revision.version }
            : {}),
          payload: origin?.revision
            ? {
                ...input.payload,
                seriesId: origin.revision.seriesId,
                revisionId: quoteIdRef.current,
              }
            : input.payload,
        },
        { idempotencyKey: idempotencyKeyRef.current },
      );
      setCreatedQuoteId(quoteIdRef.current);
      setMessage(t("customer.commercial.builder.created"));
    } catch (caught) {
      setErrorMessage(
        commercialFailureText(
          caught,
          t,
          "customer.commercial.builder.error.failed",
        ),
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <main
      className={`${styles.main} ${styles.commercialTask}`}
      id="main-content"
    >
      <header className={styles.header}>
        <div>
          <p className={styles.taskContext}>
            {t("customer.commercial.builder.taskContext")}
          </p>
          <h1>
            {t(
              origin?.revision
                ? "customer.commercial.builder.title.revise"
                : "customer.commercial.builder.title.create",
            )}
          </h1>
          <p className={styles.description}>
            {t("customer.commercial.builder.description")}
          </p>
        </div>
        <LeaveDraftControl
          armed={unsaved}
          className={styles.secondary ?? ""}
          discardClassName={styles.secondary ?? ""}
          href="/quotes"
          label={t("customer.commercial.builder.cancelAndReturn")}
        />
      </header>

      {origin ? (
        <p className={styles.notice} role="status">
          {originLabel(origin, t)}
        </p>
      ) : null}

      {offers.length === 0 ? (
        <p className={styles.errorMessage} role="alert">
          {t("customer.commercial.builder.noOffers")}
        </p>
      ) : null}

      <ol
        aria-label={t("customer.commercial.accept.chainLabel")}
        className={styles.promiseChain}
      >
        <li>
          <span>{t("customer.commercial.builder.chain.upstream")}</span>
          <strong>
            {t("customer.commercial.builder.chain.upstreamValue")}
          </strong>
        </li>
        <li aria-current="step">
          <span>{t("customer.commercial.builder.chain.current")}</span>
          <strong>{t("customer.commercial.builder.chain.currentValue")}</strong>
        </li>
        <li>
          <span>{t("customer.commercial.builder.chain.notCreated")}</span>
          <strong>
            {t("customer.commercial.builder.chain.notCreatedValue")}
          </strong>
        </li>
      </ol>

      <div className={styles.workflowGrid}>
        <div
          aria-labelledby="quote-stage-heading"
          className={`${styles.panel} ${styles.workflow} ${styles.taskPanel}`}
          ref={workflowRef}
          role="region"
          tabIndex={-1}
        >
          <ol
            className={styles.steps}
            aria-label={t("customer.commercial.builder.stagesLabel")}
          >
            {stages.map((label, index) => {
              const number = (index + 1) as QuoteStage;
              const className =
                number === stage
                  ? styles.current
                  : number < stage
                    ? styles.complete
                    : "";
              return (
                <li
                  aria-current={number === stage ? "step" : undefined}
                  className={className}
                  key={label}
                >
                  {t("customer.commercial.builder.stageItem", {
                    stage: index + 1,
                    label,
                  })}
                </li>
              );
            })}
          </ol>

          <div>
            <p className={styles.taskContext}>
              {t("customer.commercial.builder.stageOf", {
                stage,
                total: stages.length,
              })}
            </p>
            <h2 id="quote-stage-heading">{stages[stage - 1]}</h2>
          </div>

          {stage === 1 ? (
            <fieldset className={styles.stageFields}>
              <legend>{t("customer.commercial.builder.legend.offer")}</legend>
              <div className={styles.formGrid}>
                <SearchableSelector
                  error={errors.account && t(errors.account)}
                  id="account"
                  label={t("customer.commercial.builder.label.account")}
                  onChange={(value) => update("account", value)}
                  options={accountOptions}
                  placeholder={t("customer.commercial.builder.search.account")}
                  value={draft.account}
                />
                <SearchableSelector
                  error={errors.offer && t(errors.offer)}
                  help={t("customer.commercial.builder.offerHelp")}
                  id="offer"
                  label={t("customer.commercial.builder.offer")}
                  placeholder={t("customer.commercial.builder.search.offer")}
                  onChange={(value) => {
                    update("offer", value);
                    const selected = offers.find(
                      (offer) => offer.id === resolveSelectorId(value, offers),
                    );
                    setDraft((current) => ({
                      ...current,
                      region: selected?.region ?? "",
                    }));
                  }}
                  options={offers}
                  value={draft.offer}
                />
              </div>
            </fieldset>
          ) : null}

          {stage === 2 ? (
            <fieldset className={styles.stageFields}>
              <legend>{t("customer.commercial.builder.legend.terms")}</legend>
              <div className={styles.formGrid}>
                <Field
                  error={errors.capacity}
                  id="capacity"
                  label={t("customer.commercial.builder.label.capacity")}
                >
                  <input
                    aria-describedby={
                      errors.capacity ? "capacity-error" : undefined
                    }
                    aria-invalid={Boolean(errors.capacity) || undefined}
                    id="capacity"
                    inputMode="decimal"
                    min="10"
                    onChange={(event) => update("capacity", event.target.value)}
                    type="number"
                    value={draft.capacity}
                  />
                </Field>
                <Field
                  error={errors.termMonths}
                  id="termMonths"
                  label={t("customer.commercial.builder.label.term")}
                >
                  <input
                    aria-describedby={
                      errors.termMonths ? "termMonths-error" : undefined
                    }
                    aria-invalid={Boolean(errors.termMonths) || undefined}
                    id="termMonths"
                    max="60"
                    min="1"
                    onChange={(event) =>
                      update("termMonths", event.target.value)
                    }
                    type="number"
                    value={draft.termMonths}
                  />
                </Field>
                <fieldset
                  className={`${styles.routeChoices} ${styles.spanTwo}`}
                >
                  <legend>
                    {t("customer.commercial.builder.legend.route")}
                  </legend>
                  <label className={styles.routeChoice}>
                    <input
                      checked
                      name="route"
                      readOnly
                      type="radio"
                      value={customerQuoteRoute}
                    />
                    <span>
                      <strong>
                        {t("customer.commercial.builder.route.direct")}
                      </strong>
                      <span>
                        {t(
                          "customer.commercial.builder.route.directDescription",
                        )}
                      </span>
                    </span>
                  </label>
                  <p className={styles.description}>
                    {t("customer.commercial.builder.route.scope")}
                  </p>
                  <p className={styles.routeRule}>
                    {t("customer.commercial.builder.route.rule")}
                  </p>
                </fieldset>
                <Field
                  error={errors.expiresAt}
                  id="expiresAt"
                  label={t("customer.commercial.builder.label.expiry")}
                >
                  <input
                    aria-describedby={
                      errors.expiresAt
                        ? "expiresAt-error expiresAt-help"
                        : "expiresAt-help"
                    }
                    aria-invalid={Boolean(errors.expiresAt) || undefined}
                    id="expiresAt"
                    onChange={(event) =>
                      update("expiresAt", event.target.value)
                    }
                    type="datetime-local"
                    value={draft.expiresAt}
                  />
                  <p id="expiresAt-help" className={styles.muted}>
                    {t("customer.commercial.builder.expiryHelp")}
                  </p>
                </Field>
              </div>
            </fieldset>
          ) : null}

          {stage === 2 ? (
            <QuoteLines
              lines={lines}
              offers={offers}
              {...(selectedOffer
                ? { priceBookId: selectedOffer.priceBookId }
                : {})}
              onChange={updateLines}
            />
          ) : null}
          {lineError ? (
            <p role="alert" className={styles.errorMessage}>
              {lineError}
            </p>
          ) : null}
          {stage === 3 ? (
            <section aria-labelledby="quote-review-heading">
              <h3 id="quote-review-heading">
                {t("customer.commercial.builder.reviewTitle")}
              </h3>
              <p className={styles.notice}>
                {t("customer.commercial.builder.reviewDescription")}
              </p>
              <ul className={styles.reviewList}>
                {lines.map((line, index) => (
                  <li key={index}>
                    <span>
                      {t("customer.commercial.builder.line", {
                        line: index + 2,
                      })}
                    </span>
                    <strong>
                      {t("customer.commercial.builder.lineValue", {
                        offer:
                          offers.find((item) => item.id === line.offerId)
                            ?.label ?? "",
                        capacity: capacityLabel(
                          line.capacity,
                          formattingLocale,
                        ),
                        term: monthsLabel(line.termMonths, t),
                      })}
                    </strong>
                  </li>
                ))}
                <li>
                  <span>{t("customer.commercial.builder.stage.offer")}</span>
                  <strong>
                    {t("common.join.labels", {
                      first: draft.offer,
                      second: regionLabel(draft.region, t),
                    })}
                  </strong>
                </li>
                <li>
                  <span>
                    {t("customer.commercial.builder.review.capacityTerm")}
                  </span>
                  <strong>
                    {t("common.join.labels", {
                      first: capacityLabel(draft.capacity, formattingLocale),
                      second: monthsLabel(draft.termMonths, t),
                    })}
                  </strong>
                </li>
                <li>
                  <span>
                    {t("customer.commercial.builder.review.routeExpiry")}
                  </span>
                  <strong>
                    {t("customer.commercial.builder.review.routeExpiryValue", {
                      expiry: expiryLabel(draft.expiresAt, formattingLocale, t),
                    })}
                  </strong>
                </li>
              </ul>
            </section>
          ) : null}

          {message ? (
            <p className={styles.successMessage} role="status">
              {message}{" "}
              {createdQuoteId ? (
                <Link href={`/quotes/quote-${createdQuoteId}`}>
                  {t("customer.commercial.builder.createdLink")}
                </Link>
              ) : null}
            </p>
          ) : null}
          {errorMessage ? (
            <p className={styles.errorMessage} role="alert" tabIndex={-1}>
              {errorMessage}
            </p>
          ) : null}

          <div className={styles.actions}>
            <div>
              {stage > 1 ? (
                <button
                  className={styles.secondary}
                  disabled={pending}
                  onClick={() =>
                    setStage((current) => (current - 1) as QuoteStage)
                  }
                  type="button"
                >
                  {t("common.back")}
                </button>
              ) : null}
            </div>
            <div className={styles.actionGroup}>
              {stage < 3 ? (
                <button
                  className={styles.primary}
                  disabled={offers.length === 0}
                  onClick={next}
                  type="button"
                >
                  {t("common.continue")}
                </button>
              ) : (
                <button
                  className={styles.primary}
                  disabled={pending || Boolean(message)}
                  onClick={() => {
                    void issue();
                  }}
                  type="button"
                >
                  {t(
                    pending
                      ? "customer.commercial.builder.creating"
                      : "customer.commercial.builder.createDraft",
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
        <Summary draft={draft} lines={lines} offers={offers} />
      </div>
    </main>
  );
}
