import { createHash, randomUUID } from "node:crypto";

import { and, eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { IdempotencyKeySchema } from "@clockwork/contracts";

import { createRuntimeDatabase, type RuntimeTransaction } from "../../client";
import {
  auditEvents,
  exceptionCases,
  outboxMessages,
  providerOperations,
  workflowRuns,
} from "../../schema";
import { lifecycleDomainEvents } from "../../schema/lifecycle";
import { withInternalTransaction } from "../../transaction";
import { appendAuditAndOutbox } from "../audit-outbox";
import { DatabaseOutboxDispatcherStore } from "../system/outbox";
import {
  DatabaseCoreWorkflowRecordPort,
  DatabaseWorkflowExceptionPort,
  DatabaseWorkflowRunStore,
} from "./core";
import { DatabaseAuthoritativeLifecycleTaskStore } from "./lifecycle";

const databaseUrl =
  process.env.DIRECT_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable";
const { client, db } = createRuntimeDatabase({
  url: databaseUrl,
  maxConnections: 8,
  role: "clockwork_service",
  ssl: false,
});
const prefix = "integration-runtime-";
const accountId = "10000000-0000-4000-8000-000000000001";
const ownerUserId = "20000000-0000-4000-8000-000000000001";

async function internal<T>(
  requestId: string,
  operation: (transaction: RuntimeTransaction) => Promise<T>,
): Promise<T> {
  return withInternalTransaction(db, requestId, operation);
}

async function cleanup(): Promise<void> {
  await internal(`${prefix}cleanup`, async (transaction) => {
    const events = await transaction
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(like(auditEvents.requestId, `${prefix}%`));
    const eventIds = events.map((event) => event.id);
    const messages = eventIds.length
      ? await transaction
          .select({ id: outboxMessages.id })
          .from(outboxMessages)
          .where(inArray(outboxMessages.eventId, eventIds))
      : [];
    const messageIds = messages.map((message) => message.id);
    if (messageIds.length)
      await transaction
        .delete(workflowRuns)
        .where(inArray(workflowRuns.aggregateId, messageIds));
    if (eventIds.length)
      await transaction
        .delete(outboxMessages)
        .where(inArray(outboxMessages.eventId, eventIds));
    await transaction
      .delete(workflowRuns)
      .where(like(workflowRuns.idempotencyKey, `${prefix}%`));
    await transaction
      .delete(auditEvents)
      .where(like(auditEvents.requestId, `${prefix}%`));
    await transaction
      .delete(exceptionCases)
      .where(like(exceptionCases.objectType, `${prefix}%`));
    await transaction
      .delete(providerOperations)
      .where(like(providerOperations.idempotencyKey, `${prefix}%`));
  });
}

beforeEach(cleanup);
afterAll(async () => {
  await cleanup();
  await client.end();
});

// Required serialization: beforeEach removes the shared integration-runtime-
// prefix and each case intentionally performs multiple transitions on one
// aggregate. Concurrent cases could delete another case's in-flight state.
describe.sequential("database workflow claims", () => {
  it("grants one concurrent claim and rejects a changed payload", async () => {
    const now = new Date("2031-01-01T00:00:00.000Z");
    const store = new DatabaseWorkflowRunStore(db, { clock: () => now });
    const request = {
      taskId: `${prefix}concurrency`,
      invocationKey: IdempotencyKeySchema.parse(`${prefix}concurrency-key`),
      payloadHash: "a".repeat(64),
      aggregateId: randomUUID(),
      aggregateVersion: 1,
      requestId: `${prefix}concurrency`,
    };
    const claims = await Promise.all(
      Array.from({ length: 8 }, () => store.claim(request)),
    );
    expect(claims.filter((claim) => claim.status === "acquired")).toHaveLength(
      1,
    );
    expect(
      claims.filter((claim) => claim.status === "in_progress"),
    ).toHaveLength(7);
    await expect(
      store.claim({ ...request, payloadHash: "b".repeat(64) }),
    ).resolves.toEqual({
      status: "payload_conflict",
      existingPayloadHash: "a".repeat(64),
    });
  });

  it("recovers an expired lease and rejects the crashed worker completion", async () => {
    let now = new Date("2031-01-01T00:00:00.000Z");
    const store = new DatabaseWorkflowRunStore(db, {
      clock: () => now,
      leaseMs: 1_000,
    });
    const request = {
      taskId: `${prefix}recovery`,
      invocationKey: IdempotencyKeySchema.parse(`${prefix}recovery-key`),
      payloadHash: "c".repeat(64),
      aggregateId: randomUUID(),
      aggregateVersion: 1,
      requestId: `${prefix}recovery`,
    };
    const first = await store.claim(request);
    if (first.status !== "acquired") throw new Error("claim expected");
    now = new Date(now.getTime() + 1_001);
    const recovered = await store.claim(request);
    if (recovered.status !== "acquired") throw new Error("reclaim expected");
    await expect(
      store.markCompleted({
        invocationKey: request.invocationKey,
        leaseToken: first.leaseToken,
        output: { stale: true },
        completedAt: now.toISOString(),
      }),
    ).rejects.toThrow("STALE_WORKFLOW_LEASE");
    await store.markCompleted({
      invocationKey: request.invocationKey,
      leaseToken: recovered.leaseToken,
      output: { recovered: true },
      completedAt: now.toISOString(),
    });
    await expect(store.claim(request)).resolves.toEqual({
      status: "completed",
      output: { recovered: true },
    });
  });

  it("uses distinct persisted workflow versions for retry and dead-letter audit/outbox", async () => {
    let now = new Date("2031-01-01T00:00:00.000Z");
    const store = new DatabaseWorkflowRunStore(db, { clock: () => now });
    const request = {
      taskId: `${prefix}dead-letter-version-regression`,
      invocationKey: IdempotencyKeySchema.parse(
        `${prefix}dead-letter-version-key`,
      ),
      payloadHash: "d".repeat(64),
      aggregateId: randomUUID(),
      // This source version deliberately stays constant across both failures.
      aggregateVersion: 1,
      requestId: `${prefix}dead-letter-version-claim`,
    };
    const first = await store.claim(request);
    if (first.status !== "acquired") throw new Error("claim expected");
    await store.markRetrying({
      invocationKey: request.invocationKey,
      leaseToken: first.leaseToken,
      code: "PROVIDER_TIMEOUT",
      failedAt: now.toISOString(),
    });
    now = new Date("2031-01-01T00:00:01.000Z");
    const recovered = await store.claim(request);
    if (recovered.status !== "acquired") throw new Error("reclaim expected");
    await store.markPermanentFailure({
      invocationKey: request.invocationKey,
      leaseToken: recovered.leaseToken,
      output: { code: "LIFECYCLE_TASK_FAILED" },
      failedAt: now.toISOString(),
    });

    const persisted = await internal(
      `${prefix}dead-letter-version-inspect`,
      async (transaction) => {
        const run = await transaction.query.workflowRuns.findFirst({
          where: and(
            eq(workflowRuns.taskIdentifier, request.taskId),
            eq(workflowRuns.idempotencyKey, request.invocationKey),
          ),
        });
        if (!run) throw new Error("workflow run expected");
        const events = await transaction.query.auditEvents.findMany({
          where: and(
            eq(auditEvents.aggregateType, "workflow_run"),
            eq(auditEvents.aggregateId, run.id),
          ),
          orderBy: (event, { asc }) => [asc(event.aggregateVersion)],
        });
        const messages = await transaction.query.outboxMessages.findMany({
          where: inArray(
            outboxMessages.eventId,
            events.map((event) => event.id),
          ),
        });
        return { run, events, messages };
      },
    );
    expect(persisted.run.status).toBe("failed");
    expect(
      persisted.events.map((event) => [
        event.aggregateVersion,
        event.eventType,
      ]),
    ).toEqual([
      [2, "workflow.task.retry_scheduled"],
      [4, "workflow.task.dead_lettered"],
    ]);
    expect(persisted.messages).toHaveLength(2);
    expect(
      persisted.events.every((event) =>
        persisted.messages.some((message) => message.eventId === event.id),
      ),
    ).toBe(true);
  });

  it("closes a persisted policy denial without creating audit or outbox work", async () => {
    const now = new Date("2031-01-01T00:00:00.000Z");
    const store = new DatabaseWorkflowRunStore(db, { clock: () => now });
    const request = {
      taskId: `${prefix}policy-denial`,
      invocationKey: IdempotencyKeySchema.parse(`${prefix}policy-denial-key`),
      payloadHash: "e".repeat(64),
      aggregateId: randomUUID(),
      aggregateVersion: 1,
      requestId: `${prefix}policy-denial-claim`,
    };
    const claim = await store.claim(request);
    if (claim.status !== "acquired") throw new Error("claim expected");
    await store.markPolicyDenied({
      invocationKey: request.invocationKey,
      leaseToken: claim.leaseToken,
      code: "PROVIDER_GATE_INACTIVE",
    });
    const persisted = await internal(
      `${prefix}policy-denial-inspect`,
      async (transaction) => {
        const run = await transaction.query.workflowRuns.findFirst({
          where: and(
            eq(workflowRuns.taskIdentifier, request.taskId),
            eq(workflowRuns.idempotencyKey, request.invocationKey),
          ),
        });
        if (!run) throw new Error("workflow run expected");
        const events = await transaction.query.auditEvents.findMany({
          where: and(
            eq(auditEvents.aggregateType, "workflow_run"),
            eq(auditEvents.aggregateId, run.id),
          ),
        });
        return { run, events };
      },
    );
    expect(persisted.run).toMatchObject({
      status: "failed",
      lastError: "PROVIDER_GATE_INACTIVE",
      output: { code: "PROVIDER_GATE_INACTIVE" },
    });
    expect(persisted.events).toEqual([]);
  });
});

describe.sequential("workflow projection crash recovery", () => {
  it("recovers a same-payload record claim and rejects a conflicting payload", async () => {
    const invocationKey = IdempotencyKeySchema.parse(`${prefix}record-key`);
    const aggregateId = randomUUID();
    const record = {
      kind: "integration_recorded",
      taskId: `${prefix}task`,
      result: "ok",
    };
    const recordHash = createHash("sha256")
      .update(JSON.stringify(record))
      .digest("hex");
    await internal(`${prefix}record-seed`, async (transaction) => {
      await transaction.insert(providerOperations).values({
        provider: "clockwork-workflow-record",
        operation: record.kind,
        idempotencyKey: invocationKey,
        aggregateType: "workflow_run",
        aggregateId,
        status: "running",
        attemptCount: 1,
        providerReference: recordHash,
      });
    });
    const port = new DatabaseCoreWorkflowRecordPort(db);
    await expect(
      port.record({
        invocationKey,
        aggregateId,
        aggregateVersion: 1,
        requestId: `${prefix}record-recover`,
        occurredAt: "2031-01-01T00:00:00.000Z",
        record,
      }),
    ).resolves.toEqual({});
    const operation = await internal(`${prefix}record-inspect`, (transaction) =>
      transaction.query.providerOperations.findFirst({
        where: and(
          eq(providerOperations.provider, "clockwork-workflow-record"),
          eq(providerOperations.idempotencyKey, invocationKey),
        ),
      }),
    );
    expect(operation).toMatchObject({ status: "succeeded", attemptCount: 2 });
    await expect(
      port.record({
        invocationKey,
        aggregateId,
        aggregateVersion: 1,
        requestId: `${prefix}record-conflict`,
        occurredAt: "2031-01-01T00:00:00.000Z",
        record: { ...record, result: "changed" },
      }),
    ).rejects.toThrow("WORKFLOW_RECORD_PAYLOAD_CONFLICT");
  });

  it("recovers a same-payload exception claim atomically", async () => {
    const aggregateId = randomUUID();
    const request = {
      taskId: `${prefix}exception-task`,
      exceptionKey: IdempotencyKeySchema.parse(`${prefix}exception-key`),
      queue: "workflow_operations",
      code: "PROVIDER_CONFIGURATION_REQUIRED",
      safeDetail: "Provider activation is incomplete",
      aggregateId,
      aggregateVersion: 1,
      requestId: `${prefix}exception-recover`,
      occurredAt: "2031-01-01T00:00:00.000Z",
      severity: "blocking",
      metadata: { gate: "EXT-PROVIDER-01" },
    } satisfies Parameters<DatabaseWorkflowExceptionPort["open"]>[0];
    const requestHash = createHash("sha256")
      .update(JSON.stringify(request))
      .digest("hex");
    await internal(`${prefix}exception-seed`, async (transaction) => {
      await transaction.insert(providerOperations).values({
        provider: "clockwork-workflow-exception",
        operation: request.taskId,
        idempotencyKey: request.exceptionKey,
        aggregateType: "exception_case",
        aggregateId,
        status: "running",
        attemptCount: 1,
        providerReference: requestHash,
      });
    });
    const port = new DatabaseWorkflowExceptionPort(db, {
      resolve: () =>
        Promise.resolve({
          accountId,
          ownerUserId,
          objectType: `${prefix}exception`,
          targetAt: "2031-01-02T00:00:00.000Z",
        }),
    });
    const opened = await port.open(request);
    expect(opened.caseId).toMatch(/^[0-9a-f-]{36}$/);
    await expect(port.open(request)).resolves.toEqual({
      caseId: opened.caseId,
      duplicate: true,
    });
  });
});

describe.sequential("authoritative lifecycle effect recovery", () => {
  it("checkpoints provider success, fences the crashed lease, and commits without re-invocation", async () => {
    let now = new Date("2031-01-01T00:00:00.000Z");
    const store = new DatabaseAuthoritativeLifecycleTaskStore(db, () => now);
    const account = await internal(`${prefix}effect-account`, (transaction) =>
      transaction.query.accounts.findFirst({
        where: (table, { eq }) => eq(table.id, accountId),
      }),
    );
    if (!account) throw new Error("seed account expected");
    const transition = `${prefix}effect-transition-${randomUUID()}`;
    const effect = {
      effectKey: `${prefix}effect-provider-success`,
      taskId: "lifecycle-onboarding-screening-refresh-v1",
      aggregateId: account.id,
      aggregateVersion: account.rowVersion,
      loader: "account" as const,
      transition,
      effectBoundary: "screening_provider" as const,
      persistedState: account,
    };
    const first = await store.claimEffect({
      effect,
      requestId: `${prefix}effect-claim-1`,
    });
    if (first.status !== "invoke") throw new Error("effect claim expected");
    await store.checkpointEffectSuccess({
      effect,
      leaseToken: first.leaseToken,
      reference: "screening-result-1",
      requestId: `${prefix}effect-checkpoint`,
    });

    // The provider succeeded, then the local worker crashed before finalize.
    now = new Date(now.getTime() + 60_001);
    const recovered = await store.claimEffect({
      effect,
      requestId: `${prefix}effect-claim-2`,
    });
    if (recovered.status !== "provider_succeeded")
      throw new Error("provider checkpoint recovery expected");
    expect(recovered.reference).toBe("screening-result-1");
    await expect(
      store.checkpointEffectSuccess({
        effect,
        leaseToken: first.leaseToken,
        reference: recovered.reference,
        requestId: `${prefix}effect-stale-checkpoint`,
      }),
    ).rejects.toThrow("STALE_LIFECYCLE_EFFECT_LEASE");
    await expect(
      store.finalizeEffect({
        effect,
        leaseToken: first.leaseToken,
        reference: recovered.reference,
        requestId: `${prefix}effect-stale-finalize`,
      }),
    ).rejects.toThrow("STALE_LIFECYCLE_EFFECT_LEASE");
    await store.finalizeEffect({
      effect,
      leaseToken: recovered.leaseToken,
      reference: recovered.reference,
      requestId: `${prefix}effect-finalize`,
    });
    await expect(
      store.claimEffect({
        effect,
        requestId: `${prefix}effect-duplicate`,
      }),
    ).resolves.toEqual({
      status: "committed",
      reference: "screening-result-1",
    });

    const persisted = await internal(
      `${prefix}effect-inspect`,
      async (transaction) => {
        const operation = await transaction.query.providerOperations.findFirst({
          where: and(
            eq(providerOperations.provider, "lifecycle-runtime"),
            eq(providerOperations.idempotencyKey, effect.effectKey),
          ),
        });
        if (!operation) throw new Error("effect operation expected");
        return {
          transitions: await transaction.query.lifecycleDomainEvents.findMany({
            where: and(
              eq(lifecycleDomainEvents.aggregateId, account.id),
              eq(lifecycleDomainEvents.eventType, transition),
            ),
          }),
          audits: await transaction.query.auditEvents.findMany({
            where: and(
              eq(auditEvents.requestId, `${prefix}effect-finalize`),
              eq(auditEvents.aggregateId, operation.id),
            ),
          }),
        };
      },
    );
    expect(persisted.transitions).toHaveLength(1);
    expect(persisted.audits).toHaveLength(1);
    expect(persisted.audits[0]?.eventType).toBe("lifecycle.effect.committed");
  });
});

describe.sequential("database outbox dispatch leases", () => {
  it("recovers a crash, rejects the stale worker, and stores sanitized failure", async () => {
    // The deliberately old availability window excludes seeded and other
    // file-owned outbox rows while still exercising the global claim query.
    let now = new Date("2000-01-01T00:00:00.000Z");
    const appended = await internal(`${prefix}outbox-crash`, (transaction) =>
      appendAuditAndOutbox(transaction, {
        aggregateType: "audit_event",
        aggregateId: randomUUID(),
        aggregateVersion: 1,
        eventType: `${prefix}topic`,
        actor: { kind: "system", id: "integration-runtime" },
        requestId: `${prefix}outbox-crash`,
        occurredAt: new Date("1999-12-31T23:59:00.000Z"),
      }),
    );
    await internal(`${prefix}outbox-crash-ready`, async (transaction) => {
      await transaction
        .update(outboxMessages)
        .set({ availableAt: new Date("1999-12-31T23:59:30.000Z") })
        .where(eq(outboxMessages.id, appended.message.id));
    });
    const store = new DatabaseOutboxDispatcherStore(db, {
      clock: () => now,
      leaseMs: 1_000,
    });
    const first = await store.claimNext({ workerId: "worker-1" });
    if (!first) throw new Error("outbox claim expected");
    now = new Date(now.getTime() + 1_001);
    const recovered = await store.claimNext({ workerId: "worker-2" });
    if (!recovered) throw new Error("outbox reclaim expected");
    expect(recovered.id).toBe(first.id);
    await expect(store.complete(first)).rejects.toThrow("STALE_OUTBOX_LEASE");
    await store.fail(recovered);
    const row = await internal(`${prefix}outbox-inspect`, (transaction) =>
      transaction.query.outboxMessages.findFirst({
        where: eq(outboxMessages.id, appended.message.id),
      }),
    );
    expect(row?.lastError).toBe("OUTBOX_DISPATCH_FAILED");
    expect(row?.lastError).not.toContain("secret");
  });

  it("fails closed when persisted lease metadata is corrupt", async () => {
    const appended = await internal(`${prefix}outbox-corrupt`, (transaction) =>
      appendAuditAndOutbox(transaction, {
        aggregateType: "audit_event",
        aggregateId: randomUUID(),
        aggregateVersion: 1,
        eventType: `${prefix}corrupt-topic`,
        actor: { kind: "system", id: "integration-runtime" },
        requestId: `${prefix}outbox-corrupt`,
        occurredAt: new Date("1999-12-31T23:58:00.000Z"),
      }),
    );
    await internal(`${prefix}outbox-corrupt-ready`, async (transaction) => {
      await transaction
        .update(outboxMessages)
        .set({ availableAt: new Date("1999-12-31T23:59:30.000Z") })
        .where(eq(outboxMessages.id, appended.message.id));
    });
    const store = new DatabaseOutboxDispatcherStore(db, {
      clock: () => new Date("2000-01-01T00:00:00.000Z"),
    });
    const claimed = await store.claimNext({ workerId: "worker-corrupt" });
    if (!claimed) throw new Error("outbox claim expected");
    await internal(`${prefix}outbox-corrupt-write`, async (transaction) => {
      await transaction
        .update(workflowRuns)
        .set({ input: { malformed: true } })
        .where(eq(workflowRuns.aggregateId, appended.message.id));
    });
    await expect(store.complete(claimed)).rejects.toThrow(
      "OUTBOX_WORKFLOW_INPUT_CORRUPT",
    );
  });
});
