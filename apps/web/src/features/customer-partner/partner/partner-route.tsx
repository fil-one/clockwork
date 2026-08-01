import { getRouteRoles } from "@/src/features/shell/route-session";

import { PartnerCollection } from "./partner-collection";
import { partnerSurfaces, type PartnerSurfaceKey } from "./partner-data";

export async function PartnerCollectionRoute({
  surface,
}: {
  surface: PartnerSurfaceKey;
}) {
  const roles = await getRouteRoles("partner");
  return (
    <PartnerCollection
      surface={surface}
      config={partnerSurfaces[surface]}
      roles={roles}
    />
  );
}
