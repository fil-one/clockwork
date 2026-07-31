"use client";

import { useEffect, useState } from "react";

import { Button, StatusBadge } from "@clockwork/ui";

import { signingFixture } from "@/src/features/shared/demo-data";
import { t } from "@/src/i18n/en";

type SigningState = "review" | "loading" | "failed" | "returned";

export function SigningExperience({
  mode,
  verified = false,
}: {
  mode: "redirect" | "embedded" | "return";
  verified?: boolean;
}) {
  const [state, setState] = useState<SigningState>(
    mode === "return" ? (verified ? "returned" : "failed") : "review",
  );
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => setHydrated(true), []);

  useEffect(() => {
    if (state !== "loading") return;
    const timer = window.setTimeout(() => {
      if (mode === "redirect") {
        window.location.assign(
          `/signing/return?envelope=${signingFixture.envelope}&status=${signingFixture.status}&hash=${signingFixture.hash}`,
        );
      } else {
        setState("failed");
      }
    }, 650);
    return () => window.clearTimeout(timer);
  }, [mode, state]);

  return (
    <main className="signing-main" id="main-content">
      <header className="signing-header">
        <div className="signing-wordmark">
          FIL ONE <span>{t("app.product")}</span>
        </div>
        <StatusBadge
          tone={
            state === "returned"
              ? "success"
              : state === "failed"
                ? "danger"
                : "neutral"
          }
        >
          {t(
            state === "returned"
              ? "status.signed"
              : state === "failed"
                ? "status.blocked"
                : "status.ready",
          )}
        </StatusBadge>
      </header>
      <section className="signing-card" aria-live="polite">
        <p className="eyebrow">{t("signing.eyebrow")}</p>
        <h1>{t(mode === "embedded" ? "signing.embedded" : "signing.title")}</h1>
        <p>{t("signing.description")}</p>
        <dl className="signing-summary">
          <div>
            <dt>{t("common.reference")}</dt>
            <dd>{signingFixture.reference}</dd>
          </div>
          <div>
            <dt>{t("common.account")}</dt>
            <dd>{signingFixture.account}</dd>
          </div>
          <div>
            <dt>{t("common.term")}</dt>
            <dd>{signingFixture.term}</dd>
          </div>
        </dl>
        {state === "loading" ? (
          <div className="provider-state" role="status">
            <span className="provider-progress" aria-hidden="true" />
            <p>{t("signing.loading")}</p>
          </div>
        ) : null}
        {state === "failed" ? (
          <div className="provider-state provider-state--error" role="alert">
            <h2>{t("signing.failed")}</h2>
            <p>
              {t(
                mode === "return"
                  ? "signing.unverified"
                  : "state.recoverable.description",
              )}
            </p>
            <Button disabled={!hydrated} onClick={() => setState("loading")}>
              {t("signing.recover")}
            </Button>
          </div>
        ) : null}
        {state === "returned" ? (
          <div className="provider-state provider-state--success" role="status">
            <h2>{t("state.success.title")}</h2>
            <p>{t("signing.returned")}</p>
            <Button>{t("action.download")}</Button>
          </div>
        ) : null}
        {state === "review" ? (
          <div className="signing-actions">
            <Button disabled={!hydrated} onClick={() => setState("loading")}>
              {t("signing.redirect")}
            </Button>
            <Button variant="secondary">{t("action.cancel")}</Button>
          </div>
        ) : null}
      </section>
    </main>
  );
}
