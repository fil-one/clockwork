"use client";

import { useRef, useState } from "react";

import {
  CommerceApiError,
  createInvoicePaymentSession,
} from "@/src/features/contracts/commerce-client";
import { trustedStripePaymentUrl } from "@/src/features/contracts/provider-navigation";

import { customerPartnerCopy } from "../copy";
import styles from "./commercial.module.css";

/**
 * The invoice this handoff is for. Every value comes from the record the route
 * loaded: the amount and due date the reader is asked to confirm have to be the
 * ones the payment session is opened against, or the confirmation means
 * nothing.
 */
export interface PayableInvoice {
  accountId: string;
  invoiceId: string;
  amountLabel: string;
  dueLabel: string;
}

export function PaymentHandoff({
  accountId,
  invoiceId,
  amountLabel,
  dueLabel,
}: PayableInvoice) {
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [providerUrl, setProviderUrl] = useState("");
  const [error, setError] = useState("");
  /**
   * Set when the server refused on purpose rather than failed.
   *
   * The demo declines checkout with `DEMO_PAYMENT_UNAVAILABLE`, because moving
   * money in a prospect's browser would be worse than saying no. That refusal
   * arrived here as a 503 and was rendered in the alert style with the sentence
   * "The commerce service is unavailable." -- so the one place the demo is most
   * deliberately honest read as the product being broken. A scripted boundary
   * is not an error: it keeps the reader's own copy, drops the alert role, and
   * withdraws the retry, because pressing the button again cannot change it.
   */
  const [boundary, setBoundary] = useState("");
  const idempotencyKeyRef = useRef<string | null>(null);

  const prepare = async () => {
    if (!confirmed) {
      document.getElementById("payment-confirmation")?.focus();
      return;
    }
    setPending(true);
    setError("");
    setBoundary("");
    try {
      idempotencyKeyRef.current ??= crypto.randomUUID();
      const session = await createInvoicePaymentSession(
        { accountId, invoiceId },
        { idempotencyKey: idempotencyKeyRef.current },
      );
      setProviderUrl(trustedStripePaymentUrl(session.url));
    } catch (caught) {
      if (
        caught instanceof CommerceApiError &&
        caught.problemCode === "DEMO_PAYMENT_UNAVAILABLE"
      ) {
        setBoundary(caught.message);
        return;
      }
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
          <dd>{amountLabel}</dd>
        </div>
        <div>
          <dt>{customerPartnerCopy.commercial.paymentTruth}</dt>
          <dd>Awaiting provider confirmation</dd>
        </div>
        <div>
          <dt>Payment due</dt>
          <dd>{dueLabel}</dd>
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
      {boundary ? (
        <p className={styles.notice} role="status">
          Payment is where this workspace stops. {boundary} On the live platform
          this control opens a Stripe checkout session, and the invoice is
          marked paid only by the provider webhook that follows.
        </p>
      ) : null}
      {providerUrl ? (
        <a className={styles.primary} href={providerUrl} rel="noreferrer">
          Continue to secure Stripe payment
        </a>
      ) : boundary ? null : (
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
