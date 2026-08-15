import Link from "next/link";
import type { ReactNode } from "react";

import { ApplicationStatePanel, buttonClassName } from "@clockwork/ui";

import { t } from "@/src/i18n/en";
import { getRouteSession } from "@/src/features/shell/route-session";
import { loadPartnerRecords } from "@/src/features/experience-server/portal-view-loader";

import { PartnerCollection } from "./partner-collection";
import { partnerSurfaces, type PartnerSurfaceKey } from "./partner-data";
import styles from "./partner.module.css";

/**
 * An identity with no partner membership for the selected organization is a
 * permission outcome, not a failure. Throwing here would reach the route error
 * boundary, whose only offer is a retry that re-throws.
 */
function NoPartnerMembership() {
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

export async function PartnerCollectionRoute({
  surface,
  actions,
}: {
  surface: PartnerSurfaceKey;
  /**
   * Server-backed action for this surface, supplied by the route so the panel
   * carries the route's own permission gate rather than a second guess at it.
   */
  actions?: ReactNode;
}) {
  const session = await getRouteSession("partner");
  const partnerMembership = session.memberships.find(
    (membership) => membership.accountId === session.effectiveAccountId,
  );
  if (!partnerMembership) return <NoPartnerMembership />;
  const projection = await loadPartnerRecords(surface);
  return (
    <PartnerCollection
      surface={surface}
      config={{ ...partnerSurfaces[surface], records: projection.records }}
      roles={session.roles}
      partnerName={partnerMembership.accountName}
      // The loader has always returned these two. This route dropped them and
      // rendered the rows as current; the reader had no way to know otherwise.
      freshness={{
        generatedAt: projection.generatedAt,
        stale: projection.stale,
      }}
      formatting={{ locale: session.locale, timeZone: session.timeZone }}
      {...(actions ? { actions } : {})}
    />
  );
}
