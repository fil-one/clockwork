import { CommercialRecordDetail } from "@/src/features/customer-partner/commercial/record-detail";
import { SurfacePermissionGate } from "@/src/features/shell/permission-gate";
import { getRouteRoles } from "@/src/features/shell/route-session";
import { loadCommercialRecord } from "@/src/features/experience-server/portal-view-loader";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [roles, record] = await Promise.all([
    getRouteRoles("customer"),
    loadCommercialRecord("quotes", id),
  ]);
  const canWrite = roles.some((role) => role === "owner" || role === "admin");
  return (
    <SurfacePermissionGate audience="customer" requiredPermission="quote:read">
      <CommercialRecordDetail canMutate={canWrite} id={id} record={record} />
    </SurfacePermissionGate>
  );
}
