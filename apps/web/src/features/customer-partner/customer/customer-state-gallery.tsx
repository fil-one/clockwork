import Link from "next/link";

import { ApplicationStatePanel, SkeletonGroup } from "@clockwork/ui";

import { customerPartnerCopy } from "../copy";
import styles from "./customer-pages.module.css";

const common = customerPartnerCopy.common;

export function CustomerStateGallery() {
  return (
    <main className={styles.main} id="main-content">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Customer workspace</p>
          <h1>Collection states</h1>
          <p className={styles.description}>
            Reusable states for every customer and partner collection.
          </p>
        </div>
      </header>
      <section className={styles.stateGrid} aria-label="Collection states">
        <ApplicationStatePanel
          state="loading"
          title={common.loadingTitle}
          description={common.loadingBody}
          details={<SkeletonGroup label={common.loadingTitle} rows={3} />}
        />
        <ApplicationStatePanel
          state="empty"
          title={common.emptyTitle}
          description={common.emptyBody}
        />
        <ApplicationStatePanel
          state="empty"
          title={common.noMatchTitle}
          description={common.noMatchBody}
          action={<Link href="/states">Clear filters</Link>}
        />
        <ApplicationStatePanel
          state="permission"
          title={common.permissionTitle}
          description={common.permissionBody}
          action={<Link href="/dashboard">Return to dashboard</Link>}
        />
        <ApplicationStatePanel
          state="recoverable-error"
          title={common.errorTitle}
          description={common.errorBody}
          action={<Link href="/states">Try again</Link>}
        />
      </section>
    </main>
  );
}
