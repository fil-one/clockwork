"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { uuidV7 } from "@clockwork/contracts";

import { sendCoreCommand } from "@/src/features/contracts/commerce-client";
import { t } from "@/src/i18n/en";

import { customerPartnerCopy } from "../copy";
import { anyEntered } from "../draft-state";
import {
  LeaveDraftControl,
  useUnsavedChangesWarning,
} from "../unsaved-changes";
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

/**
 * Acceptance is two server commands, and the second one's only precondition --
 * the rendered order form -- is computed server-side and arrives as a prop.
 *
 * The phase, not the presence of a message, is what says whether a further
 * pass is available. `router.refresh()` re-renders the server component but
 * deliberately preserves this client component's state, so a control disabled
 * on `Boolean(message)` stays disabled through the very refresh that is
 * supposed to release it -- which is how the customer ended up having to leave
 * the page and re-enter every field.
 */
type AcceptancePhase =
  /** A pass is available: prepare if no order form yet, otherwise create. */
  | "ready"
  /** A command is in flight. */
  | "submitting"
  /** Prepare succeeded; polling for the order form the create pass binds. */
  | "awaiting_form"
  /** Polling gave up. Nothing was created; the recheck affordance is offered. */
  | "form_stalled"
  /** The order exists. There is no third pass. */
  | "created";

/**
 * The same bounded discipline `awaitReceipt` uses for projection actions:
 * a fixed number of attempts, success only on the terminal condition, and a
 * recheck affordance rather than a spinner that never resolves. What is polled
 * differs -- a server-rendered prop here, an action receipt there -- so the
 * loop is not shared; the rules are.
 */
const ORDER_FORM_POLL_ATTEMPTS = 15;
const ORDER_FORM_POLL_INTERVAL_MS = 1_000;

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
  partialRead = false,
}: {
  account: { id: string; name: string };
  signerUserId: string;
  quote: AcceptableQuote | null;
  agreement: GoverningAgreement | null;
  orderFormDocumentId: string | null;
  /**
   * Set when a channel read stopped at the page ceiling. The quote this page
   * selected and the agreement it bound were then chosen from a prefix, and
   * the reader is the one committing money against them, so the incompleteness
   * is disclosed rather than absorbed.
   */
  partialRead?: boolean;
}) {
  const [poNumber, setPoNumber] = useState("");
  const [serviceStart, setServiceStart] = useState("");
  const [authorityTitle, setAuthorityTitle] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [phase, setPhase] = useState<AcceptancePhase>("ready");
  const [createdOrderId, setCreatedOrderId] = useState("");
  const [error, setError] = useState("");
  const [validationError, setValidationError] = useState<{
    id: string;
    message: string;
  } | null>(null);
  const router = useRouter();
  /**
   * One key per pass. The two passes send different actions and different
   * payloads under the same order identifier, so replaying the prepare key on
   * the create is precisely the write an idempotency store exists to refuse --
   * and this one does.
   */
  const prepareKeyRef = useRef<string | null>(null);
  const createKeyRef = useRef<string | null>(null);
  const orderIdRef = useRef<string | null>(null);
  const acceptedAtRef = useRef<string | null>(null);
  const orderLineIdsRef = useRef<readonly string[] | null>(null);
  /** The prop, readable from inside the poll loop's closure. */
  const documentIdRef = useRef(orderFormDocumentId);
  /** Supersedes an in-flight poll when the reader rechecks or resubmits. */
  const pollRef = useRef(0);

  useEffect(() => {
    documentIdRef.current = orderFormDocumentId;
    if (orderFormDocumentId === null) return;
    setPhase((current) =>
      current === "awaiting_form" || current === "form_stalled"
        ? "ready"
        : current,
    );
  }, [orderFormDocumentId]);

  /** Abandons a poll left running when the reader navigates away mid-wait. */
  useEffect(
    () => () => {
      pollRef.current += 1;
    },
    [],
  );

  /**
   * Armed once a purchase-order number, a service start, or a signing title
   * has been entered, or the commitment box has been ticked, and the order has
   * not been created.
   *
   * Every field on this form starts empty, so there is no default to exclude.
   * `createdOrderId` disarms, and it is set from the server's response, so the
   * prompt never stands between someone and the order they just placed.
   */
  const unsaved =
    (anyEntered(poNumber, serviceStart, authorityTitle) || confirmed) &&
    !createdOrderId;
  useUnsavedChangesWarning(unsaved);

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

  /**
   * An edit to a bound input invalidates whatever was submitted for the old
   * values, so the next submission is a fresh prepare pass under a fresh order
   * identifier and fresh keys. Any poll still running is abandoned rather than
   * left to re-enable a control for inputs that no longer match.
   *
   * A submission that has already produced an order is not reset: `created` is
   * terminal, and there is nothing left to re-key.
   */
  const resetSubmission = () => {
    setValidationError(null);
    if (phase === "created") return;
    pollRef.current += 1;
    setPhase("ready");
    prepareKeyRef.current = null;
    createKeyRef.current = null;
    orderIdRef.current = null;
    acceptedAtRef.current = null;
    orderLineIdsRef.current = null;
  };

  /**
   * Bounded polling for the order form. Success is only the terminal
   * condition -- the identifier actually present -- never "the loop ended".
   */
  const awaitOrderForm = async () => {
    const token = pollRef.current + 1;
    pollRef.current = token;
    setPhase("awaiting_form");
    for (let attempt = 0; attempt < ORDER_FORM_POLL_ATTEMPTS; attempt += 1) {
      router.refresh();
      await new Promise((resolve) =>
        setTimeout(resolve, ORDER_FORM_POLL_INTERVAL_MS),
      );
      if (pollRef.current !== token) return;
      if (documentIdRef.current !== null) {
        setPhase("ready");
        return;
      }
    }
    if (pollRef.current !== token) return;
    setPhase("form_stalled");
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
    setPhase("submitting");
    setError("");
    const creating = orderFormDocumentId !== null;
    try {
      orderIdRef.current ??= uuidV7();
      acceptedAtRef.current ??= new Date().toISOString();
      orderLineIdsRef.current ??= [uuidV7()];
      const keyRef = creating ? createKeyRef : prepareKeyRef;
      keyRef.current ??= crypto.randomUUID();
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
          action: creating ? "create" : "prepare_artifact",
          payload:
            creating && orderFormDocumentId
              ? { ...command, orderFormDocumentId }
              : { ...command, retainUntil: retainUntil(acceptedAtRef.current) },
        },
        { idempotencyKey: keyRef.current },
      );
      if (creating) {
        setCreatedOrderId(orderIdRef.current);
        setPhase("created");
        return;
      }
      // The first pass only asked for the document. Bridge to the second one
      // here rather than making the reader navigate away and re-key the form.
      await awaitOrderForm();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : t("orders.accept.failed"),
      );
      // A refused command leaves the same pass available. Locking the control
      // after a failure would be a control blocking legitimate work.
      setPhase("ready");
    }
  };

  /**
   * Derived, not stored. A stored message outlives the state it described --
   * that is how the prepared notice survived to disable the create pass.
   */
  const statusMessage =
    phase === "created"
      ? t("orders.accept.created")
      : phase === "awaiting_form"
        ? t("orders.accept.prepared")
        : phase === "form_stalled"
          ? "The order form has not been rendered yet. Nothing has been created and your entries are held here — check again, or come back to this page later to finish."
          : "";

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
        <LeaveDraftControl
          armed={unsaved}
          className={styles.secondary ?? ""}
          discardClassName={styles.secondary ?? ""}
          href="/orders"
          label="Return to orders"
        />
      </header>

      {partialRead ? (
        <p className={styles.errorMessage} role="alert">
          This account holds more commercial records than one page of this
          workspace can read, so the quote and governing agreement shown here
          were chosen from the most recently updated records only. Check them
          against the quote and agreement ledgers before accepting.
        </p>
      ) : null}

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
              {statusMessage ? (
                <p className={styles.successMessage} role="status">
                  {statusMessage}{" "}
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
              {phase === "form_stalled" ? (
                <button
                  className={styles.secondary}
                  onClick={() => void awaitOrderForm()}
                  type="button"
                >
                  Check for the order form again
                </button>
              ) : null}
              <button
                className={styles.primary}
                // The condition is "no further pass is available", not "a
                // message is on screen". `router.refresh()` preserves this
                // component's state, so a message-keyed disable would survive
                // the refresh that is meant to release it.
                disabled={phase !== "ready"}
                type="submit"
              >
                {phase === "submitting"
                  ? "Accepting…"
                  : orderFormDocumentId
                    ? "Create the order and commitment"
                    : "Accept order and create commitment"}
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
