"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";

import { uuidV7 } from "@clockwork/contracts";

import { sendCoreCommand } from "@/src/features/contracts/commerce-client";

import { customerPartnerCopy } from "../copy";
import styles from "./commercial.module.css";
import { orderReviewSummary } from "./workflow-model";

const orderIds = {
  account: "11111111-1111-4111-8111-111111111111",
  quote: "88888888-8888-4888-8888-888888888888",
  agreement: "99999999-9999-4999-8999-999999999999",
  user: "66666666-6666-4666-8666-666666666666",
  orderForm: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  orderLine: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
} as const;

const reviewLabels = {
  quote: "Accepted quote",
  agreement: "Governing agreement",
  purchaseOrder: "Purchase order",
  serviceStart: "Service start",
  commitment: "Resulting commitment",
} as const;

export function OrderAcceptance() {
  const [poNumber, setPoNumber] = useState("PO-NA-1092");
  const [serviceStart, setServiceStart] = useState("2026-08-15");
  const [authorityTitle, setAuthorityTitle] = useState(
    "Chief Operating Officer",
  );
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [validationError, setValidationError] = useState<{
    id: string;
    message: string;
  } | null>(null);
  const idempotencyKeyRef = useRef<string | null>(null);
  const orderIdRef = useRef<string | null>(null);
  const acceptedAtRef = useRef<string | null>(null);
  const summary = useMemo(
    () =>
      orderReviewSummary({
        agreementTitle: "Cloud Service Agreement",
        agreementVersion: "3.2",
        capacity: "120 TB in US East",
        poNumber,
        quoteTitle: "Compliance replica renewal",
        quoteVersion: "2",
        serviceStart,
        spend: "$55,440.00",
      }),
    [poNumber, serviceStart],
  );

  const accept = async () => {
    const invalid = !poNumber.trim()
      ? { id: "po-number", message: "Enter the purchase order reference." }
      : !serviceStart
        ? { id: "service-start", message: "Choose the service start date." }
        : !authorityTitle.trim()
          ? {
              id: "order-authority-title",
              message: "Enter the title that holds acceptance authority.",
            }
          : !confirmed
            ? {
                id: "order-confirmation",
                message: "Confirm the reviewed commitment before accepting.",
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
      await sendCoreCommand(
        {
          resource: "orders",
          id: orderIdRef.current,
          accountId: orderIds.account,
          action: "create",
          payload: {
            quoteId: orderIds.quote,
            agreementId: orderIds.agreement,
            signerUserId: orderIds.user,
            authorityTitle,
            authorityAttested: true,
            poNumber,
            acceptedAt: acceptedAtRef.current,
            serviceStartsOn: serviceStart,
            orderFormDocumentId: orderIds.orderForm,
            orderLineIds: [orderIds.orderLine],
          },
        },
        { idempotencyKey: idempotencyKeyRef.current },
      );
      setMessage(
        "The server created the order. Its current commitment and provisioning state are now authoritative.",
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The order could not be accepted. Nothing was changed.",
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

      <ol aria-label="Commercial promise chain" className={styles.promiseChain}>
        <li>
          <span>Authoritative input</span>
          <strong>Accepted quote · version 2</strong>
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
            <h2>Compliance replica renewal · version 2</h2>
            <p className={styles.description}>
              Accepted Jul 25 by Maya Chen · 120 TB · US East · 12 months
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
                    setValidationError(null);
                    idempotencyKeyRef.current = null;
                    orderIdRef.current = null;
                    acceptedAtRef.current = null;
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
                    setValidationError(null);
                    idempotencyKeyRef.current = null;
                    orderIdRef.current = null;
                    acceptedAtRef.current = null;
                  }}
                  required
                  type="date"
                  value={serviceStart}
                />
              </div>
              <div className={`${styles.field} ${styles.spanTwo}`}>
                <label htmlFor="order-authority-title">Authority title</label>
                <input
                  aria-describedby={
                    validationError?.id === "order-authority-title"
                      ? "order-validation"
                      : undefined
                  }
                  aria-invalid={
                    validationError?.id === "order-authority-title" || undefined
                  }
                  id="order-authority-title"
                  onChange={(event) => {
                    setAuthorityTitle(event.target.value);
                    setValidationError(null);
                    idempotencyKeyRef.current = null;
                    orderIdRef.current = null;
                    acceptedAtRef.current = null;
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
            Estimated spend is a quote calculation. Invoices and payments remain
            separate server records after this order is created.
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
            {Object.entries(summary).map(([label, value]) => (
              <li key={label}>
                <span>{reviewLabels[label as keyof typeof reviewLabels]}</span>
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
            type="submit"
          >
            {pending ? "Accepting…" : "Accept order and create commitment"}
          </button>
        </aside>
      </form>
    </main>
  );
}
