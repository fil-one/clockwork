import Link from "next/link";

import { buttonClassName, EmptyState } from "@clockwork/ui";

import { t } from "@/src/i18n/en";

/**
 * The internal group's not-found boundary, below `(internal)/layout.tsx` and
 * so inside `AppShell` and below the assisted-session banner. An operator who
 * follows a stale queue link keeps both, rather than landing on a root 404
 * that says nothing about the session they are still inside.
 */
export default function InternalNotFound() {
  return (
    <main className="experience-main" id="main-content">
      <EmptyState
        title={t("state.notFound.title")}
        description={t("state.notFound.description")}
        action={
          <Link
            className={buttonClassName({ variant: "primary", size: "medium" })}
            href="/internal"
          >
            {t("nav.internal.home")}
          </Link>
        }
      />
    </main>
  );
}
