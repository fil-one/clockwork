"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";

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
  const idempotencyKeyRef = useRef<string | null>(null);
  const orderIdRef = useRef<string | null>(null);
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
      ? "po-number"
      : !serviceStart
        ? "service-start"
        : !authorityTitle.trim()
          ? "order-authority-title"
          : !confirmed
            ? "order-confirmation"
            : undefined;
    if (invalid) {
      document.getElementById(invalid)?.focus();
      return;
    }
    setPending(true);
    setMessage("");
    setError("");
    try {
      idempotencyKeyRef.current ??= crypto.randomUUID();
      orderIdRef.current ??= crypto.randomUUID();
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
            acceptedAt: new Date().toISOString(),
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
    <main className={styles.main} id="main-content">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Order acceptance</p>
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

      <div className={styles.workflowGrid}>
        <section className={`${styles.panel} ${styles.workflow}`}>
          <div>
            <p className={styles.eyebrow}>Accepted quote</p>
            <h2>Compliance replica renewal · version 2</h2>
            <p className={styles.description}>
              Accepted Jul 25 by Maya Chen · 120 TB · US East · 12 months
            </p>
          </div>
          <div className={styles.formGrid}>
            <div className={styles.field}>
              <label htmlFor="po-number">Purchase order</label>
              <input
                id="po-number"
                onChange={(event) => setPoNumber(event.target.value)}
                required
                value={poNumber}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="service-start">Service start</label>
              <input
                id="service-start"
                onChange={(event) => setServiceStart(event.target.value)}
                required
                type="date"
                value={serviceStart}
              />
            </div>
            <div className={`${styles.field} ${styles.spanTwo}`}>
              <label htmlFor="order-authority-title">Authority title</label>
              <input
                id="order-authority-title"
                onChange={(event) => setAuthorityTitle(event.target.value)}
                required
                value={authorityTitle}
              />
            </div>
          </div>
          <p className={styles.notice}>
            Estimated spend is a quote calculation. Invoices and payments remain
            separate server records after this order is created.
          </p>
        </section>

        <aside className={styles.summary} aria-labelledby="order-summary-title">
          <div>
            <p className={styles.eyebrow}>Resulting commitment</p>
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
              checked={confirmed}
              id="order-confirmation"
              onChange={(event) => setConfirmed(event.target.checked)}
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
            onClick={() => {
              void accept();
            }}
            type="button"
          >
            {pending ? "Accepting…" : "Accept order and create commitment"}
          </button>
        </aside>
      </div>
    </main>
  );
}
