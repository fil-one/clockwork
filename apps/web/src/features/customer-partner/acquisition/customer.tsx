"use client";
import { useFormattingLocale, useTranslations } from "@/src/i18n/client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type {
  CustomerAcquisitionOffer,
  CustomerAcquisitionRequest,
  CustomerAcquisitionView,
} from "@clockwork/domain/core";
import type { MessageId, Translator } from "@/src/i18n";
import {
  formatMoney,
  type SupportedCurrency,
} from "@/src/features/shared/format";
import { submitCustomerAcquisition } from "./actions";
import styles from "./customer.module.css";

/** An offer's amount in its own currency, with the reader's digits. */
function money(currency: string, minor: string, locale: string): string {
  return formatMoney(minor, currency as SupportedCurrency, locale);
}

/** Decimal terabytes when the value is whole terabytes, bytes otherwise. */
function bytes(value: string, locale: string): string {
  const n = BigInt(value);
  return n % 1_000_000_000_000n === 0n
    ? new Intl.NumberFormat(locale, {
        style: "unit",
        unit: "terabyte",
      }).format(n / 1_000_000_000_000n)
    : new Intl.NumberFormat(locale, {
        style: "unit",
        unit: "byte",
        unitDisplay: "long",
      }).format(n);
}

/** A calendar date from an ISO timestamp, as the UTC day it names. */
function day(value: string, locale: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return value;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(parsed);
}

/** A timestamp in UTC, labelled as UTC, because the terms are UTC-based. */
function utcTime(value: string, locale: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return value;
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(parsed);
}

export const requestKindLabels: Readonly<
  Record<CustomerAcquisitionRequest["kind"], MessageId>
> = {
  payg: "customer.payg.kind.payg",
  trial: "customer.payg.kind.trial",
  convert_to_payg: "customer.payg.kind.conversion",
  cancel_payg: "customer.payg.kind.cancellation",
};

/**
 * Who bills an enrollment. The codes name systems, so two of them are proper
 * names; the demo's code is a description and is worded for the reader.
 */
function billingAuthority(value: string | null, t: Translator): string {
  if (value === "fil_one") return "Fil One";
  if (value === "clockwork") return "Clockwork"; // i18n-exempt: the billing system's product name
  if (value === "fictional_demo")
    return t("customer.payg.billingAuthority.fictionalDemo");
  return value ?? t("common.notRecorded");
}

export function CustomerAcquisition({
  view,
  accountId,
  demo,
  available,
}: {
  view: CustomerAcquisitionView;
  accountId: string;
  demo: boolean;
  available: boolean;
}) {
  const t = useTranslations();
  const formattingLocale = useFormattingLocale();
  const router = useRouter();
  const [offerId, setOfferId] = useState(view.offers[0]?.id ?? "");
  const [organizationId, setOrganizationId] = useState(
    view.organizations.find((org) => org.canRequest)?.id ?? "",
  );
  const [mode, setMode] = useState<"payg" | "trial" | "convert_to_payg">(
    "payg",
  );
  const [trialId, setTrialId] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const [refreshingOffers, setRefreshingOffers] = useState(false);
  useEffect(() => setRefreshingOffers(false), [view.offers]);
  const offer = view.offers.find((row) => row.id === offerId);
  const org = view.organizations.find((row) => row.id === organizationId);
  useEffect(
    () => setAccepted(false),
    [offer?.fingerprint, offer?.rowVersion, organizationId, mode],
  );
  const pending = view.requests.some(
    (row) =>
      row.organizationId === organizationId &&
      row.status === "pending" &&
      row.kind !== "cancel_payg",
  );
  async function send(body: unknown, finishConversionReview = false) {
    setBusy(true);
    try {
      const result = await submitCustomerAcquisition(body);
      setMessage(result.message);
      setErrorCode(result.code ?? "");
      if (result.code === "ACQUISITION_OFFER_CHANGED") setAccepted(false);
      if (result.ok) {
        setAccepted(false);
        if (finishConversionReview) {
          setMode("payg");
          setTrialId("");
        }
        router.refresh();
      }
    } catch {
      setMessage(t("customer.payg.error.didNotComplete"));
    } finally {
      setBusy(false);
    }
  }
  function convert(request: CustomerAcquisitionRequest) {
    setOrganizationId(request.organizationId);
    setTrialId(request.result?.id ?? request.trialId ?? "");
    setMode("convert_to_payg");
    setAccepted(false);
    document.getElementById("acquisition-offer-heading")?.focus();
  }
  return (
    <main id="main-content" className={styles.main}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>{t("customer.payg.eyebrow")}</p>
          <h1>{t("customer.payg.title")}</h1>
          <p>{t("customer.payg.description")}</p>
        </div>
        <Link href="/buy">{t("customer.payg.buildQuote")}</Link>
      </header>
      {demo ? (
        <p className={styles.notice}>{t("customer.payg.demoNotice")}</p>
      ) : null}
      {!available ? (
        <p role="status" className={styles.notice}>
          {t("customer.payg.unavailable")}
        </p>
      ) : null}
      <section className={styles.panel} id="acquisition-offer">
        <h2 id="acquisition-offer-heading" tabIndex={-1}>
          {mode === "convert_to_payg"
            ? t("customer.payg.reviewConversion")
            : t("customer.payg.chooseOffer")}
        </h2>
        {!view.offers.length ? (
          <p>{t("customer.payg.noOffers")}</p>
        ) : (
          <>
            <div className={styles.fields}>
              <label>
                {t("customer.payg.offer")}
                <select
                  value={offerId}
                  disabled={busy}
                  onChange={(event) => {
                    setOfferId(event.target.value);
                    setAccepted(false);
                  }}
                >
                  {view.offers.map((item) => (
                    <option key={item.id} value={item.id}>
                      {t("customer.payg.offerOption", {
                        name: item.name,
                        region: item.region,
                        version: item.version,
                      })}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t("nav.group.organization")}
                <select
                  value={organizationId}
                  disabled={busy || mode === "convert_to_payg"}
                  onChange={(event) => {
                    setOrganizationId(event.target.value);
                    setAccepted(false);
                  }}
                >
                  <option value="" disabled>
                    {t("customer.payg.selectOrganization")}
                  </option>
                  {view.organizations.map((item) => (
                    <option
                      key={item.id}
                      value={item.id}
                      disabled={!item.canRequest}
                    >
                      {item.canRequest
                        ? item.name
                        : t("customer.payg.organizationNeedsOwner", {
                            organization: item.name,
                          })}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {offer ? (
              <>
                <div className={styles.pricing}>
                  <article>
                    <h3>{t("customer.payg.paygHeading")}</h3>
                    <strong>
                      {money(
                        offer.currency,
                        offer.storageTbMonthMinor,
                        formattingLocale,
                      )}
                    </strong>{" "}
                    <small>{t("customer.payg.perTbMonth")}</small>
                    <p>
                      {t("common.join.sentences", {
                        first: t("customer.payg.monthlyMinimum", {
                          amount: money(
                            offer.currency,
                            offer.monthlyMinimumMinor,
                            formattingLocale,
                          ),
                        }),
                        second: t(
                          offer.partialMonthMinimum === "full"
                            ? "customer.payg.partialMonth.full"
                            : "customer.payg.partialMonth.prorated",
                        ),
                      })}
                    </p>
                    <p>{t("customer.payg.metering")}</p>
                  </article>
                  <article>
                    <h3>{t("customer.payg.trialHeading")}</h3>
                    <strong>
                      {t("customer.payg.trialDays", {
                        count: offer.trial.durationDays,
                      })}
                    </strong>
                    <p>
                      {t("customer.payg.trialLimits", {
                        storage: bytes(
                          offer.trial.storageLimitBytes,
                          formattingLocale,
                        ),
                        egress: bytes(
                          offer.trial.cumulativeEgressLimitBytes,
                          formattingLocale,
                        ),
                      })}
                    </p>
                    <p>
                      {t("common.join.sentences", {
                        first: t("customer.payg.trialGrace", {
                          count: offer.trial.gracePeriodDays,
                        }),
                        second: t("customer.payg.conversionSeparate"),
                      })}
                    </p>
                  </article>
                </div>
                <div className={styles.notices}>
                  {/* Policy wording is typed by a pricing administrator in one
                      language; `dir="auto"` lays it out by its own script. */}
                  <p dir="auto">{offer.notices.serviceNotice}</p>
                  <p dir="auto">
                    {mode === "trial"
                      ? offer.notices.trialNotice
                      : offer.notices.cancellationNotice}
                  </p>
                  <p>
                    {org?.providerMapped
                      ? t("customer.payg.providerMapped")
                      : t("customer.payg.providerNotConfirmed")}
                  </p>
                </div>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!accepted || !org?.canRequest || busy || pending)
                      return;
                    void send(
                      {
                        id: crypto.randomUUID(),
                        accountId,
                        organizationId,
                        kind: mode,
                        offerVersionId: offer.id,
                        offerRowVersion: offer.rowVersion,
                        offerFingerprint: offer.fingerprint,
                        acceptedTerms: true,
                        ...(mode === "convert_to_payg" ? { trialId } : {}),
                      },
                      mode === "convert_to_payg",
                    );
                  }}
                >
                  <fieldset
                    disabled={
                      busy ||
                      refreshingOffers ||
                      !available ||
                      pending ||
                      !org?.canRequest
                    }
                  >
                    <legend>
                      {mode === "convert_to_payg"
                        ? t("customer.payg.conversionRequest")
                        : t("customer.payg.requestType")}
                    </legend>
                    {mode !== "convert_to_payg" ? (
                      <div className={styles.choices}>
                        <label>
                          <input
                            type="radio"
                            name="kind"
                            value="payg"
                            checked={mode === "payg"}
                            disabled={!offer.notices.paygRequestsEnabled}
                            onChange={() => {
                              setMode("payg");
                              setAccepted(false);
                            }}
                          />{" "}
                          {t("customer.payg.kind.payg")}
                        </label>
                        <label>
                          <input
                            type="radio"
                            name="kind"
                            value="trial"
                            checked={mode === "trial"}
                            disabled={!offer.notices.trialRequestsEnabled}
                            onChange={() => {
                              setMode("trial");
                              setAccepted(false);
                            }}
                          />{" "}
                          {t("customer.payg.trialRequest")}
                        </label>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setMode("payg");
                          setTrialId("");
                          setAccepted(false);
                        }}
                      >
                        {t("customer.payg.cancelConversionReview")}
                      </button>
                    )}
                    <DocumentLinks offer={offer} demo={demo} />
                    {demo ? <p>{t("customer.payg.demoAcceptance")}</p> : null}
                    <label className={styles.acceptance}>
                      <input
                        type="checkbox"
                        checked={accepted}
                        onChange={(event) => setAccepted(event.target.checked)}
                        required
                      />{" "}
                      <span>
                        {t(
                          demo
                            ? "customer.payg.consent.demo"
                            : "customer.payg.consent",
                          {
                            terms: offer.notices.terms.version,
                            retention: offer.notices.retention.version,
                          },
                        )}
                      </span>
                    </label>
                    <p>{t("customer.payg.submitEffect")}</p>
                    <button
                      className={styles.primary}
                      disabled={
                        !accepted ||
                        (mode === "trial"
                          ? !offer.notices.trialRequestsEnabled
                          : !offer.notices.paygRequestsEnabled)
                      }
                    >
                      {busy
                        ? t("customer.payg.submitting")
                        : mode === "trial"
                          ? t("customer.payg.submit.trial")
                          : mode === "convert_to_payg"
                            ? t("customer.payg.submit.conversion")
                            : t("customer.payg.submit.payg")}
                    </button>
                  </fieldset>
                </form>
                {pending ? (
                  <p role="status">{t("customer.payg.alreadyPending")}</p>
                ) : null}
              </>
            ) : null}
          </>
        )}
      </section>
      {message ? (
        <div className={styles.notice}>
          <p role="status">{message}</p>
          {errorCode === "ACQUISITION_OFFER_CHANGED" ? (
            <button
              type="button"
              disabled={refreshingOffers}
              onClick={() => {
                setAccepted(false);
                setRefreshingOffers(true);
                router.refresh();
              }}
            >
              {refreshingOffers
                ? t("customer.payg.refreshingOffers")
                : t("customer.payg.refreshOffers")}
            </button>
          ) : null}
        </div>
      ) : null}
      <section className={styles.panel}>
        <h2>{t("customer.payg.requests.title")}</h2>
        {!view.requests.length ? (
          <p>{t("customer.payg.requests.empty")}</p>
        ) : (
          view.requests.map((request) => (
            <article className={styles.request} key={request.id}>
              <div className={styles.requestHeading}>
                <h3>
                  {t("common.join.labels", {
                    first: t(requestKindLabels[request.kind]),
                    second: request.organizationName,
                  })}
                </h3>
                <span className={styles.status}>
                  {request.status === "pending"
                    ? t("customer.payg.status.pendingHandoff")
                    : request.status === "declined"
                      ? t("customer.payg.status.declined")
                      : t("customer.payg.status.linked")}
                </span>
              </div>
              <p>
                {t("customer.payg.request.summary", {
                  offer: request.offer.name,
                  version: request.offer.version,
                  region: request.offer.region,
                  time: utcTime(request.acceptedAt, formattingLocale),
                })}
              </p>
              {request.resolutionReason ? (
                <p dir="auto">{request.resolutionReason}</p>
              ) : null}
              {request.status === "pending" ? (
                <p>{t("customer.payg.request.financeReviewing")}</p>
              ) : null}
              {request.result ? (
                <>
                  <p>
                    {[
                      request.result.kind === "trial"
                        ? t("customer.payg.result.trial", {
                            start: day(
                              request.result.startsAt,
                              formattingLocale,
                            ),
                            end: request.result.endsAt
                              ? day(request.result.endsAt, formattingLocale)
                              : t("common.notRecorded"),
                          })
                        : t("customer.payg.result.payg", {
                            start: day(
                              request.result.startsAt,
                              formattingLocale,
                            ),
                            authority: billingAuthority(
                              request.result.billingAuthority,
                              t,
                            ),
                          }),
                      request.result.convertedAt
                        ? t("customer.payg.result.converted")
                        : null,
                      request.result.kind === "payg" && request.result.endsAt
                        ? t("customer.payg.result.serviceEnded", {
                            end: utcTime(
                              request.result.endsAt,
                              formattingLocale,
                            ),
                          })
                        : null,
                    ]
                      .filter((sentence): sentence is string =>
                        Boolean(sentence),
                      )
                      .reduce((first, second) =>
                        t("common.join.sentences", { first, second }),
                      )}
                  </p>
                  <p>{t("customer.payg.result.providerAccess")}</p>
                  {request.result.kind === "trial" &&
                  !request.result.convertedAt ? (
                    <button
                      disabled={
                        busy ||
                        view.requests.some(
                          (item) =>
                            item.organizationId === request.organizationId &&
                            item.status === "pending" &&
                            item.kind !== "cancel_payg",
                        ) ||
                        !view.offers.some(
                          (item) => item.notices.paygRequestsEnabled,
                        )
                      }
                      onClick={() => convert(request)}
                    >
                      {t("customer.payg.reviewPaygConversion")}
                    </button>
                  ) : null}
                  {request.result.kind === "payg" && !request.result.endsAt ? (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        const data = new FormData(event.currentTarget);
                        void send({
                          id: crypto.randomUUID(),
                          accountId,
                          organizationId: request.organizationId,
                          kind: "cancel_payg",
                          enrollmentId: request.result?.id,
                          reason:
                            typeof data.get("reason") === "string"
                              ? data.get("reason")
                              : "",
                        });
                      }}
                    >
                      <label>
                        {t("customer.payg.cancellationReason")}
                        <textarea
                          name="reason"
                          minLength={8}
                          maxLength={2000}
                          required
                          disabled={busy}
                        />
                      </label>
                      <p dir="auto">
                        {request.offer.notices.cancellationNotice}
                      </p>
                      <button
                        disabled={
                          busy ||
                          view.requests.some(
                            (item) =>
                              item.kind === "cancel_payg" &&
                              item.enrollmentId === request.result?.id &&
                              item.status === "pending",
                          )
                        }
                      >
                        {t("customer.payg.requestCancellation")}
                      </button>
                    </form>
                  ) : null}
                </>
              ) : null}
              <details>
                <summary>
                  {request.kind === "cancel_payg"
                    ? t("customer.payg.request.retainedReference")
                    : t("customer.payg.request.acceptedReference")}
                </summary>
                <DocumentLinks offer={request.offer} demo={demo} />
                <p>
                  {t("customer.payg.request.reference", { id: request.id })}
                </p>
                <p>
                  {t("customer.payg.request.fingerprint", {
                    fingerprint: request.offer.fingerprint,
                  })}
                </p>
              </details>
            </article>
          ))
        )}
      </section>
    </main>
  );
}
function DocumentLinks({
  offer,
  demo = false,
}: {
  offer: CustomerAcquisitionOffer;
  demo?: boolean;
}) {
  const t = useTranslations();
  return (
    <div className={styles.documents}>
      {(
        [
          ["terms", "customer.payg.document.terms", offer.notices.terms],
          [
            "retention",
            "customer.payg.document.retention",
            offer.notices.retention,
          ],
        ] as const
      ).map(([key, label, reference]) => (
        <div key={key}>
          {demo ? (
            <span>
              {t("customer.payg.document.fictionalVersion", {
                document: t(label),
                version: reference.version,
              })}
            </span>
          ) : (
            <a href={reference.uri} target="_blank" rel="noreferrer">
              {t("customer.payg.document.version", {
                document: t(label),
                version: reference.version,
              })}
            </a>
          )}
          <details>
            <summary>{t("customer.payg.document.evidence")}</summary>
            <p>{reference.documentId}</p>
            <p>{reference.uri}</p>
            <code>{reference.sha256}</code>
          </details>
        </div>
      ))}
    </div>
  );
}
