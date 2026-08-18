"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import { requestOffboarding } from "@/src/features/contracts/commerce-client";
import { sendProjectionAction } from "@/src/features/contracts/experience-client";
import { t } from "@/src/i18n/en";

import { customerPartnerCopy } from "../copy";
import { draftIsDirty } from "../draft-state";
import {
  LeaveDraftControl,
  useUnsavedChangesWarning,
} from "../unsaved-changes";
import styles from "./commercial.module.css";

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
    message: string;
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
    const invalid = !effectiveAt
      ? {
          id: "effective-at",
          message: t("account.offboarding.validation.effectiveAt"),
        }
      : !confirmed
        ? {
            id: "offboarding-confirmation",
            message: t("account.offboarding.validation.confirmation"),
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
      setMessage(t("account.offboarding.requested"));
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : t("account.offboarding.failed"),
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <main className={styles.main} id="main-content">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Controlled offboarding</p>
          <h1>Review service offboarding</h1>
          <p className={styles.description}>
            Offboarding is a controlled request with retention, retrieval, and
            two-person approval safeguards. It never tears down service
            immediately.
          </p>
        </div>
        <LeaveDraftControl
          armed={unsaved}
          className={styles.secondary ?? ""}
          discardClassName={styles.secondary ?? ""}
          href="/account"
          label="Return to account"
        />
      </header>

      {services.length === 0 ? (
        <section className={styles.state} role="status">
          <h2>{t("account.offboarding.empty.title")}</h2>
          <p>{t("account.offboarding.empty.description")}</p>
          <Link className={styles.secondary} href="/orders">
            {t("account.offboarding.empty.action")}
          </Link>
        </section>
      ) : (
        <div className={styles.workflowGrid}>
          <section className={`${styles.panel} ${styles.workflow}`}>
            <div className={styles.formGrid}>
              <div className={`${styles.field} ${styles.spanTwo}`}>
                <label htmlFor="offboarding-service">
                  {t("account.offboarding.service")}
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
                <label htmlFor="offboarding-reason">Reason</label>
                <select
                  id="offboarding-reason"
                  onChange={(event) => setReason(event.target.value)}
                  value={reason}
                >
                  <option value="non_renewal">Non-renewal</option>
                  <option value="customer_request">Customer request</option>
                  <option value="material_breach">Material breach</option>
                </select>
              </div>
              <div className={styles.field}>
                <label htmlFor="retrieval-days">Retrieval window</label>
                <select
                  id="retrieval-days"
                  onChange={(event) => setRetrievalDays(event.target.value)}
                  value={retrievalDays}
                >
                  <option value="30">30 days</option>
                  <option value="60">60 days</option>
                  <option value="90">90 days</option>
                </select>
              </div>
              <div className={`${styles.field} ${styles.spanTwo}`}>
                <label htmlFor="effective-at">Requested effective time</label>
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
              {customerPartnerCopy.commercial.confirmMutation}
            </button>
          </section>

          <aside
            className={styles.summary}
            aria-labelledby="offboarding-review-title"
          >
            <div>
              <p className={styles.eyebrow}>Safeguarded request</p>
              <h2 id="offboarding-review-title">Review impact</h2>
            </div>
            {reviewing ? (
              <>
                <ul className={styles.reviewList}>
                  <li>
                    <span>Service</span>
                    <strong>{selectedService?.name ?? "Not selected"}</strong>
                  </li>
                  <li>
                    <span>Requested effective time</span>
                    <strong>{effectiveAt || "Not selected"}</strong>
                  </li>
                  <li>
                    <span>Retrieval window</span>
                    <strong>{retrievalDays} days</strong>
                  </li>
                  <li>
                    <span>Approval</span>
                    <strong>Two distinct approvers required</strong>
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
                    I reviewed the term, retrieval window, retention safeguards,
                    and approval requirement.
                  </span>
                </label>
                {validationError ? (
                  <p
                    className={styles.errorMessage}
                    id="offboarding-validation"
                    role="alert"
                  >
                    {validationError.message}
                  </p>
                ) : null}
                {message ? (
                  <p className={styles.successMessage} role="status">
                    {message}{" "}
                    {requested && selectedService ? (
                      <Link href={`/orders/${selectedService.reference}`}>
                        {t("account.offboarding.requestedLink")}
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
                  {pending
                    ? "Submitting…"
                    : "Submit controlled offboarding request"}
                </button>
              </>
            ) : (
              <p className={styles.notice}>
                Select the service, reason, effective time, and retrieval
                window, then open the final confirmation.
              </p>
            )}
          </aside>
        </div>
      )}
    </main>
  );
}
