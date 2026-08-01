import { CustomerCollection } from "@/src/features/customer-partner/customer/customer-collection";
import { customerCollections } from "@/src/features/customer-partner/customer/customer-data";
import type { RawCollectionSearchParams } from "@/src/features/customer-partner/customer/collection-state";
import { SurfacePermissionGate } from "@/src/features/shell/permission-gate";
import { loadCustomerCollectionRecords } from "@/src/features/experience-server/portal-view-loader";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<RawCollectionSearchParams>;
}) {
  const projection = await loadCustomerCollectionRecords("procurement");
  return (
    <SurfacePermissionGate
      audience="customer"
      requiredPermission="account:write"
    >
      <CustomerCollection
        config={{
          ...customerCollections.procurement,
          records: projection.records,
        }}
        searchParams={await searchParams}
      />
    </SurfacePermissionGate>
  );
}
