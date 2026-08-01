import { CustomerCollection } from "@/src/features/customer-partner/customer/customer-collection";
import { customerCollections } from "@/src/features/customer-partner/customer/customer-data";
import type { RawCollectionSearchParams } from "@/src/features/customer-partner/customer/collection-state";
import { SurfacePermissionGate } from "@/src/features/shell/permission-gate";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<RawCollectionSearchParams>;
}) {
  return (
    <SurfacePermissionGate audience="customer" requiredPermission="order:write">
      <CustomerCollection
        config={customerCollections.amendments}
        searchParams={await searchParams}
      />
    </SurfacePermissionGate>
  );
}
