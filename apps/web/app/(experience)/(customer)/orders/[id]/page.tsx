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
    loadCommercialRecord("orders", id),
  ]);
  const guidedDemo = demoDeployIdentityEnabled(process.env);
  return (
    <SurfacePermissionGate audience="customer" requiredPermission="order:read">
      <CommercialRecordDetail
        accountId={identity.accountId}
        actions={
          <SurfaceActionGate
            audience="customer"
            requiredPermission="order:write"
          >
            {/*
             * The renewal decision is about this order and this account. Both
             * are already resolved above, and neither is a reference a customer
             * could type: the order's persisted identifier appears nowhere they
             * can read it.
             */}
            {guidedDemo &&
            !record?.allowedActions?.includes(
              "request_renewal",
            ) ? null : guidedDemo && record?.projectionId && record.version ? (
              <ProjectionActionButtons
                audience="customer"
                channel="orders"
                recordKey={id}
                projectionId={record.projectionId}
                version={Number(record.version)}
                actions={(record.allowedActions ?? []).filter(
                  (action) => action === "request_renewal",
                )}
                roles={roles}
              />
            ) : (
              <WorkflowPanel
                context={{
                  accountId: identity.accountId,
                  ...(record?.aggregateId
                    ? { orderId: record.aggregateId }
                    : {}),
                }}
                workflow="renewal"
                surface="services"
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
