import { CommercialCollectionPage } from "@/src/features/customer-partner/commercial/collection-page";
import type { RawSearchParams } from "@/src/features/customer-partner/commercial/url-state";
import { SurfacePermissionGate } from "@/src/features/shell/permission-gate";
import { getRouteRoles } from "@/src/features/shell/route-session";
import { loadCommercialRecords } from "@/src/features/experience-server/portal-view-loader";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const [roles, projection] = await Promise.all([
    getRouteRoles("customer"),
    loadCommercialRecords("agreements"),
  ]);
  const canExecute = roles.some((role) => role === "owner" || role === "admin");
  return (
    <SurfacePermissionGate
      audience="customer"
      requiredPermission="agreement:read"
    >
      <CommercialCollectionPage
        canUsePrimaryAction={canExecute}
        kind="agreements"
        records={projection.records}
        searchParams={await searchParams}
      />
    </SurfacePermissionGate>
  );
}
