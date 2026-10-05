import { CommercialRecordDetail } from "@/src/features/customer-partner/commercial/record-detail";
import { SurfacePermissionGate } from "@/src/features/shell/permission-gate";
import {
  getRouteIdentity,
  getRoutePermissions,
} from "@/src/features/shell/route-session";
import { loadCommercialRecord } from "@/src/features/experience-server/portal-view-loader";
import { demoDeployIdentityEnabled } from "@/src/auth/demo-deploy";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [identity, permissions, record] = await Promise.all([
    getRouteIdentity("customer"),
    getRoutePermissions("customer"),
    loadCommercialRecord("billing", id),
  ]);
  const canPay = permissions.includes("billing:write");
  return (
    <SurfacePermissionGate
      audience="customer"
      requiredPermission="billing:read"
    >
      <CommercialRecordDetail
        accountId={identity.accountId}
        canMutate={canPay}
        guidedDemo={demoDeployIdentityEnabled(process.env)}
        id={id}
        record={record}
      />
    </SurfacePermissionGate>
  );
}
