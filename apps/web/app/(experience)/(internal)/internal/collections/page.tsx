import { CollectionsView } from "@/src/features/internal-ops/finance-lifecycle/collections-view";
import { SurfacePermissionGate } from "@/src/features/shell/permission-gate";

export default function Page() {
  return (
    <SurfacePermissionGate
      audience="internal"
      requiredPermission="billing:approve"
    >
      <CollectionsView />
    </SurfacePermissionGate>
  );
}
