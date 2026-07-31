import { createHash } from "node:crypto";

import type { Actor } from "@clockwork/contracts";
import {
  beginProvisioning,
  type ProvisioningCommand,
} from "@clockwork/domain/lifecycle";
import { eq } from "drizzle-orm";
import { z } from "zod";

import type { RuntimeTransaction } from "../../client";
import { organizations } from "../../schema";
import { lifecycleProvisioningAttempts } from "../../schema/lifecycle/platform";
import { appendAuditAndOutbox } from "../audit-outbox";
import { coreSnapshotHash } from "../core/finance";

const ProvisioningLineSnapshotSchema = z.object({
  id: z.uuid(),
  sku: z.string().trim().min(1),
  region: z.string().trim().min(1),
  quantity: z.string().regex(/^(0|[1-9]\d*)(?:\.\d+)?$/),
});

export interface PersistedOrderLineSnapshot {
  orderLineId: string;
  snapshot: unknown;
  snapshotHash: string;
}

function entitlementKind(sku: string): "storage" | "egress" | "feature" {
  const normalized = sku.toLowerCase();
  if (normalized.includes("egress")) return "egress";
  if (
    normalized.includes("storage") ||
    normalized.includes("archive") ||
    normalized.includes("capacity")
  )
    return "storage";
  return "feature";
}

export function provisioningLinesFromSnapshots(
  snapshots: readonly PersistedOrderLineSnapshot[],
) {
  return snapshots.map((persisted) => {
    if (coreSnapshotHash(persisted.snapshot) !== persisted.snapshotHash)
      throw new Error("PROVISIONING_LINE_SNAPSHOT_HASH_MISMATCH");
    const line = ProvisioningLineSnapshotSchema.parse(persisted.snapshot);
    if (line.id !== persisted.orderLineId)
      throw new Error("PROVISIONING_LINE_SNAPSHOT_ID_MISMATCH");
    return {
      orderLineId: persisted.orderLineId,
      sku: line.sku,
      productCode: line.sku,
      entitlementKind: entitlementKind(line.sku),
      quantity: line.quantity,
      region: line.region,
    };
  });
}

function provisioningOrganization(
  candidates: readonly (typeof organizations.$inferSelect)[],
) {
  if (candidates.length === 0)
    throw new Error("PROVISIONING_ORGANIZATION_NOT_FOUND");
  if (candidates.length === 1) return candidates[0];
  const productionCandidates = candidates.filter(
    (candidate) => !candidate.isolated,
  );
  if (productionCandidates.length === 1) return productionCandidates[0];
  throw new Error("PROVISIONING_ORGANIZATION_AMBIGUOUS");
}

/**
 * Adds the durable provisioning command to the accepted-order transaction.
 * Its entitlement request is rebuilt from persisted immutable line snapshots;
 * request/provider payloads never supply commercial quantities or regions.
 */
export async function createAcceptedOrderProvisioningAttempt(
  transaction: RuntimeTransaction,
  input: {
    orderId: string;
    orderVersion: number;
    accountId: string;
    provisioningIdempotencyKey: string;
    requestedAt: Date;
    actor: Actor;
    requestId: string;
    lineSnapshots: readonly PersistedOrderLineSnapshot[];
  },
) {
  if (input.lineSnapshots.length === 0)
    throw new Error("PROVISIONING_ORDER_LINES_REQUIRED");
  const candidates = await transaction.query.organizations.findMany({
    where: eq(organizations.accountId, input.accountId),
  });
  const organization = provisioningOrganization(candidates);
  if (!organization) throw new Error("PROVISIONING_ORGANIZATION_NOT_FOUND");

  const lines = provisioningLinesFromSnapshots(input.lineSnapshots);
  const digest = createHash("sha256")
    .update(input.provisioningIdempotencyKey)
    .digest("hex");
  const command: ProvisioningCommand = {
    commandId: `provisioning-${digest.slice(0, 32)}`,
    idempotencyKey: input.provisioningIdempotencyKey,
    orderId: input.orderId,
    orderVersion: input.orderVersion,
    organizationId: organization.id,
    operation: "provision",
    tenantId: organization.externalProvisioningId,
    entitlements: lines.map((line) => ({
      sku: line.sku,
      productCode: line.productCode,
      entitlementKind: line.entitlementKind,
      quantity: line.quantity,
      region: line.region,
    })),
    requestedAt: input.requestedAt.toISOString(),
  };
  const attempt = beginProvisioning(command);
  const [persistedAttempt] = await transaction
    .insert(lifecycleProvisioningAttempts)
    .values({
      commandId: command.commandId,
      accountId: input.accountId,
      orderId: input.orderId,
      organizationId: organization.id,
      operation: command.operation,
      state: attempt.state,
      attempt,
    })
    .returning();
  if (!persistedAttempt) throw new Error("PROVISIONING_ATTEMPT_INSERT_FAILED");

  const event = await appendAuditAndOutbox(transaction, {
    accountId: input.accountId,
    aggregateType: "provider_operation",
    aggregateId: persistedAttempt.id,
    aggregateVersion: persistedAttempt.rowVersion,
    eventType: "order.provisioning_requested",
    topic: "order.provisioning_requested",
    actor: input.actor,
    requestId: input.requestId,
    occurredAt: input.requestedAt,
    after: {
      orderId: input.orderId,
      accountId: input.accountId,
      organizationId: organization.id,
      command,
    },
  });
  return {
    attempt: persistedAttempt,
    command,
    outboxMessageId: event.message.id,
  };
}
