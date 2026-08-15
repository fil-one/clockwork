"use client";

import { useEffect } from "react";

import { Button } from "@clockwork/ui";

import { t } from "@/src/i18n/en";

/**
 * The internal group's error boundary.
 *
 * It sits below `(internal)/layout.tsx`, so it renders inside `AppShell` and,
 * critically, below the assisted-session banner that layout renders. An
 * operator whose queue page fails keeps the banner naming the session they are
 * acting inside; before this file existed the failure reached
 * `(experience)/error.tsx` above the layout and took the banner with it, which
 * is the one piece of chrome an audited assisted session must not lose.
 */
export default function InternalExperienceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Internal experience route error", { digest: error.digest });
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
