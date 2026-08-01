import { eq } from "drizzle-orm";
import { z } from "zod";

import type { RuntimeDatabase } from "../../client";
import { exceptionCases, orders, pocs } from "../../schema";
import { withInternalTransaction } from "../../transaction";

const PersistedLifecycleExceptionQueueSchema = z.enum([
  "pricing",
  "legal",
  "credit_collections",
  "restricted_parties",
  "disputes",
  "deal_registration_disputes",
  "poc_qualification",
]);

export type PersistedLifecycleExceptionQueue =
  | "pricing"
  | "legal"
  | "credit_collections"
  | "restricted_parties"
  | "disputes"
  | "deal_registration_disputes"
  | "poc_qualification";

function persistedQueue(value: string): PersistedLifecycleExceptionQueue {
  return PersistedLifecycleExceptionQueueSchema.parse(value);
}

/**
 * Resolves authorization scope from commerce-owned records. The API uses this
 * before permission checks so path IDs and request bodies cannot choose scope.
 */
export class DatabaseLifecycleAuthorizationScopeResolver {
  public constructor(private readonly db: RuntimeDatabase) {}

  public async resolvePocAccount(input: {
    pocId: string;
    requestId: string;
  }): Promise<{ accountId: string }> {
    const poc = await withInternalTransaction(
      this.db,
      input.requestId,
      (transaction) =>
        transaction.query.pocs.findFirst({
          columns: { accountId: true },
          where: eq(pocs.id, input.pocId),
        }),
    );
    if (!poc) throw new Error("LIFECYCLE_AUTHORIZATION_TARGET_NOT_FOUND");
    return { accountId: poc.accountId };
  }

  public async resolveExceptionScope(input: {
    caseId: string;
    requestId: string;
  }): Promise<{
    accountId: string | null;
    queue: PersistedLifecycleExceptionQueue;
  }> {
    const exceptionCase = await withInternalTransaction(
      this.db,
      input.requestId,
      (transaction) =>
        transaction.query.exceptionCases.findFirst({
          columns: { accountId: true, queue: true },
          where: eq(exceptionCases.id, input.caseId),
        }),
    );
    if (!exceptionCase)
      throw new Error("LIFECYCLE_AUTHORIZATION_TARGET_NOT_FOUND");
    return {
      accountId: exceptionCase.accountId,
      queue: persistedQueue(exceptionCase.queue),
    };
  }

  public async resolveOrderScope(input: {
    orderId: string;
    requestId: string;
  }): Promise<{
    accountId: string;
    partnerAccountId: string | null;
    authorizationAccountId: string;
  }> {
    const order = await withInternalTransaction(
      this.db,
      input.requestId,
      (transaction) =>
        transaction.query.orders.findFirst({
          columns: { accountId: true, partnerAccountId: true, sourcing: true },
          where: eq(orders.id, input.orderId),
        }),
    );
    if (!order) throw new Error("LIFECYCLE_AUTHORIZATION_TARGET_NOT_FOUND");
    const partnerIsMerchantOfRecord = ["resale", "distributor"].includes(
      order.sourcing,
    );
    if (partnerIsMerchantOfRecord && !order.partnerAccountId)
      throw new Error("LIFECYCLE_ORDER_PARTNER_SCOPE_INVALID");
    const authorizationAccountId = partnerIsMerchantOfRecord
      ? order.partnerAccountId
      : order.accountId;
    if (!authorizationAccountId)
      throw new Error("LIFECYCLE_ORDER_PARTNER_SCOPE_INVALID");
    return {
      accountId: order.accountId,
      partnerAccountId: order.partnerAccountId,
      authorizationAccountId,
    };
  }
}
