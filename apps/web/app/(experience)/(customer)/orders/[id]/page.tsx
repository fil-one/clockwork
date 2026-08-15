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
    loadCommercialRecord("orders", id),
  ]);
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
            <WorkflowPanel
              context={{
                accountId: identity.accountId,
                ...(record?.aggregateId ? { orderId: record.aggregateId } : {}),
              }}
              workflow="renewal"
              surface="services"
            />
          </SurfaceActionGate>
        }
        id={id}
        record={record}
      />
    </SurfacePermissionGate>
  );
}
