"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { BrandLogo, Button, Input, StatusBadge } from "@clockwork/ui";

import {
  readAuthoritativeSigningReturn,
  startAuthoritativeSigning,
} from "@/src/features/contracts/experience-client";
import { trustedSigningUrl } from "@/src/features/contracts/provider-navigation";
import type { EsignReturnStatus } from "@/src/features/experience-server/model";
import { t } from "@/src/i18n/en";

type SigningState =
  | "review"
  | "loading"
  | "failed"
  | "requested"
  | "pending"
  | "completed"
  | "declined"
  | "expired";

function value(data: FormData, name: string): string {
  const raw = data.get(name);
  return typeof raw === "string" ? raw.trim() : "";
}

export function SigningExperience({
  mode,
  returnState,
  agreementId = "",
}: {
  mode: "redirect" | "embedded" | "return";
  returnState?: string;
  agreementId?: string;
}) {
  const [state, setState] = useState<SigningState>(
    mode === "return" ? "loading" : "review",
  );
  const [error, setError] = useState("");
  const [providerUrl, setProviderUrl] = useState("");
  const [returnStatus, setReturnStatus] = useState<EsignReturnStatus | null>(
    null,
  );
  const [hydrated, setHydrated] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => setHydrated(true), []);

  const reconcileReturn = useCallback(async () => {
    if (!returnState) {
      setError(
        "The signing return does not contain an authoritative state reference.",
      );
      setState("failed");
      return;
    }
    setError("");
    setState("loading");
    try {
      const status = await readAuthoritativeSigningReturn(returnState);
      setReturnStatus(status);
      setState(status.state);
    } catch (caught) {
      setReturnStatus(null);
      setError(
        caught instanceof Error
          ? caught.message
          : "The signing state could not be verified by the server.",
      );
      setState("failed");
      window.setTimeout(() => errorRef.current?.focus(), 0);
    }
  }, [returnState]);

  useEffect(() => {
    if (mode === "return") void reconcileReturn();
  }, [mode, reconcileReturn]);

  const beginSigning = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.checkValidity()) {
      form.reportValidity();
      form.querySelector<HTMLElement>(":invalid")?.focus();
      return;
    }
    setError("");
    setProviderUrl("");
    setState("loading");
    try {
      const session = await startAuthoritativeSigning({
        agreementId: value(new FormData(form), "agreementId"),
        mode: mode === "embedded" ? "embedded" : "redirect",
      });
      setProviderUrl(trustedSigningUrl(session.signingUrl));
      setState("requested");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The signing request failed. The agreement remains unchanged.",
      );
      setState("failed");
      window.setTimeout(() => errorRef.current?.focus(), 0);
    }
  };

  const tone =
    state === "completed"
      ? "success"
      : ["failed", "declined", "expired"].includes(state)
        ? "danger"
        : "neutral";
  const statusLabel =
    state === "completed"
      ? t("status.signed")
      : state === "pending" || state === "requested" || state === "loading"
        ? t("status.pending")
        : ["failed", "declined", "expired"].includes(state)
          ? t("status.blocked")
          : t("status.ready");

  return (
    <main className="signing-main" id="main-content">
      <header className="signing-header">
        <div className="signing-wordmark">
          <BrandLogo src="/brand/fo-wordmark-dark.png" name={t("app.name")} />
          <span>{t("app.product")}</span>
        </div>
        <StatusBadge tone={tone}>{statusLabel}</StatusBadge>
      </header>
      <section className="signing-card" aria-live="polite">
        <p className="eyebrow">{t("signing.eyebrow")}</p>
        <h1>{t(mode === "embedded" ? "signing.embedded" : "signing.title")}</h1>
        <p>{t("signing.description")}</p>
        {mode !== "return" ? (
          <form onSubmit={(event) => void beginSigning(event)} noValidate>
            {agreementId ? (
              <>
                <input type="hidden" name="agreementId" value={agreementId} />
                <p>
                  Agreement reference: <strong>{agreementId}</strong>
                </p>
              </>
            ) : (
              <Input label="Agreement ID" name="agreementId" required />
            )}
            <p>
              Your account, signer identity, and immutable agreement document
              are selected by the server from this persisted agreement.
            </p>
            {state === "loading" ? (
              <div className="provider-state" role="status">
                <span className="provider-progress" aria-hidden="true" />
                <p>{t("signing.loading")}</p>
              </div>
            ) : null}
            {state === "requested" ? (
              <div className="provider-state" role="status">
                <p>
                  Envelope accepted. The agreement remains inactive until a
                  signed provider callback is verified.
                </p>
                {mode === "redirect" ? (
                  <a
                    className="cw-button cw-button--primary"
                    href={providerUrl}
                    rel="noopener noreferrer"
                    referrerPolicy="no-referrer"
                  >
                    Continue to the approved e-sign provider
                  </a>
                ) : (
                  <iframe
                    className="signing-frame"
                    src={providerUrl}
                    title="Secure e-sign provider"
                    /* The provider frame keeps an opaque origin. Pairing
                       allow-same-origin with allow-scripts would let framed
                       script reach this document whenever the allow-listed
                       signing origin resolves to our own origin. */
                    sandbox="allow-forms allow-popups allow-scripts"
                    referrerPolicy="no-referrer"
                  />
                )}
              </div>
            ) : null}
            {state === "failed" ? (
              <div
                ref={errorRef}
                tabIndex={-1}
                className="provider-state provider-state--error"
                role="alert"
              >
                <h2>{t("signing.failed")}</h2>
                <p>{error || t("state.recoverable.description")}</p>
              </div>
            ) : null}
            <div className="signing-actions">
              <Button type="submit" disabled={!hydrated || state === "loading"}>
                {state === "failed"
                  ? t("signing.recover")
                  : mode === "embedded"
                    ? "Start embedded signing"
                    : t("signing.redirect")}
              </Button>
              <Button
                variant="secondary"
                type="reset"
                disabled={state === "loading"}
                onClick={() => {
                  setError("");
                  setProviderUrl("");
                  setState("review");
                }}
              >
                {t("action.cancel")}
              </Button>
            </div>
          </form>
        ) : null}

        {mode === "return" && state === "loading" ? (
          <div className="provider-state" role="status">
            <p>Checking the persisted envelope status…</p>
          </div>
        ) : null}
        {mode === "return" && state === "completed" ? (
          <div className="provider-state provider-state--success" role="status">
            <h2>{t("state.success.title")}</h2>
            <p>{t("signing.returned")}</p>
            {returnStatus?.signedDocumentId && returnState ? (
              <a
                className="cw-button cw-button--secondary"
                href={`/api/experience/esign/returns/${encodeURIComponent(returnState)}/signed-document`}
              >
                Download signed agreement
              </a>
            ) : null}
          </div>
        ) : null}
        {mode === "return" && state === "pending" ? (
          <div className="provider-state" role="status">
            <h2>Signature pending</h2>
            <p>The provider has not yet confirmed a completed signature.</p>
            <Button
              variant="secondary"
              type="button"
              onClick={() => void reconcileReturn()}
            >
              Refresh status
            </Button>
          </div>
        ) : null}
        {mode === "return" && (state === "declined" || state === "expired") ? (
          <div className="provider-state provider-state--error" role="alert">
            <h2>
              {state === "declined"
                ? "Signature declined"
                : "Signing session expired"}
            </h2>
            <p>
              The agreement remains unchanged. Return to the agreement to review
              next steps.
            </p>
          </div>
        ) : null}
        {mode === "return" && state === "failed" ? (
          <div
            ref={errorRef}
            tabIndex={-1}
            className="provider-state provider-state--error"
            role="alert"
          >
            <h2>{t("signing.failed")}</h2>
            <p>{error || t("signing.unverified")}</p>
          </div>
        ) : null}
      </section>
    </main>
  );
}
