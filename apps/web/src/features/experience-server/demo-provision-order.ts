import "server-only";
import type { SessionClaims } from "@clockwork/api";
import { hasPermission } from "@clockwork/contracts";
import { provisioningRequest } from "@clockwork/domain/core";
import { createFakeProviderPorts } from "@clockwork/integrations/fakes";
import { z } from "zod";
import type { DemoAdapterStateStore } from "@clockwork/testing/demo-state";
import type { DemoOrderAcceptanceState } from "./demo-order-acceptance";
import { configuredDemoStateStore } from "./demo-state-store";

/** A demo port invocation records dispatch only; it never fabricates completion. */
export async function submitDemoProvisioning(
  body: unknown,
  session: SessionClaims,
  store: DemoAdapterStateStore = configuredDemoStateStore(),
) {
  if (
    !session.isInternalStaff ||
    !session.roles.some((role) => hasPermission(role, "system:operate"))
  )
    throw new Error("Internal operations authority is required.");
  const { orderId } = z.object({ orderId: z.uuid() }).strict().parse(body);
  const state = (await store.read()) as DemoOrderAcceptanceState;
  const order = state.createdOrders?.[orderId];
  if (!order?.domainOrder || !order.organizationId)
    throw new Error(
      "This historical order has no saved provisioning request. Use a newly accepted demo order.",
    );
  if (order.provisioning) return order.provisioning;
  const request = provisioningRequest(order.domainOrder, order.organizationId);
  const response =
    await createFakeProviderPorts().provisioning.provision(request);
  if (!response.ok)
    throw new Error(
      "Demo provisioner refused the request. Retry from the order queue.",
    );
  let result = {
    operationId: response.value.operationId,
    submittedAt: new Date().toISOString(),
    actorId: session.userId,
  };
  await store.update((current) => {
    const latest = current as DemoOrderAcceptanceState;
    const currentOrder = latest.createdOrders?.[orderId];
    if (
      !currentOrder ||
      JSON.stringify(currentOrder.domainOrder) !==
        JSON.stringify(order.domainOrder)
    )
      throw new Error("The order changed. Reload its handoff.");
    if (currentOrder.provisioning) {
      result = currentOrder.provisioning;
      return current;
    }
    return {
      ...latest,
      revision: latest.revision + 1,
      createdOrders: {
        ...latest.createdOrders,
        [orderId]: { ...currentOrder, provisioning: result },
      },
    };
  });
  return result;
}
