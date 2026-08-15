import { PartnerCollectionRoute } from "@/src/features/customer-partner/partner/partner-route";
import { SurfaceActionGate } from "@/src/features/shell/permission-gate";
import { getRouteIdentity } from "@/src/features/shell/route-session";
import { WorkflowPanel } from "@/src/features/surfaces/workflow-panel";

export default async function Page() {
  // A partner registers a domain against their own account, which is the
  // account the session already resolved. `POST /v1/lifecycle/partners/
  // {accountId}/domains` is keyed on it, and no partner sees that identifier
  // anywhere in the portal.
  const identity = await getRouteIdentity("partner");
  return (
    <PartnerCollectionRoute
      surface="brand"
      actions={
        <SurfaceActionGate
          audience="partner"
          requiredPermission="account:write"
        >
          <WorkflowPanel
            context={{ partnerAccountId: identity.accountId }}
            workflow="brand"
            surface="brand"
          />
        </SurfaceActionGate>
      }
    />
  );
}
