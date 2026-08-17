import { loadRevenueWorkspace } from "@/src/features/internal-ops/revenue/revenue-loader";
import { RevenueView } from "@/src/features/internal-ops/revenue/revenue-view";
import { SurfacePermissionGate } from "@/src/features/shell/permission-gate";

export const dynamic = "force-dynamic";

export default async function Page() {
  const workspace = await loadRevenueWorkspace({
    requestId: `experience:revenue:${crypto.randomUUID()}`,
  });
  return (
    <SurfacePermissionGate audience="internal" requiredPermission="report:read">
      <RevenueView workspace={workspace} />
    </SurfacePermissionGate>
  );
}
