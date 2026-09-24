"use client";
import { useTranslations } from "@/src/i18n/client";

import { useRef, useState } from "react";

import {
  CommerceApiError,
  createInvoicePaymentSession,
} from "@/src/features/contracts/commerce-client";
import { trustedStripePaymentUrl } from "@/src/features/contracts/provider-navigation";

import styles from "./commercial.module.css";
import { CommercialStop, commercialFailureText } from "./failure-message";

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
    throw new CommercialStop("customer.commercial.payment.error.csrf");
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
  // The sandbox's own problem detail is English written for integrators; the
  // reader is told what did not happen.
  if (!response.ok)
    throw new CommercialStop(
      "customer.commercial.payment.error.demoNotRecorded",
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
    throw new CommercialStop("customer.commercial.payment.error.demoInvalid");
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
  const t = useTranslations();
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
   * The boundary is a fact; the page says it in the reader's language.
   */
  const [boundary, setBoundary] = useState(false);
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
    setBoundary(false);
    try {
      idempotencyKeyRef.current ??= crypto.randomUUID();
      if (guidedDemo) {
        const session = await demoPaymentMutation(
          "/api/demo/payments/sessions",
          idempotencyKeyRef.current,
          { accountId, invoiceId },
        );
        if (session.invoiceId !== invoiceId)
          throw new CommercialStop(
            "customer.commercial.payment.error.demoWrongInvoice",
          );
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
        setBoundary(true);
        return;
      }
      setError(
        commercialFailureText(
          caught,
          t,
          "customer.commercial.payment.error.sessionFailed",
        ),
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
        throw new CommercialStop(
          "customer.commercial.payment.error.demoInvalidPaid",
        );
      setDemoSession(completed);
    } catch (caught) {
      setError(
        commercialFailureText(
          caught,
          t,
          "customer.commercial.payment.error.demoNotCompleted",
        ),
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <section className={styles.summary} aria-labelledby="payment-title">
      <div>
        <p className={styles.eyebrow}>
          {t(
            guidedDemo
              ? "customer.commercial.payment.eyebrow.demo"
              : "customer.commercial.payment.eyebrow.live",
          )}
        </p>
        <h2 id="payment-title">
          {t(
            guidedDemo
              ? "customer.commercial.payment.title.demo"
              : "customer.commercial.payment.title.live",
          )}
        </h2>
      </div>
      <dl>
        <div>
          <dt>{t("customer.commercial.valueLabel.invoicedAmount")}</dt>
          <dd>{amountLabel}</dd>
        </div>
        <div>
          <dt>{t("customer.commercial.payment.status")}</dt>
          <dd>
            {t(
              guidedDemo
                ? demoSession?.status === "paid"
                  ? "customer.commercial.payment.status.demoPaid"
                  : "customer.commercial.payment.status.demoNone"
                : "customer.commercial.payment.status.awaitingProvider",
            )}
          </dd>
        </div>
        <div>
          <dt>{t("customer.commercial.payment.due")}</dt>
          <dd>{dueLabel}</dd>
        </div>
      </dl>
      <p className={styles.notice}>
        {t(
          guidedDemo
            ? "customer.commercial.payment.notice.demo"
            : "customer.commercial.payment.notice.live",
        )}
      </p>
      <label className={styles.check} htmlFor="payment-confirmation">
        <input
          checked={confirmed}
          id="payment-confirmation"
          onChange={(event) => setConfirmed(event.target.checked)}
          type="checkbox"
        />
        <span>
          {t(
            guidedDemo
              ? "customer.commercial.payment.confirm.demo"
              : "customer.commercial.payment.confirm.live",
          )}
        </span>
      </label>
      {error ? (
        <p className={styles.errorMessage} role="alert">
          {error}
        </p>
      ) : null}
      {boundary ? (
        <p className={styles.notice} role="status">
          {t("customer.commercial.payment.boundary")}
        </p>
      ) : null}
      {guidedDemo && demoSession?.status === "requires_customer_action" ? (
        <div
          className={styles.stack}
          aria-label={t("customer.commercial.payment.sandboxLabel")}
        >
          <p className={styles.notice} role="status">
            {t("customer.commercial.payment.sandboxReady")}
          </p>
          <button
            className={styles.primary}
            disabled={pending}
            onClick={() => void completeDemoPayment()}
            type="button"
          >
            {t(
              pending
                ? "customer.commercial.payment.completing"
                : "customer.commercial.payment.complete",
            )}
          </button>
        </div>
      ) : guidedDemo && demoSession?.status === "paid" ? (
        <div className={styles.stack}>
          <p className={styles.successMessage} role="status">
            {t("customer.commercial.payment.completed", {
              receipt: demoSession.receiptId ?? "",
            })}
          </p>
          <a className={styles.primary} href={`/billing/${recordKey}`}>
            {t("customer.commercial.payment.returnPaid")}
          </a>
        </div>
      ) : providerUrl ? (
        <a className={styles.primary} href={providerUrl} rel="noreferrer">
          {t("customer.commercial.payment.continueStripe")}
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
          {t(
            pending
              ? "customer.commercial.payment.preparing"
              : guidedDemo
                ? "customer.commercial.payment.startDemo"
                : "customer.commercial.payment.prepare",
          )}
        </button>
      )}
      <p className={styles.muted}>
        {t(
          guidedDemo
            ? "customer.commercial.payment.footer.demo"
            : "customer.commercial.payment.footer.live",
        )}
      </p>
    </section>
  );
}
