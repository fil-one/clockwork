import { ProvisioningView } from "@/src/features/internal-ops/finance-lifecycle/provisioning-view";
import { SurfacePermissionGate } from "@/src/features/shell/permission-gate";

export default function Page() {
  return (
    <SurfacePermissionGate
      audience="internal"
      requiredPermission="system:operate"
    >
      <ProvisioningView />
    </SurfacePermissionGate>
  );
}
