"use client";
import { useFormattingLocale, useTranslations } from "@/src/i18n/client";

import Link from "next/link";
import { useRef, useState } from "react";

import { uuidV7 } from "@clockwork/contracts";
import { CapacityMeter } from "@clockwork/ui";

import {
  CommerceApiError,
  sendCoreCommand,
} from "@/src/features/contracts/commerce-client";
import { formatMoney } from "@/src/features/shared/format";

import { commercialArtifactRetainUntil } from "./artifact-retention";
import {
  buildBuyQuoteCommand,
  buyCapacity,
  createdRowVersion,
  initialBuyDraft,
  needsFullQuote,
  quoteHandoff,
  requiresPricingReview,
  SELF_SERVE_CAPACITY_CEILING_TB,
  SELF_SERVE_TERM_MONTHS,
  serverPrice,
  type BuyDraft,
  type ServerPrice,
} from "./buy-model";
import styles from "./buy.module.css";
import { CommercialStop, commercialFailureText } from "./failure-message";
import {
  preparedArtifactRequestId,
  readPreparedQuoteArtifact,
  readBuyQuoteProjection,
} from "./quote-issuance-client";
import type { QuoteOfferOption } from "./workflow-model";

export type BuyMode = "authoritative" | "demo";

type BuyPhase = "configure" | "working" | "pricing_review" | "ready" | "error";

const defaultPollAttempts = 15;
const defaultPollIntervalMs = 1_000;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

/** "100 TB" (fr "100 To", ar "100 تيرابايت"), as Intl writes it. */
function terabytes(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: "terabyte",
    maximumFractionDigits: 3,
  }).format(value);
}

function pricingException(error: unknown): boolean {
  return (
    error instanceof CommerceApiError &&
    error.status === 422 &&
    /pricing exception|margin/i.test(error.message)
  );
}

export function SelfServeBuy({
  account,
  offers,
  thresholdTb = SELF_SERVE_CAPACITY_CEILING_TB,
  pollAttempts = defaultPollAttempts,
  pollIntervalMs = defaultPollIntervalMs,
}: {
  account: { id: string; name: string };
  catalogueMode: "authoritative" | "simulated";
  mode: BuyMode;
  offers: readonly QuoteOfferOption[];
  thresholdTb?: number;
  pollAttempts?: number;
  pollIntervalMs?: number;
}) {
  const t = useTranslations();
  const formattingLocale = useFormattingLocale();
  const [draft, setDraft] = useState<BuyDraft>(() => initialBuyDraft(offers));
  const [phase, setPhase] = useState<BuyPhase>("configure");
  const [message, setMessage] = useState("");
  const [price, setPrice] = useState<ServerPrice | null>(null);
  const quoteIdRef = useRef<string | null>(null);
  const createKeyRef = useRef<string | null>(null);
  const prepareKeyRef = useRef<string | null>(null);
  const issueKeyRef = useRef<string | null>(null);
  const issuedAtRef = useRef<string | null>(null);
  const commandRef = useRef<ReturnType<typeof buildBuyQuoteCommand> | null>(
    null,
  );

  const capacity = buyCapacity(draft);
  const fullQuote = needsFullQuote(draft, thresholdTb);
  const quoteId = quoteIdRef.current;

  const resetRun = () => {
    quoteIdRef.current = null;
    createKeyRef.current = null;
    prepareKeyRef.current = null;
    issueKeyRef.current = null;
    issuedAtRef.current = null;
    commandRef.current = null;
    setPhase("configure");
    setMessage("");
    setPrice(null);
  };

  const update = (field: keyof BuyDraft, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    resetRun();
  };

  const waitForArtifact = async (
    quoteIdValue: string,
    artifactRequestId: string,
  ) => {
    for (let attempt = 0; attempt < pollAttempts; attempt += 1) {
      const result = await readPreparedQuoteArtifact({
        artifactRequestId,
        quoteId: quoteIdValue,
        accountId: account.id,
      }).catch(() => null);
      if (!result) {
        if (attempt + 1 < pollAttempts) await delay(pollIntervalMs);
        continue;
      }
      if (result.status === "stored") return result;
      if (result.status === "forbidden")
        throw new CommercialStop(
          "customer.commercial.buy.error.sessionCannotPrepare",
        );
      if (result.status === "unavailable")
        throw new CommercialStop(
          "customer.commercial.buy.error.documentUnconfirmed",
        );
      if (attempt + 1 < pollAttempts) await delay(pollIntervalMs);
    }
    throw new CommercialStop("customer.commercial.buy.error.stillRendering");
  };

  const waitForIssuedProjection = async (quoteIdValue: string) => {
    for (let attempt = 0; attempt < pollAttempts; attempt += 1) {
      const result = await readBuyQuoteProjection({
        quoteId: quoteIdValue,
        accountId: account.id,
      }).catch(() => null);
      if (!result) {
        if (attempt + 1 < pollAttempts) await delay(pollIntervalMs);
        continue;
      }
      if (result.status === "found" && result.quoteStatus === "issued")
        return result;
      if (result.status === "forbidden")
        throw new CommercialStop(
          "customer.commercial.buy.error.sessionCannotRead",
        );
      if (result.status === "unavailable")
        throw new CommercialStop(
          "customer.commercial.buy.error.ledgerUnconfirmed",
        );
      if (attempt + 1 < pollAttempts) await delay(pollIntervalMs);
    }
    throw new CommercialStop("customer.commercial.buy.error.notInLedgerYet");
  };

  const run = async () => {
    setPhase("working");
    setMessage("");
    try {
      quoteIdRef.current ??= uuidV7();
      commandRef.current ??= buildBuyQuoteCommand({
        draft,
        account: { id: account.id, label: account.name },
        offers,
        quoteId: quoteIdRef.current,
        now: new Date(),
        thresholdTb,
      });
      createKeyRef.current ??= crypto.randomUUID();
      const created = await sendCoreCommand(commandRef.current, {
        idempotencyKey: createKeyRef.current,
      });
      setPrice(serverPrice(created));
      const rowVersion = createdRowVersion(created);
      if (requiresPricingReview(created)) {
        setPhase("pricing_review");
        setMessage(t("customer.commercial.buy.pricingReview"));
        return;
      }
      issuedAtRef.current ??= new Date().toISOString();
      prepareKeyRef.current ??= crypto.randomUUID();
      const prepared = await sendCoreCommand(
        {
          resource: "quotes",
          id: quoteIdRef.current,
          accountId: account.id,
          action: "prepare_artifact",
          expectedVersion: rowVersion,
          payload: {
            audience: "end_client",
            issuedAt: issuedAtRef.current,
            retainUntil: commercialArtifactRetainUntil(issuedAtRef.current),
          },
        },
        { idempotencyKey: prepareKeyRef.current },
      );
      const artifactRequestId = preparedArtifactRequestId(prepared);
      if (!artifactRequestId)
        throw new CommercialStop(
          "customer.commercial.buy.error.requestUnverified",
        );
      const artifact = await waitForArtifact(
        quoteIdRef.current,
        artifactRequestId,
      );
      issueKeyRef.current ??= crypto.randomUUID();
      try {
        await sendCoreCommand(
          {
            resource: "quotes",
            id: quoteIdRef.current,
            accountId: account.id,
            action: "issue",
            expectedVersion: rowVersion,
            payload: {
              artifactIssuedAt: issuedAtRef.current,
              renderedDocumentId: artifact.documentId,
            },
          },
          { idempotencyKey: issueKeyRef.current },
        );
      } catch (error) {
        if (pricingException(error)) {
          setPhase("pricing_review");
          setMessage(t("customer.commercial.buy.pricingReview"));
          return;
        }
        throw error;
      }
      await waitForIssuedProjection(quoteIdRef.current);
      setPhase("ready");
      setMessage(t("customer.commercial.buy.ready"));
    } catch (error) {
      setPhase("error");
      setMessage(
        commercialFailureText(error, t, "customer.commercial.buy.error.failed"),
      );
    }
  };

  return (
    <main className={styles.main} id="main-content">
      <header className={styles.header}>
        <p className={styles.context}>{t("customer.commercial.buy.context")}</p>
        <h1>{t("customer.commercial.buy.title")}</h1>
        <p>
          {t("customer.commercial.buy.description", {
            count: SELF_SERVE_TERM_MONTHS,
          })}
        </p>
        <p>
          <Link className={styles.alternateOffer} href="/buy/payg">
            {t("customer.commercial.buy.paygLink")}
          </Link>
        </p>
      </header>

      <ol
        aria-label={t("customer.commercial.buy.stepsLabel")}
        className={styles.steps}
      >
        <li aria-current={phase === "configure" ? "step" : undefined}>
          {t("customer.commercial.buy.step.configure")}
        </li>
        <li aria-current={phase === "working" ? "step" : undefined}>
          {t("customer.commercial.buy.step.price")}
        </li>
        <li aria-current={phase === "ready" ? "step" : undefined}>
          {t("customer.commercial.buy.step.accept")}
        </li>
      </ol>

      <div className={styles.layout}>
        <section aria-labelledby="buy-configure" className={styles.panel}>
          <h2 id="buy-configure">
            {t("customer.commercial.buy.configureTitle")}
          </h2>
          <div className={styles.fields}>
            <label>
              {t("customer.commercial.builder.offer")}
              <select
                disabled={phase === "working"}
                onChange={(event) => update("offerId", event.target.value)}
                value={draft.offerId}
              >
                {offers.map((offer) => (
                  <option key={offer.id} value={offer.id}>
                    {offer.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("customer.commercial.builder.label.capacity")}
              <input
                disabled={phase === "working"}
                inputMode="decimal"
                min="10"
                onChange={(event) => update("capacity", event.target.value)}
                type="number"
                value={draft.capacity}
              />
            </label>
          </div>
          {offers.length === 0 ? (
            <p className={styles.error} role="alert">
              {t("customer.commercial.builder.noOffers")}
            </p>
          ) : null}
          <CapacityMeter
            label={t("customer.commercial.buy.meterLabel")}
            max={150}
            threshold={thresholdTb}
            thresholdLabel={t("customer.commercial.buy.meterThreshold", {
              threshold: terabytes(thresholdTb, formattingLocale),
            })}
            value={capacity ?? 0}
            valueLabel={
              capacity === null
                ? t("customer.commercial.builder.notSet")
                : terabytes(capacity, formattingLocale)
            }
          />
          <p className={styles.rule}>
            {t("customer.commercial.buy.routingRule", {
              threshold: terabytes(thresholdTb, formattingLocale),
            })}
          </p>
          <dl className={styles.terms}>
            <div>
              <dt>{t("customer.commercial.builder.legend.route")}</dt>
              <dd>{t("customer.commercial.buy.routeValue")}</dd>
            </div>
            <div>
              <dt>{t("customer.commercial.buy.term")}</dt>
              <dd>
                {t("customer.commercial.buy.termValue", {
                  count: SELF_SERVE_TERM_MONTHS,
                })}
              </dd>
            </div>
          </dl>

          {price ? (
            <p className={styles.price}>
              <span>{t("customer.commercial.buy.priceLabel")}</span>
              <strong>
                {t("customer.commercial.buy.priceValue", {
                  amount: formatMoney(
                    price.totalMinor,
                    price.currency,
                    formattingLocale,
                  ),
                  count: SELF_SERVE_TERM_MONTHS,
                })}
              </strong>
            </p>
          ) : null}

          {message ? (
            <p
              className={phase === "error" ? styles.error : styles.status}
              role={phase === "error" ? "alert" : "status"}
            >
              {message}
            </p>
          ) : null}

          <div className={styles.actions}>
            {fullQuote ? (
              <Link className={styles.primary} href={quoteHandoff(draft)}>
                {t("customer.commercial.buy.continueInQuote")}
              </Link>
            ) : phase === "ready" && quoteId ? (
              <Link
                className={styles.primary}
                href={`/orders/accept?quote=quote-${quoteId}`}
              >
                {t("customer.commercial.detail.step.acceptOrder")}
              </Link>
            ) : phase === "pricing_review" && quoteId ? (
              <Link
                className={styles.primary}
                href={`/quotes/quote-${quoteId}`}
              >
                {t("customer.commercial.buy.openDraft")}
              </Link>
            ) : (
              <button
                className={styles.primary}
                disabled={
                  offers.length === 0 ||
                  capacity === null ||
                  phase === "working"
                }
                onClick={() => void run()}
                type="button"
              >
                {t(
                  phase === "working"
                    ? "customer.commercial.buy.working"
                    : phase === "error"
                      ? "customer.commercial.buy.tryAgain"
                      : "customer.commercial.buy.submit",
                )}
              </button>
            )}
          </div>
        </section>

        <aside aria-labelledby="buy-boundary" className={styles.boundary}>
          <h2 id="buy-boundary">{t("customer.commercial.buy.nextTitle")}</h2>
          <p>{t("customer.commercial.buy.nextOrder")}</p>
          <p>{t("customer.commercial.buy.nextReview")}</p>
        </aside>
      </div>
    </main>
  );
}
