import { CommercialCollectionPage } from "@/src/features/customer-partner/commercial/collection-page";
import type { RawSearchParams } from "@/src/features/customer-partner/commercial/url-state";
import { SurfacePermissionGate } from "@/src/features/shell/permission-gate";
import { loadCommercialRecords } from "@/src/features/experience-server/portal-view-loader";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const projection = await loadCommercialRecords("billing");
  return (
    <SurfacePermissionGate
      audience="customer"
      requiredPermission="billing:read"
    >
      <CommercialCollectionPage
        kind="billing"
        records={projection.records}
        searchParams={await searchParams}
      />
    </SurfacePermissionGate>
  );
}
