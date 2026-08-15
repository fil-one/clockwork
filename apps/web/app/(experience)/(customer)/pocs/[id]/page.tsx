import { CommercialRecordDetail } from "@/src/features/customer-partner/commercial/record-detail";
import {
  SurfaceActionGate,
  SurfacePermissionGate,
} from "@/src/features/shell/permission-gate";
import { loadCommercialRecord } from "@/src/features/experience-server/portal-view-loader";
import { getRouteIdentity } from "@/src/features/shell/route-session";
import { WorkflowPanel } from "@/src/features/surfaces/workflow-panel";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [identity, record] = await Promise.all([
    getRouteIdentity("customer"),
    loadCommercialRecord("pocs", id),
  ]);
  return (
    <SurfacePermissionGate audience="customer" requiredPermission="poc:manage">
      <CommercialRecordDetail
        accountId={identity.accountId}
        actions={
          <SurfaceActionGate
            audience="customer"
            requiredPermission="poc:manage"
          >
            <WorkflowPanel
              context={{
                accountId: identity.accountId,
                userId: identity.userId,
                ...(record?.aggregateId ? { pocId: record.aggregateId } : {}),
              }}
              workflow="poc"
              surface="pocs"
            />
          </SurfaceActionGate>
        }
        id={id}
        record={record}
      />
    </SurfacePermissionGate>
  );
}
