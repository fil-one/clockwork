import { PartnerOrders } from "@/src/features/customer-partner/partner/partner-orders";
import { SurfacePermissionGate } from "@/src/features/shell/permission-gate";
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
