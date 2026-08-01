import { getRouteSession } from "@/src/features/shell/route-session";
import { loadPartnerRecords } from "@/src/features/experience-server/portal-view-loader";

import { PartnerCollection } from "./partner-collection";
import { partnerSurfaces, type PartnerSurfaceKey } from "./partner-data";

export async function PartnerCollectionRoute({
  surface,
}: {
  surface: PartnerSurfaceKey;
}) {
  const session = await getRouteSession("partner");
  const projection = await loadPartnerRecords(surface);
  const partnerMembership = session.memberships.find(
    (membership) => membership.accountId === session.effectiveAccountId,
  );
  if (!partnerMembership)
    throw new Error(
      "The selected partner account is not an authorized membership",
    );
  return (
    <PartnerCollection
      surface={surface}
      config={{ ...partnerSurfaces[surface], records: projection.records }}
      roles={session.roles}
      partnerName={partnerMembership.accountName}
    />
  );
}
