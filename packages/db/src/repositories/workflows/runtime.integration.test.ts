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
import { withInternalTransaction } from "../../transaction";
import { appendAuditAndOutbox } from "../audit-outbox";
import { DatabaseOutboxDispatcherStore } from "../system/outbox";
import {
  DatabaseCoreWorkflowRecordPort,
  DatabaseWorkflowExceptionPort,
  DatabaseWorkflowRunStore,
} from "./core";

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
