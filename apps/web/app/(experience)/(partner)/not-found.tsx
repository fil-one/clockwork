import Link from "next/link";

import { buttonClassName, EmptyState } from "@clockwork/ui";

import { t } from "@/src/i18n/en";

/**
 * The partner group's not-found boundary, below `(partner)/layout.tsx` and so
 * inside `AppShell`. Without it a `notFound()` from any partner surface falls
 * to the root 404 and the partner desk's navigation disappears with it.
 */
export default function PartnerNotFound() {
  return (
    <main className="experience-main" id="main-content">
      <EmptyState
        title={t("state.notFound.title")}
        description={t("state.notFound.description")}
        action={
          <Link
            className={buttonClassName({ variant: "primary", size: "medium" })}
            href="/partner"
          >
            {t("nav.partner.home")}
          </Link>
        }
      />
    </main>
  );
}
