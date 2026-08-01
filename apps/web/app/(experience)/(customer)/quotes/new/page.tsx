import { ProjectionDetailPage } from "@/src/features/experience-server/projection-detail-page";
import { SurfacePermissionGate } from "@/src/features/shell/permission-gate";
export default function Page() {
  return (
    <SurfacePermissionGate audience="customer" requiredPermission="quote:write">
      <ProjectionDetailPage
        audience="customer"
        channel="quotes"
        title="Quote workspace"
        description="Choose the authorized commercial record that should produce a new quote task."
      />
    </SurfacePermissionGate>
  );
}
