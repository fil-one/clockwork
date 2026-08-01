import { uuidV7, type Actor, type EntityName } from "@clockwork/contracts";

import type { RuntimeTransaction } from "../client";
import { auditEvents, outboxMessages } from "../schema";

export interface AppendAuditOutboxInput {
  accountId?: string;
  aggregateType: EntityName;
  aggregateId: string;
  aggregateVersion: number;
  eventType: string;
  eventVersion?: number;
  actor: Actor;
  requestId: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  topic?: string;
  occurredAt?: Date;
}

/** The audit event and its delivery record are always appended atomically. */
export async function appendAuditAndOutbox(
  transaction: RuntimeTransaction,
  input: AppendAuditOutboxInput,
) {
  const [event] = await transaction
    .insert(auditEvents)
    .values({
      accountId: input.accountId,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      aggregateVersion: input.aggregateVersion,
      eventType: input.eventType,
      eventVersion: input.eventVersion ?? 1,
      actor: input.actor,
      occurredAt: input.occurredAt ?? new Date(),
      requestId: input.requestId,
      before: input.before,
      after: input.after,
      metadata: input.metadata ?? {},
    })
    .returning();

  if (!event) throw new Error("Audit insert did not return a row");

  const messageId = uuidV7();
  await transaction.insert(outboxMessages).values({
    id: messageId,
    eventId: event.id,
    topic: input.topic ?? input.eventType,
    payload: {
      eventId: event.id,
      eventType: input.eventType,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      aggregateVersion: input.aggregateVersion,
      occurredAt: event.occurredAt.toISOString(),
      requestId: input.requestId,
      actor: input.actor,
      data: input.after ?? {},
    },
  });

  // Tenant transactions may append but intentionally cannot SELECT the
  // service-owned dispatch queue, so INSERT ... RETURNING would violate RLS.
  return { event, message: { id: messageId } };
}
