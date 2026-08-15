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
    loadCustomerCollectionRecords("users"),
  ]);
  // An invitation is addressed to the organization that owns the acting
  // account. `RouteIdentity` names the organization but not its identifier, so
  // the membership behind it supplies the one the invite endpoint is keyed on.
  const organizationId = session.memberships.find(
    (membership) => membership.accountId === identity.accountId,
  )?.organizationId;
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
              context={{
                accountId: identity.accountId,
                ...(organizationId ? { organizationId } : {}),
              }}
              workflow="invite"
              surface="users"
            />
          </SurfaceActionGate>
        }
        config={{ ...customerCollections.users, records: projection.records }}
        searchParams={await searchParams}
      />
    </SurfacePermissionGate>
  );
}
