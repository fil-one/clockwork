import { ProvisioningView } from "@/src/features/internal-ops/finance-lifecycle/provisioning-view";
import { loadProvisioningWorkspace } from "@/src/features/internal-ops/finance-lifecycle/server-loader";
import { SurfacePermissionGate } from "@/src/features/shell/permission-gate";

export const dynamic = "force-dynamic";

export default async function Page() {
  const workspace = await loadProvisioningWorkspace();
  return (
    <SurfacePermissionGate
      audience="internal"
      requiredPermission="system:operate"
    >
      <ProvisioningView
        work={workspace.items}
        provenance={workspace.provenance}
      />
    </SurfacePermissionGate>
  );
}
