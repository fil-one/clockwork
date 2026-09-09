"use client";
import { useTranslations } from "@/src/i18n/client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type {
  CustomerAcquisitionOffer,
  CustomerAcquisitionRequest,
  CustomerAcquisitionView,
} from "@clockwork/domain/core";
import { submitCustomerAcquisition } from "./actions";
import styles from "./customer.module.css";
function money(currency: string, minor: string) {
  const n = BigInt(minor);
  return `${currency} ${n / 100n}.${(n % 100n).toString().padStart(2, "0")}`;
}
function bytes(value: string) {
  const n = BigInt(value);
  return n % 1_000_000_000_000n === 0n
    ? `${n / 1_000_000_000_000n} TB`
    : `${n.toLocaleString()} bytes`;
}
const kindName = {
  payg: "PAYG activation",
  trial: "Trial",
  convert_to_payg: "Trial conversion",
  cancel_payg: "Cancellation",
};
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
      setMessage(
        "The request did not complete. Refresh to check its status before retrying.",
      );
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
          <p className={styles.eyebrow}>Storage on your terms</p>
          <h1>{t("nav.internal.paygOffers")}</h1>
          <p>
            Review no-term usage pricing, request a trial, and follow your
            service handoff.
          </p>
        </div>
        <Link href="/buy">Need a committed term? Build a quote</Link>
      </header>
      {demo ? (
        <p className={styles.notice}>
          Fictional demo. Requests and handoffs stay in resettable demo state.
          No provider tenant is provisioned and no payment is collected.
        </p>
      ) : null}
      {!available ? (
        <p role="status" className={styles.notice}>
          The service request workspace is unavailable. No changes have been
          made. Try again later.
        </p>
      ) : null}
      <section className={styles.panel} id="acquisition-offer">
        <h2 id="acquisition-offer-heading" tabIndex={-1}>
          {mode === "convert_to_payg"
            ? "Review paid conversion"
            : "Choose your offer"}
        </h2>
        {!view.offers.length ? (
          <p>
            No approved, effective offer with customer terms is accepting
            requests right now. Your account team can help you with the next
            available offer.
          </p>
        ) : (
          <>
            <div className={styles.fields}>
              <label>
                Offer
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
                      {item.name} · {item.region} · v{item.version}
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
                    Select your organization
                  </option>
                  {view.organizations.map((item) => (
                    <option
                      key={item.id}
                      value={item.id}
                      disabled={!item.canRequest}
                    >
                      {item.name}
                      {item.canRequest ? "" : " · owner/admin required"}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {offer ? (
              <>
                <div className={styles.pricing}>
                  <article>
                    <h3>Pay as you go</h3>
                    <strong>
                      {money(offer.currency, offer.storageTbMonthMinor)}
                      <small> / TB-month</small>
                    </strong>
                    <p>
                      {money(offer.currency, offer.monthlyMinimumMinor)} monthly
                      minimum.{" "}
                      {offer.partialMonthMinimum === "full"
                        ? "Full minimum in partial months."
                        : "Minimum prorated by service hours in partial months."}
                    </p>
                    <p>
                      Hourly storage measurements averaged by UTC day. Decimal
                      TB. Egress and API operations have no usage charge in this
                      offer.
                    </p>
                  </article>
                  <article>
                    <h3>Trial</h3>
                    <strong>{offer.trial.durationDays} days</strong>
                    <p>
                      {bytes(offer.trial.storageLimitBytes)} storage ·{" "}
                      {bytes(offer.trial.cumulativeEgressLimitBytes)} lifetime
                      trial egress.
                    </p>
                    <p>
                      {offer.trial.gracePeriodDays} days of read-only grace
                      after expiry. Paid conversion requires a separate
                      acceptance and confirmed service record.
                    </p>
                  </article>
                </div>
                <div className={styles.notices}>
                  <p>{offer.notices.serviceNotice}</p>
                  <p>
                    {mode === "trial"
                      ? offer.notices.trialNotice
                      : offer.notices.cancellationNotice}
                  </p>
                  <p>
                    {org?.providerMapped
                      ? "An organization mapping is on file. Activation still requires verified provider and billing handoff."
                      : "Provider setup has not been confirmed. You can submit a request and track the handoff here."}
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
                        ? "Paid conversion request"
                        : "Request type"}
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
                          PAYG activation
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
                          Trial request
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
                        Cancel conversion review
                      </button>
                    )}
                    <DocumentLinks offer={offer} demo={demo} />
                    {demo ? (
                      <p>
                        This fictional acceptance is only a product
                        demonstration: no service contract, charge, provider
                        access, or retention commitment is created. The
                        references below are fictional evidence fixtures.
                      </p>
                    ) : null}
                    <label className={styles.acceptance}>
                      <input
                        type="checkbox"
                        checked={accepted}
                        onChange={(event) => setAccepted(event.target.checked)}
                        required
                      />{" "}
                      <span>{`I have read and agree to the ${demo ? "fictional displayed" : "linked"} terms (version ${offer.notices.terms.version}) and retention policy (version ${offer.notices.retention.version}), and authorize this request for my organization.`}</span>
                    </label>
                    <p>
                      Submitting records your acceptance and starts a handoff
                      request. It does not create provider credentials, start
                      billing, or confirm access.
                    </p>
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
                        ? "Submitting…"
                        : mode === "trial"
                          ? "Accept terms and request trial"
                          : mode === "convert_to_payg"
                            ? "Accept paid terms and request conversion"
                            : "Accept terms and request PAYG"}
                    </button>
                  </fieldset>
                </form>
                {pending ? (
                  <p role="status">
                    An activation or trial request is already pending for this
                    organization. Its status appears below.
                  </p>
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
              {refreshingOffers ? "Refreshing offers…" : "Refresh offers"}
            </button>
          ) : null}
        </div>
      ) : null}
      <section className={styles.panel}>
        <h2>Your service requests</h2>
        {!view.requests.length ? (
          <p>
            No service requests yet. Submitted terms and handoff updates will be
            retained here.
          </p>
        ) : (
          view.requests.map((request) => (
            <article className={styles.request} key={request.id}>
              <div className={styles.requestHeading}>
                <h3>
                  {kindName[request.kind]} · {request.organizationName}
                </h3>
                <span className={styles.status}>
                  {request.status === "pending"
                    ? "Pending verified handoff"
                    : request.status === "declined"
                      ? "Declined"
                      : "Service record linked"}
                </span>
              </div>
              <p>
                {request.offer.name} v{request.offer.version} ·{" "}
                {request.offer.region} · Requested{" "}
                {new Date(request.acceptedAt).toLocaleString("en-US", {
                  timeZone: "UTC",
                })}{" "}
                UTC
              </p>
              {request.resolutionReason ? (
                <p>{request.resolutionReason}</p>
              ) : null}
              {request.status === "pending" ? (
                <p>
                  Finance is reviewing eligibility, provider mapping and the
                  applicable billing handoff. No activation is implied by this
                  request.
                </p>
              ) : null}
              {request.result ? (
                <>
                  <p>
                    {request.result.kind === "trial"
                      ? `Trial recorded from ${request.result.startsAt.slice(0, 10)} to ${request.result.endsAt?.slice(0, 10)}.`
                      : `PAYG enrollment recorded from ${request.result.startsAt.slice(0, 10)}. Billing authority: ${request.result.billingAuthority}.`}
                    {request.result.convertedAt
                      ? " Trial conversion confirmed."
                      : ""}
                    {request.result.kind === "payg" && request.result.endsAt
                      ? ` Service end confirmed: ${request.result.endsAt}.`
                      : ""}
                  </p>
                  <p>
                    Provider access and credentials are managed by the verified
                    provider handoff, separately from this record.
                  </p>
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
                      Review PAYG conversion
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
                        Cancellation reason
                        <textarea
                          name="reason"
                          minLength={8}
                          maxLength={2000}
                          required
                          disabled={busy}
                        />
                      </label>
                      <p>{request.offer.notices.cancellationNotice}</p>
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
                        Request cancellation
                      </button>
                    </form>
                  ) : null}
                </>
              ) : null}
              <details>
                <summary>
                  {request.kind === "cancel_payg"
                    ? "Retained policy and request reference"
                    : "Accepted terms and request reference"}
                </summary>
                <DocumentLinks offer={request.offer} demo={demo} />
                <p>Request {request.id}</p>
                <p>Offer evidence fingerprint {request.offer.fingerprint}</p>
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
  return (
    <div className={styles.documents}>
      {(
        [
          ["Terms", offer.notices.terms],
          ["Retention policy", offer.notices.retention],
        ] as const
      ).map(([label, reference]) => (
        <div key={label}>
          {demo ? (
            <span>
              {label} · fictional version {reference.version}
            </span>
          ) : (
            <a href={reference.uri} target="_blank" rel="noreferrer">
              {label} · version {reference.version}
            </a>
          )}
          <details>
            <summary>Document evidence</summary>
            <p>{reference.documentId}</p>
            <p>{reference.uri}</p>
            <code>{reference.sha256}</code>
          </details>
        </div>
      ))}
    </div>
  );
}
