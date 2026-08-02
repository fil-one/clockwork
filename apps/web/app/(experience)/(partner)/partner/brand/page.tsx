import { PartnerCollectionRoute } from "@/src/features/customer-partner/partner/partner-route";
import { SurfaceActionGate } from "@/src/features/shell/permission-gate";
import { WorkflowPanel } from "@/src/features/surfaces/workflow-panel";

export default function Page() {
  return (
    <PartnerCollectionRoute
      surface="brand"
      actions={
        <SurfaceActionGate
          audience="partner"
          requiredPermission="account:write"
        >
          <WorkflowPanel workflow="brand" surface="brand" />
        </SurfaceActionGate>
      }
    />
  );
}
