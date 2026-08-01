import { QuoteBuilder } from "@/src/features/customer-partner/commercial/quote-builder";
import { SurfacePermissionGate } from "@/src/features/shell/permission-gate";

export default function Page() {
  return (
    <SurfacePermissionGate audience="customer" requiredPermission="quote:write">
      <QuoteBuilder />
    </SurfacePermissionGate>
  );
}
