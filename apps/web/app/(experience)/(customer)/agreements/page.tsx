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
  const canExecute = roles.some((role) => role === "owner" || role === "admin");
  return (
    <SurfacePermissionGate
      audience="customer"
      requiredPermission="agreement:read"
    >
      <CommercialCollectionPage
        canUsePrimaryAction={canExecute}
        kind="agreements"
        searchParams={await searchParams}
      />
    </SurfacePermissionGate>
  );
}
