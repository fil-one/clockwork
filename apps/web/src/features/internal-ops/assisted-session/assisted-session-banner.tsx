import Link from "next/link";

import { internalOpsCopy } from "../copy";
import styles from "./assisted-session-banner.module.css";

export function AssistedSessionBanner() {
  const copy = internalOpsCopy.assisted;
  return (
    <aside className={styles.banner} aria-label={copy.label}>
      <div className={styles.title}>
        <span aria-hidden="true" />
        <strong>{copy.label}</strong>
      </div>
      <dl>
        <div>
          <dt>{copy.effectiveAccount}</dt>
          <dd>{copy.account}</dd>
        </div>
        <div>
          <dt>{copy.staffActor}</dt>
          <dd>{copy.actor}</dd>
        </div>
        <div>
          <dt>{copy.reasonLabel}</dt>
          <dd>{copy.reason}</dd>
        </div>
      </dl>
      <p>{copy.authority}</p>
      <Link href="/internal/assisted?exit=review">{copy.exit}</Link>
    </aside>
  );
}
