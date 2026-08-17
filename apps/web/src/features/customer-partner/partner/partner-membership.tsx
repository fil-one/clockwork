import Link from "next/link";

import { ApplicationStatePanel, buttonClassName } from "@clockwork/ui";

import { t } from "@/src/i18n/en";
import type { RouteSession } from "@/src/features/shell/route-session";

import styles from "./partner.module.css";

/**
 * Resolves the selected partner account exactly as every partner collection
 * does. Audience and role admission remains in the partner layout; this check
 * prevents a selected organization with no matching commerce membership from
 * being presented as a partner account.
 */
export function partnerRouteMembership(
  session: Pick<RouteSession, "memberships" | "effectiveAccountId">,
) {
  return session.memberships.find(
    (membership) => membership.accountId === session.effectiveAccountId,
  );
}

/** A missing partner membership is a permission outcome, not a route error. */
export function NoPartnerMembership() {
  return (
    <main className={styles.main} id="main-content">
      <div className={styles.state}>
        <ApplicationStatePanel
          state="permission"
          title={t("partner.access.title")}
          description={t("partner.access.description")}
          action={
            <Link
              className={buttonClassName({ variant: "secondary" })}
              href="/choose-organization"
            >
              {t("partner.access.action")}
            </Link>
          }
        />
      </div>
    </main>
  );
}
