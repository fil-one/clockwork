import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Actor, IdempotencyKey } from "@clockwork/contracts";
import {
  appendAuditAndOutbox,
  coreSnapshotHash,
  createAcceptedOrderProvisioningAttempt,
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
const orderId = "80000000-0000-4000-8000-000000000007";
const orderLineId = "81000000-0000-4000-8000-000000000007";

const actor: Actor = {
  kind: "user",
  id: "20000000-0000-4000-8000-000000000001",
};

/**
 * The operator-recovery emitter keys its audit row on the order aggregate, so
 * its version has to be unique per run: `audit_events` is append-only with no
 * delete policy, and a fixed version collides with the previous run on
 * `audit_aggregate_version_unique`.
 */
const recoveryVersion = 100_000 + Math.floor(Math.random() * 800_000);

/** Order line snapshot in the shape the acceptance emitter validates. */
const lineSnapshot = {
  id: orderLineId,
  sku: "LOCKED-STORAGE-TB",
  region: "us-central",
  quantity: "1",
};

const replay = {
  requestedBy: "20000000-0000-4000-8000-000000000001",
  reason: "Provider capacity restored, the command is safe to re-issue",
};

/**
 * Populated by the seed. The dispatch fixtures come from the production
 * emitter, `createAcceptedOrderProvisioningAttempt`, not from hand-built rows:
 * this file previously seeded `aggregate_type = 'order'` audit rows by raw SQL,
 * which satisfied the dispatch join while the real emitter wrote
 * `'provider_operation'` -- so the join's defect was invisible here. The
 * payload is read back from the outbox row the emitter wrote, because those
 * bytes, not a literal in this file, are what a redrive must reproduce.
 */
const seeded = {
  attemptId: "",
  commandId: "",
  outboxMessageId: "",
  stubMessageId: "",
  runId: crypto.randomUUID(),
  dispatchedPayload: undefined as unknown,
  invocationKey: "" as IdempotencyKey,
};

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

    // The dispatch under test, written by the emitter that writes it in
    // production. This is the event/outbox pair `loadDeadLetterDispatch` must
    // find behind a stopped attempt.
    const created = await createAcceptedOrderProvisioningAttempt(tx, {
      orderId,
      orderVersion: 4,
      accountId,
      provisioningIdempotencyKey: `redrive-dispatch-${suffix}`,
      requestedAt: new Date("2026-08-01T00:30:00.000Z"),
      actor,
      requestId: `redrive-seed-${suffix}`,
      lineSnapshots: [
        {
          orderLineId,
          snapshot: lineSnapshot,
          snapshotHash: coreSnapshotHash(lineSnapshot),
        },
      ],
    });
    seeded.attemptId = created.attempt.id;
    seeded.commandId = created.command.commandId;
    seeded.outboxMessageId = created.outboxMessageId;
    seeded.invocationKey =
      `outbox:${created.outboxMessageId}` as IdempotencyKey;

    // The terminal state is the task runner's to write after provider
    // exhaustion; no repository emitter produces it, so the column moves by
    // fixture.
    await tx.execute(sql`
      update public.lifecycle_provisioning_attempts
      set state = 'dead_letter',
          attempt = attempt || '{"state":"dead_letter","attempts":5}'::jsonb
      where id = ${seeded.attemptId}::uuid
    `);

    // The bytes the task ran on, exactly as the emitter durably wrote them.
    const payloadRows = await tx.execute(sql`
      select payload from public.outbox_messages
      where id = ${seeded.outboxMessageId}::uuid
    `);
    seeded.dispatchedPayload = required(
      payloadRows[0],
      "dispatched outbox payload",
    ).payload;

    // The operator-recovery emitter, `recoverProvisioning` in
    // packages/db/src/repositories/lifecycle/command-repository.ts:3466-3481,
    // also writes `order.provisioning_requested` -- keyed on the order/poc
    // aggregate and carrying only a stub, not the command. Invoking that
    // command needs a recent-authentication operator context this suite does
    // not construct, so its `appendEvent` call is reproduced here through the
    // same production writer it delegates to, with its exact field shape and a
    // LATER timestamp: the dispatch lookup must not let this newer stub shadow
    // the real dispatch bytes.
    const stub = await appendAuditAndOutbox(tx, {
      accountId,
      aggregateType: "order",
      aggregateId: orderId,
      aggregateVersion: recoveryVersion,
      eventType: "order.provisioning_requested",
      topic: "order.provisioning_requested",
      actor,
      requestId: `redrive-recovery-${suffix}`,
      occurredAt: new Date("2026-08-02T09:00:00.000Z"),
      before: { state: "dead_letter", rowVersion: 1 },
      after: {
        commandId: seeded.commandId,
        state: "retry_scheduled",
        recoveredBy: actor.id,
        reason: "Operator recovery after provider outage",
      },
    });
    seeded.stubMessageId = stub.message.id;

    // The run as the Trigger dispatcher left it: that runtime is not running
    // in an integration test, so its row is seeded by hand. `input` holds a
    // lease envelope carrying the payload hash; it never held the payload.
    // The recovery store has already moved the run out of `failed`.
    await tx.execute(sql`
      insert into public.workflow_runs (
        id, task_identifier, idempotency_key, aggregate_type, aggregate_id,
        status, attempt_count, input, last_error, updated_at
      ) values (
        ${seeded.runId}::uuid, 'lifecycle-provisioning-command-dispatch-v1',
        ${seeded.invocationKey}, 'workflow', ${seeded.attemptId}::uuid,
        'pending', 4,
        ${sql`${JSON.stringify({
          payloadHash: payloadHash(seeded.dispatchedPayload),
          aggregateVersion: 1,
          requestId: `redrive-seed-${suffix}`,
          leaseToken: crypto.randomUUID(),
          leaseUntil: "2026-08-01T00:35:00.000Z",
        })}::jsonb`},
        null, '2026-08-01T02:00:00.000Z'::timestamptz
      )
    `);
  });
}

async function cleanup() {
  await withInternalTransaction(db, `redrive-clean-${suffix}`, async (tx) => {
    await tx.execute(sql`
      delete from public.workflow_runs
      where idempotency_key = ${seeded.invocationKey}
    `);
    await tx.execute(sql`
      delete from public.outbox_messages where id in (
        ${seeded.outboxMessageId}::uuid, ${seeded.stubMessageId}::uuid
      )
    `);
    await tx.execute(sql`
      delete from public.lifecycle_provisioning_attempts
      where id = ${seeded.attemptId}::uuid
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
        invocationKey: seeded.invocationKey,
        payloadHash: payloadHash({ redriveKey: seeded.invocationKey }),
        aggregateId: seeded.attemptId,
        aggregateVersion: 1,
        requestId: `redrive-synthesised-${suffix}`,
      }),
    ).resolves.toEqual({
      status: "payload_conflict",
      existingPayloadHash: payloadHash(seeded.dispatchedPayload),
    });
  });

  it("rebuilds the dispatched payload and its invocation key from the outbox message", async () => {
    const dispatch = await loadDeadLetterDispatch(db, {
      source: "workflow_run",
      id: seeded.runId,
      requestId: `redrive-load-${suffix}`,
    });
    expect(dispatch).toEqual({
      outboxMessageId: seeded.outboxMessageId,
      topic: "order.provisioning_requested",
      payload: seeded.dispatchedPayload,
    });
    const invocation = required(
      deadLetterRedriveInvocation(required(dispatch, "dispatch"), replay),
      "invocation",
    );
    expect(invocation).toMatchObject({
      taskId: "lifecycle-provisioning-command-dispatch-v1",
      idempotencyKey: seeded.invocationKey,
      replay,
    });
    expect(payloadHash(invocation.payload)).toBe(
      payloadHash(seeded.dispatchedPayload),
    );
  });

  it("re-enters the same run rather than opening a second one", async () => {
    const dispatch = await loadDeadLetterDispatch(db, {
      source: "workflow_run",
      id: seeded.runId,
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
        aggregateId: seeded.attemptId,
        aggregateVersion: 1,
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
          where idempotency_key = ${seeded.invocationKey}
        `),
    );
    expect(rows).toEqual([{ runs: 1 }]);
  });

  /**
   * The regression this file failed to catch once: the acceptance emitter
   * writes its event as `('provider_operation', attempt.id)`, and a dispatch
   * join modelled on the recovery emitter's `('order'|'poc', subject)` binding
   * returned null for every acceptance-path attempt -- precisely the failures
   * an operator redrives. The fixture is the production emitter, so this test
   * fails the moment the join and the emitter disagree again.
   */
  it("finds the provisioning command dispatch behind a stopped attempt", async () => {
    await expect(
      loadDeadLetterDispatch(db, {
        source: "provisioning_attempt",
        id: seeded.attemptId,
        requestId: `redrive-attempt-${suffix}`,
      }),
    ).resolves.toEqual({
      outboxMessageId: seeded.outboxMessageId,
      topic: "order.provisioning_requested",
      payload: seeded.dispatchedPayload,
    });
  });

  /**
   * The recovery emitter's stub is newer than the dispatch and shares its
   * command id, but carries `{ commandId, state, recoveredBy, reason }` rather
   * than the command. A lookup that picks it hands the redrive bytes that hash
   * differently, and the run store refuses the claim -- worse than the null it
   * replaces. The dispatch read must keep returning the acceptance-path
   * message.
   */
  it("does not let a newer operator-recovery stub shadow the dispatched bytes", async () => {
    const dispatch = await loadDeadLetterDispatch(db, {
      source: "provisioning_attempt",
      id: seeded.attemptId,
      requestId: `redrive-stub-${suffix}`,
    });
    expect(required(dispatch, "dispatch").outboxMessageId).toBe(
      seeded.outboxMessageId,
    );
    expect(dispatch?.outboxMessageId).not.toBe(seeded.stubMessageId);
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
          id: seeded.outboxMessageId,
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
          id: seeded.runId,
          requestedBy: replay.requestedBy,
          reason: replay.reason,
          requestId: `redrive-submit-${suffix}`,
        },
        submission,
      ),
    ).resolves.toEqual({ status: "submitted" });
    expect(submitted).toHaveLength(1);
    const sent = required(submitted[0], "submitted invocation");
    expect(payloadHash(sent.payload)).toBe(
      payloadHash(seeded.dispatchedPayload),
    );
    expect(sent.replay).toEqual(replay);
  });
});
