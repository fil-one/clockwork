import { getTranslations } from "@/src/i18n/server";
import { use } from "react";
import Link from "next/link";

import { buttonClassName, EmptyState } from "@clockwork/ui";

/**
 * Root 404. Without this, an unmatched path falls through to the framework
 * default, which carries no brand, no navigation and no way back.
 */
export default function NotFound() {
  const t = use(getTranslations());
  return (
    <main className="permission-view" id="main-content">
      <EmptyState
        title={t("state.notFound.title")}
        description={t("state.notFound.description")}
        action={
          <Link
            className={buttonClassName({
              variant: "primary",
              size: "medium",
            })}
            href="/"
          >
            {t("action.returnHome")}
          </Link>
        }
      />
    </main>
  );
}
