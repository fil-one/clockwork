import type { Permission } from "@clockwork/contracts";
import type { ReactNode } from "react";

import { SurfacePermissionGate } from "@/src/features/shell/permission-gate";

import { lifecycleCopy } from "./copy";
import styles from "./finance-lifecycle.module.css";

export function FinancePageFrame({
  title,
  description,
  freshness,
  source,
  permission,
  children,
}: {
  title: string;
  description: string;
  freshness: string;
  source: string;
  permission: Permission;
  children: ReactNode;
}) {
  return (
    <SurfacePermissionGate audience="internal" requiredPermission={permission}>
      <main className={styles.page} id="main-content">
        <header className={styles.header}>
          <div className={styles.headerCopy}>
            <p className={styles.eyebrow}>{lifecycleCopy.eyebrow}</p>
            <h1 className={styles.title}>{title}</h1>
            <p className={styles.description}>{description}</p>
          </div>
          <div
            className={styles.freshness}
            aria-label={lifecycleCopy.provenance}
          >
            <strong>{freshness}</strong>
            {lifecycleCopy.sourcePrefix} {source}
          </div>
        </header>
        {children}
      </main>
    </SurfacePermissionGate>
  );
}
