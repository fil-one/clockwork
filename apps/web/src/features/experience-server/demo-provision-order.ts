import "server-only";
// i18n-exempt-file: demo provisioning refusals travel as the API's `detail`; each carries a stable code for the interface to map (the handoff surface and demo-app route are other lanes' files).
import type { SessionClaims } from "@clockwork/api";
import { hasPermission } from "@clockwork/contracts";
import { provisioningRequest } from "@clockwork/domain/core";
import { createFakeProviderPorts } from "@clockwork/integrations/fakes";
import { z } from "zod";
import type { DemoAdapterStateStore } from "@clockwork/testing/demo-state";
import type { DemoOrderAcceptanceState } from "./demo-order-acceptance";
import { configuredDemoStateStore } from "./demo-state-store";

/**
 * A refusal the operator reads. The English `message` is what the demo route
 * returns as `detail` today; `code` is the stable key an interface maps to the
 * reader's language.
 */
export class DemoProvisioningRefusal extends Error {
  public constructor(
    public readonly code:
      | "PROVISIONING_FORBIDDEN"
      | "DEMO_PROVISIONING_REQUEST_MISSING"
      | "DEMO_PROVISIONER_REFUSED"
      | "DEMO_ORDER_CHANGED",
    message: string,
  ) {
    super(message);
    this.name = "DemoProvisioningRefusal";
  }
}

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
    throw new DemoProvisioningRefusal(
      "PROVISIONING_FORBIDDEN",
      "Internal operations authority is required.",
    );
  const { orderId } = z.object({ orderId: z.uuid() }).strict().parse(body);
  const state = (await store.read()) as DemoOrderAcceptanceState;
  const order = state.createdOrders?.[orderId];
  if (!order?.domainOrder || !order.organizationId)
    throw new DemoProvisioningRefusal(
      "DEMO_PROVISIONING_REQUEST_MISSING",
      "This historical order has no saved provisioning request. Use a newly accepted demo order.",
    );
  if (order.provisioning) return order.provisioning;
  const request = provisioningRequest(order.domainOrder, order.organizationId);
  const response =
    await createFakeProviderPorts().provisioning.provision(request);
  if (!response.ok)
    throw new DemoProvisioningRefusal(
      "DEMO_PROVISIONER_REFUSED",
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
      throw new DemoProvisioningRefusal(
        "DEMO_ORDER_CHANGED",
        "The order changed. Reload its handoff.",
      );
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
