import Link from "next/link";

import { buttonClassName, EmptyState } from "@clockwork/ui";

import { t } from "@/src/i18n/en";

/**
 * The experience group's shell-less 404, and the last one before the root.
 *
 * A `notFound()` raised inside an audience group is answered by that group's
 * own `not-found.tsx`, which renders inside the shell. This file answers the
 * one case those cannot: a `notFound()` raised by an audience layout, above
 * every boundary that has a shell to keep. It matches the root 404 rather than
 * inventing a second look for the same outcome.
 */
export default function ExperienceNotFound() {
  return (
    <main className="permission-view" id="main-content">
      <EmptyState
        title={t("state.notFound.title")}
        description={t("state.notFound.description")}
        action={
          <Link
            className={buttonClassName({ variant: "primary", size: "medium" })}
            href="/"
          >
            {t("action.returnHome")}
          </Link>
        }
      />
    </main>
  );
}
