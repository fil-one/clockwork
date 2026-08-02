"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";

import { uuidV7 } from "@clockwork/contracts";

import { sendCoreCommand } from "@/src/features/contracts/commerce-client";
import { t } from "@/src/i18n/en";

import { customerPartnerCopy } from "../copy";
import styles from "./commercial.module.css";
import { orderReviewSummary } from "./workflow-model";

const reviewLabels = {
  quote: "Accepted quote",
  agreement: "Governing agreement",
  purchaseOrder: "Purchase order",
  serviceStart: "Service start",
  commitment: "Resulting commitment",
} as const;

const ARTIFACT_RETENTION_YEARS = 7;

export interface AcceptableQuote {
  id: string;
  reference: string;
  title: string;
  version: string;
  scope: string;
  spend: string;
  acceptedLabel: string;
}

export interface GoverningAgreement {
  title: string;
  version: string;
}

function retainUntil(acceptedAt: string): string {
  const retention = new Date(acceptedAt);
  retention.setUTCFullYear(
    retention.getUTCFullYear() + ARTIFACT_RETENTION_YEARS,
  );
  return retention.toISOString();
}

export function OrderAcceptance({
  account,
  signerUserId,
  quote,
  agreement,
  orderFormDocumentId,
}: {
  account: { id: string; name: string };
  signerUserId: string;
  quote: AcceptableQuote | null;
  agreement: GoverningAgreement | null;
  orderFormDocumentId: string | null;
}) {
  const [poNumber, setPoNumber] = useState("");
  const [serviceStart, setServiceStart] = useState("");
  const [authorityTitle, setAuthorityTitle] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [createdOrderId, setCreatedOrderId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [validationError, setValidationError] = useState<{
    id: string;
    message: string;
  } | null>(null);
  const idempotencyKeyRef = useRef<string | null>(null);
  const orderIdRef = useRef<string | null>(null);
  const acceptedAtRef = useRef<string | null>(null);
  const orderLineIdsRef = useRef<readonly string[] | null>(null);
  const summary = useMemo(
    () =>
      quote
        ? orderReviewSummary({
            agreementTitle:
              agreement?.title ?? t("orders.accept.agreement.unknown"),
            agreementVersion: agreement?.version ?? "Not recorded",
            scope: quote.scope,
            poNumber,
            quoteTitle: quote.title,
            quoteVersion: quote.version,
            serviceStart,
            spend: quote.spend,
          })
        : null,
    [agreement, poNumber, quote, serviceStart],
  );

  const resetSubmission = () => {
    setValidationError(null);
    idempotencyKeyRef.current = null;
    orderIdRef.current = null;
    acceptedAtRef.current = null;
    orderLineIdsRef.current = null;
  };

  const accept = async () => {
    if (!quote) return;
    const invalid = !poNumber.trim()
      ? { id: "po-number", message: t("orders.accept.validation.po") }
      : !serviceStart
        ? {
            id: "service-start",
            message: t("orders.accept.validation.serviceStart"),
          }
        : !authorityTitle.trim()
          ? {
              id: "order-authority-title",
              message: t("orders.accept.validation.authority"),
            }
          : !confirmed
            ? {
                id: "order-confirmation",
                message: t("orders.accept.validation.confirmation"),
              }
            : undefined;
    if (invalid) {
      setValidationError(invalid);
      document.getElementById(invalid.id)?.focus();
      return;
    }
    setValidationError(null);
    setPending(true);
    setMessage("");
    setError("");
    try {
      idempotencyKeyRef.current ??= crypto.randomUUID();
      orderIdRef.current ??= uuidV7();
      acceptedAtRef.current ??= new Date().toISOString();
      orderLineIdsRef.current ??= [uuidV7()];
      const command = {
        quoteId: quote.id,
        signerUserId,
        authorityTitle,
        authorityAttested: true,
        poNumber,
        acceptedAt: acceptedAtRef.current,
        serviceStartsOn: serviceStart,
        orderLineIds: orderLineIdsRef.current,
      };
      await sendCoreCommand(
        {
          resource: "orders",
          id: orderIdRef.current,
          accountId: account.id,
          // The order form is bound evidence: acceptance can only be recorded
          // once it exists, so a first pass asks the server to render it.
          action: orderFormDocumentId ? "create" : "prepare_artifact",
          payload: orderFormDocumentId
            ? { ...command, orderFormDocumentId }
            : { ...command, retainUntil: retainUntil(acceptedAtRef.current) },
        },
        { idempotencyKey: idempotencyKeyRef.current },
      );
      setCreatedOrderId(orderFormDocumentId ? orderIdRef.current : "");
      setMessage(
        orderFormDocumentId
          ? t("orders.accept.created")
          : t("orders.accept.prepared"),
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : t("orders.accept.failed"),
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
          <p className={styles.taskContext}>
            Binding acceptance · creates a commitment
          </p>
          <h1>{customerPartnerCopy.commercial.orderReview}</h1>
          <p className={styles.description}>
            This legal and financial confirmation creates the resulting service
            commitment from an accepted quote.
          </p>
        </div>
        <Link className={styles.secondary} href="/orders">
          Return to orders
        </Link>
      </header>

      {quote ? (
        <>
          <ol
            aria-label="Commercial promise chain"
            className={styles.promiseChain}
          >
            <li>
              <span>Authoritative input</span>
              <strong>
                {t("orders.accept.source", {
                  reference: quote.reference,
                  version: quote.version,
                })}
              </strong>
            </li>
            <li aria-current="step">
              <span>Current decision</span>
              <strong>Order authority and service start</strong>
            </li>
            <li>
              <span>Created on acceptance</span>
              <strong>Service commitment and provisioning state</strong>
            </li>
          </ol>

          <form
            className={styles.workflowGrid}
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void accept();
            }}
          >
            <section
              className={`${styles.panel} ${styles.workflow} ${styles.taskPanel}`}
            >
              <div>
                <p className={styles.taskContext}>Accepted commercial source</p>
                <h2>
                  {quote.title} · version {quote.version}
                </h2>
                <p className={styles.description}>
                  {quote.acceptedLabel} · {quote.scope}
                </p>
              </div>
              <fieldset className={styles.stageFields}>
                <legend>Acceptance inputs</legend>
                <div className={styles.formGrid}>
                  <div className={styles.field}>
                    <label htmlFor="po-number">Purchase order</label>
                    <input
                      aria-describedby={
                        validationError?.id === "po-number"
                          ? "order-validation"
                          : undefined
                      }
                      aria-invalid={
                        validationError?.id === "po-number" || undefined
                      }
                      id="po-number"
                      onChange={(event) => {
                        setPoNumber(event.target.value);
                        resetSubmission();
                      }}
                      required
                      value={poNumber}
                    />
                  </div>
                  <div className={styles.field}>
                    <label htmlFor="service-start">Service start</label>
                    <input
                      aria-describedby={
                        validationError?.id === "service-start"
                          ? "order-validation"
                          : undefined
                      }
                      aria-invalid={
                        validationError?.id === "service-start" || undefined
                      }
                      id="service-start"
                      onChange={(event) => {
                        setServiceStart(event.target.value);
                        resetSubmission();
                      }}
                      required
                      type="date"
                      value={serviceStart}
                    />
                  </div>
                  <div className={`${styles.field} ${styles.spanTwo}`}>
                    <label htmlFor="order-authority-title">
                      Authority title
                    </label>
                    <input
                      aria-describedby={
                        validationError?.id === "order-authority-title"
                          ? "order-validation"
                          : undefined
                      }
                      aria-invalid={
                        validationError?.id === "order-authority-title" ||
                        undefined
                      }
                      id="order-authority-title"
                      onChange={(event) => {
                        setAuthorityTitle(event.target.value);
                        resetSubmission();
                      }}
                      required
                      value={authorityTitle}
                    />
                  </div>
                </div>
              </fieldset>
              {validationError ? (
                <p
                  className={styles.errorMessage}
                  id="order-validation"
                  role="alert"
                >
                  {validationError.message}
                </p>
              ) : null}
              <p className={styles.notice}>
                Estimated spend is a quote calculation. Invoices and payments
                remain separate server records after this order is created.
              </p>
            </section>

            <aside
              className={`${styles.summary} ${styles.commitmentSummary}`}
              aria-labelledby="order-summary-title"
            >
              <div>
                <p className={styles.taskContext}>Resulting commitment</p>
                <h2 id="order-summary-title">Review before accepting</h2>
              </div>
              <ul className={styles.reviewList}>
                {Object.entries(summary ?? {}).map(([label, value]) => (
                  <li key={label}>
                    <span>
                      {reviewLabels[label as keyof typeof reviewLabels]}
                    </span>
                    <strong>{value}</strong>
                  </li>
                ))}
              </ul>
              <label className={styles.check} htmlFor="order-confirmation">
                <input
                  aria-describedby={
                    validationError?.id === "order-confirmation"
                      ? "order-validation"
                      : undefined
                  }
                  aria-invalid={
                    validationError?.id === "order-confirmation" || undefined
                  }
                  checked={confirmed}
                  id="order-confirmation"
                  onChange={(event) => {
                    setConfirmed(event.target.checked);
                    setValidationError(null);
                  }}
                  required
                  type="checkbox"
                />
                <span>{customerPartnerCopy.commercial.orderConfirmation}</span>
              </label>
              {message ? (
                <p className={styles.successMessage} role="status">
                  {message}{" "}
                  {createdOrderId ? (
                    <Link href={`/orders/order-${createdOrderId}`}>
                      {t("orders.accept.createdLink")}
                    </Link>
                  ) : (
                    <Link href="/orders">
                      {t("orders.accept.preparedLink")}
                    </Link>
                  )}
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
                type="submit"
              >
                {pending ? "Accepting…" : "Accept order and create commitment"}
              </button>
            </aside>
          </form>
        </>
      ) : (
        <section className={styles.state} role="alert">
          <h2>{t("orders.accept.unavailable.title")}</h2>
          <p>{t("orders.accept.unavailable.description")}</p>
          <Link className={styles.secondary} href="/quotes">
            {t("orders.accept.unavailable.action")}
          </Link>
        </section>
      )}
    </main>
  );
}
