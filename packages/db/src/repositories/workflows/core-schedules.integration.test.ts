import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { createRuntimeDatabase } from "../../client";
import { auditEvents, outboxMessages } from "../../schema";
import { withInternalTransaction } from "../../transaction";
import { DatabaseCoreScheduleOccurrenceStore } from "./core-schedules";

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
