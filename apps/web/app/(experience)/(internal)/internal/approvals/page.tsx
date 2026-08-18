import { demoDeployIdentityEnabled } from "@/src/auth/demo-deploy";
import { InternalProjectionPage } from "@/src/features/experience-server/internal-projection-page";
import { ApprovalWorkspace } from "@/src/features/internal-ops/administration-safety/approvals";
import { getRouteRoles } from "@/src/features/shell/route-session";

export default async function Page() {
  if (demoDeployIdentityEnabled(process.env))
    return (
      <InternalProjectionPage
        channel="approvals"
        title="Approval decisions"
        description="Record an authorized approval or rejection against the latest case evidence."
      />
    );
  return <ApprovalWorkspace roles={await getRouteRoles("internal")} />;
}
