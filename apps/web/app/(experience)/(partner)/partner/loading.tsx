import { Skeleton } from "@clockwork/ui";

import { t } from "@/src/i18n/en";

import styles from "./loading.module.css";

const facts = [0, 1, 2];
const ledgerRows = [0, 1, 2, 3, 4, 5];

/**
 * The shell renders from the layout, so this covers only the page content and
 * holds the same bands the partner desk resolves into.
 */
export default function PartnerLoading() {
  return (
    <main className={styles.main} id="main-content">
      <p className="cw-sr-only" role="status">
        {t("state.loading.title")}
      </p>

      <div className={styles.header}>
        <div className={styles.headerCopy}>
          <Skeleton width="min(24rem, 80%)" height="2.5rem" decorative />
          <Skeleton width="min(34rem, 95%)" height="1rem" decorative />
          <Skeleton width="14rem" height="0.75rem" decorative />
        </div>
        <Skeleton width="12rem" height="2.75rem" decorative />
      </div>

      <div className={styles.clock}>
        <div className={styles.bandHeading}>
          <div className={styles.bandCopy}>
            <Skeleton width="10rem" height="0.75rem" decorative />
            <Skeleton width="16rem" height="1.25rem" decorative />
          </div>
          <Skeleton width="14rem" height="0.75rem" decorative />
        </div>
        <Skeleton height="4.5rem" decorative />
        <div className={styles.facts}>
          {facts.map((index) => (
            <div className={styles.fact} key={index}>
              <Skeleton width="7rem" height="0.75rem" decorative />
              <Skeleton width="min(12rem, 90%)" height="1rem" decorative />
            </div>
          ))}
        </div>
      </div>

      <div className={styles.ledger}>
        <div className={styles.bandHeading}>
          <div className={styles.bandCopy}>
            <Skeleton width="14rem" height="1.25rem" decorative />
            <Skeleton width="min(26rem, 90%)" height="0.875rem" decorative />
          </div>
          <Skeleton width="6rem" height="0.75rem" decorative />
        </div>
        <div className={styles.rows}>
          {ledgerRows.map((index) => (
            <div className={styles.row} key={index}>
              <Skeleton height="1.25rem" decorative />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
