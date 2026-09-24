import { PartnerOrders } from "@/src/features/customer-partner/partner/partner-orders";
import { SurfacePermissionGate } from "@/src/features/shell/permission-gate";
import { partnerPageMetadata } from "@/src/features/customer-partner/partner/partner-route";

export const generateMetadata = () =>
  partnerPageMetadata("partner.orders.supplyOrder");
export const dynamic = "force-dynamic";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <SurfacePermissionGate audience="partner" requiredPermission="order:read">
      <PartnerOrders id={id} />
    </SurfacePermissionGate>
  );
}
