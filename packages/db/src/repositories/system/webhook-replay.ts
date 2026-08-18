import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
} from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { uuidV7, type Actor } from "@clockwork/contracts";

import type { RuntimeDatabase } from "../../client";
import { webhookEvents, workflowRuns } from "../../schema";
import { withInternalTransaction } from "../../transaction";
import { appendAuditAndOutbox } from "../audit-outbox";

export const WEBHOOK_REPLAY_TASK_ID = "webhook-replay:v1";
export const WEBHOOK_REPLAY_REQUESTED_TOPIC = "system.webhook_replay.requested";
export const WEBHOOK_REPLAY_MAX_ATTEMPTS = 8;

const ReplayRunInputSchema = z
  .object({
    version: z.literal(1),
    webhookEventId: z.uuid(),
    provider: z.string().min(1).max(120),
    providerEventId: z.string().min(1).max(255),
    payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
    claimToken: z.uuid(),
    requestedBy: z.object({
      kind: z.enum(["user", "system", "provider"]),
      id: z.string().min(1),
    }),
    reason: z.string().min(8).max(2_000),
    requestId: z.string().min(8).max(255),
    leaseUntil: z.iso.datetime({ offset: true }),
  })
  .strict();

export type WebhookReplayRunInput = z.infer<typeof ReplayRunInputSchema>;

export interface VerifiedWebhookReplayPayload {
  workflowRunId: string;
  webhookEventId: string;
  provider: string;
  providerEventId: string;
  eventType: string;
  payloadHash: string;
  payload: unknown;
  occurredAt: string;
}

export type WebhookReplayRequestResult =
  | { status: "not_found" }
  | { status: "ingress_in_progress" }
  | { status: "already_running"; workflowRunId: string }
  | { status: "started"; workflowRunId: string };

/** Durable command/task store. Payload bytes never cross the queue boundary. */
export class DatabaseWebhookReplayTaskStore {
  public constructor(
    private readonly database: RuntimeDatabase,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  public request(input: {
    provider: string;
    providerEventId: string;
    requestedBy: Actor;
    reason: string;
    requestId: string;
  }): Promise<WebhookReplayRequestResult> {
    const provider = input.provider.trim();
    const providerEventId = input.providerEventId.trim();
    const reason = input.reason.trim();
    if (!provider || !providerEventId)
      throw new Error("WEBHOOK_REPLAY_IDENTITY_REQUIRED");
    if (reason.length < 8 || reason.length > 2_000)
      throw new Error("WEBHOOK_REPLAY_REASON_INVALID");
    return withInternalTransaction(
      this.database,
      input.requestId,
      async (transaction) => {
        const [event] = await transaction
          .select()
          .from(webhookEvents)
          .where(
            and(
              eq(webhookEvents.provider, provider),
              eq(webhookEvents.providerEventId, providerEventId),
            ),
          )
          .limit(1)
          .for("update");
        if (!event) return { status: "not_found" };

        const active = await transaction.query.workflowRuns.findFirst({
          where: and(
            eq(workflowRuns.taskIdentifier, WEBHOOK_REPLAY_TASK_ID),
            eq(workflowRuns.aggregateType, "webhook_event"),
            eq(workflowRuns.aggregateId, event.id),
            inArray(workflowRuns.status, ["pending", "running", "retrying"]),
          ),
          orderBy: [desc(workflowRuns.createdAt)],
        });
        const now = this.clock();
        if (active) {
          const activeInput = ReplayRunInputSchema.parse(active.input);
          if (
            activeInput.webhookEventId !== event.id ||
            activeInput.claimToken !== event.lockToken
          )
            throw new Error("WEBHOOK_REPLAY_ACTIVE_RUN_BINDING_INVALID");
          if (Date.parse(activeInput.leaseUntil) > now.getTime())
            return { status: "already_running", workflowRunId: active.id };
          const [expired] = await transaction
            .update(workflowRuns)
            .set({
              status: "failed",
              output: { code: "WEBHOOK_REPLAY_LEASE_EXPIRED" },
              lastError: "WEBHOOK_REPLAY_LEASE_EXPIRED",
            })
            .where(
              and(
                eq(workflowRuns.id, active.id),
                eq(workflowRuns.rowVersion, active.rowVersion),
              ),
            )
            .returning({ id: workflowRuns.id });
          if (!expired) throw new Error("WEBHOOK_REPLAY_EXPIRY_RACE");
        }
        if (
          !active &&
          event.processedAt === null &&
          event.processingError === null &&
          event.lockedUntil > now
        )
          return { status: "ingress_in_progress" };

        const workflowRunId = uuidV7();
        const claimToken = randomUUID();
        const leaseUntil = new Date(now.getTime() + 60 * 60 * 1_000);
        const runInput: WebhookReplayRunInput = {
          version: 1,
          webhookEventId: event.id,
          provider,
          providerEventId,
          payloadHash: event.payloadHash,
          claimToken,
          requestedBy: input.requestedBy,
          reason,
          requestId: input.requestId,
          leaseUntil: leaseUntil.toISOString(),
        };
        await transaction
          .update(webhookEvents)
          .set({
            lockToken: claimToken,
            lockedUntil: leaseUntil,
            attemptCount: event.attemptCount + 1,
          })
          .where(eq(webhookEvents.id, event.id));
        await transaction.insert(workflowRuns).values({
          id: workflowRunId,
          taskIdentifier: WEBHOOK_REPLAY_TASK_ID,
          idempotencyKey: `webhook-replay:${event.id}:${workflowRunId}`,
          aggregateType: "webhook_event",
          aggregateId: event.id,
          status: "pending",
          input: runInput,
        });
        await appendAuditAndOutbox(transaction, {
          aggregateType: "workflow_run",
          aggregateId: workflowRunId,
          aggregateVersion: 1,
          eventType: WEBHOOK_REPLAY_REQUESTED_TOPIC,
          topic: WEBHOOK_REPLAY_REQUESTED_TOPIC,
          actor: input.requestedBy,
          requestId: input.requestId,
          occurredAt: now,
          after: {
            workflowRunId,
            webhookEventId: event.id,
            provider,
            providerEventId,
            payloadHash: event.payloadHash,
            reason,
          },
        });
        return { status: "started", workflowRunId };
      },
    );
  }

  public claim(input: {
    workflowRunId: string;
    triggerRunId: string;
    attempt: number;
  }): Promise<
    | { status: "claimed"; event: VerifiedWebhookReplayPayload }
    | { status: "duplicate"; output: unknown }
  > {
    return withInternalTransaction(
      this.database,
      `webhook-replay-claim:${input.workflowRunId}`,
      async (transaction) => {
        const candidate = await transaction.query.workflowRuns.findFirst({
          where: eq(workflowRuns.id, input.workflowRunId),
        });
        if (!candidate || candidate.taskIdentifier !== WEBHOOK_REPLAY_TASK_ID)
          throw new Error("WEBHOOK_REPLAY_RUN_NOT_FOUND");
        if (candidate.status === "succeeded")
          return { status: "duplicate", output: candidate.output };
        const candidateReplay = ReplayRunInputSchema.parse(candidate.input);
        const [event] = await transaction
          .select()
          .from(webhookEvents)
          .where(eq(webhookEvents.id, candidateReplay.webhookEventId))
          .limit(1)
          .for("update");
        const [run] = await transaction
          .select()
          .from(workflowRuns)
          .where(eq(workflowRuns.id, input.workflowRunId))
          .limit(1)
          .for("update");
        if (!run || run.taskIdentifier !== WEBHOOK_REPLAY_TASK_ID)
          throw new Error("WEBHOOK_REPLAY_RUN_NOT_FOUND");
        if (run.status === "succeeded")
          return { status: "duplicate", output: run.output };
        const replay = ReplayRunInputSchema.parse(run.input);
        if (replay.webhookEventId !== candidateReplay.webhookEventId)
          throw new Error("WEBHOOK_REPLAY_RUN_BINDING_CHANGED");
        const now = this.clock();
        const sameTriggerRetry =
          run.status === "running" &&
          run.triggerRunId === input.triggerRunId &&
          input.attempt > run.attemptCount;
        if (
          run.status !== "pending" &&
          run.status !== "retrying" &&
          !sameTriggerRetry
        )
          throw new Error("WEBHOOK_REPLAY_ALREADY_IN_PROGRESS");
        if (
          !event ||
          event.provider !== replay.provider ||
          event.providerEventId !== replay.providerEventId ||
          event.payloadHash !== replay.payloadHash ||
          event.lockToken !== replay.claimToken
        )
          throw new Error("WEBHOOK_REPLAY_STORED_EVENT_BINDING_INVALID");
        const leaseUntil = new Date(now.getTime() + 60 * 60 * 1_000);
        const [claimed] = await transaction
          .update(workflowRuns)
          .set({
            status: "running",
            triggerRunId: input.triggerRunId,
            attemptCount: input.attempt,
            lastError: null,
            input: { ...replay, leaseUntil: leaseUntil.toISOString() },
          })
          .where(
            and(
              eq(workflowRuns.id, run.id),
              eq(workflowRuns.rowVersion, run.rowVersion),
            ),
          )
          .returning({ id: workflowRuns.id });
        if (!claimed) throw new Error("WEBHOOK_REPLAY_CLAIM_RACE");
        await transaction
          .update(webhookEvents)
          .set({ lockedUntil: leaseUntil })
          .where(
            and(
              eq(webhookEvents.id, event.id),
              eq(webhookEvents.lockToken, replay.claimToken),
            ),
          );
        return {
          status: "claimed",
          event: {
            workflowRunId: run.id,
            webhookEventId: event.id,
            provider: event.provider,
            providerEventId: event.providerEventId,
            eventType: event.eventType,
            payloadHash: event.payloadHash,
            payload: event.payload,
            occurredAt: event.occurredAt.toISOString(),
          },
        };
      },
    );
  }

  public complete(input: {
    workflowRunId: string;
    triggerRunId: string;
    output: unknown;
  }): Promise<void> {
    return this.finish(input, true);
  }

  public fail(input: {
    workflowRunId: string;
    triggerRunId: string;
    attempt: number;
  }): Promise<void> {
    return this.finish(input, input.attempt >= WEBHOOK_REPLAY_MAX_ATTEMPTS);
  }

  private async finish(
    input: {
      workflowRunId: string;
      triggerRunId: string;
      output?: unknown;
    },
    terminal: boolean,
  ): Promise<void> {
    await withInternalTransaction(
      this.database,
      `webhook-replay-finish:${input.workflowRunId}`,
      async (transaction) => {
        const candidate = await transaction.query.workflowRuns.findFirst({
          where: eq(workflowRuns.id, input.workflowRunId),
        });
        if (!candidate || candidate.taskIdentifier !== WEBHOOK_REPLAY_TASK_ID)
          throw new Error("STALE_WEBHOOK_REPLAY_CLAIM");
        const candidateReplay = ReplayRunInputSchema.parse(candidate.input);
        const [event] = await transaction
          .select()
          .from(webhookEvents)
          .where(eq(webhookEvents.id, candidateReplay.webhookEventId))
          .limit(1)
          .for("update");
        const [run] = await transaction
          .select()
          .from(workflowRuns)
          .where(eq(workflowRuns.id, input.workflowRunId))
          .limit(1)
          .for("update");
        if (
          !run ||
          run.status !== "running" ||
          run.triggerRunId !== input.triggerRunId
        )
          throw new Error("STALE_WEBHOOK_REPLAY_CLAIM");
        const replay = ReplayRunInputSchema.parse(run.input);
        if (
          !event ||
          replay.webhookEventId !== candidateReplay.webhookEventId ||
          event.lockToken !== replay.claimToken
        )
          throw new Error("STALE_WEBHOOK_REPLAY_EVENT_CLAIM");
        const now = this.clock();
        const succeeded = input.output !== undefined;
        const retryLeaseUntil = new Date(now.getTime() + 60 * 60 * 1_000);
        if (succeeded || terminal) {
          const [settled] = await transaction
            .update(webhookEvents)
            .set(
              succeeded
                ? {
                    processedAt: event.processedAt ?? now,
                    processingError: null,
                    lockedUntil: now,
                  }
                : event.processedAt
                  ? { lockedUntil: now }
                  : {
                      processingError: "WEBHOOK_REPLAY_FAILED",
                      lockedUntil: now,
                    },
            )
            .where(
              and(
                eq(webhookEvents.id, replay.webhookEventId),
                eq(webhookEvents.lockToken, replay.claimToken),
              ),
            )
            .returning({ id: webhookEvents.id });
          if (!settled) throw new Error("STALE_WEBHOOK_REPLAY_EVENT_CLAIM");
        } else {
          await transaction
            .update(webhookEvents)
            .set({ lockedUntil: retryLeaseUntil })
            .where(
              and(
                eq(webhookEvents.id, replay.webhookEventId),
                eq(webhookEvents.lockToken, replay.claimToken),
              ),
            );
        }
        const [updated] = await transaction
          .update(workflowRuns)
          .set({
            status: succeeded ? "succeeded" : terminal ? "failed" : "retrying",
            output: succeeded
              ? (input.output ?? null)
              : terminal
                ? { code: "WEBHOOK_REPLAY_FAILED" }
                : null,
            lastError: succeeded ? null : "WEBHOOK_REPLAY_FAILED",
            input:
              !succeeded && !terminal
                ? { ...replay, leaseUntil: retryLeaseUntil.toISOString() }
                : replay,
          })
          .where(
            and(
              eq(workflowRuns.id, run.id),
              eq(workflowRuns.rowVersion, run.rowVersion),
            ),
          )
          .returning({ id: workflowRuns.id });
        if (!updated) throw new Error("STALE_WEBHOOK_REPLAY_RUN");
      },
    );
  }
}

/**
 * Verified provider callbacks an operator may replay.
 *
 * A replay re-processes the stored, signature-verified bytes. Nothing here
 * exposes those bytes: the payload, the signature header, and the lock token
 * stay in the row. The runbook forbids putting a webhook secret or payload into
 * a ticket or a log, and an operator surface is a place both of those end up.
 */
export interface ReplayableWebhookEvent {
  id: string;
  provider: string;
  providerEventId: string;
  eventType: string;
  /** Content hash of the verified bytes. Replay identity, with the event id. */
  payloadHash: string;
  occurredAt: string;
  signatureVerifiedAt: string;
  attemptCount: number;
  processedAt: string | null;
  /** Operator-safe failure text as the consumer recorded it. */
  processingError: string | null;
  state: "failed" | "unprocessed" | "processed";
}

const ListInputSchema = z
  .object({
    provider: z.string().trim().min(1).max(120).optional(),
    limit: z.number().int().min(1).max(200).default(50),
    requestId: z.string().min(8).max(255),
  })
  .strict();

export type WebhookReplayListInput = z.input<typeof ListInputSchema>;

function instant(value: Date): string {
  return value.toISOString();
}

function state(row: {
  processedAt: Date | null;
  processingError: string | null;
}): ReplayableWebhookEvent["state"] {
  if (row.processingError) return "failed";
  return row.processedAt ? "processed" : "unprocessed";
}

/**
 * Reads the replay candidates for the operator surface.
 *
 * A processed callback with no error is deliberately absent: replaying one is
 * legitimate but rare, and listing every settled event would bury the ones that
 * actually stopped. Look one up by provider and event id instead.
 */
export class DatabaseWebhookReplayReadModel {
  public constructor(
    private readonly database: RuntimeDatabase,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  public async list(
    input: WebhookReplayListInput,
  ): Promise<readonly ReplayableWebhookEvent[]> {
    const parsed = ListInputSchema.parse(input);
    const rows = await withInternalTransaction(
      this.database,
      parsed.requestId,
      (transaction) =>
        transaction.query.webhookEvents.findMany({
          where: and(
            ...(parsed.provider
              ? [eq(webhookEvents.provider, parsed.provider)]
              : []),
            and(
              or(
                isNotNull(webhookEvents.processingError),
                isNull(webhookEvents.processedAt),
              ),
              lte(webhookEvents.lockedUntil, this.clock()),
            ),
          ),
          orderBy: [desc(webhookEvents.occurredAt), desc(webhookEvents.id)],
          limit: parsed.limit,
        }),
    );
    return rows.map((row) => this.present(row));
  }

  private present(
    row: typeof webhookEvents.$inferSelect,
  ): ReplayableWebhookEvent {
    return {
      id: row.id,
      provider: row.provider,
      providerEventId: row.providerEventId,
      eventType: row.eventType,
      payloadHash: row.payloadHash,
      occurredAt: instant(row.occurredAt),
      signatureVerifiedAt: instant(row.signatureVerifiedAt),
      attemptCount: row.attemptCount,
      processedAt: row.processedAt ? instant(row.processedAt) : null,
      processingError: row.processingError,
      state: state(row),
    };
  }
}
