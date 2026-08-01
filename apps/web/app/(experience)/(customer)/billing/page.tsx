import { CommercialCollectionPage } from "@/src/features/customer-partner/commercial/collection-page";
import type { RawSearchParams } from "@/src/features/customer-partner/commercial/url-state";
import { SurfacePermissionGate } from "@/src/features/shell/permission-gate";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  return (
    <SurfacePermissionGate
      audience="customer"
      requiredPermission="billing:read"
    >
      <CommercialCollectionPage
        kind="billing"
        searchParams={await searchParams}
      />
    </SurfacePermissionGate>
  );
}
