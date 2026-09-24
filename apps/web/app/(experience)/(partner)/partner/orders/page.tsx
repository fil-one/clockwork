import { PartnerOrders } from "@/src/features/customer-partner/partner/partner-orders";
import { SurfacePermissionGate } from "@/src/features/shell/permission-gate";
import { partnerPageMetadata } from "@/src/features/customer-partner/partner/partner-route";

export const generateMetadata = () =>
  partnerPageMetadata("partner.orders.title");
export const dynamic = "force-dynamic";
export default function Page() {
  return (
    <SurfacePermissionGate audience="partner" requiredPermission="order:read">
      <PartnerOrders />
    </SurfacePermissionGate>
  );
}
