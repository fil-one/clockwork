import { demoDeployIdentityEnabled } from "@/src/auth/demo-deploy";
import { configuredDemoStateStore } from "@/src/features/experience-server/demo-state-store";
import type { DemoOrderAcceptanceState } from "@/src/features/experience-server/demo-order-acceptance";
import { DemoOrderHandoff } from "@/src/features/internal-ops/finance-lifecycle/demo-order-handoff";
import { ProvisioningView } from "@/src/features/internal-ops/finance-lifecycle/provisioning-view";
import { loadProvisioningWorkspace } from "@/src/features/internal-ops/finance-lifecycle/server-loader";
import { SurfacePermissionGate } from "@/src/features/shell/permission-gate";

export const dynamic = "force-dynamic";

export default async function Page() {
  const workspace = await loadProvisioningWorkspace();
  const orders = demoDeployIdentityEnabled(process.env)
    ? Object.values(
        ((await configuredDemoStateStore().read()) as DemoOrderAcceptanceState)
          .createdOrders ?? {},
      ).map((order) => ({
        id: order.id,
        reference: order.poNumber,
        startsOn: order.serviceStartsOn,
        ready: Boolean(order.domainOrder && order.organizationId),
        ...(order.provisioning
          ? { submittedAt: order.provisioning.submittedAt }
          : {}),
      }))
    : undefined;
  return (
    <SurfacePermissionGate
      audience="internal"
      requiredPermission="system:operate"
    >
      <ProvisioningView
        work={workspace.items}
        provenance={workspace.provenance}
      >
        {orders ? <DemoOrderHandoff orders={orders} /> : null}
      </ProvisioningView>
    </SurfacePermissionGate>
  );
}
