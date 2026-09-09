"use client";
import { useTranslations } from "@/src/i18n/client";

import { useEffect } from "react";

import { Button } from "@clockwork/ui";

/**
 * The partner group's error boundary.
 *
 * It sits below `(partner)/layout.tsx`, so it renders inside `AppShell`. The
 * group declared no `error.tsx` at all: every partner surface -- the desk,
 * portfolio, quotes, registrations, commissions, billing, disputes, renewals,
 * sandboxes, brand, marketplace and support -- fell through to
 * `(experience)/error.tsx`, above the layout, and lost the shell.
 */
export default function PartnerExperienceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations();
  useEffect(() => {
    console.error("Partner experience route error", { digest: error.digest });
  }, [error]);
  return (
    <main className="experience-main" id="main-content">
      <section className="state-card state-card--danger" role="alert">
        <h1>{t("state.fatal.title")}</h1>
        <p>{t("state.fatal.description")}</p>
        {error.digest ? (
          <p className="eyebrow">
            <code>{t("app.requestId", { id: error.digest })}</code>
          </p>
        ) : null}
        <Button onClick={reset}>{t("action.retry")}</Button>
      </section>
    </main>
  );
}
