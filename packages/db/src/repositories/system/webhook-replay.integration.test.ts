import { and, eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createRuntimeDatabase } from "../../client";
import {
  auditEvents,
  outboxMessages,
  webhookEvents,
  workflowRuns,
} from "../../schema";
import { withInternalTransaction } from "../../transaction";
import {
  DatabaseWebhookReplayTaskStore,
  DatabaseWebhookReplayReadModel,
  WEBHOOK_REPLAY_REQUESTED_TOPIC,
  WEBHOOK_REPLAY_TASK_ID,
} from "./webhook-replay";

const databaseUrl =
  process.env.DIRECT_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable";
const requestPrefix = "integration:webhook-replay";
const provider = "support:replay-integration";
const providerEventId = "evt_replay_integration";
const liveProviderEventId = "evt_replay_live_integration";
const processedProviderEventId = "evt_replay_processed_integration";
const liveClaimToken = "70000000-0000-4000-8000-000000000001";
const originalProcessedAt = new Date("2026-08-17T11:45:00.000Z");
const payloadHash = "a".repeat(64);
const now = new Date("2026-08-17T12:00:00.000Z");

const { client, db } = createRuntimeDatabase({
  url: databaseUrl,
  maxConnections: 2,
  role: "clockwork_service",
  ssl: false,
});
const store = new DatabaseWebhookReplayTaskStore(db, () => now);

async function cleanup() {
  await withInternalTransaction(db, `${requestPrefix}:cleanup`, async (tx) => {
    const events = await tx
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(like(auditEvents.requestId, `${requestPrefix}%`));
    if (events.length > 0) {
      await tx.delete(outboxMessages).where(
        inArray(
          outboxMessages.eventId,
          events.map(({ id }) => id),
        ),
      );
      await tx
        .delete(auditEvents)
        .where(like(auditEvents.requestId, `${requestPrefix}%`));
    }
    await tx
      .delete(workflowRuns)
      .where(eq(workflowRuns.taskIdentifier, WEBHOOK_REPLAY_TASK_ID));
    await tx.delete(webhookEvents).where(eq(webhookEvents.provider, provider));
  });
}

beforeAll(async () => {
  await cleanup();
  await withInternalTransaction(db, `${requestPrefix}:setup`, async (tx) => {
    await tx.insert(webhookEvents).values({
      provider,
      providerEventId,
      eventType: "ticket.updated",
      signatureVerifiedAt: new Date("2026-08-17T11:59:00.000Z"),
      payloadHash,
      payload: {
        provider: "replay-integration",
        type: "ticket.updated",
        ticketId: "ticket_1",
      },
      occurredAt: new Date("2026-08-17T11:58:00.000Z"),
      lockedUntil: new Date("2026-08-17T11:59:30.000Z"),
      processingError: "WEBHOOK_PROCESSING_FAILED",
    });
    await tx.insert(webhookEvents).values({
      provider,
      providerEventId: liveProviderEventId,
      eventType: "ticket.created",
      signatureVerifiedAt: new Date("2026-08-17T11:59:59.000Z"),
      payloadHash: "c".repeat(64),
      payload: {
        provider: "replay-integration",
        type: "ticket.created",
        ticketId: "ticket_live_1",
      },
      occurredAt: new Date("2026-08-17T11:59:59.000Z"),
      lockToken: liveClaimToken,
      lockedUntil: new Date("2026-08-17T12:00:30.000Z"),
    });
    await tx.insert(webhookEvents).values({
      provider,
      providerEventId: processedProviderEventId,
      eventType: "ticket.closed",
      signatureVerifiedAt: new Date("2026-08-17T11:44:00.000Z"),
      payloadHash: "d".repeat(64),
      payload: {
        provider: "replay-integration",
        type: "ticket.closed",
        ticketId: "ticket_processed_1",
      },
      occurredAt: new Date("2026-08-17T11:43:00.000Z"),
      lockedUntil: originalProcessedAt,
      processedAt: originalProcessedAt,
    });
  });
});

afterAll(async () => {
  await cleanup();
  await client.end();
});

describe.sequential("durable webhook replay", () => {
  it("does not steal a live ingress claim or list it as stopped work", async () => {
    await expect(
      store.request({
        provider,
        providerEventId: liveProviderEventId,
        requestedBy: { kind: "system", id: "integration-operator" },
        reason: "INC-9001 delivery still processing",
        requestId: `${requestPrefix}:live-ingress`,
      }),
    ).resolves.toEqual({ status: "ingress_in_progress" });

    const live = await withInternalTransaction(
      db,
      `${requestPrefix}:live-inspect`,
      (tx) =>
        tx.query.webhookEvents.findFirst({
          where: and(
            eq(webhookEvents.provider, provider),
            eq(webhookEvents.providerEventId, liveProviderEventId),
          ),
        }),
    );
    expect(live).toMatchObject({
      lockToken: liveClaimToken,
      attemptCount: 1,
      processedAt: null,
      processingError: null,
    });
    const listed = await new DatabaseWebhookReplayReadModel(db, () => now).list(
      {
        provider,
        requestId: `${requestPrefix}:live-list`,
      },
    );
    expect(listed.map(({ providerEventId: id }) => id)).not.toContain(
      liveProviderEventId,
    );
  });

  it("queues only a trusted row reference and deduplicates an active replay", async () => {
    const requested = await store.request({
      provider,
      providerEventId,
      requestedBy: { kind: "system", id: "integration-operator" },
      reason: "INC-9001 replay verified support delivery",
      requestId: `${requestPrefix}:request`,
    });
    expect(requested.status).toBe("started");
    if (requested.status !== "started") return;

    const duplicate = await store.request({
      provider,
      providerEventId,
      requestedBy: { kind: "system", id: "integration-operator" },
      reason: "INC-9001 duplicate click",
      requestId: `${requestPrefix}:duplicate`,
    });
    expect(duplicate).toEqual({
      status: "already_running",
      workflowRunId: requested.workflowRunId,
    });

    const persisted = await withInternalTransaction(
      db,
      `${requestPrefix}:inspect`,
      async (tx) => ({
        run: await tx.query.workflowRuns.findFirst({
          where: eq(workflowRuns.id, requested.workflowRunId),
        }),
        outbox: await tx.query.outboxMessages.findFirst({
          where: eq(outboxMessages.topic, WEBHOOK_REPLAY_REQUESTED_TOPIC),
        }),
        event: await tx.query.webhookEvents.findFirst({
          where: and(
            eq(webhookEvents.provider, provider),
            eq(webhookEvents.providerEventId, providerEventId),
          ),
        }),
      }),
    );
    expect(persisted.run).toMatchObject({
      taskIdentifier: WEBHOOK_REPLAY_TASK_ID,
      aggregateType: "webhook_event",
      status: "pending",
    });
    expect(JSON.stringify(persisted.outbox?.payload)).not.toContain("ticket_1");
    expect(persisted.event?.processedAt).toBeNull();
    expect(persisted.event?.processingError).toBe("WEBHOOK_PROCESSING_FAILED");
    const listed = await new DatabaseWebhookReplayReadModel(db, () => now).list(
      {
        provider,
        requestId: `${requestPrefix}:active-replay-list`,
      },
    );
    expect(listed.map(({ providerEventId: id }) => id)).not.toContain(
      providerEventId,
    );
  });

  it("loads the stored verified payload and fences completion to its claim", async () => {
    const run = await withInternalTransaction(
      db,
      `${requestPrefix}:run`,
      (tx) =>
        tx.query.workflowRuns.findFirst({
          where: eq(workflowRuns.taskIdentifier, WEBHOOK_REPLAY_TASK_ID),
        }),
    );
    if (!run) throw new Error("Replay run was not created");
    const claim = await store.claim({
      workflowRunId: run.id,
      triggerRunId: "trigger_replay_integration",
      attempt: 1,
    });
    expect(claim.status).toBe("claimed");
    if (claim.status !== "claimed") return;
    expect(claim.event).toMatchObject({
      webhookEventId: run.aggregateId,
      provider,
      providerEventId,
      payloadHash,
      payload: { ticketId: "ticket_1" },
    });

    const crashRetry = await store.claim({
      workflowRunId: run.id,
      triggerRunId: "trigger_replay_integration",
      attempt: 2,
    });
    expect(crashRetry.status).toBe("claimed");

    await store.complete({
      workflowRunId: run.id,
      triggerRunId: "trigger_replay_integration",
      output: { status: "processed" },
    });
    const completed = await withInternalTransaction(
      db,
      `${requestPrefix}:completed`,
      async (tx) => ({
        run: await tx.query.workflowRuns.findFirst({
          where: eq(workflowRuns.id, run.id),
        }),
        event: await tx.query.webhookEvents.findFirst({
          where: and(
            eq(webhookEvents.provider, provider),
            eq(webhookEvents.providerEventId, providerEventId),
          ),
        }),
      }),
    );
    expect(completed.run).toMatchObject({ status: "succeeded" });
    expect(completed.event?.processedAt).toEqual(now);
    expect(completed.event?.processingError).toBeNull();
    await expect(
      store.complete({
        workflowRunId: run.id,
        triggerRunId: "foreign_trigger",
        output: { status: "processed" },
      }),
    ).rejects.toThrow("STALE_WEBHOOK_REPLAY_CLAIM");
  });

  it("expires a crashed run and fences it from a replacement claim", async () => {
    const crashed = await store.request({
      provider,
      providerEventId,
      requestedBy: { kind: "system", id: "integration-operator" },
      reason: "INC-9001 simulate a worker crash",
      requestId: `${requestPrefix}:crashed`,
    });
    if (crashed.status !== "started")
      throw new Error("Crashed replay did not start");
    await store.claim({
      workflowRunId: crashed.workflowRunId,
      triggerRunId: "trigger_crashed",
      attempt: 1,
    });

    const recoveredStore = new DatabaseWebhookReplayTaskStore(
      db,
      () => new Date(now.getTime() + 2 * 60 * 60 * 1_000),
    );
    const replacement = await recoveredStore.request({
      provider,
      providerEventId,
      requestedBy: { kind: "system", id: "integration-operator" },
      reason: "INC-9001 replace expired worker claim",
      requestId: `${requestPrefix}:replacement`,
    });
    expect(replacement.status).toBe("started");
    if (replacement.status !== "started") return;
    expect(replacement.workflowRunId).not.toBe(crashed.workflowRunId);

    const expired = await withInternalTransaction(
      db,
      `${requestPrefix}:expired`,
      (tx) =>
        tx.query.workflowRuns.findFirst({
          where: eq(workflowRuns.id, crashed.workflowRunId),
        }),
    );
    expect(expired).toMatchObject({
      status: "failed",
      lastError: "WEBHOOK_REPLAY_LEASE_EXPIRED",
    });
    await expect(
      store.claim({
        workflowRunId: crashed.workflowRunId,
        triggerRunId: "trigger_crashed",
        attempt: 2,
      }),
    ).rejects.toThrow("WEBHOOK_REPLAY_ALREADY_IN_PROGRESS");

    const replacementClaim = await recoveredStore.claim({
      workflowRunId: replacement.workflowRunId,
      triggerRunId: "trigger_replacement",
      attempt: 1,
    });
    expect(replacementClaim.status).toBe("claimed");
  });

  it("serializes an expiry-time worker retry against operator replacement", async () => {
    const crashed = await store.request({
      provider,
      providerEventId: processedProviderEventId,
      requestedBy: { kind: "system", id: "integration-operator" },
      reason: "INC-9001 concurrent expiry setup",
      requestId: `${requestPrefix}:concurrent-setup`,
    });
    if (crashed.status !== "started")
      throw new Error("Concurrent replay did not start");
    await store.claim({
      workflowRunId: crashed.workflowRunId,
      triggerRunId: "trigger_concurrent",
      attempt: 1,
    });
    const recoveredStore = new DatabaseWebhookReplayTaskStore(
      db,
      () => new Date(now.getTime() + 2 * 60 * 60 * 1_000),
    );
    const [operator, worker] = await Promise.allSettled([
      recoveredStore.request({
        provider,
        providerEventId: processedProviderEventId,
        requestedBy: { kind: "system", id: "integration-operator" },
        reason: "INC-9001 concurrent expiry replacement",
        requestId: `${requestPrefix}:concurrent-replacement`,
      }),
      recoveredStore.claim({
        workflowRunId: crashed.workflowRunId,
        triggerRunId: "trigger_concurrent",
        attempt: 2,
      }),
    ]);
    const failures = [operator, worker]
      .filter(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      )
      .map(({ reason }) => String(reason));
    expect(failures.join("\n")).not.toContain("deadlock detected");

    if (operator.status !== "fulfilled")
      throw new Error("Operator replacement unexpectedly failed");
    if (operator.value.status === "started") {
      expect(worker.status).toBe("rejected");
      await recoveredStore.claim({
        workflowRunId: operator.value.workflowRunId,
        triggerRunId: "trigger_concurrent_replacement",
        attempt: 1,
      });
      await recoveredStore.complete({
        workflowRunId: operator.value.workflowRunId,
        triggerRunId: "trigger_concurrent_replacement",
        output: { status: "processed" },
      });
    } else {
      expect(operator.value).toEqual({
        status: "already_running",
        workflowRunId: crashed.workflowRunId,
      });
      expect(worker.status).toBe("fulfilled");
      await recoveredStore.complete({
        workflowRunId: crashed.workflowRunId,
        triggerRunId: "trigger_concurrent",
        output: { status: "processed" },
      });
    }
  });

  it("preserves original success evidence across failed and successful replays", async () => {
    const failedReplay = await store.request({
      provider,
      providerEventId: processedProviderEventId,
      requestedBy: { kind: "system", id: "integration-operator" },
      reason: "INC-9001 verify processed replay failure evidence",
      requestId: `${requestPrefix}:processed-failure`,
    });
    if (failedReplay.status !== "started")
      throw new Error("Processed replay did not start");
    await store.claim({
      workflowRunId: failedReplay.workflowRunId,
      triggerRunId: "trigger_processed_failure",
      attempt: 8,
    });
    await store.fail({
      workflowRunId: failedReplay.workflowRunId,
      triggerRunId: "trigger_processed_failure",
      attempt: 8,
    });

    const successfulReplay = await store.request({
      provider,
      providerEventId: processedProviderEventId,
      requestedBy: { kind: "system", id: "integration-operator" },
      reason: "INC-9001 verify processed replay success evidence",
      requestId: `${requestPrefix}:processed-success`,
    });
    if (successfulReplay.status !== "started")
      throw new Error("Second processed replay did not start");
    await store.claim({
      workflowRunId: successfulReplay.workflowRunId,
      triggerRunId: "trigger_processed_success",
      attempt: 1,
    });
    await store.complete({
      workflowRunId: successfulReplay.workflowRunId,
      triggerRunId: "trigger_processed_success",
      output: { status: "processed" },
    });

    const event = await withInternalTransaction(
      db,
      `${requestPrefix}:processed-inspect`,
      (tx) =>
        tx.query.webhookEvents.findFirst({
          where: and(
            eq(webhookEvents.provider, provider),
            eq(webhookEvents.providerEventId, processedProviderEventId),
          ),
        }),
    );
    expect(event?.processedAt).toEqual(originalProcessedAt);
    expect(event?.processingError).toBeNull();
  });
});
