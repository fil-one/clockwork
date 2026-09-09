"use client";
import { localizeCopy } from "@/src/i18n/copy";

import { useTranslations } from "@/src/i18n/client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import {
  executeClickAgreement,
  getActiveAgreementTemplate,
  type ActiveAgreementTemplate,
} from "@/src/features/contracts/commerce-client";
import { sendProjectionAction } from "@/src/features/contracts/experience-client";

import { customerPartnerCopy } from "../copy";
import { anyEntered } from "../draft-state";
import {
  LeaveDraftControl,
  useUnsavedChangesWarning,
} from "../unsaved-changes";
import styles from "./commercial.module.css";

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export interface ExecutableAgreement {
  reference: string;
  title: string;
  jurisdiction: string;
  type: string;
  demoProjection?: {
    projectionId: string;
    recordKey: string;
    version: number;
  };
}

export function AgreementAcceptance({
  account,
  agreement,
  demoTemplate,
}: {
  account: { id: string; name: string };
  agreement?: ExecutableAgreement;
  demoTemplate?: ActiveAgreementTemplate;
}) {
  const t = useTranslations();
  const localizedcustomerPartnerCopy = localizeCopy(customerPartnerCopy, t);
  const jurisdiction = agreement?.jurisdiction ?? "US";
  const type = agreement?.type ?? "csa";
  const [template, setTemplate] = useState<ActiveAgreementTemplate | undefined>(
    demoTemplate,
  );
  const [authorityTitle, setAuthorityTitle] = useState("");
  const [attested, setAttested] = useState(false);
  const [pending, setPending] = useState(false);
  const [executed, setExecuted] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [validationError, setValidationError] = useState<{
    id: string;
    message: string;
  } | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const idempotencyKeyRef = useRef<string | null>(null);

  /**
   * Armed once the signer has typed their title or ticked the authority
   * attestation, and the agreement has not been executed.
   *
   * The template fetched by the effect below is not the reader's input, so it
   * never arms the prompt: opening the page and reading the agreement is not
   * unsaved work. `executed` disarms.
   */
  const unsaved = (anyEntered(authorityTitle) || attested) && !executed;
  useUnsavedChangesWarning(unsaved);

  useEffect(() => {
    if (demoTemplate) return;
    let active = true;
    getActiveAgreementTemplate({ jurisdiction, type })
      .then((result) => {
        if (active) setTemplate(result);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setError(
          caught instanceof Error
            ? caught.message
            : "The approved agreement could not be loaded.",
        );
      });
    return () => {
      active = false;
    };
  }, [demoTemplate, jurisdiction, type]);

  const accept = async () => {
    if (!template) return;
    const invalid = !authorityTitle.trim()
      ? {
          id: "authority-title",
          message: t("agreements.execute.validation.authority"),
        }
      : !attested
        ? {
            id: "authority-attestation",
            message: t("agreements.execute.validation.attestation"),
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
      const observedHash = await sha256(template.exactText);
      if (observedHash !== template.exactTextHash)
        throw new Error(
          "The approved agreement failed its integrity check. Nothing was accepted.",
        );
      idempotencyKeyRef.current ??= crypto.randomUUID();
      if (agreement?.demoProjection)
        await sendProjectionAction(
          {
            audience: "customer",
            channel: "agreements",
            accountId: account.id,
            recordKey: agreement.demoProjection.recordKey,
            projectionId: agreement.demoProjection.projectionId,
            action: "execute_agreement",
            expectedVersion: agreement.demoProjection.version,
            payload: {
              authorityTitle,
              templateId: template.id,
              templateVersion: template.semanticVersion,
              exactTextHash: template.exactTextHash,
            },
          },
          { idempotencyKey: idempotencyKeyRef.current },
        );
      else
        await executeClickAgreement(
          {
            accountId: account.id,
            templateId: template.id,
            templateVersion: template.semanticVersion,
            exactText: template.exactText,
            exactTextHash: template.exactTextHash,
            authorityTitle,
          },
          { idempotencyKey: idempotencyKeyRef.current },
        );
      setExecuted(true);
      setMessage(t("agreements.execute.accepted"));
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The agreement could not be accepted. Nothing was changed.",
      );
      window.setTimeout(() => errorRef.current?.focus(), 0);
    } finally {
      setPending(false);
    }
  };

  return (
    <main className={styles.main} id="main-content">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Legal review</p>
          <h1>{localizedcustomerPartnerCopy.commercial.agreementReview}</h1>
          <p className={styles.description}>
            {t("agreements.execute.binding", { account: account.name })}
          </p>
        </div>
        <LeaveDraftControl
          armed={unsaved}
          className={styles.secondary ?? ""}
          discardClassName={styles.secondary ?? ""}
          href="/agreements"
          label="Return to agreements"
        />
      </header>

      {agreement ? (
        <p className={styles.notice} role="status">
          {t("agreements.execute.source", { reference: agreement.reference })}
        </p>
      ) : null}

      {!template && !error ? (
        <section className={styles.state} role="status">
          <h2>Loading counsel-approved agreement</h2>
          <p>The current active version and exact text are being verified.</p>
        </section>
      ) : null}

      {template ? (
        <div className={styles.workflowGrid}>
          <section className={`${styles.panel} ${styles.workflow}`}>
            <div>
              <p className={styles.eyebrow}>Governing agreement</p>
              <h2>
                {agreement?.title ?? template.type.toUpperCase()} · version{" "}
                {template.semanticVersion}
              </h2>
              <p className={styles.description}>
                {template.jurisdiction} · effective {template.effectiveOn} ·{" "}
                {template.executionMode === "click_through"
                  ? "click-through execution"
                  : "counter-signature required"}
              </p>
            </div>
            <article
              className={styles.section}
              aria-label="Exact agreement text"
            >
              <h3>Terms presented for acceptance</h3>
              <p className={styles.description}>{template.exactText}</p>
            </article>
            <details className={styles.technical}>
              <summary>
                {localizedcustomerPartnerCopy.common.technicalDetails}
              </summary>
              <dl className={styles.definitionGrid}>
                <div>
                  <dt>Template identifier</dt>
                  <dd>
                    <code>{template.id}</code>
                  </dd>
                </div>
                <div>
                  <dt>Canonical document</dt>
                  <dd>
                    <code>{template.canonicalDocumentId}</code>
                  </dd>
                </div>
                <div className={styles.spanTwo}>
                  <dt>Approved text SHA-256</dt>
                  <dd>
                    <code>{template.exactTextHash}</code>
                  </dd>
                </div>
              </dl>
            </details>
          </section>

          <aside
            className={styles.summary}
            aria-labelledby="authority-review-title"
          >
            <div>
              <p className={styles.eyebrow}>Authority evidence</p>
              <h2 id="authority-review-title">Review and confirm</h2>
            </div>
            <div className={styles.field}>
              <label htmlFor="authority-title">Authority title</label>
              <input
                aria-describedby={
                  validationError?.id === "authority-title"
                    ? "agreement-validation"
                    : undefined
                }
                aria-invalid={
                  validationError?.id === "authority-title" || undefined
                }
                id="authority-title"
                onChange={(event) => {
                  setAuthorityTitle(event.target.value);
                  setValidationError(null);
                }}
                required
                value={authorityTitle}
              />
            </div>
            <label className={styles.check} htmlFor="authority-attestation">
              <input
                aria-describedby={
                  validationError?.id === "authority-attestation"
                    ? "agreement-validation"
                    : undefined
                }
                aria-invalid={
                  validationError?.id === "authority-attestation" || undefined
                }
                checked={attested}
                id="authority-attestation"
                onChange={(event) => {
                  setAttested(event.target.checked);
                  setValidationError(null);
                }}
                required
                type="checkbox"
              />
              <span>
                {localizedcustomerPartnerCopy.commercial.agreementAuthority}
              </span>
            </label>
            {validationError ? (
              <p
                className={styles.errorMessage}
                id="agreement-validation"
                role="alert"
              >
                {validationError.message}
              </p>
            ) : null}
            <p className={styles.notice}>
              Accepting binds your organization to this agreement. The version,
              exact text hash, actor, title, and time are recorded as audit
              evidence.
            </p>
            {message ? (
              <p className={styles.successMessage} role="status">
                {message}{" "}
                {executed ? (
                  <Link href="/agreements">
                    {t("agreements.execute.acceptedLink")}
                  </Link>
                ) : null}
              </p>
            ) : null}
            {error ? (
              <p
                className={styles.errorMessage}
                ref={errorRef}
                role="alert"
                tabIndex={-1}
              >
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
              {pending ? "Accepting…" : "Accept and execute"}
            </button>
          </aside>
        </div>
      ) : null}

      {!template && error ? (
        <section className={styles.state} role="alert">
          <h2>Agreement unavailable</h2>
          <p ref={errorRef}>{error}</p>
          <p>
            No legal acceptance action is available until the approved server
            record loads.
          </p>
        </section>
      ) : null}
    </main>
  );
}
