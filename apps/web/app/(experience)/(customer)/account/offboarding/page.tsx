import { OffboardingWorkflow } from "@/src/features/customer-partner/commercial/offboarding";
import { SurfacePermissionGate } from "@/src/features/shell/permission-gate";

export default function Page() {
  return (
    <SurfacePermissionGate
      audience="customer"
      requiredPermission="destructive:request"
    >
      <OffboardingWorkflow />
    </SurfacePermissionGate>
  );
}
