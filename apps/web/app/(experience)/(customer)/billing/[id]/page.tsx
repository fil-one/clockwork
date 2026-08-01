import { CommercialRecordDetail } from "@/src/features/customer-partner/commercial/record-detail";
import { SurfacePermissionGate } from "@/src/features/shell/permission-gate";
import { getRouteRoles } from "@/src/features/shell/route-session";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const roles = await getRouteRoles("customer");
  const canPay = roles.some((role) => role === "owner" || role === "billing");
  return (
    <SurfacePermissionGate
      audience="customer"
      requiredPermission="billing:read"
    >
      <CommercialRecordDetail canMutate={canPay} id={id} />
    </SurfacePermissionGate>
  );
}
