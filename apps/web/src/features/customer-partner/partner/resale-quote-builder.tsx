"use client";
import { localQuoteExpiry } from "./resale-quote-model";

import type { MessageId } from "@/src/i18n";
import { useFormattingLocale, useTranslations } from "@/src/i18n/client";
import { richText } from "@/src/i18n/rich";

import type { Route } from "next";
import Link from "next/link";
import { useRef, useState } from "react";

import { ApplicationStatePanel, Button, buttonClassName } from "@clockwork/ui";
import { uuidV7 } from "@clockwork/contracts";

import { draftIsDirty } from "@/src/features/customer-partner/draft-state";
import {
  LeaveDraftControl,
  useUnsavedChangesWarning,
} from "@/src/features/customer-partner/unsaved-changes";
import { sendCoreCommand } from "@/src/features/contracts/commerce-client";

import {
  emptyResaleQuoteDraft,
  merchantOfRecordName,
  parseDecimalAmount,
  partnerRouteConsequence,
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
import { partnerCommandFailure } from "./partner-command-errors";
import { formatTerabytes } from "./partner-presentation";
import { attributionStatement } from "./partner-rules";
import styles from "./partner.module.css";
import {
  QuoteLines,
  validateAdditionalLines,
  type EditableQuoteLine,
} from "../commercial/quote-lines";

export type MissingQuoteInput =
  "agreement" | "referralRoute" | "offers" | "endClients";

const nothingToQuote: Readonly<
  Record<
    MissingQuoteInput,
    { title: MessageId; description: MessageId; href: Route; action: MessageId }
  >
> = {
  agreement: {
    title: "partner.quote.nothing.agreement.title",
    description: "partner.quote.nothing.agreement.description",
    href: "/partner",
    action: "partner.quote.nothing.backToDesk",
  },
  referralRoute: {
    title: "partner.quote.nothing.referral.title",
    description: "partner.quote.nothing.referral.description",
    href: "/partner/registrations",
    action: "partner.quote.nothing.openRegistrations",
  },
  offers: {
    title: "partner.quote.nothing.offers.title",
    description: "partner.quote.nothing.offers.description",
    href: "/partner/quotes",
    action: "partner.quote.new.back",
  },
  endClients: {
    title: "partner.quote.nothing.endClients.title",
    description: "partner.quote.nothing.endClients.description",
    href: "/partner/registrations",
    action: "partner.quote.nothing.openRegistrations",
  },
};

/**
 * Nothing can be quoted without an agreement to quote under, a rate card to
 * price against, or a registered end client to quote to. All three are server
 * reads, so an empty one is a state to name rather than an empty picker to
 * leave the seller guessing at.
 */
export function NothingToQuote({ missing }: { missing: MissingQuoteInput }) {
  const t = useTranslations();
  const copy = nothingToQuote[missing];
  return (
    <main className={styles.main} id="main-content">
      <div className={styles.state}>
        <ApplicationStatePanel
          state="empty"
          title={t(copy.title)}
          description={t(copy.description)}
          action={
            <Link
              className={buttonClassName({ variant: "secondary" })}
              href={copy.href}
            >
              {t(copy.action)}
            </Link>
          }
        />
      </div>
    </main>
  );
}

const eyebrows = {
  referral: "partner.quote.new.eyebrow.referral",
  resale: "partner.quote.new.eyebrow.resale",
  distributor: "partner.quote.new.eyebrow.distributor",
} as const satisfies Record<PartnerQuoteContext["route"], MessageId>;

const stageHelp = {
  1: "partner.quote.new.help.offer",
  2: "partner.quote.new.help.terms",
  3: "partner.quote.new.help.review",
} as const satisfies Record<1 | 2 | 3, MessageId>;

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
  const t = useTranslations();
  const formattingLocale = useFormattingLocale();
  const [stage, setStage] = useState<1 | 2 | 3>(1);
  // Derived from the clock this form was opened against, never from a calendar
  // date compiled into the bundle. One clock read seeds both the editable draft
  // and the pristine copy the unsaved-work check compares against, so the
  // derived expiry can never be mistaken for something the seller typed.
  const [pristine] = useState<ResaleQuoteDraft>(() => ({
    ...emptyResaleQuoteDraft(new Date()),
    ...context.revision?.initialDraft,
    ...(context.revision?.initialDraft.expiresAt
      ? {
          expiresAt: localQuoteExpiry(
            new Date(context.revision.initialDraft.expiresAt),
          ),
        }
      : {}),
  }));
  const [draft, setDraft] = useState<ResaleQuoteDraft>(pristine);
  const [lines, setLines] = useState<readonly EditableQuoteLine[]>(
    context.revision?.lines ?? [],
  );
  const [lineError, setLineError] = useState<string>();
  const lineOffers = context.offers.map((offer) => ({
    ...offer,
    label: offer.name,
  }));
  const [errors, setErrors] = useState<QuoteValidation>({});
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [succeeded, setSucceeded] = useState(false);
  const [notice, setNotice] = useState<MessageId | null>(null);
  const [failure, setFailure] = useState<MessageId | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const submissionRef = useRef<{
    idempotencyKey: string;
    quoteId: string;
    payload: ReturnType<typeof resaleQuotePayload>;
  } | null>(null);
  const stages = [
    t("cp.commercial.quoteStages.0"),
    t("quotes.form.stageTerms"),
    t("quotes.form.stageReview"),
  ];
  const partnerPriced = partnerPricedRoute(context.route);

  /**
   * Armed while the seller has entered something the server has not taken.
   *
   * `confirmed` counts: ticking the authority box on stage three is an
   * assertion, and losing it silently is losing work. `succeeded` disarms, and
   * `update()` clears `succeeded` on any further edit, so the pair tracks the
   * submission rather than the visit.
   */
  const unsaved =
    (draftIsDirty(draft, pristine) ||
      confirmed ||
      JSON.stringify(lines) !==
        JSON.stringify(context.revision?.lines ?? [])) &&
    !succeeded;
  useUnsavedChangesWarning(unsaved);

  function update<K extends keyof ResaleQuoteDraft>(
    key: K,
    value: ResaleQuoteDraft[K],
  ) {
    setDraft((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
    submissionRef.current = null;
    setSucceeded(false);
    setNotice(null);
    setFailure(null);
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

  function updateLines(nextLines: EditableQuoteLine[]) {
    setLines(nextLines);
    setLineError(undefined);
    update("expiresAt", draft.expiresAt);
  }
  function checkLines() {
    const problem = validateAdditionalLines(
      lines,
      lineOffers,
      resolveOption(draft.offerName, context.offers)?.priceBookId,
      t,
    );
    setLineError(problem);
    return problem;
  }
  function advance() {
    if (stage === 2 && checkLines()) return;
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
    if (checkLines()) {
      setStage(2);
      return;
    }
    const nextErrors = validateResaleQuoteStage(3, draft, context, new Date());
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return focusFirstInvalid(nextErrors);
    if (!confirmed) return;
    setPending(true);
    setNotice(null);
    setFailure(null);
    try {
      if (!submissionRef.current) {
        const payload = resaleQuotePayload(draft, context);
        payload.lines.push(
          ...lines.map((line) => {
            const offer = context.offers.find(
              (item) => item.id === line.offerId,
            );
            // checkLines() above already refused a line without an offer.
            if (!offer) throw new Error("Line offer is unresolved."); // i18n-exempt: internal invariant, not rendered
            return {
              lineId: uuidV7(),
              sku: offer.sku,
              region: offer.region,
              quantity: line.capacity,
              termMonths: Number(line.termMonths),
            };
          }),
        );
        submissionRef.current = {
          idempotencyKey: crypto.randomUUID(),
          quoteId:
            context.revision?.action === "edit"
              ? context.revision.quoteId
              : uuidV7(),
          payload,
        };
      }
      const submission = submissionRef.current;
      await sendCoreCommand(
        {
          resource: "quotes",
          id: context.revision?.quoteId ?? submission.quoteId,
          accountId: submission.payload.endClientAccountId,
          action: context.revision?.action ?? "create",
          ...(context.revision
            ? { expectedVersion: context.revision.version }
            : {}),
          payload: {
            ...submission.payload,
            ...(context.revision
              ? {
                  seriesId: context.revision.seriesId,
                  ...(context.revision.action === "revise"
                    ? { revisionId: submission.quoteId }
                    : {}),
                }
              : {}),
          },
        },
        { idempotencyKey: submission.idempotencyKey },
      );
      setSucceeded(true);
      setNotice("partner.quote.new.success");
    } catch (error) {
      setFailure(partnerCommandFailure(error, "partner.quote.new.failure"));
    } finally {
      setPending(false);
    }
  }

  const offer = resolveOption(draft.offerName, context.offers);
  const endClient = resolveOption(draft.endClientName, context.endClients);
  const selectableOffers = quotableOffers(context, draft.endClientName);
  const summary = quoteReviewSummary(draft, context, t, formattingLocale);
  const routeLabel = t(quoteRouteLabel(context.route));
  const resaleCurrency = offer?.currency ?? endClient?.quoteCurrency;
  const resaleAmount = parseDecimalAmount(draft.resalePrice);
  const firstLineTerm = Number(draft.termMonths);
  const months = (value: string) => {
    const count = Number(value);
    return value && Number.isInteger(count) && count > 0
      ? t("partner.term.months", { count })
      : "—";
  };
  const field = (label: MessageId, value: React.ReactNode) =>
    richText(t, "partner.labelled", {
      label: <strong>{t(label)}</strong>,
      value,
    });
  // A disabled primary action always says what would enable it.
  const submitReason: MessageId | null =
    stage < 3
      ? null
      : succeeded
        ? "partner.quote.new.disabled.created"
        : confirmed
          ? null
          : "partner.quote.new.disabled.unconfirmed";

  return (
    <main className={styles.main} id="main-content">
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>{t(eyebrows[context.route])}</p>
          <h1>
            {t(
              context.revision
                ? context.revision.action === "edit"
                  ? "partner.quote.new.title.edit"
                  : "partner.quote.new.title.revise"
                : "partner.quote.new.title.create",
            )}
          </h1>
          <p>{t("partner.quote.new.description")}</p>
        </div>
        <LeaveDraftControl
          armed={unsaved}
          className={`${styles.buttonLink} ${styles.buttonSecondary}`}
          discardClassName={`${styles.buttonLink} ${styles.buttonSecondary}`}
          href="/partner/quotes"
          label={t("partner.quote.new.back")}
        />
      </header>

      <ol
        className={styles.stages}
        aria-label={t("partner.quote.new.stagesLabel")}
      >
        {stages.map((label, index) => (
          <li
            className={styles.stage}
            data-active={stage === index + 1}
            aria-current={stage === index + 1 ? "step" : undefined}
            key={label}
          >
            <span>
              {t("partner.quote.new.stageNumber", { number: index + 1 })}
            </span>
            <br />
            {label}
          </li>
        ))}
      </ol>

      <section
        aria-labelledby="partner-route-consequence"
        className={styles.routeConsequence}
      >
        <div>
          <p className={styles.classifier}>
            {t("partner.quote.new.routeEyebrow")}
          </p>
          <h2 id="partner-route-consequence">{routeLabel}</h2>
        </div>
        <p>{t(partnerRouteConsequence(context.route))}</p>
        <p>{t("partner.quote.new.routeFixed")}</p>
      </section>

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
          <p className={styles.muted}>{t(stageHelp[stage])}</p>
          <div className={styles.formGrid}>
            {stage === 1 ? (
              <label className={`${styles.field} ${styles.full}`}>
                {t("partner.quote.new.field.offer")}
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
                    {t(errors.offerName.id, errors.offerName.values)}
                  </span>
                ) : null}
              </label>
            ) : null}
            {stage === 2 ? (
              <>
                <label className={styles.field}>
                  {t("partner.quote.new.field.capacity")}
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
                      {t(errors.capacity.id, errors.capacity.values)}
                    </span>
                  ) : null}
                </label>
                <label className={styles.field}>
                  {t("partner.quote.new.field.term")}
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
                      {t(errors.termMonths.id, errors.termMonths.values)}
                    </span>
                  ) : null}
                </label>
                <label className={styles.field}>
                  {t("partner.quote.new.field.endClient")}
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
                      {t(errors.endClientName.id, errors.endClientName.values)}
                    </span>
                  ) : null}
                </label>
                <label className={styles.field}>
                  {t("partner.quote.new.field.expiry")}
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
                      {t(errors.expiresAt.id, errors.expiresAt.values)}
                    </span>
                  ) : null}
                </label>
                {partnerPriced ? (
                  <label className={styles.field}>
                    {resaleCurrency
                      ? t("partner.quote.new.field.resalePrice", {
                          currency: resaleCurrency,
                        })
                      : t("cp.partner.partnerPrice")}
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
                        {t(errors.resalePrice.id, errors.resalePrice.values)}
                      </span>
                    ) : null}
                  </label>
                ) : (
                  <p className={`${styles.muted} ${styles.full}`}>
                    {t("partner.quote.new.referralNote")}
                  </p>
                )}
                {errors.offerName ? (
                  <span
                    className={`${styles.error} ${styles.full}`}
                    role="alert"
                  >
                    {t(errors.offerName.id, errors.offerName.values)}
                  </span>
                ) : null}
              </>
            ) : null}
            {stage === 2 ? (
              <QuoteLines
                lines={lines}
                offers={lineOffers}
                {...(offer ? { priceBookId: offer.priceBookId } : {})}
                onChange={updateLines}
              />
            ) : null}
            {lineError ? <p role="alert">{lineError}</p> : null}
            {stage === 3 ? (
              <div className={styles.full}>
                <ul className={styles.summaryList}>
                  {lines.map((line, index) => (
                    <li key={`line-${index}`}>
                      {t("partner.quote.new.extraLine", {
                        number: index + 2,
                        offer:
                          context.offers.find(
                            (item) => item.id === line.offerId,
                          )?.name ?? t("partner.quote.summary.chooseOffer"),
                        capacity: line.capacity
                          ? formatTerabytes(line.capacity, formattingLocale)
                          : "—",
                        term: months(line.termMonths),
                      })}
                    </li>
                  ))}
                  {summary.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <p className={styles.gate}>{t("cp.partner.boundary")}</p>
                <label className={styles.confirm}>
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(event) => setConfirmed(event.target.checked)}
                  />
                  <span>{t("partner.quote.new.confirmation")}</span>
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
                {t("common.back")}
              </Button>
            ) : null}
            {stage < 3 ? (
              <Button onClick={advance}>{t("common.continue")}</Button>
            ) : (
              <Button
                type="submit"
                disabled={!confirmed || succeeded}
                loading={pending}
                aria-describedby={submitReason ? "submit-reason" : undefined}
              >
                {t("partner.quote.new.submit")}
              </Button>
            )}
          </div>
          {submitReason ? (
            <p className={styles.muted} id="submit-reason">
              {t(submitReason)}
            </p>
          ) : null}
          {failure ? (
            <p className={styles.failure} role="alert">
              {t(failure)}
            </p>
          ) : null}
          {notice ? (
            <p className={styles.success} role="status">
              {submissionRef.current
                ? richText(t, "common.join.sentences", {
                    first: t(notice),
                    second: (
                      <Link
                        href={`/partner/quotes/quote-${submissionRef.current.quoteId}`}
                      >
                        {t("quotes.builder.createdLink")}
                      </Link>
                    ),
                  })
                : t(notice)}
            </p>
          ) : null}
        </form>

        <aside
          className={`${styles.summary} ${styles.sticky}`}
          aria-labelledby="quote-summary-title"
        >
          <h2 id="quote-summary-title">{t("cp.commercial.quoteSummary")}</h2>
          <ul className={styles.summaryList}>
            <li>
              {field(
                "partner.quote.summary.offer",
                draft.offerName || t("partner.quote.summary.notSelected"),
              )}
            </li>
            <li>
              {field(
                "common.region",
                offer?.region ?? t("partner.quote.summary.setByOffer"),
              )}
            </li>
            <li>
              {field(
                "partner.quote.summary.route",
                t("partner.quote.summary.routeValue", { route: routeLabel }),
              )}
            </li>
            <li>
              {field(
                "partner.quote.summary.endClient",
                draft.endClientName || t("partner.quote.summary.notSelected"),
              )}
            </li>
            <li>
              {field(
                "partner.quote.summary.firstLine",
                draft.capacity ||
                  (Number.isInteger(firstLineTerm) && firstLineTerm > 0)
                  ? t("partner.quote.summary.lineValue", {
                      capacity: draft.capacity
                        ? formatTerabytes(draft.capacity, formattingLocale)
                        : "—",
                      term: months(draft.termMonths),
                    })
                  : t("common.notRecorded"),
              )}
            </li>
            <li>
              {field(
                "cp.partner.partnerPrice",
                !partnerPriced
                  ? t("partner.quote.summary.notSetReferral")
                  : resaleAmount !== undefined && draft.resalePrice
                    ? resaleCurrency
                      ? new Intl.NumberFormat(formattingLocale, {
                          style: "currency",
                          currency: resaleCurrency,
                        }).format(resaleAmount)
                      : new Intl.NumberFormat(formattingLocale).format(
                          resaleAmount,
                        )
                    : t("partner.quote.summary.notSet"),
              )}
            </li>
            <li>
              {field(
                "cp.partner.transferPrice",
                t("partner.quote.summary.transferPending"),
              )}
            </li>
            <li>
              {field(
                "cp.partner.merchantOfRecord",
                merchantOfRecordName(context),
              )}
            </li>
            <li>
              {field(
                "partner.quote.summary.attribution",
                attributionStatement(
                  context.route,
                  context.partnerAccountName,
                  t,
                ),
              )}
            </li>
          </ul>
          {lines.length ? (
            <ul>
              {lines.map((line, index) => (
                <li key={index}>
                  {richText(t, "partner.labelled", {
                    label: (
                      <strong>
                        {t("partner.quote.summary.lineNumber", {
                          number: index + 2,
                        })}
                      </strong>
                    ),
                    value: t("partner.quote.summary.extraLineValue", {
                      sku:
                        context.offers.find((item) => item.id === line.offerId)
                          ?.sku ?? t("partner.quote.summary.chooseOffer"),
                      capacity: line.capacity
                        ? formatTerabytes(line.capacity, formattingLocale)
                        : "—",
                      term: months(line.termMonths),
                    }),
                  })}
                </li>
              ))}
            </ul>
          ) : null}
          <details className={styles.technical}>
            <summary>{t("common.technicalDetails")}</summary>
            <p>
              {field(
                "partner.technical.priceBookId",
                <code>
                  {offer?.priceBookId ?? t("partner.technical.unresolved")}
                </code>,
              )}
            </p>
            <p>
              {field(
                "partner.technical.rateCard",
                <code>
                  {offer
                    ? `${offer.sku}/${offer.region}`
                    : t("partner.technical.unresolved")}
                </code>,
              )}
            </p>
            <p>
              {field(
                "partner.technical.endClientId",
                <code>
                  {endClient?.id ?? t("partner.technical.unresolved")}
                </code>,
              )}
            </p>
            <p>
              {field(
                "partner.technical.partnerId",
                <code>{context.partnerAccountId}</code>,
              )}
            </p>
          </details>
        </aside>
      </div>
    </main>
  );
}
