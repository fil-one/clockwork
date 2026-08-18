import { demoDeployIdentityEnabled } from "@/src/auth/demo-deploy";
import { CommercialRecordDetail } from "@/src/features/customer-partner/commercial/record-detail";
import { ProjectionActionButtons } from "@/src/features/experience-server/projection-action-buttons";
import {
  SurfaceActionGate,
  SurfacePermissionGate,
} from "@/src/features/shell/permission-gate";
import { loadCommercialRecord } from "@/src/features/experience-server/portal-view-loader";
import {
  getRouteIdentity,
  getRouteRoles,
} from "@/src/features/shell/route-session";
import { WorkflowPanel } from "@/src/features/surfaces/workflow-panel";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [identity, roles, record] = await Promise.all([
    getRouteIdentity("customer"),
    getRouteRoles("customer"),
    loadCommercialRecord("pocs", id),
  ]);
  const guidedDemo = demoDeployIdentityEnabled(process.env);
  return (
    <SurfacePermissionGate audience="customer" requiredPermission="poc:manage">
      <CommercialRecordDetail
        accountId={identity.accountId}
        actions={
          <SurfaceActionGate
            audience="customer"
            requiredPermission="poc:manage"
          >
            {guidedDemo && record?.projectionId && record.version ? (
              <ProjectionActionButtons
                audience="customer"
                channel="pocs"
                recordKey={id}
                projectionId={record.projectionId}
                version={Number(record.version)}
                actions={record.allowedActions ?? []}
                roles={roles}
              />
            ) : (
              <WorkflowPanel
                context={{
                  accountId: identity.accountId,
                  userId: identity.userId,
                  ...(record?.aggregateId ? { pocId: record.aggregateId } : {}),
                }}
                workflow="poc"
                surface="pocs"
              />
            )}
          </SurfaceActionGate>
        }
        id={id}
        record={record}
      />
    </SurfacePermissionGate>
  );
}
