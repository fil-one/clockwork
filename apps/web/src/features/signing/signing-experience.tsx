"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

import {
  BrandLogo,
  Button,
  buttonClassName,
  Input,
  StatusBadge,
} from "@clockwork/ui";

import { experienceErrorText } from "@/src/features/contracts/error-text";
import {
  ExperienceClientError,
  readAuthoritativeSigningReturn,
  startAuthoritativeSigning,
} from "@/src/features/contracts/experience-client";
import { trustedSigningUrl } from "@/src/features/contracts/provider-navigation";
import type { EsignReturnStatus } from "@/src/features/experience-server/model";
import { brandAsset } from "@/src/features/shell/brand-assets";
import type { MessageId, Translator } from "@/src/i18n";
import { useTranslations } from "@/src/i18n/client";
import { richText } from "@/src/i18n/rich";

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

/**
 * Signing failures the server names, worded for the reader. The server's own
 * problem `title` is English and is never shown; anything it does not name
 * falls back to the shared API wording, and a failure that never reached the
 * server to the caller's own sentence.
 */
const signingProblems: Readonly<Record<string, MessageId>> = {
  ESIGN_RETURN_NOT_FOUND: "platform.signing.returnUnknown",
  ESIGN_RETURN_EXPIRED: "platform.signing.returnExpired",
  ESIGN_STATE_INVALID: "signing.unverifiable",
  ESIGN_LAUNCH_FAILED: "platform.signing.launchFailed",
};

function signingErrorText(
  caught: unknown,
  t: Translator,
  fallback: MessageId,
): string {
  if (!(caught instanceof ExperienceClientError)) return t(fallback);
  const known = signingProblems[caught.code];
  return known ? t(known) : experienceErrorText(caught, t);
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
  const t = useTranslations();
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
      setError(t("signing.missingState"));
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
      setError(signingErrorText(caught, t, "signing.unverifiable"));
      setState("failed");
      window.setTimeout(() => errorRef.current?.focus(), 0);
    }
  }, [returnState, t]);

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
    const fail = (message: string) => {
      setError(message);
      setState("failed");
      window.setTimeout(() => errorRef.current?.focus(), 0);
    };
    let signingUrl: string;
    try {
      const session = await startAuthoritativeSigning({
        agreementId: value(new FormData(form), "agreementId"),
        mode: mode === "embedded" ? "embedded" : "redirect",
      });
      signingUrl = session.signingUrl;
    } catch (caught) {
      fail(signingErrorText(caught, t, "signing.requestFailed"));
      return;
    }
    try {
      setProviderUrl(trustedSigningUrl(signingUrl));
    } catch {
      // The allow-list refused the provider's address; it is never opened.
      fail(t("platform.signing.untrustedUrl"));
      return;
    }
    setState("requested");
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
          <BrandLogo src={brandAsset()} name={t("app.name")} />
          <span>{t("app.product")}</span>
        </div>
        <StatusBadge tone={tone}>{statusLabel}</StatusBadge>
      </header>
      <section className="signing-card">
        <p className="eyebrow">{t("signing.eyebrow")}</p>
        <h1>{t(mode === "embedded" ? "signing.embedded" : "signing.title")}</h1>
        <p>{t("signing.description")}</p>
        {mode !== "return" ? (
          <form onSubmit={(event) => void beginSigning(event)} noValidate>
            {agreementId ? (
              <>
                <input type="hidden" name="agreementId" value={agreementId} />
                <p>
                  {richText(t, "platform.signing.agreementReference", {
                    reference: (
                      <strong>
                        <bdi>{agreementId}</bdi>
                      </strong>
                    ),
                  })}
                </p>
              </>
            ) : (
              <Input
                label={t("signing.agreementId")}
                name="agreementId"
                required
              />
            )}
            <p>{t("signing.serverSelected")}</p>
            {state === "loading" ? (
              <div className="provider-state" role="status">
                <span className="provider-progress" aria-hidden="true" />
                <p>{t("signing.loading")}</p>
              </div>
            ) : null}
            {state === "requested" ? (
              <div className="provider-state" role="status">
                <p>{t("signing.accepted")}</p>
                {mode === "redirect" ? (
                  <a
                    className={buttonClassName({ variant: "primary" })}
                    href={providerUrl}
                    rel="noopener noreferrer"
                    referrerPolicy="no-referrer"
                  >
                    {t("signing.continue")}
                  </a>
                ) : (
                  <iframe
                    className="signing-frame"
                    src={providerUrl}
                    title={t("signing.frame")}
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
                <p>{error}</p>
              </div>
            ) : null}
            <div className="signing-actions">
              <Button type="submit" disabled={!hydrated || state === "loading"}>
                {state === "failed"
                  ? t("signing.recover")
                  : mode === "embedded"
                    ? t("signing.startEmbedded")
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
            <p>{t("signing.checking")}</p>
          </div>
        ) : null}
        {mode === "return" && state === "completed" ? (
          <div className="provider-state provider-state--success" role="status">
            <h2>{t("state.success.title")}</h2>
            <p>{t("signing.returned")}</p>
            {returnStatus?.signedDocumentId && returnState ? (
              <a
                className={buttonClassName({ variant: "secondary" })}
                href={`/api/experience/esign/returns/${encodeURIComponent(returnState)}/signed-document`}
              >
                {t("signing.download")}
              </a>
            ) : null}
            <Link
              className={buttonClassName({ variant: "primary" })}
              href="/agreements"
            >
              {t("signing.agreements")}
            </Link>
          </div>
        ) : null}
        {mode === "return" && state === "pending" ? (
          <div className="provider-state" role="status">
            <h2>{t("signing.pending.title")}</h2>
            <p>{t("signing.pending.description")}</p>
            <Button
              variant="secondary"
              type="button"
              onClick={() => void reconcileReturn()}
            >
              {t("signing.refresh")}
            </Button>
          </div>
        ) : null}
        {mode === "return" && (state === "declined" || state === "expired") ? (
          <div className="provider-state provider-state--error" role="alert">
            <h2>
              {t(
                state === "declined"
                  ? "signing.declined.title"
                  : "signing.expired.title",
              )}
            </h2>
            <p>{t("signing.unchanged")}</p>
            <Link
              className={buttonClassName({ variant: "primary" })}
              href="/agreements"
            >
              {t("signing.agreements")}
            </Link>
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
            <p>{error}</p>
            <Link
              className={buttonClassName({ variant: "primary" })}
              href="/agreements"
            >
              {t("signing.agreements")}
            </Link>
          </div>
        ) : null}
      </section>
    </main>
  );
}
