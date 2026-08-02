import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createRuntimeDatabase } from "../../client";
import { withInternalTransaction } from "../../transaction";
import {
  DatabaseDeadLetterReadModel,
  DatabaseDeadLetterRecoveryStore,
  DeadLetterRecoveryError,
} from "./dead-letter";

const databaseUrl =
  process.env.DIRECT_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable";

const { client, db } = createRuntimeDatabase({
  url: databaseUrl,
  maxConnections: 4,
  role: "clockwork_service",
  ssl: false,
});

const readModel = new DatabaseDeadLetterReadModel(db);
const occurredAt = new Date("2026-08-02T12:00:00.000Z");
const recovery = new DatabaseDeadLetterRecoveryStore(db, () => occurredAt);
const actor = {
  kind: "user" as const,
  id: "20000000-0000-4000-8000-000000000001",
};

const accountId = "10000000-0000-4000-8000-000000000004";
const organizationId = "30000000-0000-4000-8000-000000000003";
const orderId = "80000000-0000-4000-8000-000000000007";
const suffix = crypto.randomUUID().slice(0, 8);

const fixture: Readonly<{
  eventId: string;
  subjectId: string;
  outboxId: string;
  attemptId: string;
  runId: string;
}> = {
  eventId: crypto.randomUUID(),
  // The seeded audit event owns its own aggregate id. Audit rows are
  // append-only, so a shared id would collide with the previous run.
  subjectId: crypto.randomUUID(),
  outboxId: crypto.randomUUID(),
  attemptId: crypto.randomUUID(),
  runId: crypto.randomUUID(),
};

async function seed() {
  await withInternalTransaction(
    db,
    `dead-letter-seed-${suffix}`,
    async (tx) => {
      await tx.execute(sql`
      insert into public.audit_events (
        id, account_id, aggregate_type, aggregate_id, aggregate_version,
        event_type, event_version, actor, occurred_at, request_id, after, metadata
      ) values (
        ${fixture.eventId}::uuid, ${accountId}::uuid, 'order',
        ${fixture.subjectId}::uuid, 1, 'core.orders.create', 1,
        '{"kind":"system","id":"dead-letter-test"}'::jsonb,
        '2026-08-01T00:00:00.000Z'::timestamptz, ${`dead-letter-seed-${suffix}`},
        '{}'::jsonb, '{}'::jsonb
      )
    `);
      await tx.execute(sql`
      insert into public.outbox_messages (
        id, event_id, topic, payload, available_at, attempt_count, last_error
      ) values (
        ${fixture.outboxId}::uuid, ${fixture.eventId}::uuid,
        'core.orders.create', '{}'::jsonb,
        '2026-08-01T00:00:00.000Z'::timestamptz, 8, 'OUTBOX_DISPATCH_DEAD_LETTERED'
      )
    `);
      await tx.execute(sql`
      insert into public.lifecycle_provisioning_attempts (
        id, command_id, account_id, order_id, organization_id, operation, state,
        attempt, updated_at
      ) values (
        ${fixture.attemptId}::uuid, ${`dead-letter-${suffix}`}, ${accountId}::uuid,
        ${orderId}::uuid, ${organizationId}::uuid, 'provision', 'dead_letter',
        ${sql`${JSON.stringify({
          attempts: 5,
          state: "dead_letter",
          lastError: {
            code: "PROVIDER_REJECTED",
            message: "redacted",
            kind: "permanent",
          },
        })}::jsonb`},
        '2026-08-01T01:00:00.000Z'::timestamptz
      )
    `);
      await tx.execute(sql`
      insert into public.workflow_runs (
        id, task_identifier, idempotency_key, aggregate_type, aggregate_id,
        status, attempt_count, input, last_error, updated_at
      ) values (
        ${fixture.runId}::uuid, 'lifecycle-provisioning-command-dispatch-v1',
        ${`dead-letter-run-${suffix}`}, 'order', ${orderId}::uuid,
        'failed', 4, '{}'::jsonb, 'WORKFLOW_TASK_DEAD_LETTERED',
        '2026-08-01T02:00:00.000Z'::timestamptz
      )
    `);
    },
  );
}

/**
 * Audit rows stay. They are append-only evidence with no delete policy, which
 * is why every fixture here owns a fresh aggregate id.
 */
async function cleanup() {
  await withInternalTransaction(
    db,
    `dead-letter-clean-${suffix}`,
    async (tx) => {
      await tx.execute(
        sql`delete from public.outbox_messages where event_id in (
            ${fixture.eventId}::uuid
          )`,
      );
      await tx.execute(
        sql`delete from public.workflow_runs where id = ${fixture.runId}::uuid`,
      );
      await tx.execute(
        sql`delete from public.lifecycle_provisioning_attempts where id = ${fixture.attemptId}::uuid`,
      );
    },
  );
}

beforeAll(seed);
afterAll(async () => {
  await cleanup();
  await client.end();
});

describe("dead letter operator read model", () => {
  it("lists all three stopped shapes from their own indexed columns", async () => {
    const operations = await readModel.list({
      limit: 200,
      requestId: `dead-letter-list-${suffix}`,
    });
    const mine = operations.filter((operation) =>
      [fixture.outboxId, fixture.attemptId, fixture.runId].includes(
        operation.id,
      ),
    );
    expect(mine).toHaveLength(3);
    expect(
      mine.find((operation) => operation.id === fixture.outboxId),
    ).toMatchObject({
      source: "outbox_message",
      reference: "core.orders.create",
      subjectType: "order",
      subjectId: fixture.subjectId,
      accountId,
      failureCode: "OUTBOX_DISPATCH_DEAD_LETTERED",
      attemptCount: 8,
      decision: "open",
    });
    expect(
      mine.find((operation) => operation.id === fixture.attemptId),
    ).toMatchObject({
      source: "provisioning_attempt",
      reference: "provision",
      subjectType: "order",
      failureCode: "PROVIDER_REJECTED",
      attemptCount: 5,
      decision: "open",
    });
    expect(
      mine.find((operation) => operation.id === fixture.runId),
    ).toMatchObject({
      source: "workflow_run",
      reference: "lifecycle-provisioning-command-dispatch-v1",
      accountId: null,
      failureCode: "WORKFLOW_TASK_DEAD_LETTERED",
      attemptCount: 4,
      decision: "open",
    });
  });

  it("filters to one source without scanning the others", async () => {
    const operations = await readModel.list({
      sources: ["workflow_run"],
      limit: 200,
      requestId: `dead-letter-filter-${suffix}`,
    });
    expect(
      operations.every((operation) => operation.source === "workflow_run"),
    ).toBe(true);
    expect(operations.some((operation) => operation.id === fixture.runId)).toBe(
      true,
    );
  });

  it("returns an outbox message to the dispatcher and records why", async () => {
    const result = await recovery.retry({
      source: "outbox_message",
      id: fixture.outboxId,
      reason: "Provider outage cleared, redelivery is safe",
      actor,
      requestId: `dead-letter-retry-${suffix}`,
    });
    expect(result).toMatchObject({
      decision: "retry_requested",
      decisionReason: "Provider outage cleared, redelivery is safe",
    });
    const rows = await withInternalTransaction(
      db,
      `dead-letter-retry-assert-${suffix}`,
      (tx) =>
        tx.execute(sql`
          select message.attempt_count, message.last_error, message.processed_at,
                 decision.event_type, decision.after->>'reason' as reason,
                 decision.aggregate_version
          from public.outbox_messages message
          join public.audit_events decision
            on decision.aggregate_type = 'outbox_message'
           and decision.aggregate_id = message.id
          where message.id = ${fixture.outboxId}::uuid
        `),
    );
    expect(rows).toEqual([
      expect.objectContaining({
        attempt_count: 0,
        last_error: null,
        processed_at: null,
        event_type: "system.dead_letter.retry_requested",
        reason: "Provider outage cleared, redelivery is safe",
        aggregate_version: 1,
      }),
    ]);
  });

  it("closes a workflow run permanently and drops it from the queue", async () => {
    await recovery.abandon({
      source: "workflow_run",
      id: fixture.runId,
      reason: "Superseded by a replacement order, no redrive planned",
      actor,
      requestId: `dead-letter-abandon-${suffix}`,
    });
    const operations = await readModel.list({
      limit: 200,
      requestId: `dead-letter-abandon-list-${suffix}`,
    });
    expect(operations.some((operation) => operation.id === fixture.runId)).toBe(
      false,
    );
    const rows = await withInternalTransaction(
      db,
      `dead-letter-abandon-assert-${suffix}`,
      (tx) =>
        tx.execute(
          sql`select status from public.workflow_runs where id = ${fixture.runId}::uuid`,
        ),
    );
    expect(rows).toEqual([{ status: "cancelled" }]);
  });

  it("refuses a second decision once the work is abandoned", async () => {
    await expect(
      recovery.retry({
        source: "workflow_run",
        id: fixture.runId,
        reason: "Changed my mind about the abandonment",
        actor,
        requestId: `dead-letter-redecide-${suffix}`,
      }),
    ).rejects.toBeInstanceOf(DeadLetterRecoveryError);
  });

  it("requires a reason long enough to be evidence", async () => {
    await expect(
      recovery.abandon({
        source: "provisioning_attempt",
        id: fixture.attemptId,
        reason: "no",
        actor,
        requestId: `dead-letter-reason-${suffix}`,
      }),
    ).rejects.toThrow();
  });
});
