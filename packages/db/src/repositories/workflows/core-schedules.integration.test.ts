import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { createRuntimeDatabase } from "../../client";
import { auditEvents, invoices, outboxMessages } from "../../schema";
import { collectionCases } from "../../schema/core/finance";
import { withInternalTransaction } from "../../transaction";
import {
  DatabaseCoreScheduleOccurrenceStore,
  DatabaseCoreScheduledDispatchStore,
} from "./core-schedules";
import { FixtureTaxPort } from "../core/tax-fixture";

const databaseUrl =
  process.env.DIRECT_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable";
const { client, db } = createRuntimeDatabase({
  url: databaseUrl,
  maxConnections: 3,
  role: "clockwork_service",
  ssl: false,
});
const store = new DatabaseCoreScheduleOccurrenceStore(db);
const scheduleOffset = Number.parseInt(
  crypto.randomUUID().replaceAll("-", "").slice(0, 10),
  16,
);
const occurrence = {
  scheduleId: "core.schedule.dunning.v1" as const,
  scheduledAt: new Date(
    Date.UTC(2090, 0, 1) + (scheduleOffset % (10 * 365 * 24 * 60 * 60)) * 1_000,
  ).toISOString(),
  triggerRunId: "integration-schedule-first-run",
};
let occurrenceId: string | undefined;
let eventId: string | undefined;

afterAll(async () => {
  await client.end();
});

describe.sequential("database-backed core schedules", () => {
  it("converges duplicate and concurrent Trigger deliveries on one outbox row", async () => {
    const [first, second] = await Promise.all([
      store.enqueue(occurrence),
      store.enqueue({
        ...occurrence,
        triggerRunId: "integration-schedule-concurrent-run",
      }),
    ]);
    occurrenceId = first.occurrenceId;
    eventId = first.eventId;
    expect(first.occurrenceId).toBe(occurrenceId);
    expect(second.occurrenceId).toBe(occurrenceId);
    expect(first.eventId).toBe(eventId);
    expect(second.eventId).toBe(eventId);
    expect([first.queued, second.queued].sort()).toEqual([false, true]);
    const persistedEventId = eventId;
    if (!persistedEventId) throw new Error("SCHEDULE_EVENT_ID_MISSING");

    const persisted = await withInternalTransaction(
      db,
      "schedule-integration-read",
      async (tx) => ({
        events: await tx
          .select()
          .from(auditEvents)
          .where(eq(auditEvents.id, persistedEventId)),
        messages: await tx
          .select()
          .from(outboxMessages)
          .where(eq(outboxMessages.eventId, persistedEventId)),
      }),
    );
    expect(persisted.events).toHaveLength(1);
    expect(persisted.messages).toHaveLength(1);
    expect(persisted.messages[0]).toMatchObject({
      topic: "core.schedule.dispatch.v1",
      processedAt: null,
      attemptCount: 0,
    });
  });

  it("recovers a crash-after-commit retry without creating another request", async () => {
    await expect(
      store.enqueue({
        ...occurrence,
        triggerRunId: "integration-schedule-recovery-run",
      }),
    ).resolves.toEqual({ occurrenceId, eventId, queued: false });
  });
});

/**
 * A dispatch payload crosses the schedule boundary as `unknown` and the task
 * schema that owns it lives downstream in `@clockwork/workflows`. Parsing the
 * fields under test here fails loudly if the sweep stops emitting them.
 */
const DunningPayloadShape = z.object({
  invoiceId: z.uuid(),
  invoiceStatus: z.string(),
  outstanding: z.object({ currency: z.string(), minor: z.string() }),
  context: z.object({
    aggregateId: z.uuid(),
    aggregateVersion: z.int().positive(),
  }),
});

describe.sequential("dunning sweep against outstanding amounts", () => {
  const dispatches = new DatabaseCoreScheduledDispatchStore(
    db,
    process.env.AUTHORIZATION_CONTEXT_SECRET ??
      "clockwork-local-auth-context-secret-change-me",
    new FixtureTaxPort(),
  );
  const invoiceId = randomUUID();
  const suffix = invoiceId.replaceAll("-", "").slice(0, 12);
  const scheduledAt = "2090-06-01T00:00:00.000Z";

  const sweep = async (label: string) => {
    const built = await dispatches.buildDueDispatches({
      scheduleId: "core.schedule.dunning.v1",
      occurrenceId: randomUUID(),
      scheduledAt,
      requestId: `integration-dunning-sweep-${label}-${suffix}`,
      idempotencyPrefix: `integration-dunning-sweep-${suffix}`,
      limit: 100,
    });
    return built.map((dispatch) => DunningPayloadShape.parse(dispatch.payload));
  };

  it("carries the outstanding amount and stops once the invoice is settled", async () => {
    await withInternalTransaction(
      db,
      `integration-dunning-fixture-${suffix}`,
      async (tx) => {
        await tx.insert(invoices).values({
          id: invoiceId,
          orderId: "80000000-0000-4000-8000-000000000001",
          accountId: "10000000-0000-4000-8000-000000000001",
          stripeInvoiceId: `in_dunning_sweep_${suffix}`,
          currency: "USD",
          amountMinor: 180_000n,
          amountPaidMinor: 40_000n,
          poNumber: "PO-DEMO-001",
          status: "open",
          dueAt: new Date("2090-01-01T00:00:00.000Z"),
        });
        await tx.insert(collectionCases).values({
          invoiceId,
          accountId: "10000000-0000-4000-8000-000000000001",
          ownerUserId: "20000000-0000-4000-8000-000000000001",
          agingBucket: "second_threshold",
          nextActionAt: new Date("2090-02-01T00:00:00.000Z"),
          status: "escalated",
        });
      },
    );

    const outstanding = await sweep("outstanding");
    const chased = outstanding.find(
      (payload) => payload.invoiceId === invoiceId,
    );
    expect(chased).toMatchObject({
      outstanding: { currency: "USD", minor: "140000" },
      invoiceStatus: "past_due",
    });
    const dueEpochDay = Math.floor(
      Date.parse("2090-01-01T00:00:00.000Z") / 86_400_000,
    );
    expect(chased?.context).toMatchObject({
      aggregateId: invoiceId,
      aggregateVersion: dueEpochDay * 3 + 2,
    });

    await withInternalTransaction(
      db,
      `integration-dunning-settle-${suffix}`,
      async (tx) => {
        await tx
          .update(invoices)
          .set({ amountPaidMinor: 180_000n })
          .where(eq(invoices.id, invoiceId));
      },
    );

    const settled = await sweep("settled");
    expect(
      settled.find((payload) => payload.invoiceId === invoiceId),
    ).toBeUndefined();
  });
});
