import { getTranslations } from "@/src/i18n/server";
import { use } from "react";
import { Skeleton } from "@clockwork/ui";

import styles from "./loading.module.css";

const recommendations = [0, 1, 2];
const actionRows = [0, 1, 2, 3];
const monitoringRows = [0, 1, 2];

function SignalRows({ rows }: { rows: readonly number[] }) {
  return (
    <div className={styles.rows}>
      {rows.map((index) => (
        <div className={styles.row} key={index}>
          <Skeleton height="2.1rem" decorative />
        </div>
      ))}
    </div>
  );
}

function BandHeading() {
  return (
    <div className={styles.bandHeading}>
      <div className={styles.bandCopy}>
        <Skeleton width="min(16rem, 90%)" height="1.15rem" decorative />
        <Skeleton width="min(30rem, 100%)" height="0.8rem" decorative />
      </div>
    </div>
  );
}

/**
 * The shell renders from the layout, so this covers only the page content and
 * holds the same bands the operations home resolves into.
 */
export default function InternalLoading() {
  const t = use(getTranslations());
  return (
    <main className={styles.main} id="main-content">
      <p className="cw-sr-only" role="status">
        {t("common.loading")}
      </p>

      <div className={styles.header}>
        <div className={styles.bandCopy}>
          <Skeleton width="min(20rem, 90%)" height="2.2rem" decorative />
          <Skeleton width="min(38rem, 100%)" height="0.9rem" decorative />
        </div>
        <Skeleton width="9rem" height="0.72rem" decorative />
      </div>

      <div>
        <div className={styles.bandHeading}>
          <div className={styles.bandCopy}>
            <Skeleton width="min(18rem, 90%)" height="1.15rem" decorative />
            <Skeleton width="min(30rem, 100%)" height="0.8rem" decorative />
          </div>
          <Skeleton width="9rem" height="2.75rem" decorative />
        </div>
        <div className={styles.recommendations}>
          {recommendations.map((index) => (
            <div className={styles.recommendation} key={index}>
              <Skeleton width="1.25rem" height="1rem" decorative />
              <div className={styles.recommendationCopy}>
                <Skeleton width="min(26rem, 90%)" height="1rem" decorative />
                <Skeleton width="min(34rem, 100%)" height="0.8rem" decorative />
              </div>
              <Skeleton width="8rem" height="1rem" decorative />
            </div>
          ))}
        </div>
      </div>

      <div>
        <BandHeading />
        <SignalRows rows={actionRows} />
      </div>

      <div>
        <BandHeading />
        <SignalRows rows={monitoringRows} />
      </div>
    </main>
  );
}
