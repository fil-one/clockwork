import { CommercialCollectionPage } from "@/src/features/customer-partner/commercial/collection-page";
import type { RawSearchParams } from "@/src/features/customer-partner/commercial/url-state";
import { SurfacePermissionGate } from "@/src/features/shell/permission-gate";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  return (
    <SurfacePermissionGate audience="customer" requiredPermission="order:read">
      <CommercialCollectionPage
        kind="services"
        searchParams={await searchParams}
      />
    </SurfacePermissionGate>
  );
}
