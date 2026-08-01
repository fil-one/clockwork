import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { ids, type Actor } from "@clockwork/contracts";

import type { RuntimeDatabase, RuntimeTransaction } from "../../client";
import { withInternalTransaction } from "../../transaction";
import { appendAuditAndOutbox } from "../audit-outbox";

const TerminalStatusSchema = z.enum(["applied", "rejected", "failed"]);
const ActionRowSchema = z.object({
  id: z.string().uuid(),
  projection_id: z.string().uuid(),
  aggregate_type: z.string(),
  aggregate_id: z.string().uuid(),
  command_resource: z.string(),
  action: z.string(),
  expected_version: z.number().int().positive(),
  actor_user_id: z.string().uuid(),
  effective_account_id: z.string().uuid().nullable(),
  audience_account_id: z.string().uuid().nullable(),
  subject_account_id: z.string().uuid().nullable(),
  assisted_session_id: z.string().uuid().nullable(),
  assisted_reason: z.string().nullable(),
  mfa_verified: z.boolean(),
  recent_authentication_verified: z.boolean(),
  idempotency_key: z.string(),
  request_payload: z.record(z.string(), z.unknown()),
  status: z.enum(["queued", "applied", "rejected", "failed"]),
  result_reference: z.string().nullable(),
  result_code: z.string().nullable(),
  authoritative_version: z.number().int().positive().nullable(),
  command_replayed: z.boolean().nullable(),
  created_at: z.coerce.date(),
  completed_at: z.coerce.date().nullable(),
  audit_event_id: z.string().uuid(),
  outbox_message_id: z.string().uuid(),
  row_version: z.number().int().positive(),
});
const ClaimRowSchema = z.object({
  action_request_id: z.string().uuid(),
  event_id: z.string().uuid(),
  message_id: z.string().uuid(),
  idempotency_key: z.string(),
  claim_token: z.string().uuid().nullable(),
  lease_until: z.coerce.date().nullable(),
  attempt_count: z.number().int().nonnegative(),
  row_version: z.number().int().positive(),
});

export interface DatabasePortalActionOutcome {
  status: "applied" | "rejected" | "failed";
  code: string;
  resultReference: string;
  authoritativeVersion: number | null;
  commandReplayed: boolean | null;
}

export interface DatabasePortalActionCompletionOutcome extends Omit<
  DatabasePortalActionOutcome,
  "commandReplayed"
> {
  commandReplayed: boolean;
}

function terminalOutcome(
  row: z.infer<typeof ActionRowSchema>,
): DatabasePortalActionOutcome {
  const status = TerminalStatusSchema.safeParse(row.status);
  if (!status.success || !row.result_code || !row.result_reference)
    throw new Error("PORTAL_ACTION_TERMINAL_STATE_CORRUPT");
  const isMigrationUnknown =
    (status.data === "applied" &&
      row.result_code === "LEGACY_PORTAL_ACTION_APPLIED") ||
    (status.data === "rejected" &&
      row.result_code === "LEGACY_PORTAL_ACTION_REJECTED") ||
    (status.data === "failed" &&
      (row.result_code === "LEGACY_PORTAL_ACTION_FAILED" ||
        row.result_code === "LEGACY_PROJECTION_VERSION_UNVERIFIED"));
  if (row.command_replayed === null && !isMigrationUnknown)
    throw new Error("PORTAL_ACTION_TERMINAL_STATE_CORRUPT");
  return {
    status: status.data,
    code: row.result_code,
    resultReference: row.result_reference,
    authoritativeVersion: row.authoritative_version,
    commandReplayed: row.command_replayed,
  };
}

function requestView(row: z.infer<typeof ActionRowSchema>) {
  return {
    id: row.id,
    projectionId: row.projection_id,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    commandResource: row.command_resource,
    action: row.action,
    expectedVersion: row.expected_version,
    actor: { kind: "user", id: row.actor_user_id } as const,
    effectiveAccountId: row.effective_account_id,
    assistedSessionId: row.assisted_session_id,
    assistedReason: row.assisted_reason,
    mfaVerified: row.mfa_verified,
    recentAuthenticationVerified: row.recent_authentication_verified,
    idempotencyKey: row.idempotency_key,
    payload: row.request_payload,
    createdAt: row.created_at.toISOString(),
  };
}

async function actionRow(
  transaction: RuntimeTransaction,
  actionRequestId: string,
) {
  const rows = await transaction.execute(sql`
    select id, projection_id, aggregate_type, aggregate_id, command_resource,
           action, expected_version, actor_user_id, effective_account_id,
           audience_account_id, subject_account_id, assisted_session_id,
           assisted_reason, mfa_verified, recent_authentication_verified,
           idempotency_key, request_payload, status,
           result_reference, result_code, authoritative_version,
           command_replayed, created_at, completed_at, audit_event_id,
           outbox_message_id, row_version
    from public.experience_projection_action_requests
    where id = ${actionRequestId}::uuid
    for update
  `);
  return rows[0] ? ActionRowSchema.parse(rows[0]) : undefined;
}

/** Durable lease and terminal-outcome persistence for portal action workers. */
export class DatabasePortalActionPersistence {
  public constructor(
    private readonly database: RuntimeDatabase,
    private readonly leaseMs = 60_000,
  ) {
    if (!Number.isSafeInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 300_000)
      throw new Error("PORTAL_ACTION_LEASE_INVALID");
  }

  public claim(input: {
    actionRequestId: string;
    eventId: string;
    messageId: string;
    idempotencyKey: string;
    now: Date;
  }) {
    return withInternalTransaction(
      this.database,
      input.idempotencyKey,
      async (transaction) => {
        const request = await actionRow(transaction, input.actionRequestId);
        if (!request) return { status: "missing" as const };
        if (
          request.audit_event_id !== input.eventId ||
          request.outbox_message_id !== input.messageId ||
          input.idempotencyKey !== `outbox:${input.messageId}`
        )
          throw new Error("PORTAL_ACTION_CLAIM_BINDING_INVALID");
        if (request.status !== "queued")
          return {
            status: "terminal" as const,
            actionRequestId: request.id,
            outcome: terminalOutcome(request),
          };

        await transaction.execute(sql`
          insert into public.experience_projection_action_claims (
            action_request_id, event_id, message_id, idempotency_key
          ) values (
            ${request.id}::uuid, ${input.eventId}::uuid,
            ${input.messageId}::uuid, ${input.idempotencyKey}
          ) on conflict (action_request_id) do nothing
        `);
        const claimRows = await transaction.execute(sql`
          select action_request_id, event_id, message_id, idempotency_key,
                 claim_token, lease_until, attempt_count, row_version
          from public.experience_projection_action_claims
          where action_request_id = ${request.id}::uuid
          for update
        `);
        const existing = ClaimRowSchema.parse(claimRows[0]);
        if (
          existing.event_id !== input.eventId ||
          existing.message_id !== input.messageId ||
          existing.idempotency_key !== input.idempotencyKey
        )
          throw new Error("PORTAL_ACTION_CLAIM_BINDING_INVALID");
        if (
          existing.claim_token &&
          existing.lease_until &&
          existing.lease_until > input.now
        )
          return {
            status: "busy" as const,
            retryAt: existing.lease_until.toISOString(),
          };
        const claimToken = randomUUID();
        const leaseUntil = new Date(input.now.getTime() + this.leaseMs);
        const updated = await transaction.execute(sql`
          update public.experience_projection_action_claims
          set claim_token = ${claimToken}::uuid,
              lease_until = ${leaseUntil.toISOString()}::timestamptz,
              attempt_count = attempt_count + 1,
              last_error = null
          where action_request_id = ${request.id}::uuid
            and row_version = ${existing.row_version}
          returning attempt_count
        `);
        const attempt = z
          .object({ attempt_count: z.number().int().positive() })
          .parse(updated[0]).attempt_count;
        return {
          status: "claimed" as const,
          claimToken,
          attempt,
          request: requestView(request),
        };
      },
    );
  }

  public finish(input: {
    actionRequestId: string;
    claimToken: string;
    eventId: string;
    requestId: string;
    completedAt: Date;
    outcome: DatabasePortalActionCompletionOutcome;
  }) {
    return withInternalTransaction(
      this.database,
      input.requestId,
      async (transaction) => {
        const request = await actionRow(transaction, input.actionRequestId);
        if (!request) throw new Error("PORTAL_ACTION_REQUEST_NOT_FOUND");
        if (request.status !== "queued") return terminalOutcome(request);
        const claimRows = await transaction.execute(sql`
          select action_request_id, event_id, message_id, idempotency_key,
                 claim_token, lease_until, attempt_count, row_version
          from public.experience_projection_action_claims
          where action_request_id = ${request.id}::uuid
          for update
        `);
        const claim = ClaimRowSchema.parse(claimRows[0]);
        if (
          claim.event_id !== input.eventId ||
          claim.claim_token !== input.claimToken ||
          !claim.lease_until ||
          claim.lease_until <= input.completedAt
        )
          throw new Error("PORTAL_ACTION_CLAIM_STALE");
        const status = TerminalStatusSchema.parse(input.outcome.status);
        const updatedRows = await transaction.execute(sql`
          update public.experience_projection_action_requests
          set status = ${status},
              result_reference = ${input.outcome.resultReference},
              result_code = ${input.outcome.code},
              authoritative_version = ${input.outcome.authoritativeVersion},
              command_replayed = ${input.outcome.commandReplayed},
              completed_at = ${input.completedAt.toISOString()}::timestamptz
          where id = ${request.id}::uuid and status = 'queued'
          returning row_version
        `);
        const updated = z
          .object({ row_version: z.number().int().positive() })
          .parse(updatedRows[0]);
        await transaction.execute(sql`
          update public.experience_projection_action_claims
          set claim_token = null, lease_until = null, last_error = null
          where action_request_id = ${request.id}::uuid
            and claim_token = ${input.claimToken}::uuid
        `);
        const accountId =
          request.effective_account_id ??
          request.subject_account_id ??
          request.audience_account_id;
        const actor: Actor = request.assisted_session_id
          ? {
              kind: "user",
              id: request.actor_user_id,
              ...(accountId
                ? { impersonatedAccountId: ids.account.parse(accountId) }
                : {}),
              ...(request.assisted_reason
                ? { assistedActionReason: request.assisted_reason }
                : {}),
            }
          : { kind: "user", id: request.actor_user_id };
        await appendAuditAndOutbox(transaction, {
          ...(accountId ? { accountId } : {}),
          aggregateType: "experience_action_request",
          aggregateId: request.id,
          aggregateVersion: updated.row_version,
          eventType: `experience.projection_action.${status}`,
          actor,
          requestId: input.requestId,
          occurredAt: input.completedAt,
          after: {
            actionRequestId: request.id,
            aggregateType: request.aggregate_type,
            aggregateId: request.aggregate_id,
            action: request.action,
            expectedVersion: request.expected_version,
            status,
            resultCode: input.outcome.code,
            resultReference: input.outcome.resultReference,
            authoritativeVersion: input.outcome.authoritativeVersion,
            commandReplayed: input.outcome.commandReplayed,
          },
          ...(request.assisted_session_id
            ? {
                metadata: {
                  assistedSessionId: request.assisted_session_id,
                },
              }
            : {}),
        });
        return { ...input.outcome, status };
      },
    );
  }

  public release(input: {
    actionRequestId: string;
    claimToken: string;
    eventId: string;
    requestId: string;
    releasedAt: Date;
    failureCode: string;
  }): Promise<void> {
    return withInternalTransaction(
      this.database,
      input.requestId,
      async (transaction) => {
        const request = await actionRow(transaction, input.actionRequestId);
        if (!request) throw new Error("PORTAL_ACTION_REQUEST_NOT_FOUND");
        const rows = await transaction.execute(sql`
          update public.experience_projection_action_claims
          set claim_token = null,
              lease_until = null,
              last_error = ${input.failureCode}
          where action_request_id = ${request.id}::uuid
            and event_id = ${input.eventId}::uuid
            and claim_token = ${input.claimToken}::uuid
          returning row_version, attempt_count
        `);
        const claim = z
          .object({
            row_version: z.number().int().positive(),
            attempt_count: z.number().int().positive(),
          })
          .parse(rows[0]);
        const accountId =
          request.effective_account_id ??
          request.subject_account_id ??
          request.audience_account_id;
        await appendAuditAndOutbox(transaction, {
          ...(accountId ? { accountId } : {}),
          aggregateType: "experience_action_claim",
          aggregateId: request.id,
          aggregateVersion: claim.row_version,
          eventType: "experience.projection_action.retry_released",
          actor: { kind: "system", id: "portal-action-worker" },
          requestId: input.requestId,
          occurredAt: input.releasedAt,
          after: {
            actionRequestId: request.id,
            attempt: claim.attempt_count,
            failureCode: input.failureCode,
          },
        });
      },
    );
  }
}

export interface DatabasePortalProjection {
  audience: "customer" | "partner" | "internal";
  audienceAccountId: string | null;
  subjectAccountId: string | null;
  channel: string;
  recordKey: string;
  commandResource: string | null;
  payload: Readonly<Record<string, unknown>>;
  aggregateType: string;
  aggregateId: string;
  sourceVersion: number;
  sourceHash: string;
  sourceUpdatedAt: string;
}

/** Atomic authoritative-event receipt plus projection-set replacement. */
export class DatabasePortalProjectionMaterializer {
  public constructor(private readonly database: RuntimeDatabase) {}

  public materialize(input: {
    eventId: string;
    eventType: string;
    aggregateType: string;
    aggregateId: string;
    aggregateVersion: number;
    sourceVersion: number;
    sourceHash: string;
    sourceUpdatedAt: string;
    actor: Actor;
    requestId: string;
    projectedAt: Date;
    projections: readonly DatabasePortalProjection[];
  }) {
    return withInternalTransaction(
      this.database,
      input.requestId,
      async (transaction) => {
        await transaction.execute(sql`
          select pg_advisory_xact_lock(
            hashtextextended(${`${input.aggregateType}:${input.aggregateId}`}, 0)
          )
        `);
        const receipts = await transaction.execute(sql`
          select id, event_type, aggregate_type, aggregate_id,
                 aggregate_version, source_hash, projection_count
          from public.experience_projection_materialization_receipts
          where event_id = ${input.eventId}::uuid
        `);
        if (receipts[0]) {
          const receipt = z
            .object({
              event_type: z.string(),
              aggregate_type: z.string(),
              aggregate_id: z.string().uuid(),
              aggregate_version: z.number().int().positive(),
              source_hash: z.string(),
              projection_count: z.number().int().nonnegative(),
            })
            .parse(receipts[0]);
          if (
            receipt.event_type !== input.eventType ||
            receipt.aggregate_type !== input.aggregateType ||
            receipt.aggregate_id !== input.aggregateId ||
            receipt.aggregate_version !== input.aggregateVersion ||
            receipt.source_hash !== input.sourceHash
          )
            throw new Error("PROJECTION_RECEIPT_BINDING_CONFLICT");
          return {
            status: "duplicate" as const,
            projectionCount: receipt.projection_count,
          };
        }
        const latest = await transaction.execute(sql`
          select max(aggregate_version)::integer as aggregate_version
          from public.experience_projection_materialization_receipts
          where aggregate_type = ${input.aggregateType}
            and aggregate_id = ${input.aggregateId}::uuid
        `);
        const latestVersion = z
          .object({ aggregate_version: z.number().int().positive().nullable() })
          .parse(latest[0]).aggregate_version;
        if (
          (latestVersion !== null && latestVersion > input.aggregateVersion) ||
          input.sourceVersion < input.aggregateVersion
        )
          return { status: "stale" as const, projectionCount: 0 };
        if (
          input.projections.some(
            (projection) =>
              projection.aggregateType !== input.aggregateType ||
              projection.aggregateId !== input.aggregateId ||
              projection.sourceVersion !== input.sourceVersion ||
              projection.sourceHash !== input.sourceHash ||
              projection.sourceUpdatedAt !== input.sourceUpdatedAt,
          )
        )
          throw new Error("PROJECTION_SET_BINDING_INVALID");

        const retainedIds: string[] = [];
        for (const projection of input.projections) {
          const rows = await transaction.execute(sql`
            insert into public.experience_portal_projections (
              audience, audience_account_id, subject_account_id, channel,
              record_key, aggregate_type, aggregate_id, command_resource,
              payload, source_hash, source_aggregate_version,
              source_updated_at, projected_at
            ) values (
              ${projection.audience}, ${projection.audienceAccountId}::uuid,
              ${projection.subjectAccountId}::uuid, ${projection.channel},
              ${projection.recordKey}, ${projection.aggregateType},
              ${projection.aggregateId}::uuid, ${projection.commandResource},
              ${JSON.stringify(projection.payload)}::jsonb,
              ${projection.sourceHash}, ${projection.sourceVersion},
              ${projection.sourceUpdatedAt}::timestamptz,
              ${input.projectedAt.toISOString()}::timestamptz
            )
            on conflict (audience, audience_account_id, channel, record_key)
            do update set
              subject_account_id = excluded.subject_account_id,
              aggregate_type = excluded.aggregate_type,
              aggregate_id = excluded.aggregate_id,
              command_resource = excluded.command_resource,
              payload = excluded.payload,
              source_hash = excluded.source_hash,
              source_aggregate_version = excluded.source_aggregate_version,
              source_updated_at = excluded.source_updated_at,
              projected_at = excluded.projected_at,
              row_version = experience_portal_projections.row_version + 1
            where experience_portal_projections.source_aggregate_version
              <= excluded.source_aggregate_version
            returning id
          `);
          const row = z.object({ id: z.string().uuid() }).safeParse(rows[0]);
          if (row.success) retainedIds.push(row.data.id);
        }
        if (retainedIds.length === 0) {
          await transaction.execute(sql`
            delete from public.experience_portal_projections
            where aggregate_type = ${input.aggregateType}
              and aggregate_id = ${input.aggregateId}::uuid
              and source_aggregate_version <= ${input.sourceVersion}
          `);
        } else {
          const retained = sql.join(
            retainedIds.map((id) => sql`${id}::uuid`),
            sql`, `,
          );
          await transaction.execute(sql`
            delete from public.experience_portal_projections
            where aggregate_type = ${input.aggregateType}
              and aggregate_id = ${input.aggregateId}::uuid
              and source_aggregate_version <= ${input.sourceVersion}
              and id not in (${retained})
          `);
        }
        const receiptRows = await transaction.execute(sql`
          insert into public.experience_projection_materialization_receipts (
            event_id, event_type, aggregate_type, aggregate_id,
            aggregate_version, source_hash, projection_count, projected_at
          ) values (
            ${input.eventId}::uuid, ${input.eventType}, ${input.aggregateType},
            ${input.aggregateId}::uuid, ${input.aggregateVersion},
            ${input.sourceHash}, ${input.projections.length},
            ${input.projectedAt.toISOString()}::timestamptz
          ) returning id
        `);
        const receiptId = z
          .object({ id: z.string().uuid() })
          .parse(receiptRows[0]).id;
        await appendAuditAndOutbox(transaction, {
          aggregateType: "portal_projection",
          aggregateId: receiptId,
          aggregateVersion: 1,
          eventType: "experience.projection.materialized",
          actor: input.actor,
          requestId: input.requestId,
          occurredAt: input.projectedAt,
          after: {
            sourceEventId: input.eventId,
            aggregateType: input.aggregateType,
            aggregateId: input.aggregateId,
            aggregateVersion: input.aggregateVersion,
            sourceVersion: input.sourceVersion,
            sourceHash: input.sourceHash,
            projectionCount: input.projections.length,
          },
        });
        return {
          status: "applied" as const,
          projectionCount: input.projections.length,
        };
      },
    );
  }
}
