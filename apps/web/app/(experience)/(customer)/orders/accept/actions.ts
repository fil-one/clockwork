"use server";

import { hasPermission } from "@clockwork/contracts";

import { getCommerceSession } from "@/src/auth/session";
import type { PreparedOrderFormLookup } from "@/src/features/customer-partner/commercial/prepared-order-form";
import { loadPreparedOrderForm } from "@/src/features/experience-server/portal-view-loader";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Asks whether the order form the acceptance surface prepared has been stored.
 *
 * The surface polls this between its two passes. It is an action rather than a
 * server-rendered prop because the identifier being asked about is minted on
 * the client for a command that has not created anything yet: no route holds
 * it, and nothing on the orders channel can answer for it until the create
 * pass has already run.
 *
 * `order:write` is re-checked here against a freshly read session rather than
 * inherited from the page's gate, and the argument is validated as a UUID
 * before it reaches a query. The answer is a document identifier the caller's
 * own account is already the audience for -- row-level security, not this
 * function, is what enforces that -- and it is worth nothing on its own: the
 * create pass still has to satisfy `assertCommercialArtifactBinding` inside
 * the accepting transaction.
 */
export async function lookupPreparedOrderForm(
  orderId: string,
): Promise<PreparedOrderFormLookup> {
  if (typeof orderId !== "string" || !uuidPattern.test(orderId))
    return { status: "unavailable" };
  const session = await getCommerceSession();
  const permitted = session.roles.some((role) =>
    hasPermission(role, "order:write"),
  );
  if (!permitted) return { status: "forbidden" };
  return loadPreparedOrderForm(orderId);
}
