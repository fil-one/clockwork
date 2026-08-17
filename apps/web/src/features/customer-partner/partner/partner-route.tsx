import type { ReactNode } from "react";

import { getRouteSession } from "@/src/features/shell/route-session";
import { loadPartnerRecords } from "@/src/features/experience-server/portal-view-loader";

import {
  PartnerCollection,
  PartnerSurfacePermission,
} from "./partner-collection";
import { partnerSurfaces, type PartnerSurfaceKey } from "./partner-data";
import {
  NoPartnerMembership,
  partnerRouteMembership,
} from "./partner-membership";
import { roleCanUseSurface } from "./partner-rules";
import { canReadPartnerChannel } from "./partner-access";

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
  const partnerMembership = partnerRouteMembership(session);
  if (!partnerMembership) return <NoPartnerMembership />;
  const config = partnerSurfaces[surface];
  const assistedInternal = Boolean(session.assistedSession);
  if (
    !canReadPartnerChannel(session.roles, surface, assistedInternal) ||
    (!assistedInternal && !roleCanUseSurface(session.roles, config.roles))
  )
    return <PartnerSurfacePermission />;
  const projection = await loadPartnerRecords(surface);
  return (
    <PartnerCollection
      surface={surface}
      config={{ ...config, records: projection.records }}
      roles={session.roles}
      partnerName={partnerMembership.accountName}
      // The loader has always returned these. This route dropped them and
      // rendered the rows as current; the reader had no way to know otherwise.
      //
      // `truncated` is the third of them and says something `stale` cannot:
      // rows are missing, so the result count and the facet choices below
      // describe a prefix. The loader stopped raising this as an error
      // precisely so the read would succeed -- succeeding silently would just
      // move the defect from a refused route to a wrong page.
      freshness={{
        generatedAt: projection.generatedAt,
        partial: projection.truncated,
        stale: projection.stale,
      }}
      formatting={{ locale: session.locale, timeZone: session.timeZone }}
      {...(actions ? { actions } : {})}
    />
  );
}
