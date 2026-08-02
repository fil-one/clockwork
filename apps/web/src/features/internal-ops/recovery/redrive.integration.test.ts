import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { IdempotencyKey } from "@clockwork/contracts";
import {
  createRuntimeDatabase,
  DatabaseWorkflowRunStore,
  loadDeadLetterDispatch,
  withInternalTransaction,
} from "@clockwork/db";
import { payloadHash } from "@clockwork/workflows/core";
import {
  deadLetterRedriveInvocation,
  type LifecycleTaskInvocation,
} from "@clockwork/workflows/system";

import { redriveRetriedWork } from "./redrive";

const databaseUrl =
  process.env.DIRECT_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable";

const { client, db } = createRuntimeDatabase({
  url: databaseUrl,
  maxConnections: 4,
  role: "clockwork_service",
  ssl: false,
});

const runs = new DatabaseWorkflowRunStore(db);
const suffix = crypto.randomUUID().slice(0, 8);
const accountId = "10000000-0000-4000-8000-000000000004";
const organizationId = "30000000-0000-4000-8000-000000000003";
const orderId = "80000000-0000-4000-8000-000000000007";

/**
 * The provisioning dispatch has to hang off a real order, so its audit event
 * cannot take a fresh aggregate id the way the others do. `audit_events` is
 * append-only with no delete policy, so the version varies per run instead;
 * a fixed one collides with the previous run on
 * `audit_aggregate_version_unique`.
 */
const provisioningVersion = 100_000 + Math.floor(Math.random() * 800_000);

/** Fresh ids per run, for the same append-only reason. */
const fixture = {
  eventId: crypto.randomUUID(),
  subjectId: crypto.randomUUID(),
  outboxId: crypto.randomUUID(),
  runId: crypto.randomUUID(),
  attemptId: crypto.randomUUID(),
  provisioningEventId: crypto.randomUUID(),
  provisioningOutboxId: crypto.randomUUID(),
} as const;

/** The bytes the task ran on. The outbox message is their only surviving copy. */
const dispatchedPayload = {
  eventType: "order.provisioning_requested",
  aggregateType: "order",
  aggregateId: orderId,
  aggregateVersion: 4,
  data: { operation: "provision", sku: "LOCKED-STORAGE-TB" },
};

const replay = {
  requestedBy: "20000000-0000-4000-8000-000000000001",
  reason: "Provider capacity restored, the command is safe to re-issue",
};

const invocationKey = `outbox:${fixture.outboxId}` as IdempotencyKey;

function required<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined)
    throw new Error(`${what} is missing`);
  return value;
}

async function seed() {
  await withInternalTransaction(db, `redrive-seed-${suffix}`, async (tx) => {
    // `core_guard_provisioning_outbox` refuses a provisioning dispatch for an
    // order with no approved acceptance reservation, so the fixture supplies
    // the precondition production supplies. The reservation then stays:
    // `core_protect_order_acceptance_reservation` refuses the delete, which is
    // why the insert tolerates one already being there.
    await tx.execute(sql`
      insert into public.core_order_acceptance_reservations (
        order_id, buyer_account_id, billing_account_id, currency, amount_minor,
        decision, reason
      ) values (
        ${orderId}::uuid, ${accountId}::uuid, ${accountId}::uuid, 'USD', 180000,
        'approved', 'Redrive reconstruction fixture'
      )
      on conflict (order_id) do nothing
    `);
    await tx.execute(sql`
      insert into public.audit_events (
        id, account_id, aggregate_type, aggregate_id, aggregate_version,
        event_type, event_version, actor, occurred_at, request_id, after, metadata
      ) values (
        ${fixture.eventId}::uuid, ${accountId}::uuid, 'order',
        ${fixture.subjectId}::uuid, 4, 'order.provisioning_requested', 1,
        '{"kind":"system","id":"redrive-test"}'::jsonb,
        '2026-08-01T00:00:00.000Z'::timestamptz, ${`redrive-seed-${suffix}`},
        '{}'::jsonb, '{}'::jsonb
      ), (
        ${fixture.provisioningEventId}::uuid, ${accountId}::uuid, 'order',
        ${orderId}::uuid, ${provisioningVersion},
        'order.provisioning_requested', 1,
        '{"kind":"system","id":"redrive-test"}'::jsonb,
        now(), ${`redrive-seed-${suffix}`},
        '{}'::jsonb, '{}'::jsonb
      )
    `);
    await tx.execute(sql`
      insert into public.outbox_messages (
        id, event_id, topic, payload, available_at, attempt_count
      ) values (
        ${fixture.outboxId}::uuid, ${fixture.eventId}::uuid,
        'order.provisioning_requested',
        ${sql`${JSON.stringify(dispatchedPayload)}::jsonb`},
        '2026-08-01T00:00:00.000Z'::timestamptz, 1
      ), (
        ${fixture.provisioningOutboxId}::uuid,
        ${fixture.provisioningEventId}::uuid,
        'order.provisioning_requested',
        ${sql`${JSON.stringify(dispatchedPayload)}::jsonb`},
        '2026-08-01T00:30:00.000Z'::timestamptz, 1
      )
    `);
    // The run as the dispatcher left it. `input` holds a lease envelope
    // carrying the payload hash; it never held the payload. The recovery store
    // has already moved the run out of `failed`.
    await tx.execute(sql`
      insert into public.workflow_runs (
        id, task_identifier, idempotency_key, aggregate_type, aggregate_id,
        status, attempt_count, input, last_error, updated_at
      ) values (
        ${fixture.runId}::uuid, 'lifecycle-provisioning-command-dispatch-v1',
        ${invocationKey}, 'workflow', ${fixture.subjectId}::uuid,
        'pending', 4,
        ${sql`${JSON.stringify({
          payloadHash: payloadHash(dispatchedPayload),
          aggregateVersion: 4,
          requestId: `redrive-seed-${suffix}`,
          leaseToken: crypto.randomUUID(),
          leaseUntil: "2026-08-01T00:05:00.000Z",
        })}::jsonb`},
        null, '2026-08-01T02:00:00.000Z'::timestamptz
      )
    `);
    await tx.execute(sql`
      insert into public.lifecycle_provisioning_attempts (
        id, command_id, account_id, order_id, organization_id, operation, state,
        attempt, updated_at
      ) values (
        ${fixture.attemptId}::uuid, ${`redrive-${suffix}`}, ${accountId}::uuid,
        ${orderId}::uuid, ${organizationId}::uuid, 'provision', 'dead_letter',
        ${sql`${JSON.stringify({ attempts: 5, state: "dead_letter" })}::jsonb`},
        '2026-08-01T01:00:00.000Z'::timestamptz
      )
    `);
  });
}

async function cleanup() {
  await withInternalTransaction(db, `redrive-clean-${suffix}`, async (tx) => {
    await tx.execute(
      sql`delete from public.workflow_runs where id = ${fixture.runId}::uuid`,
    );
    await tx.execute(
      sql`delete from public.lifecycle_provisioning_attempts where id = ${fixture.attemptId}::uuid`,
    );
    await tx.execute(sql`
      delete from public.outbox_messages where id in (
        ${fixture.outboxId}::uuid, ${fixture.provisioningOutboxId}::uuid
      )
    `);
    await tx.execute(sql`
      delete from public.audit_events where id in (
        ${fixture.eventId}::uuid, ${fixture.provisioningEventId}::uuid
      )
    `);
  });
}

beforeAll(seed);
afterAll(async () => {
  await cleanup();
  await client.end();
});

describe.sequential("dead letter redrive payload reconstruction", () => {
  /**
   * The defect this file exists to pin. A redrive built from anything other
   * than the dispatched bytes is refused by the claim, and the task runner
   * turns that refusal into `LIFECYCLE_TASK_PAYLOAD_CONFLICT`.
   */
  it("refuses a synthesised payload", async () => {
    await expect(
      runs.claim({
        taskId: "lifecycle-provisioning-command-dispatch-v1",
        invocationKey,
        payloadHash: payloadHash({ redriveKey: invocationKey }),
        aggregateId: fixture.subjectId,
        aggregateVersion: 4,
        requestId: `redrive-synthesised-${suffix}`,
      }),
    ).resolves.toEqual({
      status: "payload_conflict",
      existingPayloadHash: payloadHash(dispatchedPayload),
    });
  });

  it("rebuilds the dispatched payload and its invocation key from the outbox message", async () => {
    const dispatch = await loadDeadLetterDispatch(db, {
      source: "workflow_run",
      id: fixture.runId,
      requestId: `redrive-load-${suffix}`,
    });
    expect(dispatch).toEqual({
      outboxMessageId: fixture.outboxId,
      topic: "order.provisioning_requested",
      payload: dispatchedPayload,
    });
    const invocation = required(
      deadLetterRedriveInvocation(required(dispatch, "dispatch"), replay),
      "invocation",
    );
    expect(invocation).toMatchObject({
      taskId: "lifecycle-provisioning-command-dispatch-v1",
      idempotencyKey: invocationKey,
      replay,
    });
    expect(payloadHash(invocation.payload)).toBe(
      payloadHash(dispatchedPayload),
    );
  });

  it("re-enters the same run rather than opening a second one", async () => {
    const dispatch = await loadDeadLetterDispatch(db, {
      source: "workflow_run",
      id: fixture.runId,
      requestId: `redrive-claim-load-${suffix}`,
    });
    const invocation = required(
      deadLetterRedriveInvocation(required(dispatch, "dispatch"), replay),
      "invocation",
    );
    await expect(
      runs.claim({
        taskId: invocation.taskId,
        invocationKey: invocation.idempotencyKey as IdempotencyKey,
        payloadHash: payloadHash(invocation.payload),
        aggregateId: fixture.subjectId,
        aggregateVersion: 4,
        requestId: `redrive-claim-${suffix}`,
      }),
    ).resolves.toMatchObject({ status: "acquired", attempt: 5 });
    const rows = await withInternalTransaction(
      db,
      `redrive-count-${suffix}`,
      (tx) =>
        tx.execute(sql`
          select count(*)::int as runs
          from public.workflow_runs
          where idempotency_key = ${invocationKey}
        `),
    );
    expect(rows).toEqual([{ runs: 1 }]);
  });

  it("finds the provisioning command dispatch behind a stopped attempt", async () => {
    await expect(
      loadDeadLetterDispatch(db, {
        source: "provisioning_attempt",
        id: fixture.attemptId,
        requestId: `redrive-attempt-${suffix}`,
      }),
    ).resolves.toEqual({
      outboxMessageId: fixture.provisioningOutboxId,
      topic: "order.provisioning_requested",
      payload: dispatchedPayload,
    });
  });

  it("leaves the outbox to itself and submits the rebuilt invocation for the rest", async () => {
    const submitted: LifecycleTaskInvocation[] = [];
    const submission = {
      submit: (invocation: LifecycleTaskInvocation) => {
        submitted.push(invocation);
        return Promise.resolve(undefined);
      },
    };
    await expect(
      redriveRetriedWork(
        db,
        {
          source: "outbox_message",
          id: fixture.outboxId,
          requestedBy: replay.requestedBy,
          reason: replay.reason,
          requestId: `redrive-outbox-${suffix}`,
        },
        submission,
      ),
    ).resolves.toEqual({ status: "not_required" });
    expect(submitted).toEqual([]);

    await expect(
      redriveRetriedWork(
        db,
        {
          source: "workflow_run",
          id: fixture.runId,
          requestedBy: replay.requestedBy,
          reason: replay.reason,
          requestId: `redrive-submit-${suffix}`,
        },
        submission,
      ),
    ).resolves.toEqual({ status: "submitted" });
    expect(submitted).toHaveLength(1);
    const sent = required(submitted[0], "submitted invocation");
    expect(payloadHash(sent.payload)).toBe(payloadHash(dispatchedPayload));
    expect(sent.replay).toEqual(replay);
  });
});
