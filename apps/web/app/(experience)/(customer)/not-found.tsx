import Link from "next/link";

import { buttonClassName, EmptyState } from "@clockwork/ui";

import { t } from "@/src/i18n/en";

/**
 * The customer group's not-found boundary.
 *
 * `notFound()` looks for the nearest `not-found.tsx` above the caller. The
 * group declared none, so `/states` in a production runtime -- the design
 * gallery deliberately calls `notFound()` there -- fell all the way to
 * `app/not-found.tsx` and replaced the shell with an unadorned 404.
 *
 * This file sits below `(customer)/layout.tsx`, so the same call now answers
 * inside `AppShell` and the reader keeps their navigation.
 */
export default function CustomerNotFound() {
  return (
    <main className="experience-main" id="main-content">
      <EmptyState
        title={t("state.notFound.title")}
        description={t("state.notFound.description")}
        action={
          <Link
            className={buttonClassName({ variant: "primary", size: "medium" })}
            href="/dashboard"
          >
            {t("action.returnHome")}
          </Link>
        }
      />
    </main>
  );
}
