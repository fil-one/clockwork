"use client";

import { useEffect } from "react";

import { Button } from "@clockwork/ui";

import { t } from "@/src/i18n/en";

export default function ExperienceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Experience route error", { digest: error.digest });
  }, [error]);
  return (
    <main className="permission-view" id="main-content">
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
