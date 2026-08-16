import { loadReconciliationWorkspace } from "@/src/features/internal-ops/billing-reconciliation/reconciliation-loader";
import { ReconciliationView } from "@/src/features/internal-ops/billing-reconciliation/reconciliation-view";
import { SurfacePermissionGate } from "@/src/features/shell/permission-gate";

export const dynamic = "force-dynamic";

export default async function Page() {
  const workspace = await loadReconciliationWorkspace({
    requestId: `experience:billing-reconciliation:${crypto.randomUUID()}`,
  });
  return (
    <SurfacePermissionGate audience="internal" requiredPermission="report:read">
      <ReconciliationView workspace={workspace} />
    </SurfacePermissionGate>
  );
}
