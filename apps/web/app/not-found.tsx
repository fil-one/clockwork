import Link from "next/link";

import { EmptyState } from "@clockwork/ui";

import { t } from "@/src/i18n/en";

/**
 * Root 404. Without this, an unmatched path falls through to the framework
 * default, which carries no brand, no navigation and no way back.
 */
export default function NotFound() {
  return (
    <main className="permission-view" id="main-content">
      <EmptyState
        title={t("state.notFound.title")}
        description={t("state.notFound.description")}
        action={
          <Link
            className="cw-button cw-button--primary cw-button--medium"
            href="/"
          >
            {t("action.returnHome")}
          </Link>
        }
      />
    </main>
  );
}
