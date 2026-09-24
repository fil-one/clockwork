"use client";

import { useFormattingLocale, useTranslations } from "@/src/i18n/client";
import type { MessageId } from "@/src/i18n";

import Link from "next/link";
import { useRef, useState } from "react";

import { requestOffboarding } from "@/src/features/contracts/commerce-client";
import { sendProjectionAction } from "@/src/features/contracts/experience-client";

import { draftIsDirty } from "../draft-state";
import {
  LeaveDraftControl,
  useUnsavedChangesWarning,
} from "../unsaved-changes";
import styles from "./commercial.module.css";
import { commercialFailureText } from "./failure-message";

const reasons = [
  ["non_renewal", "customer.commercial.offboarding.reason.nonRenewal"],
  [
    "customer_request",
    "customer.commercial.offboarding.reason.customerRequest",
  ],
  ["material_breach", "customer.commercial.offboarding.reason.materialBreach"],
] as const satisfies readonly (readonly [string, MessageId])[];

const retrievalWindows = [30, 60, 90] as const;

/** The requested effective time as the reader typed it, in their locale. */
function effectiveTimeLabel(value: string, locale: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf())
    ? value
    : new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(parsed);
}

export interface OffboardableService {
  id: string;
  reference: string;
  name: string;
  label: string;
}

export function OffboardingWorkflow({
  account,
  services,
  selectedServiceId,
  demoProjection,
}: {
  account: { id: string; name: string };
  services: readonly OffboardableService[];
  selectedServiceId?: string;
  demoProjection?: {
    projectionId: string;
    recordKey: string;
    version: number;
  };
}) {
  const t = useTranslations();
  const locale = useFormattingLocale();
  const [reviewing, setReviewing] = useState(false);
  const [orderId, setOrderId] = useState(
    selectedServiceId ?? services[0]?.id ?? "",
  );
  const [reason, setReason] = useState("non_renewal");
  const [effectiveAt, setEffectiveAt] = useState("");
  const [retrievalDays, setRetrievalDays] = useState("30");
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [requested, setRequested] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [validationError, setValidationError] = useState<{
    id: string;
    message: MessageId;
  } | null>(null);
  const idempotencyKeyRef = useRef<string | null>(null);
  const selectedService = services.find((service) => service.id === orderId);

  /**
   * Armed once the request differs from the one the page opened with -- a
   * different service, a reason other than non-renewal, an effective date, a
   * retrieval window other than 30 days -- or the confirmation is ticked, and
   * the request has not been sent.
   *
   * `reviewing` is deliberately not part of this. Stepping into the review
   * panel is navigation inside the form, not an entry, and arming on it would
   * warn someone who has looked at the summary and typed nothing.
   */
  const [pristine] = useState(() => ({
    orderId: selectedServiceId ?? services[0]?.id ?? "",
    reason: "non_renewal",
    effectiveAt: "",
    retrievalDays: "30",
  }));
  const unsaved =
    (draftIsDirty({ orderId, reason, effectiveAt, retrievalDays }, pristine) ||
      confirmed) &&
    !requested;
  useUnsavedChangesWarning(unsaved);

  const submit = async () => {
    if (!selectedService) return;
    const invalid: { id: string; message: MessageId } | undefined = !effectiveAt
      ? {
          id: "effective-at",
          message: "customer.commercial.offboarding.validation.effectiveAt",
        }
      : !confirmed
        ? {
            id: "offboarding-confirmation",
            message: "customer.commercial.offboarding.validation.confirmation",
          }
        : undefined;
    if (invalid) {
      setValidationError(invalid);
      document.getElementById(invalid.id)?.focus();
      return;
    }
    setValidationError(null);
    setPending(true);
    setError("");
    try {
      idempotencyKeyRef.current ??= crypto.randomUUID();
      const request = {
        accountId: account.id,
        orderId,
        reason: reason as
          | "customer_request"
          | "non_renewal"
          | "partner_request"
          | "partner_default"
          | "material_breach",
        effectiveAt: new Date(effectiveAt).toISOString(),
        retrievalDays: Number(retrievalDays),
        partnerAccountId: null,
      };
      if (demoProjection)
        await sendProjectionAction(
          {
            audience: "customer",
            channel: "orders",
            accountId: account.id,
            recordKey: demoProjection.recordKey,
            projectionId: demoProjection.projectionId,
            action: "request_teardown",
            expectedVersion: demoProjection.version,
            payload: request,
          },
          { idempotencyKey: idempotencyKeyRef.current },
        );
      else
        await requestOffboarding(request, {
          idempotencyKey: idempotencyKeyRef.current,
        });
      setRequested(true);
      setMessage(t("customer.commercial.offboarding.requested"));
    } catch (caught) {
      setError(
        commercialFailureText(
          caught,
          t,
          "customer.commercial.offboarding.failed",
        ),
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <main className={styles.main} id="main-content">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>
            {t("customer.commercial.offboarding.eyebrow")}
          </p>
          <h1>{t("customer.commercial.offboarding.title")}</h1>
          <p className={styles.description}>
            {t("customer.commercial.offboarding.description")}
          </p>
        </div>
        <LeaveDraftControl
          armed={unsaved}
          className={styles.secondary ?? ""}
          discardClassName={styles.secondary ?? ""}
          href="/account"
          label={t("customer.commercial.offboarding.return")}
        />
      </header>

      {services.length === 0 ? (
        <section className={styles.state} role="status">
          <h2>{t("customer.commercial.offboarding.empty.title")}</h2>
          <p>{t("customer.commercial.offboarding.empty.description")}</p>
          <Link className={styles.secondary} href="/orders">
            {t("customer.commercial.offboarding.empty.action")}
          </Link>
        </section>
      ) : (
        <div className={styles.workflowGrid}>
          <section className={`${styles.panel} ${styles.workflow}`}>
            <div className={styles.formGrid}>
              <div className={`${styles.field} ${styles.spanTwo}`}>
                <label htmlFor="offboarding-service">
                  {t("customer.commercial.offboarding.service")}
                </label>
                <select
                  id="offboarding-service"
                  onChange={(event) => {
                    setOrderId(event.target.value);
                    setValidationError(null);
                    idempotencyKeyRef.current = null;
                  }}
                  value={orderId}
                >
                  {services.map((service) => (
                    <option value={service.id} key={service.id}>
                      {service.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className={styles.field}>
                <label htmlFor="offboarding-reason">
                  {t("customer.commercial.offboarding.reason")}
                </label>
                <select
                  id="offboarding-reason"
                  onChange={(event) => setReason(event.target.value)}
                  value={reason}
                >
                  {reasons.map(([value, label]) => (
                    <option key={value} value={value}>
                      {t(label)}
                    </option>
                  ))}
                </select>
              </div>
              <div className={styles.field}>
                <label htmlFor="retrieval-days">
                  {t("customer.commercial.offboarding.retrievalWindow")}
                </label>
                <select
                  id="retrieval-days"
                  onChange={(event) => setRetrievalDays(event.target.value)}
                  value={retrievalDays}
                >
                  {retrievalWindows.map((days) => (
                    <option key={days} value={String(days)}>
                      {t("customer.commercial.days", { count: days })}
                    </option>
                  ))}
                </select>
              </div>
              <div className={`${styles.field} ${styles.spanTwo}`}>
                <label htmlFor="effective-at">
                  {t("customer.commercial.offboarding.effectiveAt")}
                </label>
                <input
                  aria-describedby={
                    validationError?.id === "effective-at"
                      ? "offboarding-validation"
                      : undefined
                  }
                  aria-invalid={
                    validationError?.id === "effective-at" || undefined
                  }
                  id="effective-at"
                  onChange={(event) => {
                    setEffectiveAt(event.target.value);
                    setValidationError(null);
                    idempotencyKeyRef.current = null;
                  }}
                  required
                  type="datetime-local"
                  value={effectiveAt}
                />
              </div>
            </div>
            <button
              className={styles.secondary}
              onClick={() => setReviewing(true)}
              type="button"
            >
              {t("customer.commercial.offboarding.reviewAndConfirm")}
            </button>
          </section>

          <aside
            className={styles.summary}
            aria-labelledby="offboarding-review-title"
          >
            <div>
              <p className={styles.eyebrow}>
                {t("customer.commercial.offboarding.summaryEyebrow")}
              </p>
              <h2 id="offboarding-review-title">
                {t("customer.commercial.offboarding.reviewImpact")}
              </h2>
            </div>
            {reviewing ? (
              <>
                <ul className={styles.reviewList}>
                  <li>
                    <span>{t("customer.commercial.offboarding.service")}</span>
                    <strong>
                      {selectedService?.name ??
                        t("customer.commercial.accept.notSelected")}
                    </strong>
                  </li>
                  <li>
                    <span>
                      {t("customer.commercial.offboarding.effectiveAt")}
                    </span>
                    <strong>
                      {effectiveAt
                        ? effectiveTimeLabel(effectiveAt, locale)
                        : t("customer.commercial.accept.notSelected")}
                    </strong>
                  </li>
                  <li>
                    <span>
                      {t("customer.commercial.offboarding.retrievalWindow")}
                    </span>
                    <strong>
                      {t("customer.commercial.days", {
                        count: Number(retrievalDays),
                      })}
                    </strong>
                  </li>
                  <li>
                    <span>{t("customer.commercial.offboarding.approval")}</span>
                    <strong>
                      {t("customer.commercial.offboarding.approvalValue")}
                    </strong>
                  </li>
                </ul>
                <label
                  className={styles.check}
                  htmlFor="offboarding-confirmation"
                >
                  <input
                    aria-describedby={
                      validationError?.id === "offboarding-confirmation"
                        ? "offboarding-validation"
                        : undefined
                    }
                    aria-invalid={
                      validationError?.id === "offboarding-confirmation" ||
                      undefined
                    }
                    checked={confirmed}
                    id="offboarding-confirmation"
                    onChange={(event) => {
                      setConfirmed(event.target.checked);
                      setValidationError(null);
                    }}
                    type="checkbox"
                  />
                  <span>
                    {t("customer.commercial.offboarding.confirmation")}
                  </span>
                </label>
                {validationError ? (
                  <p
                    className={styles.errorMessage}
                    id="offboarding-validation"
                    role="alert"
                  >
                    {t(validationError.message)}
                  </p>
                ) : null}
                {message ? (
                  <p className={styles.successMessage} role="status">
                    {message}{" "}
                    {requested && selectedService ? (
                      <Link href={`/orders/${selectedService.reference}`}>
                        {t("customer.commercial.offboarding.requestedLink")}
                      </Link>
                    ) : null}
                  </p>
                ) : null}
                {error ? (
                  <p className={styles.errorMessage} role="alert">
                    {error}
                  </p>
                ) : null}
                <button
                  className={styles.primary}
                  disabled={pending || Boolean(message)}
                  onClick={() => {
                    void submit();
                  }}
                  type="button"
                >
                  {t(
                    pending
                      ? "customer.commercial.offboarding.submitting"
                      : "customer.commercial.offboarding.submit",
                  )}
                </button>
              </>
            ) : (
              <p className={styles.notice}>
                {t("customer.commercial.offboarding.prompt")}
              </p>
            )}
          </aside>
        </div>
      )}
    </main>
  );
}
