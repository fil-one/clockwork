import { CommercialCollectionPage } from "@/src/features/customer-partner/commercial/collection-page";
import type { RawSearchParams } from "@/src/features/customer-partner/commercial/url-state";
import { SurfacePermissionGate } from "@/src/features/shell/permission-gate";
import { loadCommercialRecords } from "@/src/features/experience-server/portal-view-loader";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const projection = await loadCommercialRecords("services");
  return (
    <SurfacePermissionGate audience="customer" requiredPermission="order:read">
      <CommercialCollectionPage
        kind="services"
        records={projection.records}
        searchParams={await searchParams}
      />
    </SurfacePermissionGate>
  );
}
