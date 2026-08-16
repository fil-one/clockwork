import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import type { Actor } from "@clockwork/contracts";
import {
  appendAuditAndOutbox,
  withInternalTransaction,
  type RuntimeDatabase,
} from "@clockwork/db";

import {
  decisionReasonLimits,
  runtimeFailureEventTypes,
  unhandledErrorContainEvent,
  unhandledErrorReleaseEvent,
  type IncidentDecision,
} from "./model";

export interface UnhandledErrorDecisionInput {
  auditEventId: string;
  decision: IncidentDecision;
  reason: string;
  containmentReference?: string;
  actor: Actor;
  requestId: string;
  occurredAt?: Date;
}

export interface UnhandledErrorDecisionRecord {
  auditEventId: string;
  decision: IncidentDecision;
  recordVersion: number;
}

const AnchorSchema = z
  .object({
    id: z.string(),
    event_type: z.string(),
    account_id: z.string().nullable(),
    aggregate_type: z.string(),
    aggregate_id: z.string(),
    safe_code: z.string().nullable(),
    next_version: z.coerce.number().int().positive(),
  })
  .strict();

/**
 * Appends one operator record against the audit event that recorded a failure.
 *
 * Two properties matter and both are enforced here rather than by the caller.
 *
 * The anchor must be a runtime failure. An operator cannot attach a
 * containment record to an arbitrary audit row: the anchor is re-read inside
 * the transaction and refused unless its `event_type` is one the failure
 * catalogue names.
 *
 * The record is numbered in its own append-only sequence over the anchor. That
 * is safe precisely because nothing else in the tree versions an `audit_event`
 * aggregate -- every runtime writer numbers its audit rows from a source row's
 * `row_version`. Numbering an operator record against one of those source
 * aggregates would consume the version the next runtime transition is going to
 * use and make that transition fail on `audit_aggregate_version_unique`.
 */
// `async` rather than a plain promise-returning function so the guard below
// rejects like every other refusal here. A synchronous throw from a function
// typed as returning a promise is a refusal half its callers would miss.
export async function recordUnhandledErrorDecision(
  database: RuntimeDatabase,
  input: UnhandledErrorDecisionInput,
): Promise<UnhandledErrorDecisionRecord> {
  const reason = input.reason.trim();
  // The same two bounds the server action enforces and the help text states, so
  // a caller that reaches the store directly cannot write a reason the surface
  // would have refused.
  if (reason.length < decisionReasonLimits.min)
    throw new Error("UNHANDLED_ERROR_REASON_REQUIRED");
  if (reason.length > decisionReasonLimits.max)
    throw new Error("UNHANDLED_ERROR_REASON_TOO_LONG");
  const eventType =
    input.decision === "contain"
      ? unhandledErrorContainEvent
      : unhandledErrorReleaseEvent;
  return await withInternalTransaction(
    database,
    input.requestId,
    async (transaction) => {
      const rows = await transaction.execute(sql`
        select failure.id::text as id,
               failure.event_type,
               failure.account_id::text as account_id,
               failure.aggregate_type,
               failure.aggregate_id::text as aggregate_id,
               coalesce(
                 failure.after->>'code', failure.after->>'resultCode'
               ) as safe_code,
               (
                 select coalesce(max(record.aggregate_version), 0) + 1
                 from public.audit_events record
                 where record.aggregate_type = 'audit_event'
                   and record.aggregate_id = failure.id
               ) as next_version
        from public.audit_events failure
        where failure.id = ${input.auditEventId}::uuid
          and failure.event_type in (
            ${sql.join(
              runtimeFailureEventTypes.map((value) => sql`${value}`),
              sql`, `,
            )}
          )
      `);
      const row = rows[0];
      if (!row) throw new Error("UNHANDLED_ERROR_NOT_FOUND");
      const anchor = AnchorSchema.parse(row);
      const occurredAt = input.occurredAt ?? new Date();
      await appendAuditAndOutbox(transaction, {
        ...(anchor.account_id ? { accountId: anchor.account_id } : {}),
        aggregateType: "audit_event",
        aggregateId: anchor.id,
        aggregateVersion: anchor.next_version,
        eventType,
        actor: input.actor,
        requestId: input.requestId,
        occurredAt,
        after: {
          decision: input.decision,
          reason,
          failureEventType: anchor.event_type,
          failureAggregateType: anchor.aggregate_type,
          failureAggregateId: anchor.aggregate_id,
          safeCode: anchor.safe_code,
          ...(input.containmentReference
            ? { containmentReference: input.containmentReference }
            : {}),
        },
      });
      return {
        auditEventId: anchor.id,
        decision: input.decision,
        recordVersion: anchor.next_version,
      };
    },
  );
}
