import { createHash, randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import type { RuntimeDatabase, RuntimeTransaction } from "../../client";
import { outboxMessages, workflowRuns } from "../../schema";
import { withInternalTransaction } from "../../transaction";

export interface ClaimedOutboxMessage {
  id: string;
  eventId: string;
  topic: string;
  payload: unknown;
  attempt: number;
  leaseToken: string;
}

const ClaimedRowSchema = z.object({
  id: z.string().uuid(),
  event_id: z.string().uuid(),
  topic: z.string().min(1),
  payload: z.unknown(),
  attempt_count: z.number().int().nonnegative(),
});

interface OutboxLease {
  payloadHash: string;
  outboxMessageId: string;
  leaseToken: string;
  leaseUntil: string;
  retryAt?: string;
}

function lease(value: unknown): OutboxLease {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("OUTBOX_WORKFLOW_INPUT_CORRUPT");
  const parsed = z.record(z.string(), z.unknown()).safeParse(value);
  if (!parsed.success) throw new Error("OUTBOX_WORKFLOW_INPUT_CORRUPT");
  const item = parsed.data;
  if (
    typeof item.payloadHash !== "string" ||
    typeof item.outboxMessageId !== "string" ||
    typeof item.leaseToken !== "string" ||
    typeof item.leaseUntil !== "string" ||
    !Number.isFinite(Date.parse(item.leaseUntil)) ||
    (item.retryAt !== undefined &&
      (typeof item.retryAt !== "string" ||
        !Number.isFinite(Date.parse(item.retryAt))))
  )
    throw new Error("OUTBOX_WORKFLOW_INPUT_CORRUPT");
  return {
    payloadHash: item.payloadHash,
    outboxMessageId: item.outboxMessageId,
    leaseToken: item.leaseToken,
    leaseUntil: item.leaseUntil,
    ...(typeof item.retryAt === "string" ? { retryAt: item.retryAt } : {}),
  };
}

function hashPayload(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export class DatabaseOutboxDispatcherStore {
  public constructor(
    private readonly db: RuntimeDatabase,
    private readonly options: {
      clock?: () => Date;
      leaseMs?: number;
      maxAttempts?: number;
    } = {},
  ) {}

  private now(): Date {
    return this.options.clock?.() ?? new Date();
  }

  private leaseMs(): number {
    return this.options.leaseMs ?? 60_000;
  }

  private maxAttempts(): number {
    return this.options.maxAttempts ?? 8;
  }

  public claimNext(input: {
    workerId: string;
    topics?: readonly string[];
  }): Promise<ClaimedOutboxMessage | null> {
    return withInternalTransaction(
      this.db,
      `outbox-claim:${input.workerId}`,
      async (transaction) => {
        const now = this.now();
        const nowIso = now.toISOString();
        const topics = input.topics ? [...input.topics] : null;
        const rows = await transaction.execute(sql`
          select o.id, o.event_id, o.topic, o.payload, o.attempt_count
          from outbox_messages o
          left join workflow_runs w
            on w.task_identifier = 'system.outbox.dispatch.v1'
           and w.idempotency_key = 'outbox:' || o.id::text
          where o.processed_at is null
            and o.available_at <= ${nowIso}::timestamptz
            and o.attempt_count < ${this.maxAttempts()}
            and (${topics}::text[] is null or o.topic = any(${topics}::text[]))
            and (
              w.id is null
              or (w.status = 'running' and (w.input->>'leaseUntil')::timestamptz <= ${nowIso}::timestamptz)
              or (w.status = 'retrying' and coalesce((w.input->>'retryAt')::timestamptz, ${nowIso}::timestamptz) <= ${nowIso}::timestamptz)
            )
          order by o.available_at, o.created_at, o.id
          for update of o skip locked
          limit 1
        `);
        const rawRow = rows[0];
        if (!rawRow) return null;
        const row = ClaimedRowSchema.parse(rawRow);
        const leaseToken = randomUUID();
        const nextAttempt = row.attempt_count + 1;
        const runInput: OutboxLease = {
          payloadHash: hashPayload(row.payload),
          outboxMessageId: row.id,
          leaseToken,
          leaseUntil: new Date(now.getTime() + this.leaseMs()).toISOString(),
        };
        const existing = await transaction.query.workflowRuns.findFirst({
          where: and(
            eq(workflowRuns.taskIdentifier, "system.outbox.dispatch.v1"),
            eq(workflowRuns.idempotencyKey, `outbox:${row.id}`),
          ),
        });
        if (existing) {
          const updated = await transaction
            .update(workflowRuns)
            .set({
              status: "running",
              attemptCount: existing.attemptCount + 1,
              input: runInput,
              output: null,
              lastError: null,
              triggerRunId: input.workerId,
            })
            .where(
              and(
                eq(workflowRuns.id, existing.id),
                eq(workflowRuns.rowVersion, existing.rowVersion),
              ),
            )
            .returning({ id: workflowRuns.id });
          if (updated.length !== 1) return null;
        } else {
          await transaction.insert(workflowRuns).values({
            taskIdentifier: "system.outbox.dispatch.v1",
            idempotencyKey: `outbox:${row.id}`,
            aggregateType: "outbox_message",
            aggregateId: row.id,
            triggerRunId: input.workerId,
            status: "running",
            attemptCount: 1,
            input: runInput,
          });
        }
        await transaction
          .update(outboxMessages)
          .set({ attemptCount: nextAttempt, lastError: null })
          .where(eq(outboxMessages.id, row.id));
        return {
          id: row.id,
          eventId: row.event_id,
          topic: row.topic,
          payload: row.payload,
          attempt: nextAttempt,
          leaseToken,
        };
      },
    );
  }

  public async complete(message: ClaimedOutboxMessage): Promise<void> {
    await withInternalTransaction(
      this.db,
      `outbox-complete:${message.id}`,
      async (transaction) => {
        const run = await this.leasedRun(transaction, message);
        await transaction
          .update(outboxMessages)
          .set({ processedAt: this.now(), lastError: null })
          .where(
            and(
              eq(outboxMessages.id, message.id),
              sql`${outboxMessages.processedAt} is null`,
            ),
          );
        const completed = await transaction
          .update(workflowRuns)
          .set({
            status: "succeeded",
            output: { delivered: true, topic: message.topic },
            lastError: null,
          })
          .where(
            and(
              eq(workflowRuns.id, run.id),
              eq(workflowRuns.rowVersion, run.rowVersion),
            ),
          )
          .returning({ id: workflowRuns.id });
        if (completed.length !== 1) throw new Error("STALE_OUTBOX_LEASE");
      },
    );
  }

  public async fail(message: ClaimedOutboxMessage): Promise<void> {
    await withInternalTransaction(
      this.db,
      `outbox-fail:${message.id}`,
      async (transaction) => {
        const run = await this.leasedRun(transaction, message);
        const now = this.now();
        const exhausted = message.attempt >= this.maxAttempts();
        const delay = Math.min(300_000, 1_000 * 2 ** (message.attempt - 1));
        const retryAt = new Date(now.getTime() + delay);
        await transaction
          .update(outboxMessages)
          .set({
            availableAt: retryAt,
            lastError: exhausted
              ? "OUTBOX_DISPATCH_DEAD_LETTERED"
              : "OUTBOX_DISPATCH_FAILED",
          })
          .where(eq(outboxMessages.id, message.id));
        const prior = lease(run.input);
        const updated = await transaction
          .update(workflowRuns)
          .set({
            status: exhausted ? "failed" : "retrying",
            input: {
              ...prior,
              leaseUntil: now.toISOString(),
              retryAt: retryAt.toISOString(),
            },
            output: exhausted ? { code: "OUTBOX_DISPATCH_FAILED" } : null,
            lastError: "OUTBOX_DISPATCH_FAILED",
          })
          .where(
            and(
              eq(workflowRuns.id, run.id),
              eq(workflowRuns.rowVersion, run.rowVersion),
            ),
          )
          .returning({ id: workflowRuns.id });
        if (updated.length !== 1) throw new Error("STALE_OUTBOX_LEASE");
      },
    );
  }

  private async leasedRun(
    transaction: RuntimeTransaction,
    message: ClaimedOutboxMessage,
  ) {
    const run = await transaction.query.workflowRuns.findFirst({
      where: and(
        eq(workflowRuns.taskIdentifier, "system.outbox.dispatch.v1"),
        eq(workflowRuns.idempotencyKey, `outbox:${message.id}`),
        eq(workflowRuns.status, "running"),
      ),
    });
    if (!run) throw new Error("STALE_OUTBOX_LEASE");
    const currentLease = lease(run.input);
    if (
      currentLease.leaseToken !== message.leaseToken ||
      Date.parse(currentLease.leaseUntil) <= this.now().getTime()
    )
      throw new Error("STALE_OUTBOX_LEASE");
    return run;
  }
}
