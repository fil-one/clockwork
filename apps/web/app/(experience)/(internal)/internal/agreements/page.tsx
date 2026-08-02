import { AgreementAdministration } from "@/src/features/internal-ops/administration-safety/agreements";
import { SurfaceActionGate } from "@/src/features/shell/permission-gate";
import { getRouteRoles } from "@/src/features/shell/route-session";
import { WorkflowPanel } from "@/src/features/surfaces/workflow-panel";

export default async function Page() {
  return (
    <AgreementAdministration
      roles={await getRouteRoles("internal")}
      publishAction={
        <SurfaceActionGate
          audience="internal"
          requiredPermission="agreement:approve"
        >
          <WorkflowPanel workflow="agreementAdmin" surface="agreementAdmin" />
        </SurfaceActionGate>
      }
    />
  );
}
