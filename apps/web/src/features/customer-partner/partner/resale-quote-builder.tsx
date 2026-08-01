"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import { Button } from "@clockwork/ui";
import { uuidV7 } from "@clockwork/contracts";

import { customerPartnerCopy } from "@/src/features/customer-partner/copy";
import { sendCoreCommand } from "@/src/features/contracts/commerce-client";

import {
  clientOptions,
  offerOptions,
  quoteReviewSummary,
  resaleQuotePayload,
  resolveSelectorId,
  validateResaleQuoteStage,
  type QuoteValidation,
  type ResaleQuoteDraft,
} from "./resale-quote-model";
import styles from "./partner.module.css";

const initialDraft: ResaleQuoteDraft = {
  offerName: offerOptions[0].name,
  region: "us-east",
  capacity: "120",
  termMonths: "12",
  route: "resale",
  endClientName: clientOptions[0].name,
  expiresAt: "2026-08-31T17:00",
  resalePrice: "68400",
};

export function ResaleQuoteBuilder() {
  const [stage, setStage] = useState<1 | 2 | 3>(1);
  const [draft, setDraft] = useState(initialDraft);
  const [errors, setErrors] = useState<QuoteValidation>({});
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [succeeded, setSucceeded] = useState(false);
  const [message, setMessage] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const submissionRef = useRef<{
    idempotencyKey: string;
    quoteId: string;
    payload: ReturnType<typeof resaleQuotePayload>;
  } | null>(null);
  const stages = customerPartnerCopy.commercial.quoteStages;

  function update<K extends keyof ResaleQuoteDraft>(
    key: K,
    value: ResaleQuoteDraft[K],
  ) {
    setDraft((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
    submissionRef.current = null;
    setSucceeded(false);
    setMessage("");
  }

  function focusFirstInvalid(nextErrors: QuoteValidation) {
    const first = Object.keys(nextErrors)[0];
    if (first)
      window.setTimeout(
        () =>
          formRef.current
            ?.querySelector<HTMLElement>(`[name="${first}"]`)
            ?.focus(),
        0,
      );
  }

  function advance() {
    const nextErrors = validateResaleQuoteStage(
      stage,
      draft,
      new Date("2026-07-31T16:00:00Z"),
    );
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return focusFirstInvalid(nextErrors);
    setStage((current) => (current === 1 ? 2 : 3));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateResaleQuoteStage(
      3,
      draft,
      new Date("2026-07-31T16:00:00Z"),
    );
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return focusFirstInvalid(nextErrors);
    if (!confirmed) return;
    setPending(true);
    setMessage("");
    try {
      submissionRef.current ??= {
        idempotencyKey: crypto.randomUUID(),
        quoteId: uuidV7(),
        payload: resaleQuotePayload(draft),
      };
      const submission = submissionRef.current;
      await sendCoreCommand(
        {
          resource: "quotes",
          id: submission.quoteId,
          accountId: submission.payload.endClientAccountId,
          action: "create",
          payload: submission.payload,
        },
        { idempotencyKey: submission.idempotencyKey },
      );
      setSucceeded(true);
      setMessage(
        "Draft created from server pricing. Review the server-returned transfer price before using the valid Issue action.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The quote could not be created. Nothing changed.",
      );
    } finally {
      setPending(false);
    }
  }

  const offerId = resolveSelectorId(draft.offerName, offerOptions);
  const endClientId = resolveSelectorId(draft.endClientName, clientOptions);
  const summary = quoteReviewSummary(draft);

  return (
    <main className={styles.main} id="main-content">
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>Resale quote</p>
          <h1>Create a partner quote</h1>
          <p>
            Choose recognizable commercial options. Clockwork submits the
            existing IDs, calculates transfer pricing, and returns the
            authoritative draft.
          </p>
        </div>
        <Link
          className={`${styles.buttonLink} ${styles.buttonSecondary}`}
          href="/partner/quotes"
        >
          Back to quotes
        </Link>
      </header>

      <ol className={styles.stages} aria-label="Quote creation stages">
        {stages.map((label, index) => (
          <li
            className={styles.stage}
            data-active={stage === index + 1}
            aria-current={stage === index + 1 ? "step" : undefined}
            key={label}
          >
            <span>Stage {index + 1}</span>
            <br />
            {label}
          </li>
        ))}
      </ol>

      <div className={styles.workflowGrid}>
        <form
          className={styles.workflow}
          ref={formRef}
          onSubmit={(event) => {
            void submit(event);
          }}
          noValidate
        >
          <h2>{stages[stage - 1]}</h2>
          <p className={styles.muted}>
            {stage === 1
              ? "Choose the approved offer and service region."
              : stage === 2
                ? "Set the partner-controlled commercial shape and end client."
                : "Review both pricing boundaries before creating the server-priced draft."}
          </p>
          <div className={styles.formGrid}>
            {stage === 1 ? (
              <>
                <label className={`${styles.field} ${styles.full}`}>
                  Offer and price book
                  <input
                    name="offerName"
                    list="partner-offers"
                    value={draft.offerName}
                    onChange={(event) =>
                      update("offerName", event.target.value)
                    }
                    aria-invalid={Boolean(errors.offerName)}
                    aria-describedby={
                      errors.offerName ? "offer-error" : undefined
                    }
                    autoComplete="off"
                  />
                  <datalist id="partner-offers">
                    {offerOptions.map((option) => (
                      <option value={option.name} key={option.id} />
                    ))}
                  </datalist>
                  {errors.offerName ? (
                    <span
                      className={styles.error}
                      id="offer-error"
                      role="alert"
                    >
                      {errors.offerName}
                    </span>
                  ) : null}
                </label>
                <label className={styles.field}>
                  Service region
                  <select
                    name="region"
                    value={draft.region}
                    onChange={(event) => update("region", event.target.value)}
                    aria-invalid={Boolean(errors.region)}
                  >
                    <option value="us-east">US East (Virginia)</option>
                    <option value="eu-west">EU West (Frankfurt)</option>
                    <option value="uk-south">UK South (London)</option>
                  </select>
                  {errors.region ? (
                    <span className={styles.error} role="alert">
                      {errors.region}
                    </span>
                  ) : null}
                </label>
              </>
            ) : null}
            {stage === 2 ? (
              <>
                <label className={styles.field}>
                  Committed capacity (TB)
                  <input
                    name="capacity"
                    type="number"
                    inputMode="decimal"
                    min="10"
                    value={draft.capacity}
                    onChange={(event) => update("capacity", event.target.value)}
                    aria-invalid={Boolean(errors.capacity)}
                  />
                  {errors.capacity ? (
                    <span className={styles.error} role="alert">
                      {errors.capacity}
                    </span>
                  ) : null}
                </label>
                <label className={styles.field}>
                  Term (months)
                  <input
                    name="termMonths"
                    type="number"
                    min="1"
                    step="1"
                    value={draft.termMonths}
                    onChange={(event) =>
                      update("termMonths", event.target.value)
                    }
                    aria-invalid={Boolean(errors.termMonths)}
                  />
                  {errors.termMonths ? (
                    <span className={styles.error} role="alert">
                      {errors.termMonths}
                    </span>
                  ) : null}
                </label>
                <label className={styles.field}>
                  Commercial route
                  <select
                    name="route"
                    value={draft.route}
                    onChange={(event) =>
                      update(
                        "route",
                        event.target.value as ResaleQuoteDraft["route"],
                      )
                    }
                  >
                    <option value="resale">Resale</option>
                    <option value="distributor">Two-tier distributor</option>
                  </select>
                </label>
                <label className={styles.field}>
                  End client
                  <input
                    name="endClientName"
                    list="partner-clients"
                    value={draft.endClientName}
                    onChange={(event) =>
                      update("endClientName", event.target.value)
                    }
                    aria-invalid={Boolean(errors.endClientName)}
                    autoComplete="off"
                  />
                  <datalist id="partner-clients">
                    {clientOptions.map((option) => (
                      <option value={option.name} key={option.id} />
                    ))}
                  </datalist>
                  {errors.endClientName ? (
                    <span className={styles.error} role="alert">
                      {errors.endClientName}
                    </span>
                  ) : null}
                </label>
                <label className={styles.field}>
                  Quote expiry
                  <input
                    name="expiresAt"
                    type="datetime-local"
                    value={draft.expiresAt}
                    onChange={(event) =>
                      update("expiresAt", event.target.value)
                    }
                    aria-invalid={Boolean(errors.expiresAt)}
                  />
                  {errors.expiresAt ? (
                    <span className={styles.error} role="alert">
                      {errors.expiresAt}
                    </span>
                  ) : null}
                </label>
                <label className={styles.field}>
                  {customerPartnerCopy.partner.partnerPrice} (major units)
                  <input
                    name="resalePrice"
                    inputMode="decimal"
                    value={draft.resalePrice}
                    onChange={(event) =>
                      update("resalePrice", event.target.value)
                    }
                    aria-invalid={Boolean(errors.resalePrice)}
                  />
                  {errors.resalePrice ? (
                    <span className={styles.error} role="alert">
                      {errors.resalePrice}
                    </span>
                  ) : null}
                </label>
              </>
            ) : null}
            {stage === 3 ? (
              <div className={styles.full}>
                <ul className={styles.summaryList}>
                  {summary.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <p className={styles.gate}>
                  {customerPartnerCopy.partner.boundary}
                </p>
                <label className={styles.confirm}>
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(event) => setConfirmed(event.target.checked)}
                  />
                  <span>
                    I reviewed the named end client, service commitment, partner
                    resale price, expiry, and merchant-of-record boundary.
                  </span>
                </label>
              </div>
            ) : null}
          </div>
          <div className={styles.actions}>
            {stage > 1 ? (
              <Button
                variant="secondary"
                onClick={() => setStage((current) => (current === 3 ? 2 : 1))}
              >
                Back
              </Button>
            ) : null}
            {stage < 3 ? (
              <Button onClick={advance}>Continue</Button>
            ) : (
              <Button
                type="submit"
                disabled={!confirmed || succeeded}
                loading={pending}
              >
                Create priced draft
              </Button>
            )}
          </div>
          {message ? (
            <p className={styles.success} role="status">
              {message}
            </p>
          ) : null}
        </form>

        <aside
          className={`${styles.summary} ${styles.sticky}`}
          aria-labelledby="quote-summary-title"
        >
          <h2 id="quote-summary-title">
            {customerPartnerCopy.commercial.quoteSummary}
          </h2>
          <ul className={styles.summaryList}>
            <li>
              <strong>Offer:</strong> {draft.offerName || "Not selected"}
            </li>
            <li>
              <strong>Region:</strong> {draft.region || "Not selected"}
            </li>
            <li>
              <strong>End client:</strong>{" "}
              {draft.endClientName || "Not selected"}
            </li>
            <li>
              <strong>Commitment:</strong> {draft.capacity || "—"} TB ·{" "}
              {draft.termMonths || "—"} months
            </li>
            <li>
              <strong>{customerPartnerCopy.partner.partnerPrice}:</strong> $
              {Number(draft.resalePrice || 0).toLocaleString("en-US")}
            </li>
            <li>
              <strong>{customerPartnerCopy.partner.transferPrice}:</strong>{" "}
              Server-priced after draft creation
            </li>
            <li>
              <strong>{customerPartnerCopy.partner.merchantOfRecord}:</strong>{" "}
              Meridian Channel Group
            </li>
          </ul>
          <details className={styles.technical}>
            <summary>{customerPartnerCopy.common.technicalDetails}</summary>
            <p>
              Offer ID: <code>{offerId ?? "Unresolved"}</code>
            </p>
            <p>
              End-client ID: <code>{endClientId ?? "Unresolved"}</code>
            </p>
            <p>
              Partner ID: <code>22222222-2222-4222-8222-222222222222</code>
            </p>
          </details>
        </aside>
      </div>
    </main>
  );
}
