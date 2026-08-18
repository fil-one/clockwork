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
  recordKey: string;
  amountLabel: string;
  dueLabel: string;
  guidedDemo?: boolean;
}

interface DemoPaymentSession {
  readonly provider: "demo_sandbox";
  readonly sessionId: string;
  readonly invoiceId: string;
  readonly status: "requires_customer_action" | "paid";
  readonly paymentAttemptId: string;
  readonly receiptId: string | null;
  readonly completedAt: string | null;
}

function cookieValue(name: string): string | undefined {
  return document.cookie
    .split(";")
    .map((part) => part.trim().split("="))
    .find(([key]) => key === name)?.[1];
}

async function demoPaymentMutation(
  path: string,
  idempotencyKey: string,
  body?: Readonly<Record<string, string>>,
): Promise<DemoPaymentSession> {
  const csrf = cookieValue("clockwork-csrf");
  if (!csrf || csrf.length < 32)
    throw new Error(
      "The secure form token is unavailable. Refresh the page and try again.",
    );
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      "idempotency-key": idempotencyKey,
      "x-csrf-token": csrf,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = (await response.json()) as {
    detail?: unknown;
    provider?: unknown;
    sessionId?: unknown;
    invoiceId?: unknown;
    status?: unknown;
    paymentAttemptId?: unknown;
    receiptId?: unknown;
    completedAt?: unknown;
  };
  if (!response.ok)
    throw new Error(
      typeof payload.detail === "string"
        ? payload.detail
        : "The demo sandbox payment could not be recorded.",
    );
  if (
    payload.provider !== "demo_sandbox" ||
    typeof payload.sessionId !== "string" ||
    typeof payload.invoiceId !== "string" ||
    (payload.status !== "requires_customer_action" &&
      payload.status !== "paid") ||
    typeof payload.paymentAttemptId !== "string" ||
    (payload.receiptId !== null && typeof payload.receiptId !== "string") ||
    (payload.completedAt !== null && typeof payload.completedAt !== "string")
  )
    throw new Error("The demo sandbox returned an invalid payment record.");
  return payload as DemoPaymentSession;
}

export function PaymentHandoff({
  accountId,
  invoiceId,
  recordKey,
  amountLabel,
  dueLabel,
  guidedDemo = false,
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
  const [demoSession, setDemoSession] = useState<DemoPaymentSession | null>(
    null,
  );
  const idempotencyKeyRef = useRef<string | null>(null);
  const completionKeyRef = useRef<string | null>(null);

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
      if (guidedDemo) {
        const session = await demoPaymentMutation(
          "/api/demo/payments/sessions",
          idempotencyKeyRef.current,
          { accountId, invoiceId },
        );
        if (session.invoiceId !== invoiceId)
          throw new Error("The demo sandbox returned a different invoice.");
        setDemoSession(session);
        return;
      }
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

  const completeDemoPayment = async () => {
    if (!demoSession || demoSession.status !== "requires_customer_action")
      return;
    setPending(true);
    setError("");
    try {
      completionKeyRef.current ??= crypto.randomUUID();
      const completed = await demoPaymentMutation(
        `/api/demo/payments/sessions/${encodeURIComponent(demoSession.sessionId)}/complete`,
        completionKeyRef.current,
      );
      if (
        completed.invoiceId !== invoiceId ||
        completed.sessionId !== demoSession.sessionId ||
        completed.status !== "paid" ||
        !completed.receiptId
      )
        throw new Error("The demo sandbox returned an invalid paid record.");
      setDemoSession(completed);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The demo sandbox payment could not be completed.",
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <section className={styles.summary} aria-labelledby="payment-title">
      <div>
        <p className={styles.eyebrow}>
          {guidedDemo ? "Guided demo · payment sandbox" : "Provider handoff"}
        </p>
        <h2 id="payment-title">
          {guidedDemo ? "Try the payment flow" : "Review payment"}
        </h2>
      </div>
      <dl>
        <div>
          <dt>{customerPartnerCopy.commercial.invoiceTruth}</dt>
          <dd>{amountLabel}</dd>
        </div>
        <div>
          <dt>{customerPartnerCopy.commercial.paymentTruth}</dt>
          <dd>
            {guidedDemo
              ? demoSession?.status === "paid"
                ? "Paid in demo sandbox"
                : "No real payment attempted"
              : "Awaiting provider confirmation"}
          </dd>
        </div>
        <div>
          <dt>Payment due</dt>
          <dd>{dueLabel}</dd>
        </div>
      </dl>
      <p className={styles.notice}>
        {guidedDemo
          ? "This guided sandbox never contacts Stripe, a bank, or a card network. Completing it changes only resettable demo records; no money moves."
          : customerPartnerCopy.commercial.externalPayment}
      </p>
      <label className={styles.check} htmlFor="payment-confirmation">
        <input
          checked={confirmed}
          id="payment-confirmation"
          onChange={(event) => setConfirmed(event.target.checked)}
          type="checkbox"
        />
        <span>
          {guidedDemo
            ? "I reviewed the invoice amount and understand this is a demo-only payment simulation."
            : "I reviewed the invoice amount and understand payment continues with the provider."}
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
      {guidedDemo && demoSession?.status === "requires_customer_action" ? (
        <div className={styles.stack} aria-label="Demo payment sandbox">
          <p className={styles.notice} role="status">
            Sandbox checkout is ready. Complete it to create one resettable
            payment attempt and receipt. No external provider is involved.
          </p>
          <button
            className={styles.primary}
            disabled={pending}
            onClick={() => void completeDemoPayment()}
            type="button"
          >
            {pending ? "Completing…" : "Complete demo payment"}
          </button>
        </div>
      ) : guidedDemo && demoSession?.status === "paid" ? (
        <div className={styles.stack}>
          <p className={styles.successMessage} role="status">
            Demo payment complete. Receipt {demoSession.receiptId} is stored in
            resettable demo state. No money moved.
          </p>
          <a className={styles.primary} href={`/billing/${recordKey}`}>
            Return to paid invoice
          </a>
        </div>
      ) : providerUrl ? (
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
          {pending
            ? "Preparing…"
            : guidedDemo
              ? "Start demo sandbox checkout"
              : "Prepare secure payment"}
        </button>
      )}
      <p className={styles.muted}>
        {guidedDemo
          ? "Reset demo data to remove the sandbox payment, receipt, and paid invoice state."
          : `${customerPartnerCopy.commercial.paymentWebhook}. Returning from the provider does not mark the invoice paid.`}
      </p>
    </section>
  );
}
