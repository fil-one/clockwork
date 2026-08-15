import { CustomerCollection } from "@/src/features/customer-partner/customer/customer-collection";
import { customerCollections } from "@/src/features/customer-partner/customer/customer-data";
import type { RawCollectionSearchParams } from "@/src/features/customer-partner/customer/collection-state";
import {
  SurfaceActionGate,
  SurfacePermissionGate,
} from "@/src/features/shell/permission-gate";
import { loadCustomerCollectionRecords } from "@/src/features/experience-server/portal-view-loader";
import {
  getRouteIdentity,
  getRouteSession,
} from "@/src/features/shell/route-session";
import { WorkflowPanel } from "@/src/features/surfaces/workflow-panel";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<RawCollectionSearchParams>;
}) {
  const [identity, session, projection] = await Promise.all([
    getRouteIdentity("customer"),
    getRouteSession("customer"),
    loadCustomerCollectionRecords("procurement"),
  ]);
  return (
    <SurfacePermissionGate
      audience="customer"
      requiredPermission="account:write"
    >
      <CustomerCollection
        freshness={{
          generatedAt: projection.generatedAt,
          stale: projection.stale,
        }}
        formatting={{ locale: session.locale, timeZone: session.timeZone }}
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
