"use client";

import { useTranslations } from "@/src/i18n/client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { uuidV7 } from "@clockwork/contracts";

import { sendCoreCommand } from "@/src/features/contracts/commerce-client";

import { anyEntered } from "../draft-state";
import {
  LeaveDraftControl,
  useUnsavedChangesWarning,
} from "../unsaved-changes";
import styles from "./commercial.module.css";
import {
  ARTIFACT_RETENTION_YEARS,
  commercialArtifactRetainUntil,
} from "./artifact-retention";
import type { PreparedOrderFormLookup } from "./prepared-order-form";
import { orderReviewSummary } from "./workflow-model";

const reviewLabels = {
  quote: "Issued quote",
  agreement: "Governing agreement",
  purchaseOrder: "Purchase order",
  serviceStart: "Service start",
  commitment: "Resulting commitment",
} as const;

/**
 * Acceptance is two server commands, and the second one's only precondition --
 * the rendered order form -- is asked for rather than rendered into a prop.
 *
 * It used to arrive as a prop the page computed from the orders channel. It
 * cannot come from there: `orders:prepare_artifact` writes no order row, and
 * `orders.order_form_document_id` is written only by the create branch this
 * document is the precondition *for*. So the prop was null for ever and the
 * bridge polled a value the server could not produce. The question is now put
 * to the bodyless artifact representation GET, keyed by the artifact request
 * the prepare command returns. That request is where the document and the
 * order it was prepared for are actually bound together.
 *
 * The phase, not the presence of a message, is what says whether a further
 * pass is available. A control disabled on `Boolean(message)` stays disabled
 * through the very event that is supposed to release it -- which is how the
 * customer ended up having to leave the page and re-enter every field.
 *
 * THE FIRST PASS ALSO HAD TO BE MADE TO SUCCEED. Until this change the payload
 * below carried a service start and no service end. `mutateOrder` calls
 * `orderArtifactDefinition` on *both* its branches, and that function's first
 * statement (packages/db/src/repositories/core/artifact-definitions.ts) is
 * `if (!input.order.serviceEndsOn) throw COMMERCIAL_ARTIFACT_ORDER_TERM_REQUIRED`.
 * `acceptOrder` (packages/domain/src/core/orders/index.ts) sets that field only
 * from `coTerminateOn ?? serviceEndsOn`, and this form collected neither, so no
 * order form was ever rendered for anything typed here and there was never a
 * document for the second pass to find. Measured rather than argued: the old
 * payload was replayed against the local authoritative database through
 * `DatabaseCoreFinanceRepository.mutate` and refused with
 * `COMMERCIAL_ARTIFACT_ORDER_TERM_REQUIRED`; the same payload with a service
 * end prepared the form, and a create pass quoting the stored document then
 * wrote an order whose `order_form_document_id` is that document and whose
 * `governing_agreement_version` matches the `governingAgreementReference` the
 * document was rendered from. Every earlier test of this surface stubbed
 * `sendCoreCommand`, which is why earlier attempts at this bridge did not
 * reach it.
 *
 * §4 of the spec puts the term on the order rather than the quote -- "Carries
 * the service term clock: start, end (may be co-terminated to a parent
 * agreement anniversary), notice date" -- and nothing this page can read
 * carries it: the customer quote projection (`authoritative-state.ts`, the
 * `quote:` query) publishes revision, status, currency, total, expiry and
 * margin result, and no line terms at all. So the end is asked for rather than
 * derived; deriving it would mean inventing a term the page has no source for.
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
  /**
   * The server cannot answer at all -- no authoritative database, demo data,
   * or a session that has lost the permission. Distinct from `form_stalled`,
   * because nothing is in flight and waiting longer changes nothing.
   */
  | "form_unavailable"
  /** The order exists. There is no third pass. */
  | "created";

/**
 * The same bounded discipline `awaitReceipt` uses for projection actions:
 * a fixed number of attempts, success only on the terminal condition, and a
 * recheck affordance rather than a spinner that never resolves. What is polled
 * differs -- a bodyless artifact representation here, an action receipt there
 * -- so the loop is not shared; the rules are.
 */
const ORDER_FORM_POLL_ATTEMPTS = 15;
const ORDER_FORM_POLL_INTERVAL_MS = 1_000;

export interface AcceptableQuote {
  lineCount?: number;
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

/**
 * A rendered order form, and the order it was rendered for.
 *
 * The order identifier travels with the document because the server binds them
 * together and refuses them apart. `assertCommercialArtifactBinding` looks the
 * document up by `(document_id, subject_type, subject_id)`, where `subject_id`
 * is the order the *prepare* pass named; a create pass that quotes the document
 * under any other order identifier matches no row and is refused with
 * `COMMERCIAL_ARTIFACT_BINDING_INVALID`.
 *
 * Holding the document identifier alone makes that refusal reachable and
 * unrecoverable. See `preparedFor` below.
 */
interface PreparedOrderForm {
  documentId: string;
  orderId: string;
  /**
   * What the reader opens. Distinct from `documentId`, which is what the create
   * pass quotes -- see `PreparedOrderFormLookup`. Acceptance is a binding
   * signature on a document, and a ceremony that asks for the signature without
   * ever showing the paper is not the ceremony the product runs.
   */
  artifactId: string;
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Both API compositions return the request they actually persisted. The
 * production repository nests the generated contract and the demo adapter
 * keeps its compact compatibility field. Refuse every other shape, including
 * path-like strings, before constructing a URL from it.
 */
function preparedArtifactRequestId(result: unknown): string | null {
  const data = record(record(result)?.record)?.data;
  const dataRecord = record(data);
  const production = record(dataRecord?.artifactRequest)?.requestId;
  const demo = dataRecord?.artifactRequestId;
  const candidate = typeof production === "string" ? production : demo;
  return typeof candidate === "string" && uuidPattern.test(candidate)
    ? candidate
    : null;
}

/**
 * Reads the public, authorization-scoped representation without a request
 * body. A not-yet-stored canonical artifact intentionally presents as 404 on
 * this endpoint, so only that status means pending. A successful response is
 * accepted only when all identifiers preserve the prepare-pass binding.
 */
async function readPreparedOrderForm(
  artifactRequestId: string,
  orderId: string,
): Promise<PreparedOrderFormLookup> {
  const response = await fetch(
    `/api/experience/artifacts/order_form/${encodeURIComponent(artifactRequestId)}?representation=json`,
    {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
      headers: { accept: "application/json" },
    },
  );
  if (response.status === 404) return { status: "pending" };
  if (response.status === 401 || response.status === 403)
    return { status: "forbidden" };
  if (response.status === 503) return { status: "unavailable" };
  if (!response.ok) throw new Error("The order form lookup failed");
  const representation = record(await response.json().catch(() => null));
  if (
    representation?.kind !== "order_form" ||
    representation.subjectType !== "order" ||
    representation.id !== artifactRequestId ||
    representation.subjectId !== orderId ||
    typeof representation.documentId !== "string" ||
    !uuidPattern.test(representation.documentId)
  )
    return { status: "unavailable" };
  return {
    status: "stored",
    documentId: representation.documentId,
    artifactId: artifactRequestId,
  };
}

/**
 * The bound inputs, as one comparable value.
 *
 * The order form is rendered *from* these. `orderArtifactDefinition` puts the
 * purchase-order number, the service period and the signing title into the
 * definition it hashes, and the create pass recomputes that hash from the
 * command it is given and requires it to equal the hash stored with the
 * request. So a document prepared for one set of entries is not evidence for
 * any other set, and the moment one of them is edited the only correct next
 * pass is another prepare.
 */
function boundFields(
  poNumber: string,
  serviceStart: string,
  serviceEnd: string,
  authorityTitle: string,
): string {
  return JSON.stringify([poNumber, serviceStart, serviceEnd, authorityTitle]);
}

export function OrderAcceptance({
  account,
  signerUserId,
  quote,
  agreement,
  partialRead = false,
  audience = "customer",
}: {
  account: { id: string; name: string };
  signerUserId: string;
  quote: AcceptableQuote | null;
  agreement: GoverningAgreement | null;
  /**
   * Set when a channel read stopped at the page ceiling. The quote this page
   * selected and the agreement it bound were then chosen from a prefix, and
   * the reader is the one committing money against them, so the incompleteness
   * is disclosed rather than absorbed.
   */
  partialRead?: boolean;
  audience?: "customer" | "partner";
}) {
  const t = useTranslations();
  const [poNumber, setPoNumber] = useState("");
  const [serviceStart, setServiceStart] = useState("");
  /**
   * The end of the committed service term. Bound, hashed and required: see the
   * `COMMERCIAL_ARTIFACT_ORDER_TERM_REQUIRED` note at the top of this file.
   */
  const [serviceEnd, setServiceEnd] = useState("");
  const [authorityTitle, setAuthorityTitle] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  /**
   * The stored order form this session's prepare pass produced.
   *
   * Client state, because the only identifier it can be found by is minted
   * here: nothing the server renders knows which order this reader is part-way
   * through accepting.
   */
  const [orderForm, setOrderForm] = useState<PreparedOrderForm | null>(null);
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
  /**
   * What this session's prepare pass asked for: the order it named, and the
   * entries the resulting form was rendered from.
   *
   * Null until a prepare has been issued here, and that is the point. A
   * document this session did not prepare cannot be used: the create pass
   * rebuilds the artifact definition from the command it is given and requires
   * the hash to equal the stored request's, and that hash covers the purchase
   * order, the service period, the signing title and the acceptance instant.
   * Nothing typed into a freshly loaded form reproduces them.
   */
  const preparedRef = useRef<{
    orderId: string;
    fields: string;
    artifactRequestId: string | null;
  } | null>(null);
  /** Supersedes an in-flight poll when the reader rechecks or resubmits. */
  const pollRef = useRef(0);
  /**
   * Supersedes an in-flight *command* when a bound entry changes while it is
   * still on the wire.
   *
   * `resetSubmission` runs on every keystroke in a bound field, including the
   * keystrokes made during the second or two a prepare pass takes. It nulls
   * `orderIdRef`, so the code that resumes after the await used to record a
   * `preparedRef` with a null order identifier and then poll for it -- which
   * lands the surface in `form_unavailable` behind a recheck control that can
   * only reproduce it. The token says whose submission the resumed code belongs
   * to, so a superseded one records nothing and polls for nothing.
   */
  const submissionRef = useRef(0);

  /**
   * Whether the create pass is the pass that is available.
   *
   * Three conditions, all load-bearing: a form exists; this session prepared
   * it, under the order identifier the server bound it to; and the entries it
   * was rendered from are still the entries on screen. Dropping any one of
   * them sends a create the server refuses -- and refuses for good, because
   * the refusal does not release a further pass.
   */
  const preparedFor =
    orderForm !== null &&
    preparedRef.current !== null &&
    preparedRef.current.orderId === orderForm.orderId &&
    preparedRef.current.fields ===
      boundFields(poNumber, serviceStart, serviceEnd, authorityTitle)
      ? orderForm
      : null;

  /** Abandons a poll left running when the reader navigates away mid-wait. */
  useEffect(
    () => () => {
      pollRef.current += 1;
    },
    [],
  );

  /**
   * Armed once a purchase-order number, either end of the service term, or a
   * signing title has been entered, or the commitment box has been ticked, and
   * the order has not been created.
   *
   * Every field on this form starts empty, so there is no default to exclude.
   * `createdOrderId` disarms, and it is set from the server's response, so the
   * prompt never stands between someone and the order they just placed.
   */
  const unsaved =
    (anyEntered(poNumber, serviceStart, serviceEnd, authorityTitle) ||
      confirmed) &&
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
    submissionRef.current += 1;
    setPhase("ready");
    prepareKeyRef.current = null;
    createKeyRef.current = null;
    orderIdRef.current = null;
    acceptedAtRef.current = null;
    orderLineIdsRef.current = null;
    // The prepared form described the old entries. Keeping the record of it
    // would let the create pass fire against a document whose hash no longer
    // matches the command -- refused, and refused with nothing left to retry.
    preparedRef.current = null;
    setOrderForm(null);
  };

  /**
   * Bounded polling for the order form. Success is only the terminal condition
   * -- the server answering `stored` for the order this session prepared --
   * never "the loop ended".
   *
   * A thrown lookup is not an answer: a dropped request during a deploy would
   * otherwise end the wait as though the form were never coming. The attempt
   * is spent and the loop continues, so a transient failure costs one attempt
   * rather than the whole acceptance.
   */
  const awaitOrderForm = async (
    orderId: string,
    artifactRequestId: string | null,
  ) => {
    const token = pollRef.current + 1;
    pollRef.current = token;
    setPhase("awaiting_form");
    // There is no safe alternate transport for a prepare response that does
    // not identify its persisted request. In particular, do not fall back to a
    // Server Action POST: that body crosses the same Netlify middleware
    // boundary this GET exists to avoid.
    if (!artifactRequestId) {
      setPhase("form_unavailable");
      return;
    }
    for (let attempt = 0; attempt < ORDER_FORM_POLL_ATTEMPTS; attempt += 1) {
      await new Promise((resolve) =>
        setTimeout(resolve, ORDER_FORM_POLL_INTERVAL_MS),
      );
      if (pollRef.current !== token) return;
      const answer = await readPreparedOrderForm(
        artifactRequestId,
        orderId,
      ).catch(() => null);
      if (pollRef.current !== token) return;
      if (!answer) continue;
      if (answer.status === "stored") {
        // Only the order this session prepared ends the wait. A document
        // bound to any other order would release the control into a create
        // pass the server refuses.
        if (preparedRef.current?.orderId !== orderId) return;
        setOrderForm({
          documentId: answer.documentId,
          orderId,
          artifactId: answer.artifactId,
        });
        setPhase("ready");
        return;
      }
      if (answer.status === "unavailable" || answer.status === "forbidden") {
        setPhase("form_unavailable");
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
        : !serviceEnd
          ? {
              id: "service-end",
              message: "Choose the service end date.",
            }
          : // `acceptOrder` refuses `end < serviceStartsOn` outright. Saying so
            // here costs one comparison and saves a round trip that comes back
            // as a raw server refusal.
            serviceEnd < serviceStart
            ? {
                id: "service-end",
                message:
                  "Choose a service end on or after the service start date.",
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
    const creating = preparedFor !== null;
    const submission = submissionRef.current;
    try {
      // The create pass runs under the identifier the document was bound to,
      // never a fresh one. `preparedFor` has already established they are the
      // same value; assigning it here is what keeps them the same after a
      // reset cleared the ref.
      const orderId = creating
        ? preparedFor.orderId
        : (orderIdRef.current ?? uuidV7());
      orderIdRef.current = orderId;
      /**
       * One acceptance instant for both passes, because the order form is
       * hashed over it: the stored request's `signer.acceptedAt` is this value,
       * and the create pass re-derives the same definition and refuses a
       * different hash. Minting a fresh one on the create pass would invalidate
       * the document this pass exists to quote.
       *
       * This is DOCUMENTARY, and the repository now treats it as such:
       * `mutateOrder` takes `command.acceptedAt` on both passes and keys every
       * server fact -- `immutableAt`, the selling-entity `boundAt`, the
       * provisioning request, the tax point -- on its own receive instant
       * instead. It used to additionally require the two to be equal, which no
       * browser could satisfy because the create pass always arrives after the
       * instant the prepared form states.
       */
      const acceptedAt = acceptedAtRef.current ?? new Date().toISOString();
      acceptedAtRef.current = acceptedAt;
      orderLineIdsRef.current ??= Array.from(
        { length: quote.lineCount ?? 1 },
        () => uuidV7(),
      );
      const keyRef = creating ? createKeyRef : prepareKeyRef;
      const idempotencyKey = keyRef.current ?? crypto.randomUUID();
      keyRef.current = idempotencyKey;
      const command = {
        quoteId: quote.id,
        signerUserId,
        authorityTitle,
        authorityAttested: true,
        poNumber,
        acceptedAt,
        serviceStartsOn: serviceStart,
        // Without this the order carries no service end, and
        // `orderArtifactDefinition` refuses to render the order form at all --
        // which is why the first pass never produced a document to bridge to.
        serviceEndsOn: serviceEnd,
        orderLineIds: orderLineIdsRef.current,
      };
      const result = await sendCoreCommand(
        {
          resource: "orders",
          id: orderId,
          accountId: account.id,
          // The order form is bound evidence: acceptance can only be recorded
          // once it exists, so a first pass asks the server to render it.
          action: creating ? "create" : "prepare_artifact",
          payload: creating
            ? { ...command, orderFormDocumentId: preparedFor.documentId }
            : {
                ...command,
                retainUntil: commercialArtifactRetainUntil(acceptedAt),
              },
        },
        { idempotencyKey },
      );
      // A bound entry changed while this command was on the wire. The command
      // itself stands -- the server has it either way -- but nothing it named
      // describes what is on screen now, so it records nothing and starts no
      // wait. The reader's next submission is a fresh prepare.
      if (submissionRef.current !== submission) return;
      if (creating) {
        setCreatedOrderId(orderId);
        setPhase("created");
        // The order and its commitment now exist on the server. Every other
        // surface in this shell reads them from a cache this request did not
        // invalidate, so the orders collection would still show the state
        // before the acceptance.
        router.refresh();
        return;
      }
      // The first pass only asked for the document, and it named the order and
      // the entries the server will render it from. Both are recorded before
      // the wait starts: they are what says whether the form that turns up is
      // the one this acceptance may be completed with.
      preparedRef.current = {
        orderId,
        fields: boundFields(poNumber, serviceStart, serviceEnd, authorityTitle),
        artifactRequestId: preparedArtifactRequestId(result),
      };
      // Bridge to the second pass here rather than making the reader navigate
      // away and re-key the form.
      await awaitOrderForm(orderId, preparedRef.current.artifactRequestId);
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
        : // Both waiting messages say only what this run verified: no order row
          // is written until the create pass, the entries are component state,
          // and the order form is hashed over the acceptance instant this
          // session minted -- so a later visit cannot resume this attempt, it
          // can only start another one. The copy this replaced told the reader
          // to "come back to this page later to finish", which was never true.
          phase === "form_stalled"
          ? "The order form has not been rendered yet. Nothing has been created and your entries are held on this page — check again. Leaving this page ends this attempt: no order exists until it is completed here, and a later visit starts a new one."
          : phase === "form_unavailable"
            ? "This workspace cannot confirm whether the order form was rendered. Nothing has been created and your entries are held on this page — check again. Leaving this page ends this attempt: no order exists until it is completed here, and a later visit starts a new one."
            : "";
  /**
   * Both waiting states offer the recheck, and neither is a failure of the
   * acceptance: nothing was created, and the entries are still on screen. The
   * control exists so the reader is never left with a disabled button and no
   * way to ask again.
   *
   * It is offered only while there is a prepared order to ask about. A control
   * whose handler finds nothing to do is a control that does nothing when it is
   * pressed.
   */
  const awaitingOrderId = preparedRef.current?.orderId ?? null;
  const rechecking =
    (phase === "form_stalled" || phase === "form_unavailable") &&
    awaitingOrderId !== null;
  /**
   * What the reader is told to review, in the order the form asks for it.
   *
   * `orderReviewSummary` has no service-end field and it is shared with the
   * workflow model's tests, so the term's other half is inserted here rather
   * than by widening a model this surface is only one caller of. Both halves
   * are hashed into the order form, so the panel that says "review before
   * accepting" has to show both.
   */
  const reviewRows: readonly (readonly [string, string])[] = summary
    ? Object.entries(summary).flatMap(([key, value]) => {
        const row = [
          reviewLabels[key as keyof typeof reviewLabels],
          value,
        ] as const;
        return key === "serviceStart"
          ? [row, ["Service end", serviceEnd || "Not selected"] as const]
          : [row];
      })
    : [];

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
          <h1>{t("cp.commercial.orderReview")}</h1>
          <p className={styles.description}>
            This legal and financial confirmation creates the resulting service
            commitment from an issued quote.
          </p>
        </div>
        <LeaveDraftControl
          armed={unsaved}
          className={styles.secondary ?? ""}
          discardClassName={styles.secondary ?? ""}
          href={audience === "partner" ? "/partner/orders" : "/orders"}
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

      {createdOrderId ? (
        <section className={styles.state}>
          <h2>Order created</h2>
          <p className={styles.successMessage} role="status">
            {t("orders.accept.created")}
          </p>
          <Link
            className={styles.primary}
            href={
              audience === "partner"
                ? `/partner/orders/${createdOrderId}`
                : `/orders/order-${createdOrderId}`
            }
          >
            {t("orders.accept.createdLink")}
          </Link>
        </section>
      ) : quote ? (
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
                <p className={styles.taskContext}>Issued commercial source</p>
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
                          ? "po-terms-note order-validation"
                          : "po-terms-note"
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
                    <p className={styles.description} id="po-terms-note">
                      {t("cp.commercial.orderTermsHelp", {
                        quoteReference: quote.reference,
                        quoteVersion: quote.version,
                        agreementTitle:
                          agreement?.title ?? "unrecorded governing agreement",
                        agreementVersion: agreement?.version ?? "not recorded",
                      })}
                    </p>
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
                  <div className={styles.field}>
                    <label htmlFor="service-end">Service end</label>
                    <input
                      aria-describedby={
                        validationError?.id === "service-end"
                          ? "order-validation"
                          : "service-end-note"
                      }
                      aria-invalid={
                        validationError?.id === "service-end" || undefined
                      }
                      id="service-end"
                      min={serviceStart || undefined}
                      onChange={(event) => {
                        setServiceEnd(event.target.value);
                        resetSubmission();
                      }}
                      required
                      type="date"
                      value={serviceEnd}
                    />
                    {/*
                      Verified in this run, not assumed: the stored artifact
                      request for a prepared order form carries
                      `servicePeriod: { startDate, endDate }` in the definition
                      its source hash is taken over, and the create pass
                      re-derives that hash and refuses a mismatch.
                    */}
                    <p className={styles.description} id="service-end-note">
                      The committed term this order runs to. It is rendered onto
                      the order form and covered by the evidence hash that binds
                      the form to this acceptance.
                    </p>
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
                {reviewRows.map(([label, value]) => (
                  <li key={label}>
                    <span>{label}</span>
                    <strong>{value}</strong>
                  </li>
                ))}
              </ul>
              <p className={styles.description}>
                {t("cp.commercial.orderArtifactRetention", {
                  years: ARTIFACT_RETENTION_YEARS,
                })}
              </p>
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
                <span>{t("cp.commercial.orderConfirmation")}</span>
              </label>
              {statusMessage ? (
                <p className={styles.successMessage} role="status">
                  {statusMessage}
                  {/*
                    The link is offered only once there is something at the
                    other end of it. Before the create pass runs there is no
                    order row anywhere -- `orders:prepare_artifact` writes only
                    a `core_commercial_artifact_requests` row, and the orders
                    channel projects `public.orders` -- so "Track this
                    acceptance in orders" pointed the reader at a ledger that
                    could not show this acceptance, in exactly the three states
                    (waiting, stalled, unanswerable) where they most wanted it
                    to.
                  */}
                  {createdOrderId ? (
                    <>
                      {" "}
                      <Link
                        href={
                          audience === "partner"
                            ? `/partner/orders/${createdOrderId}`
                            : `/orders/order-${createdOrderId}`
                        }
                      >
                        {t("orders.accept.createdLink")}
                      </Link>
                    </>
                  ) : null}
                </p>
              ) : null}
              {error ? (
                <p className={styles.errorMessage} role="alert">
                  {error}
                </p>
              ) : null}
              {/*
                The paper, before the signature. The create pass is a binding
                acceptance OF this document -- its hash covers the purchase
                order, the service period, the signing title and the acceptance
                instant -- so the reader is offered the rendered form itself
                rather than asked to take its existence on trust. It appears
                only while `preparedFor` holds, which is exactly while the
                document on the server still describes what is on screen.
              */}
              {preparedFor ? (
                <p className={styles.notice}>
                  The order form has been rendered for these entries.{" "}
                  <a
                    href={`/api/experience/artifacts/order_form/${encodeURIComponent(preparedFor.artifactId)}`}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Open the order form
                  </a>{" "}
                  before you accept. Changing any entry above discards it and
                  prepares a new one.
                </p>
              ) : null}
              {rechecking && awaitingOrderId ? (
                <button
                  className={styles.secondary}
                  onClick={() =>
                    void awaitOrderForm(
                      awaitingOrderId,
                      preparedRef.current?.artifactRequestId ?? null,
                    )
                  }
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
                {/*
                  The label names the pass that will actually run, so it is
                  keyed on the same value the pass is: a form the account
                  happens to hold is not a create pass, and saying it is would
                  promise a command the server refuses.
                */}
                {phase === "submitting"
                  ? "Accepting…"
                  : preparedFor
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
          <Link
            className={styles.secondary}
            href={audience === "partner" ? "/partner/quotes" : "/quotes"}
          >
            {t("orders.accept.unavailable.action")}
          </Link>
        </section>
      )}
    </main>
  );
}
