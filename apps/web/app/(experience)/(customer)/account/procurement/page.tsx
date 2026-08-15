import { CustomerCollection } from "@/src/features/customer-partner/customer/customer-collection";
import { customerCollections } from "@/src/features/customer-partner/customer/customer-data";
import type { RawCollectionSearchParams } from "@/src/features/customer-partner/customer/collection-state";
import {
  SurfaceActionGate,
  SurfacePermissionGate,
} from "@/src/features/shell/permission-gate";
import { loadCustomerCollectionRecords } from "@/src/features/experience-server/portal-view-loader";
import { getRouteIdentity } from "@/src/features/shell/route-session";
import { WorkflowPanel } from "@/src/features/surfaces/workflow-panel";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<RawCollectionSearchParams>;
}) {
  const [identity, projection] = await Promise.all([
    getRouteIdentity("customer"),
    loadCustomerCollectionRecords("procurement"),
  ]);
  return (
    <SurfacePermissionGate
      audience="customer"
      requiredPermission="account:write"
    >
      <CustomerCollection
        actions={
          <SurfaceActionGate
            audience="customer"
            requiredPermission="account:write"
          >
            <WorkflowPanel
              context={{ accountId: identity.accountId }}
              workflow="procurement"
              surface="procurement"
            />
          </SurfaceActionGate>
        }
        config={{
          ...customerCollections.procurement,
          records: projection.records,
        }}
        searchParams={await searchParams}
      />
    </SurfacePermissionGate>
  );
}
