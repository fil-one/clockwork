import { ProjectionDetailPage } from "@/src/features/experience-server/projection-detail-page";
import { SurfacePermissionGate } from "@/src/features/shell/permission-gate";
export default function Page() {
  return (
    <SurfacePermissionGate audience="customer" requiredPermission="order:write">
      <ProjectionDetailPage
        audience="customer"
        channel="orders"
        title="Order acceptance"
        description="Review the persisted order and optimistic version before acceptance."
      />
    </SurfacePermissionGate>
  );
}
