import { RenewalsView } from "@/src/features/internal-ops/finance-lifecycle/renewals-view";
import { SurfacePermissionGate } from "@/src/features/shell/permission-gate";

export default function Page() {
  return (
    <SurfacePermissionGate audience="internal" requiredPermission="report:read">
      <RenewalsView />
    </SurfacePermissionGate>
  );
}
