"use client";

import { useFormattingLocale, useTranslations } from "@/src/i18n/client";
import type { MessageId } from "@/src/i18n";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import {
  executeClickAgreement,
  getActiveAgreementTemplate,
  type ActiveAgreementTemplate,
} from "@/src/features/contracts/commerce-client";
import { sendProjectionAction } from "@/src/features/contracts/experience-client";
import { formatDate } from "@/src/features/shared/format";

import { anyEntered } from "../draft-state";
import {
  LeaveDraftControl,
  useUnsavedChangesWarning,
} from "../unsaved-changes";
import styles from "./commercial.module.css";
import { CommercialStop, commercialFailureText } from "./failure-message";

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
  const locale = useFormattingLocale();
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
    message: MessageId;
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
          commercialFailureText(
            caught,
            t,
            "customer.commercial.agreement.loadFailed",
          ),
        );
      });
    return () => {
      active = false;
    };
  }, [demoTemplate, jurisdiction, t, type]);

  const accept = async () => {
    if (!template) return;
    const invalid: { id: string; message: MessageId } | undefined =
      !authorityTitle.trim()
        ? {
            id: "authority-title",
            message: "customer.commercial.agreement.validation.authority",
          }
        : !attested
          ? {
              id: "authority-attestation",
              message: "customer.commercial.agreement.validation.attestation",
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
        throw new CommercialStop(
          "customer.commercial.agreement.integrityFailed",
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
      setMessage(t("customer.commercial.agreement.accepted"));
    } catch (caught) {
      setError(
        commercialFailureText(
          caught,
          t,
          "customer.commercial.agreement.failed",
        ),
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
          <p className={styles.eyebrow}>
            {t("customer.commercial.agreement.eyebrow")}
          </p>
          <h1>{t("customer.commercial.agreement.title")}</h1>
          <p className={styles.description}>
            {t("customer.commercial.agreement.binding", {
              account: account.name,
            })}
          </p>
        </div>
        <LeaveDraftControl
          armed={unsaved}
          className={styles.secondary ?? ""}
          discardClassName={styles.secondary ?? ""}
          href="/agreements"
          label={t("customer.commercial.agreement.return")}
        />
      </header>

      {agreement ? (
        <p className={styles.notice} role="status">
          {t("customer.commercial.agreement.source", {
            reference: agreement.reference,
          })}
        </p>
      ) : null}

      {!template && !error ? (
        <section className={styles.state} role="status">
          <h2>{t("customer.commercial.agreement.loadingTitle")}</h2>
          <p>{t("customer.commercial.agreement.loadingBody")}</p>
        </section>
      ) : null}

      {template ? (
        <div className={styles.workflowGrid}>
          <section className={`${styles.panel} ${styles.workflow}`}>
            <div>
              <p className={styles.eyebrow}>
                {t("customer.commercial.accept.label.agreement")}
              </p>
              <h2>
                {t("customer.commercial.detail.titleWithVersion", {
                  title: agreement?.title ?? template.type.toUpperCase(),
                  version: template.semanticVersion,
                })}
              </h2>
              <p className={styles.description}>
                {t("customer.commercial.agreement.meta", {
                  jurisdiction: template.jurisdiction,
                  date: formatDate(template.effectiveOn, locale),
                  mode: t(
                    template.executionMode === "click_through"
                      ? "customer.commercial.agreement.mode.clickThrough"
                      : "customer.commercial.agreement.mode.counterSigned",
                  ),
                })}
              </p>
            </div>
            {/*
              The exact text is the legal instrument itself, in the language
              the agreement was approved in (translation policy rule 5). It is
              hashed and accepted as written, so it is never translated.
            */}
            <article
              className={styles.section}
              aria-label={t("customer.commercial.agreement.textLabel")}
            >
              <h3>{t("customer.commercial.agreement.termsTitle")}</h3>
              <p className={styles.description}>{template.exactText}</p>
            </article>
            <details className={styles.technical}>
              <summary>{t("common.technicalDetails")}</summary>
              <dl className={styles.definitionGrid}>
                <div>
                  <dt>{t("customer.commercial.agreement.templateId")}</dt>
                  <dd>
                    <code>{template.id}</code>
                  </dd>
                </div>
                <div>
                  <dt>
                    {t("customer.commercial.agreement.canonicalDocument")}
                  </dt>
                  <dd>
                    <code>{template.canonicalDocumentId}</code>
                  </dd>
                </div>
                <div className={styles.spanTwo}>
                  <dt>{t("customer.commercial.agreement.textHash")}</dt>
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
              <p className={styles.eyebrow}>
                {t("customer.commercial.agreement.authorityEyebrow")}
              </p>
              <h2 id="authority-review-title">
                {t("customer.commercial.agreement.reviewTitle")}
              </h2>
            </div>
            <div className={styles.field}>
              <label htmlFor="authority-title">
                {t("customer.commercial.accept.label.authorityTitle")}
              </label>
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
              <span>{t("customer.commercial.agreement.authority")}</span>
            </label>
            {validationError ? (
              <p
                className={styles.errorMessage}
                id="agreement-validation"
                role="alert"
              >
                {t(validationError.message)}
              </p>
            ) : null}
            <p className={styles.notice}>
              {t("customer.commercial.agreement.bindingNotice")}
            </p>
            {message ? (
              <p className={styles.successMessage} role="status">
                {message}{" "}
                {executed ? (
                  <Link href="/agreements">
                    {t("customer.commercial.agreement.acceptedLink")}
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
              {t(
                pending
                  ? "customer.commercial.accept.accepting"
                  : "customer.commercial.agreement.submit",
              )}
            </button>
          </aside>
        </div>
      ) : null}

      {!template && error ? (
        <section className={styles.state} role="alert">
          <h2>{t("customer.commercial.agreement.unavailableTitle")}</h2>
          <p ref={errorRef}>{error}</p>
          <p>{t("customer.commercial.agreement.unavailableBody")}</p>
        </section>
      ) : null}
    </main>
  );
}
