import { CommercialCollectionPage } from "@/src/features/customer-partner/commercial/collection-page";
import type { RawSearchParams } from "@/src/features/customer-partner/commercial/url-state";
import { SurfacePermissionGate } from "@/src/features/shell/permission-gate";
import { getRouteRoles } from "@/src/features/shell/route-session";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const roles = await getRouteRoles("customer");
  const canWrite = roles.some((role) => role === "owner" || role === "admin");
  return (
    <SurfacePermissionGate audience="customer" requiredPermission="order:read">
      <CommercialCollectionPage
        canUsePrimaryAction={canWrite}
        kind="orders"
        searchParams={await searchParams}
      />
    </SurfacePermissionGate>
  );
}
