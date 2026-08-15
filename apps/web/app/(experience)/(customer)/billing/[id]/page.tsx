import { CommercialRecordDetail } from "@/src/features/customer-partner/commercial/record-detail";
import { SurfacePermissionGate } from "@/src/features/shell/permission-gate";
import {
  getRouteIdentity,
  getRouteRoles,
} from "@/src/features/shell/route-session";
import { loadCommercialRecord } from "@/src/features/experience-server/portal-view-loader";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [identity, roles, record] = await Promise.all([
    getRouteIdentity("customer"),
    getRouteRoles("customer"),
    loadCommercialRecord("billing", id),
  ]);
  const canPay = roles.some((role) => role === "owner" || role === "billing");
  return (
    <SurfacePermissionGate
      audience="customer"
      requiredPermission="billing:read"
    >
      <CommercialRecordDetail
        accountId={identity.accountId}
        canMutate={canPay}
        id={id}
        record={record}
      />
    </SurfacePermissionGate>
  );
}
