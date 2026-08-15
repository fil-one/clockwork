"use client";

import { useEffect } from "react";

import { Button } from "@clockwork/ui";

import { t } from "@/src/i18n/en";

/**
 * The customer group's error boundary.
 *
 * It sits below `(customer)/layout.tsx`, so it renders inside `AppShell`: a
 * failing page loses the page, not the navigation rail, the organization
 * switcher, the command palette or the banner. Before this file existed the
 * nearest boundary was `(experience)/error.tsx`, which is above that layout,
 * and every customer surface without its own `error.tsx` -- dashboard,
 * account, amendments, marketplace, support and every nested route under them
 * -- took the whole shell down with it.
 *
 * The six collection segments that already declare `error.tsx` keep theirs;
 * a nearer boundary wins. This one covers the rest of the group.
 */
export default function CustomerExperienceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Customer experience route error", { digest: error.digest });
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
