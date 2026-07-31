import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createRuntimeDatabase, type RuntimeTransaction } from "./client";
import {
  claimIdempotencyKey,
  completeIdempotencyKey,
} from "./repositories/idempotency";
import { DatabaseWebhookDeduplicator } from "./repositories/webhooks";
import { idempotencyRecords, webhookEvents } from "./schema";
import { withInternalTransaction } from "./transaction";

const databaseUrl =
  process.env.DIRECT_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable";
const idempotencyScope = "integration:durable-idempotency";
const webhookProvider = "integration-durable-webhooks";
const baseline = new Date("2030-01-01T00:00:00.000Z");

const { client, db } = createRuntimeDatabase({
  url: databaseUrl,
  maxConnections: 1,
  role: "clockwork_service",
  ssl: false,
});
const webhookDeduplicator = new DatabaseWebhookDeduplicator(db);

async function internalTransaction<T>(
  requestId: string,
  operation: (transaction: RuntimeTransaction) => Promise<T>,
): Promise<T> {
  return withInternalTransaction(db, requestId, operation);
}

async function cleanTestRecords(): Promise<void> {
  await internalTransaction(
    "integration:durability:cleanup",
    async (transaction) => {
      await transaction
        .delete(idempotencyRecords)
        .where(eq(idempotencyRecords.scope, idempotencyScope));
      await transaction
        .delete(webhookEvents)
        .where(eq(webhookEvents.provider, webhookProvider));
    },
  );
}

function webhookInput(
  eventId: string,
  payloadHash = `sha256:${eventId}`,
): {
  provider: string;
  eventId: string;
  eventType: string;
  payloadHash: string;
  payload: { eventId: string };
  occurredAt: string;
} {
  return {
    provider: webhookProvider,
    eventId,
    eventType: "order.updated",
    payloadHash,
    payload: { eventId },
    occurredAt: baseline.toISOString(),
  };
}

beforeAll(cleanTestRecords);

afterAll(async () => {
  await cleanTestRecords();
  await client.end();
});

describe.sequential("durable idempotency records", () => {
  it("persists a completed response and replays it in a later transaction", async () => {
    const key = "claim-complete-replay";
    const requestHash = "sha256:claim-complete-replay";
    const claimed = await internalTransaction(
      "integration:idempotency:claim",
      async (transaction) =>
        claimIdempotencyKey(transaction, {
          scope: idempotencyScope,
          key,
          requestHash,
          now: baseline,
        }),
    );

    expect(claimed.kind).toBe("claimed");
    if (claimed.kind !== "claimed") throw new Error("Expected a claimed lease");

    await internalTransaction(
      "integration:idempotency:complete",
      async (transaction) =>
        completeIdempotencyKey(
          transaction,
          {
            scope: idempotencyScope,
            key,
            requestHash,
            lockToken: claimed.lockToken,
          },
          {
            status: 201,
            headers: { location: "/api/orders/order_demo" },
            body: { orderId: "order_demo", state: "accepted" },
          },
        ),
    );

    const replayed = await internalTransaction(
      "integration:idempotency:replay",
      async (transaction) =>
        claimIdempotencyKey(transaction, {
          scope: idempotencyScope,
          key,
          requestHash,
          now: new Date(baseline.getTime() + 1_000),
        }),
    );

    expect(replayed).toEqual({
      kind: "replay",
      response: {
        status: 201,
        headers: { location: "/api/orders/order_demo" },
        body: { orderId: "order_demo", state: "accepted" },
      },
    });
  });

  it("rejects reuse of a key with a different request hash", async () => {
    const key = "hash-conflict";
    const first = await internalTransaction(
      "integration:idempotency:conflict:first",
      async (transaction) =>
        claimIdempotencyKey(transaction, {
          scope: idempotencyScope,
          key,
          requestHash: "sha256:first-payload",
          now: baseline,
        }),
    );

    expect(first.kind).toBe("claimed");

    const conflict = await internalTransaction(
      "integration:idempotency:conflict:second",
      async (transaction) =>
        claimIdempotencyKey(transaction, {
          scope: idempotencyScope,
          key,
          requestHash: "sha256:different-payload",
          now: new Date(baseline.getTime() + 1_000),
        }),
    );

    expect(conflict).toEqual({ kind: "conflict" });
  });

  it("allows an expired lease takeover and rejects the stale lock token", async () => {
    const key = "stale-token-takeover";
    const requestHash = "sha256:stale-token-takeover";
    const initial = await internalTransaction(
      "integration:idempotency:stale:first",
      async (transaction) =>
        claimIdempotencyKey(transaction, {
          scope: idempotencyScope,
          key,
          requestHash,
          now: baseline,
          lockSeconds: 30,
        }),
    );

    expect(initial.kind).toBe("claimed");
    if (initial.kind !== "claimed")
      throw new Error("Expected the initial lease");

    const replacement = await internalTransaction(
      "integration:idempotency:stale:replacement",
      async (transaction) =>
        claimIdempotencyKey(transaction, {
          scope: idempotencyScope,
          key,
          requestHash,
          now: new Date(baseline.getTime() + 31_000),
          lockSeconds: 30,
        }),
    );

    expect(replacement.kind).toBe("claimed");
    if (replacement.kind !== "claimed")
      throw new Error("Expected the replacement lease");
    expect(replacement.lockToken).not.toBe(initial.lockToken);

    await expect(
      internalTransaction(
        "integration:idempotency:stale:completion",
        async (transaction) =>
          completeIdempotencyKey(
            transaction,
            {
              scope: idempotencyScope,
              key,
              requestHash,
              lockToken: initial.lockToken,
            },
            { status: 200, headers: {}, body: { stale: true } },
          ),
      ),
    ).rejects.toThrow("Stale idempotency lease cannot complete a response");

    await internalTransaction(
      "integration:idempotency:replacement:completion",
      async (transaction) =>
        completeIdempotencyKey(
          transaction,
          {
            scope: idempotencyScope,
            key,
            requestHash,
            lockToken: replacement.lockToken,
          },
          { status: 200, headers: {}, body: { stale: false } },
        ),
    );
  });
});

describe.sequential("durable webhook deduplication", () => {
  it("reports an active duplicate as in progress and a processed duplicate as complete", async () => {
    const input = webhookInput("evt_claim_duplicate");

    await expect(webhookDeduplicator.claim(input)).resolves.toBe("claimed");
    await expect(webhookDeduplicator.claim(input)).resolves.toBe("in_progress");

    await webhookDeduplicator.markProcessed(input.provider, input.eventId);

    await expect(webhookDeduplicator.claim(input)).resolves.toBe("duplicate");
  });

  it("rejects the same provider event ID when its payload hash changes", async () => {
    const input = webhookInput("evt_hash_conflict", "sha256:original");

    await expect(webhookDeduplicator.claim(input)).resolves.toBe("claimed");
    await expect(
      webhookDeduplicator.claim({
        ...input,
        payloadHash: "sha256:tampered",
        payload: { eventId: "evt_hash_conflict_tampered" },
      }),
    ).rejects.toThrow("Webhook event ID was reused with a different payload");
  });

  it("reclaims a failed expired delivery and increments its attempt count", async () => {
    const input = webhookInput("evt_failed_retry");

    await expect(webhookDeduplicator.claim(input)).resolves.toBe("claimed");
    await webhookDeduplicator.markFailed(
      input.provider,
      input.eventId,
      "simulated transient provider failure",
    );

    const failed = await internalTransaction(
      "integration:webhook:failed:inspect",
      async (transaction) =>
        transaction.query.webhookEvents.findFirst({
          where: and(
            eq(webhookEvents.provider, input.provider),
            eq(webhookEvents.providerEventId, input.eventId),
          ),
        }),
    );
    expect(failed?.attemptCount).toBe(1);
    expect(failed?.processingError).toBe(
      "simulated transient provider failure",
    );

    await internalTransaction(
      "integration:webhook:failed:expire",
      async (transaction) => {
        await transaction
          .update(webhookEvents)
          .set({ lockedUntil: new Date("2000-01-01T00:00:00.000Z") })
          .where(
            and(
              eq(webhookEvents.provider, input.provider),
              eq(webhookEvents.providerEventId, input.eventId),
            ),
          );
      },
    );

    await expect(webhookDeduplicator.claim(input)).resolves.toBe("claimed");

    const retried = await internalTransaction(
      "integration:webhook:retry:inspect",
      async (transaction) =>
        transaction.query.webhookEvents.findFirst({
          where: and(
            eq(webhookEvents.provider, input.provider),
            eq(webhookEvents.providerEventId, input.eventId),
          ),
        }),
    );
    expect(retried?.attemptCount).toBe(2);
    expect(retried?.processingError).toBeNull();
    expect(retried?.processedAt).toBeNull();
  });
});
