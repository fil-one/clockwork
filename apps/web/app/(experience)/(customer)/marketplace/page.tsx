import { CustomerCollection } from "@/src/features/customer-partner/customer/customer-collection";
import { customerCollections } from "@/src/features/customer-partner/customer/customer-data";
import type { RawCollectionSearchParams } from "@/src/features/customer-partner/customer/collection-state";
import { SurfacePermissionGate } from "@/src/features/shell/permission-gate";
import { loadCustomerCollectionRecords } from "@/src/features/experience-server/portal-view-loader";
import { getRouteSession } from "@/src/features/shell/route-session";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<RawCollectionSearchParams>;
}) {
  const [session, projection] = await Promise.all([
    getRouteSession("customer"),
    loadCustomerCollectionRecords("marketplace"),
  ]);
  return (
    <SurfacePermissionGate
      audience="customer"
      requiredPermission="account:read"
    >
      <CustomerCollection
        freshness={{
          generatedAt: projection.generatedAt,
          partial: projection.truncated,
          stale: projection.stale,
        }}
        formatting={{ locale: session.locale, timeZone: session.timeZone }}
        config={{
          ...customerCollections.marketplace,
          records: projection.records,
        }}
        searchParams={await searchParams}
      />
    </SurfacePermissionGate>
  );
}
