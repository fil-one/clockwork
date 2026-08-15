"use client";

import type { Route } from "next";
import Link from "next/link";
import { useRef, useState } from "react";

import { ApplicationStatePanel, Button, buttonClassName } from "@clockwork/ui";
import { uuidV7 } from "@clockwork/contracts";

import { customerPartnerCopy } from "@/src/features/customer-partner/copy";
import { sendCoreCommand } from "@/src/features/contracts/commerce-client";
import { t } from "@/src/i18n/en";

import {
  emptyResaleQuoteDraft,
  merchantOfRecordName,
  partnerPricedRoute,
  quotableOffers,
  quoteReviewSummary,
  quoteRouteLabel,
  resaleQuotePayload,
  resolveOption,
  validateResaleQuoteStage,
  type PartnerQuoteContext,
  type QuoteValidation,
  type ResaleQuoteDraft,
} from "./resale-quote-model";
import styles from "./partner.module.css";

export type MissingQuoteInput =
  "agreement" | "referralRoute" | "offers" | "endClients";

const nothingToQuote: Readonly<
  Record<
    MissingQuoteInput,
    { title: string; description: string; href: Route; action: string }
  >
> = {
  agreement: {
    title: "No complete partner agreement is on file for this account",
    description:
      "A partner quote is written under a persisted channel agreement, and both the commercial route and the transfer tier come from that agreement rather than from this form. Your account returned no agreement type or no transfer tier, so there is nothing to quote under.",
    href: "/partner",
    action: "Back to the partner desk",
  },
  referralRoute: {
    title: "Fil One writes the quote on a referral agreement",
    description:
      "Your agreement is a referral: Fil One is merchant of record, prices the end client itself, and pays commission against your agreement. `core_partner_can_append_commercial_audit` admits a partner-written quote only where the partner is merchant of record, so a referral quote is not yours to create. Register the deal and the Fil One desk quotes it.",
    href: "/partner/registrations",
    action: "Open deal registrations",
  },
  offers: {
    title: "No offer is available to quote",
    description:
      "A partner quote is priced from a rate card on an activated price book in your billing currency. None was returned for your partner account, so there is nothing to price this quote against yet.",
    href: "/partner/quotes",
    action: "Back to quotes",
  },
  endClients: {
    title: "No end client is available to quote",
    description:
      "A partner quote names an end client you hold an approved, currently protected deal registration for. Yours returned none, so register the opportunity before quoting it.",
    href: "/partner/registrations",
    action: "Open deal registrations",
  },
};

/**
 * Nothing can be quoted without an agreement to quote under, a rate card to
 * price against, or a registered end client to quote to. All three are server
 * reads, so an empty one is a state to name rather than an empty picker to
 * leave the seller guessing at.
 */
export function NothingToQuote({ missing }: { missing: MissingQuoteInput }) {
  const copy = nothingToQuote[missing];
  return (
    <main className={styles.main} id="main-content">
      <div className={styles.state}>
        <ApplicationStatePanel
          state="empty"
          title={copy.title}
          description={copy.description}
          action={
            <Link
              className={buttonClassName({ variant: "secondary" })}
              href={copy.href}
            >
              {copy.action}
            </Link>
          }
        />
      </div>
    </main>
  );
}

export function ResaleQuoteBuilder({
  context,
}: {
  context: PartnerQuoteContext;
}) {
  // Registered end clients are reported first: on a referral route the offer
  // list is filtered to the currencies those clients are billed in, so an empty
  // portfolio empties the offers too and "no offer" would name the wrong gap.
  if (context.endClients.length === 0)
    return <NothingToQuote missing="endClients" />;
  if (context.offers.length === 0) return <NothingToQuote missing="offers" />;
  return <QuoteWorkspace context={context} />;
}

function QuoteWorkspace({ context }: { context: PartnerQuoteContext }) {
  const [stage, setStage] = useState<1 | 2 | 3>(1);
  // Derived from the clock this form was opened against, never from a calendar
  // date compiled into the bundle.
  const [draft, setDraft] = useState<ResaleQuoteDraft>(() =>
    emptyResaleQuoteDraft(new Date()),
  );
  const [errors, setErrors] = useState<QuoteValidation>({});
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [succeeded, setSucceeded] = useState(false);
  const [notice, setNotice] = useState("");
  const [failure, setFailure] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const submissionRef = useRef<{
    idempotencyKey: string;
    quoteId: string;
    payload: ReturnType<typeof resaleQuotePayload>;
  } | null>(null);
  const stages = customerPartnerCopy.commercial.quoteStages;
  const partnerPriced = partnerPricedRoute(context.route);

  function update<K extends keyof ResaleQuoteDraft>(
    key: K,
    value: ResaleQuoteDraft[K],
  ) {
    setDraft((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
    submissionRef.current = null;
    setSucceeded(false);
    setNotice("");
    setFailure("");
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
    // Expiry is validated against the clock at the moment of the interaction,
    // so a stale tab cannot accept an expiry that has already passed.
    const nextErrors = validateResaleQuoteStage(
      stage,
      draft,
      context,
      new Date(),
    );
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return focusFirstInvalid(nextErrors);
    setStage((current) => (current === 1 ? 2 : 3));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateResaleQuoteStage(3, draft, context, new Date());
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return focusFirstInvalid(nextErrors);
    if (!confirmed) return;
    setPending(true);
    setNotice("");
    setFailure("");
    try {
      submissionRef.current ??= {
        idempotencyKey: crypto.randomUUID(),
        quoteId: uuidV7(),
        payload: resaleQuotePayload(draft, context),
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
      setNotice(t("partner.quote.new.success"));
    } catch (error) {
      setFailure(
        error instanceof Error ? error.message : t("partner.quote.new.failure"),
      );
    } finally {
      setPending(false);
    }
  }

  const offer = resolveOption(draft.offerName, context.offers);
  const endClient = resolveOption(draft.endClientName, context.endClients);
  const selectableOffers = quotableOffers(context, draft.endClientName);
  const summary = quoteReviewSummary(draft, context);
  // A disabled primary action always says what would enable it.
  const submitReason =
    stage < 3
      ? ""
      : succeeded
        ? t("partner.quote.new.disabled.created")
        : confirmed
          ? ""
          : t("partner.quote.new.disabled.unconfirmed");

  return (
    <main className={styles.main} id="main-content">
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>
            {quoteRouteLabel(context.route)} quote
          </p>
          <h1>Create a partner quote</h1>
          <p>
            Choose recognizable commercial options. Fil One submits the existing
            IDs, calculates transfer pricing, and returns the authoritative
            draft.
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
              ? "Choose the approved offer. Its price book, service region and currency come with it."
              : stage === 2
                ? "Set the partner-controlled commercial shape and end client."
                : "Review both pricing boundaries before creating the server-priced draft."}
          </p>
          <div className={styles.formGrid}>
            {stage === 1 ? (
              <label className={`${styles.field} ${styles.full}`}>
                Offer and price book
                <input
                  name="offerName"
                  list="partner-offers"
                  value={draft.offerName}
                  onChange={(event) => update("offerName", event.target.value)}
                  aria-invalid={Boolean(errors.offerName)}
                  aria-describedby={
                    errors.offerName ? "offer-error" : undefined
                  }
                  autoComplete="off"
                />
                <datalist id="partner-offers">
                  {selectableOffers.map((option) => (
                    <option value={option.name} key={option.id} />
                  ))}
                </datalist>
                {errors.offerName ? (
                  <span className={styles.error} id="offer-error" role="alert">
                    {errors.offerName}
                  </span>
                ) : null}
              </label>
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
                    {context.endClients.map((option) => (
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
                {partnerPriced ? (
                  <label className={styles.field}>
                    {customerPartnerCopy.partner.partnerPrice} (
                    {offer?.currency ?? endClient?.quoteCurrency ?? "major"}{" "}
                    major units)
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
                ) : (
                  <p className={`${styles.muted} ${styles.full}`}>
                    Fil One is merchant of record on a referral, prices the end
                    client itself, and pays commission against your agreement.
                    There is no partner-set price on this route.
                  </p>
                )}
                {errors.offerName ? (
                  <span
                    className={`${styles.error} ${styles.full}`}
                    role="alert"
                  >
                    {errors.offerName}
                  </span>
                ) : null}
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
                aria-describedby={submitReason ? "submit-reason" : undefined}
              >
                Create priced draft
              </Button>
            )}
          </div>
          {submitReason ? (
            <p className={styles.muted} id="submit-reason">
              {submitReason}
            </p>
          ) : null}
          {failure ? (
            <p className={styles.failure} role="alert">
              {failure}
            </p>
          ) : null}
          {notice ? (
            <p className={styles.success} role="status">
              {notice}
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
              <strong>Region:</strong> {offer?.region ?? "Set by the offer"}
            </li>
            <li>
              <strong>Commercial route:</strong>{" "}
              {quoteRouteLabel(context.route)} · from your persisted partner
              agreement
            </li>
            <li>
              <strong>End client:</strong>{" "}
              {draft.endClientName || "Not selected"}
            </li>
            <li>
              <strong>Commitment:</strong>{" "}
              {draft.capacity ? `${draft.capacity} TB` : "Not recorded"} ·{" "}
              {draft.termMonths ? `${draft.termMonths} months` : "Not recorded"}
            </li>
            <li>
              <strong>{customerPartnerCopy.partner.partnerPrice}:</strong>{" "}
              {!partnerPriced
                ? "Not set on a referral"
                : draft.resalePrice
                  ? `${offer?.currency ?? ""} ${Number(draft.resalePrice).toLocaleString("en-US")}`.trim()
                  : "Not set"}
            </li>
            <li>
              <strong>{customerPartnerCopy.partner.transferPrice}:</strong>{" "}
              Server-priced after draft creation
            </li>
            <li>
              <strong>{customerPartnerCopy.partner.merchantOfRecord}:</strong>{" "}
              {merchantOfRecordName(context)}
            </li>
          </ul>
          <details className={styles.technical}>
            <summary>{customerPartnerCopy.common.technicalDetails}</summary>
            <p>
              Price book ID: <code>{offer?.priceBookId ?? "Unresolved"}</code>
            </p>
            <p>
              Rate card:{" "}
              <code>
                {offer ? `${offer.sku}/${offer.region}` : "Unresolved"}
              </code>
            </p>
            <p>
              End-client ID: <code>{endClient?.id ?? "Unresolved"}</code>
            </p>
            <p>
              Partner ID: <code>{context.partnerAccountId}</code>
            </p>
          </details>
        </aside>
      </div>
    </main>
  );
}
