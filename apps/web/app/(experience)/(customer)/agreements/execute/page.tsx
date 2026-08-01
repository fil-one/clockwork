import { AgreementAcceptance } from "@/src/features/customer-partner/commercial/agreement-acceptance";
import { SurfacePermissionGate } from "@/src/features/shell/permission-gate";

export default function Page() {
  return (
    <SurfacePermissionGate
      audience="customer"
      requiredPermission="agreement:execute"
    >
      <AgreementAcceptance />
    </SurfacePermissionGate>
  );
}
