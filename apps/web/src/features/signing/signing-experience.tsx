"use client";

import { useEffect, useRef, useState } from "react";

import { Button, Input, StatusBadge } from "@clockwork/ui";

import {
  CommerceApiError,
  startAgreementEnvelope,
} from "@/src/features/contracts/commerce-client";
import { trustedSigningUrl } from "@/src/features/contracts/provider-navigation";
import { signingFixture } from "@/src/features/shared/demo-data";
import { t } from "@/src/i18n/en";

type SigningState = "review" | "loading" | "failed" | "requested" | "returned";

function value(data: FormData, name: string): string {
  const raw = data.get(name);
  return typeof raw === "string" ? raw.trim() : "";
}

const demoMode = ["development", "test"].includes(
  process.env.NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV ?? process.env.NODE_ENV ?? "",
);
const demoIds = {
  account: "11111111-1111-4111-8111-111111111111",
  agreement: "99999999-9999-4999-8999-999999999999",
  document: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
};

export function SigningExperience({
  mode,
  verified = false,
}: {
  mode: "redirect" | "embedded" | "return";
  verified?: boolean;
}) {
  const [state, setState] = useState<SigningState>(
    mode === "return" && verified && demoMode
      ? "returned"
      : mode === "return"
        ? "failed"
        : "review",
  );
  const [error, setError] = useState("");
  const [providerUrl, setProviderUrl] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => setHydrated(true), []);

  const beginSigning = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.checkValidity()) {
      form.reportValidity();
      form.querySelector<HTMLElement>(":invalid")?.focus();
      return;
    }
    const data = new FormData(form);
    setError("");
    setProviderUrl("");
    setState("loading");
    try {
      const session = await startAgreementEnvelope({
        accountId: value(data, "accountId"),
        agreementId: value(data, "agreementId"),
        documentId: value(data, "documentId"),
        signerEmail: value(data, "signerEmail"),
        mode: mode === "embedded" ? "embedded" : "redirect",
        returnUrl: `${window.location.origin}/signing/return`,
      });
      if (!session.signingUrl)
        throw new Error(
          "The e-sign provider did not return a signing session URL.",
        );
      setProviderUrl(trustedSigningUrl(session.signingUrl));
      setState("requested");
    } catch (caught) {
      if (
        caught instanceof CommerceApiError &&
        caught.code === "unavailable" &&
        demoMode
      ) {
        if (mode === "redirect") {
          window.location.assign(
            `/signing/return?envelope=${signingFixture.envelope}&status=${signingFixture.status}&hash=${signingFixture.hash}`,
          );
        } else setState("returned");
        return;
      }
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
    state === "returned"
      ? "success"
      : state === "failed"
        ? "danger"
        : "neutral";

  return (
    <main className="signing-main" id="main-content">
      <header className="signing-header">
        <div className="signing-wordmark">
          FIL ONE <span>{t("app.product")}</span>
        </div>
        <StatusBadge tone={tone}>
          {t(
            state === "returned"
              ? "status.signed"
              : state === "failed"
                ? "status.blocked"
                : state === "requested"
                  ? "status.pending"
                  : "status.ready",
          )}
        </StatusBadge>
      </header>
      <section className="signing-card" aria-live="polite">
        <p className="eyebrow">{t("signing.eyebrow")}</p>
        <h1>{t(mode === "embedded" ? "signing.embedded" : "signing.title")}</h1>
        <p>{t("signing.description")}</p>
        {mode !== "return" ? (
          <form
            onSubmit={(event) => {
              void beginSigning(event);
            }}
            noValidate
          >
            <Input
              label="Account ID"
              name="accountId"
              defaultValue={demoMode ? demoIds.account : ""}
              required
            />
            <Input
              label="Agreement ID"
              name="agreementId"
              defaultValue={demoMode ? demoIds.agreement : ""}
              required
            />
            <Input
              label="Exact document ID"
              name="documentId"
              defaultValue={demoMode ? demoIds.document : ""}
              required
            />
            <Input
              label="Signer email"
              name="signerEmail"
              type="email"
              defaultValue={demoMode ? "maya@northstar.example" : ""}
              required
            />
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
                    sandbox="allow-forms allow-popups allow-same-origin allow-scripts"
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
        {state === "returned" ? (
          <div className="provider-state provider-state--success" role="status">
            <h2>{t("state.success.title")}</h2>
            <p>{t("signing.returned")}</p>
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
            <p>{t("signing.unverified")}</p>
          </div>
        ) : null}
      </section>
    </main>
  );
}
