import { ProjectionDetailPage } from "@/src/features/experience-server/projection-detail-page";
import { SurfacePermissionGate } from "@/src/features/shell/permission-gate";
export default function Page() {
  return (
    <SurfacePermissionGate
      audience="customer"
      requiredPermission="agreement:execute"
    >
      <ProjectionDetailPage
        audience="customer"
        channel="agreements"
        title="Choose an agreement"
        description="Execution starts only from a persisted, authorized agreement version."
      />
    </SurfacePermissionGate>
  );
}
