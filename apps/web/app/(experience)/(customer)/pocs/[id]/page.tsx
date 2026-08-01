import { CommercialRecordDetail } from "@/src/features/customer-partner/commercial/record-detail";
import { SurfacePermissionGate } from "@/src/features/shell/permission-gate";
import { loadCommercialRecord } from "@/src/features/experience-server/portal-view-loader";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const record = await loadCommercialRecord("pocs", id);
  return (
    <SurfacePermissionGate audience="customer" requiredPermission="poc:manage">
      <CommercialRecordDetail id={id} record={record} />
    </SurfacePermissionGate>
  );
}
