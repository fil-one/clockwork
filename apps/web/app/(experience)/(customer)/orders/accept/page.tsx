import { OrderAcceptance } from "@/src/features/customer-partner/commercial/order-acceptance";
import { SurfacePermissionGate } from "@/src/features/shell/permission-gate";

export default function Page() {
  return (
    <SurfacePermissionGate audience="customer" requiredPermission="order:write">
      <OrderAcceptance />
    </SurfacePermissionGate>
  );
}
