"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import { requestOffboarding } from "@/src/features/contracts/commerce-client";

import { customerPartnerCopy } from "../copy";
import styles from "./commercial.module.css";

export function OffboardingWorkflow() {
  const [reviewing, setReviewing] = useState(false);
  const [orderId, setOrderId] = useState(
    "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  );
  const [reason, setReason] = useState("non_renewal");
  const [effectiveAt, setEffectiveAt] = useState("2026-12-31T23:59");
  const [retrievalDays, setRetrievalDays] = useState("30");
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const idempotencyKeyRef = useRef<string | null>(null);

  const submit = async () => {
    if (!confirmed) {
      document.getElementById("offboarding-confirmation")?.focus();
      return;
    }
    setPending(true);
    setError("");
    try {
      idempotencyKeyRef.current ??= crypto.randomUUID();
      await requestOffboarding(
        {
          accountId: "11111111-1111-4111-8111-111111111111",
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
        },
        { idempotencyKey: idempotencyKeyRef.current },
      );
      setMessage(
        "The server recorded the offboarding request for controlled approval. Service has not been torn down.",
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The offboarding request could not be submitted.",
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
        <Link className={styles.secondary} href="/account">
          Return to account
        </Link>
      </header>

      <div className={styles.workflowGrid}>
        <section className={`${styles.panel} ${styles.workflow}`}>
          <div className={styles.formGrid}>
            <div className={`${styles.field} ${styles.spanTwo}`}>
              <label htmlFor="offboarding-service">Service</label>
              <select
                id="offboarding-service"
                onChange={(event) => setOrderId(event.target.value)}
                value={orderId}
              >
                <option value="cccccccc-cccc-4ccc-8ccc-cccccccccccc">
                  Northstar primary archive · 500 TB · ends Dec 31, 2026
                </option>
                <option value="cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd">
                  Madrid compliance replica · 120 TB · ends Jul 31, 2027
                </option>
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
                id="effective-at"
                onChange={(event) => setEffectiveAt(event.target.value)}
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
                  <strong>Northstar primary archive</strong>
                </li>
                <li>
                  <span>Requested effective time</span>
                  <strong>{effectiveAt}</strong>
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
                  checked={confirmed}
                  id="offboarding-confirmation"
                  onChange={(event) => setConfirmed(event.target.checked)}
                  type="checkbox"
                />
                <span>
                  I reviewed the term, retrieval window, retention safeguards,
                  and approval requirement.
                </span>
              </label>
              {message ? (
                <p className={styles.successMessage} role="status">
                  {message}
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
              Select the service, reason, effective time, and retrieval window,
              then open the final confirmation.
            </p>
          )}
        </aside>
      </div>
    </main>
  );
}
