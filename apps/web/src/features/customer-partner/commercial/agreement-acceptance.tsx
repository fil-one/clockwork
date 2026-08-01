"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import {
  executeClickAgreement,
  getActiveAgreementTemplate,
  type ActiveAgreementTemplate,
} from "@/src/features/contracts/commerce-client";

import { customerPartnerCopy } from "../copy";
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

export function AgreementAcceptance() {
  const [template, setTemplate] = useState<ActiveAgreementTemplate>();
  const [authorityTitle, setAuthorityTitle] = useState(
    "Chief Operating Officer",
  );
  const [attested, setAttested] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const errorRef = useRef<HTMLParagraphElement>(null);
  const idempotencyKeyRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    getActiveAgreementTemplate({ jurisdiction: "US", type: "csa" })
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
  }, []);

  const accept = async () => {
    if (!template) return;
    if (!authorityTitle.trim()) {
      document.querySelector<HTMLInputElement>("#authority-title")?.focus();
      return;
    }
    if (!attested) {
      document
        .querySelector<HTMLInputElement>("#authority-attestation")
        ?.focus();
      return;
    }
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
      await executeClickAgreement(
        {
          accountId: "11111111-1111-4111-8111-111111111111",
          templateId: template.id,
          templateVersion: template.semanticVersion,
          exactText: template.exactText,
          exactTextHash: template.exactTextHash,
          authorityTitle,
        },
        { idempotencyKey: idempotencyKeyRef.current },
      );
      setMessage(
        "The server accepted the agreement and recorded the authority evidence.",
      );
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
          <h1>{customerPartnerCopy.commercial.agreementReview}</h1>
          <p className={styles.description}>
            Confirm the agreement title, version, exact approved terms, and your
            authority before binding Northstar Archive Labs.
          </p>
        </div>
        <Link className={styles.secondary} href="/agreements">
          Return to agreements
        </Link>
      </header>

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
                Cloud Service Agreement · version {template.semanticVersion}
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
              <summary>{customerPartnerCopy.common.technicalDetails}</summary>
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
                id="authority-title"
                onChange={(event) => setAuthorityTitle(event.target.value)}
                required
                value={authorityTitle}
              />
            </div>
            <label className={styles.check} htmlFor="authority-attestation">
              <input
                checked={attested}
                id="authority-attestation"
                onChange={(event) => setAttested(event.target.checked)}
                required
                type="checkbox"
              />
              <span>{customerPartnerCopy.commercial.agreementAuthority}</span>
            </label>
            <p className={styles.notice}>
              Accepting is a legal mutation. Clockwork records the version,
              exact text hash, actor, title, and time as audit evidence.
            </p>
            {message ? (
              <p className={styles.successMessage} role="status">
                {message}
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
