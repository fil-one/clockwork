import { use } from "react";

import { Skeleton } from "@clockwork/ui";

import styles from "@/src/features/internal-ops/owner-console/owner-console.module.css";
import { getTranslations } from "@/src/i18n/server";

const panels = [0, 1, 2, 3, 4, 5];

/**
 * The shell renders from the layout, so this covers only the page content and
 * holds the cards the owner console resolves into.
 */
export default function OwnerConsoleLoading() {
  const t = use(getTranslations());
  return (
    <main className={styles.main} id="main-content">
      <p className="cw-sr-only" role="status">
        {t("common.loading")}
      </p>
      <div className={styles.header}>
        <Skeleton width="min(16rem, 90%)" height="2.2rem" decorative />
        <Skeleton width="min(38rem, 100%)" height="0.9rem" decorative />
      </div>
      <div className={styles.grid}>
        {panels.map((index) => (
          <div className={styles.panel} key={index}>
            <Skeleton width="min(14rem, 80%)" height="1.15rem" decorative />
            <Skeleton width="min(24rem, 100%)" height="0.8rem" decorative />
            <Skeleton height="2.25rem" decorative />
            <Skeleton height="2.25rem" decorative />
          </div>
        ))}
      </div>
    </main>
  );
}
