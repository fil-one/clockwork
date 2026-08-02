import { ReportsView } from "@/src/features/internal-ops/finance-lifecycle/reports-view";
import { SurfacePermissionGate } from "@/src/features/shell/permission-gate";

export default function Page() {
  return (
    <SurfacePermissionGate audience="internal" requiredPermission="report:read">
      <ReportsView />
    </SurfacePermissionGate>
  );
}
