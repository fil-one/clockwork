"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import { uuidV7 } from "@clockwork/contracts";

import { sendCoreCommand } from "@/src/features/contracts/commerce-client";

import { t } from "@/src/i18n/en";

import { customerPartnerCopy } from "../copy";
import styles from "./commercial.module.css";
import { SearchableSelector } from "./searchable-selector";
import {
  emptyQuoteDraft,
  firstQuoteError,
  quotePayload,
  quoteSelectorOptions,
  quoteStageLabels,
  validateQuoteStage,
  type QuoteDraft,
  type QuoteErrors,
  type QuoteField,
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
}

function originLabel(origin: QuoteOrigin): string {
  if (!origin.resolved) return t("quotes.builder.origin.unavailable");
  return origin.kind === "revision"
    ? t("quotes.builder.origin.revision", { reference: origin.reference })
    : t("quotes.builder.origin.poc", { reference: origin.reference });
}

function labelFor(value: string, fallback = "Not selected") {
  return value.trim() || fallback;
}

function regionLabel(value: string) {
  return (
    {
      "us-east": "US East · Virginia",
      "eu-west": "EU West · Madrid",
      "uk-south": "UK South · London",
    }[value] ?? labelFor(value)
  );
}

function routeLabel(value: string) {
  return (
    {
      direct: "Direct",
      referral: "Partner referral",
      resale: "Partner resale",
      distributor: "Distributor / two-tier",
      marketplace: "Marketplace",
    }[value] ?? labelFor(value)
  );
}

function expiryLabel(value: string) {
  if (!value) return "Not set";
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf())
    ? value
    : new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(parsed);
}

function Summary({ draft }: { draft: QuoteDraft }) {
  return (
    <aside
      className={`${styles.summary} ${styles.commitmentSummary}`}
      aria-labelledby="quote-summary-title"
    >
      <div>
        <p className={styles.taskContext}>Draft facts</p>
        <h2 id="quote-summary-title">
          {customerPartnerCopy.commercial.quoteSummary}
        </h2>
      </div>
      <dl>
        <div>
          <dt>Customer</dt>
          <dd>{labelFor(draft.account)}</dd>
        </div>
        <div>
          <dt>Offer</dt>
          <dd>{labelFor(draft.offer)}</dd>
        </div>
        <div>
          <dt>Region</dt>
          <dd>{regionLabel(draft.region)}</dd>
        </div>
        <div>
          <dt>Capacity</dt>
          <dd>{draft.capacity ? `${draft.capacity} TB` : "Not set"}</dd>
        </div>
        <div>
          <dt>Term and route</dt>
          <dd>
            {draft.termMonths ? `${draft.termMonths} months` : "Not set"} ·{" "}
            {routeLabel(draft.route)}
          </dd>
        </div>
        {draft.route === "direct" ? null : (
          <div>
            <dt>End client / partner</dt>
            <dd>
              {labelFor(draft.endClient)} · {labelFor(draft.partner)}
            </dd>
          </div>
        )}
        <div>
          <dt>Expiry</dt>
          <dd>{expiryLabel(draft.expiresAt)}</dd>
        </div>
      </dl>
      <p className={styles.notice}>
        Pricing and availability are confirmed by the server when the quote is
        issued. This summary is not a commitment.
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
  error?: string | undefined;
  children: React.ReactNode;
  span?: boolean;
}) {
  return (
    <div
      className={`${styles.field} ${span ? styles.spanTwo : ""}`}
      data-field={id}
    >
      <label htmlFor={id}>{label}</label>
      {children}
      {error ? (
        <p className={styles.fieldError} id={`${id}-error`} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function QuoteBuilder({
  account,
  origin,
}: {
  account: QuoteAccount;
  origin?: QuoteOrigin;
}) {
  const accountOptions: readonly SelectorOption[] = [
    {
      id: account.id,
      label: account.name,
      description: t("quotes.builder.account.description"),
    },
  ];
  const [stage, setStage] = useState<QuoteStage>(1);
  const [draft, setDraft] = useState<QuoteDraft>(() =>
    emptyQuoteDraft(account.name),
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

  const next = () => {
    const nextErrors = validateQuoteStage(stage, draft, accountOptions);
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
    const allErrors = {
      ...validateQuoteStage(1, draft, accountOptions),
      ...validateQuoteStage(2, draft, accountOptions),
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
      quoteInputRef.current ??= quotePayload(draft, accountOptions);
      const input = quoteInputRef.current;
      idempotencyKeyRef.current ??= crypto.randomUUID();
      quoteIdRef.current ??= uuidV7();
      if (!input.accountId)
        throw new Error("Choose a customer account before creating the draft.");
      await sendCoreCommand(
        {
          resource: "quotes",
          id: quoteIdRef.current,
          accountId: input.accountId,
          action: "create",
          payload: input.payload,
        },
        { idempotencyKey: idempotencyKeyRef.current },
      );
      setCreatedQuoteId(quoteIdRef.current);
      setMessage(t("quotes.builder.created"));
    } catch (caught) {
      setErrorMessage(
        caught instanceof Error
          ? caught.message
          : "The quote could not be issued. Nothing was changed.",
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
          <p className={styles.taskContext}>Quote draft · no commitment yet</p>
          <h1>Create a quote</h1>
          <p className={styles.description}>
            Build the commercial offer in three stages. Human-readable choices
            are resolved to existing server identifiers only when issued.
          </p>
        </div>
        <Link className={styles.secondary} href="/quotes">
          Cancel and return
        </Link>
      </header>

      {origin ? (
        <p className={styles.notice} role="status">
          {originLabel(origin)}
        </p>
      ) : null}

      <ol aria-label="Commercial promise chain" className={styles.promiseChain}>
        <li>
          <span>Required upstream</span>
          <strong>Agreement and account authority</strong>
        </li>
        <li aria-current="step">
          <span>Current task</span>
          <strong>Quote scope, route, and expiry</strong>
        </li>
        <li>
          <span>Not created</span>
          <strong>Order commitment after acceptance</strong>
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
          <ol className={styles.steps} aria-label="Quote creation stages">
            {quoteStageLabels.map((label, index) => {
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
                  {index + 1}. {label}
                </li>
              );
            })}
          </ol>

          <div>
            <p className={styles.taskContext}>Stage {stage} of 3</p>
            <h2 id="quote-stage-heading">{quoteStageLabels[stage - 1]}</h2>
          </div>

          {stage === 1 ? (
            <fieldset className={styles.stageFields}>
              <legend>Customer, offer, and region</legend>
              <div className={styles.formGrid}>
                <SearchableSelector
                  error={errors.account}
                  id="account"
                  label="Customer account"
                  onChange={(value) => update("account", value)}
                  options={accountOptions}
                  value={draft.account}
                />
                <SearchableSelector
                  error={errors.offer}
                  help="Search by offer name; the selected price-book ID remains hidden."
                  id="offer"
                  label="Offer"
                  onChange={(value) => update("offer", value)}
                  options={quoteSelectorOptions.offers}
                  value={draft.offer}
                />
                <Field
                  error={errors.region}
                  id="region"
                  label="Data region"
                  span
                >
                  <select
                    aria-describedby={
                      errors.region ? "region-error" : undefined
                    }
                    aria-invalid={Boolean(errors.region) || undefined}
                    id="region"
                    onChange={(event) => update("region", event.target.value)}
                    value={draft.region}
                  >
                    <option value="us-east">US East · Virginia</option>
                    <option value="eu-west">EU West · Madrid</option>
                    <option value="uk-south">UK South · London</option>
                  </select>
                </Field>
              </div>
            </fieldset>
          ) : null}

          {stage === 2 ? (
            <fieldset className={styles.stageFields}>
              <legend>Commitment, route, and expiry</legend>
              <div className={styles.formGrid}>
                <Field
                  error={errors.capacity}
                  id="capacity"
                  label="Committed capacity (TB)"
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
                  label="Term (months)"
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
                <Field error={errors.route} id="route" label="Commercial route">
                  <select
                    aria-describedby={errors.route ? "route-error" : undefined}
                    aria-invalid={Boolean(errors.route) || undefined}
                    id="route"
                    onChange={(event) => update("route", event.target.value)}
                    value={draft.route}
                  >
                    <option value="direct">Direct</option>
                    <option value="referral">Partner referral</option>
                    <option value="resale">Partner resale</option>
                    <option value="distributor">Distributor / two-tier</option>
                    <option value="marketplace">Marketplace</option>
                  </select>
                </Field>
                <Field
                  error={errors.expiresAt}
                  id="expiresAt"
                  label="Quote expiry"
                >
                  <input
                    aria-describedby={
                      errors.expiresAt ? "expiresAt-error" : undefined
                    }
                    aria-invalid={Boolean(errors.expiresAt) || undefined}
                    id="expiresAt"
                    onChange={(event) =>
                      update("expiresAt", event.target.value)
                    }
                    type="datetime-local"
                    value={draft.expiresAt}
                  />
                </Field>
                {draft.route === "direct" ? null : (
                  <>
                    <SearchableSelector
                      error={errors.endClient}
                      id="endClient"
                      label="End client"
                      onChange={(value) => update("endClient", value)}
                      options={quoteSelectorOptions.endClients}
                      value={draft.endClient}
                    />
                    <SearchableSelector
                      error={errors.partner}
                      id="partner"
                      label="Partner"
                      onChange={(value) => update("partner", value)}
                      options={quoteSelectorOptions.partners}
                      value={draft.partner}
                    />
                  </>
                )}
              </div>
            </fieldset>
          ) : null}

          {stage === 3 ? (
            <section aria-labelledby="quote-review-heading">
              <h3 id="quote-review-heading">Draft boundary</h3>
              <p className={styles.notice}>
                Review customer, offer, region, capacity, term, route, parties,
                and expiry. This step creates a server-priced draft. Issuance is
                available only after the rendered artifact is prepared and
                bound, so this screen does not infer an open status.
              </p>
              <ul className={styles.reviewList}>
                <li>
                  <span>Offer and region</span>
                  <strong>
                    {draft.offer} · {regionLabel(draft.region)}
                  </strong>
                </li>
                <li>
                  <span>Capacity and term</span>
                  <strong>
                    {draft.capacity} TB · {draft.termMonths} months
                  </strong>
                </li>
                <li>
                  <span>Route and expiry</span>
                  <strong>
                    {routeLabel(draft.route)} · {expiryLabel(draft.expiresAt)}
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
                  {t("quotes.builder.createdLink")}
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
                  onClick={() =>
                    setStage((current) => (current - 1) as QuoteStage)
                  }
                  type="button"
                >
                  Back
                </button>
              ) : null}
            </div>
            <div className={styles.actionGroup}>
              {stage < 3 ? (
                <button className={styles.primary} onClick={next} type="button">
                  Continue
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
                  {pending ? "Creating…" : "Create priced draft"}
                </button>
              )}
            </div>
          </div>
        </div>
        <Summary draft={draft} />
      </div>
    </main>
  );
}
