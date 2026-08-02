import { CommercialRecordDetail } from "@/src/features/customer-partner/commercial/record-detail";
import {
  SurfaceActionGate,
  SurfacePermissionGate,
} from "@/src/features/shell/permission-gate";
import { loadCommercialRecord } from "@/src/features/experience-server/portal-view-loader";
import { WorkflowPanel } from "@/src/features/surfaces/workflow-panel";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const record = await loadCommercialRecord("orders", id);
  return (
    <SurfacePermissionGate audience="customer" requiredPermission="order:read">
      <CommercialRecordDetail
        actions={
          <SurfaceActionGate
            audience="customer"
            requiredPermission="order:write"
          >
            <WorkflowPanel workflow="renewal" surface="services" />
          </SurfaceActionGate>
        }
        id={id}
        record={record}
      />
    </SurfacePermissionGate>
  );
}
