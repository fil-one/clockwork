"use client";

import { useRef, useState } from "react";

import { createInvoicePaymentSession } from "@/src/features/contracts/commerce-client";
import { trustedStripePaymentUrl } from "@/src/features/contracts/provider-navigation";

import { customerPartnerCopy } from "../copy";
import styles from "./commercial.module.css";

export function PaymentHandoff() {
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [providerUrl, setProviderUrl] = useState("");
  const [error, setError] = useState("");
  const idempotencyKeyRef = useRef<string | null>(null);

  const prepare = async () => {
    if (!confirmed) {
      document.getElementById("payment-confirmation")?.focus();
      return;
    }
    setPending(true);
    setError("");
    try {
      idempotencyKeyRef.current ??= crypto.randomUUID();
      const session = await createInvoicePaymentSession(
        {
          accountId: "11111111-1111-4111-8111-111111111111",
          invoiceId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        },
        { idempotencyKey: idempotencyKeyRef.current },
      );
      setProviderUrl(trustedStripePaymentUrl(session.url));
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "A secure payment session could not be created.",
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <section className={styles.summary} aria-labelledby="payment-title">
      <div>
        <p className={styles.eyebrow}>Provider handoff</p>
        <h2 id="payment-title">Review payment</h2>
      </div>
      <dl>
        <div>
          <dt>{customerPartnerCopy.commercial.invoiceTruth}</dt>
          <dd>$15,400.00</dd>
        </div>
        <div>
          <dt>{customerPartnerCopy.commercial.paymentTruth}</dt>
          <dd>Awaiting provider confirmation</dd>
        </div>
        <div>
          <dt>Payment due</dt>
          <dd>Aug 8, 2026</dd>
        </div>
      </dl>
      <p className={styles.notice}>
        {customerPartnerCopy.commercial.externalPayment}
      </p>
      <label className={styles.check} htmlFor="payment-confirmation">
        <input
          checked={confirmed}
          id="payment-confirmation"
          onChange={(event) => setConfirmed(event.target.checked)}
          type="checkbox"
        />
        <span>
          I reviewed the invoice amount and understand payment continues with
          the provider.
        </span>
      </label>
      {error ? (
        <p className={styles.errorMessage} role="alert">
          {error}
        </p>
      ) : null}
      {providerUrl ? (
        <a className={styles.primary} href={providerUrl} rel="noreferrer">
          Continue to secure Stripe payment
        </a>
      ) : (
        <button
          className={styles.primary}
          disabled={pending}
          onClick={() => {
            void prepare();
          }}
          type="button"
        >
          {pending ? "Preparing…" : "Prepare secure payment"}
        </button>
      )}
      <p className={styles.muted}>
        {customerPartnerCopy.commercial.paymentWebhook}. Returning from the
        provider does not mark the invoice paid.
      </p>
    </section>
  );
}
