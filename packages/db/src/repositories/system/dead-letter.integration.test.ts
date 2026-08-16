import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { createRuntimeDatabase } from "../../client";
import { withInternalTransaction } from "../../transaction";
import { appendAuditAndOutbox } from "../audit-outbox";
import { coreSnapshotHash } from "../core/finance";
import { createAcceptedOrderProvisioningAttempt } from "../lifecycle/accepted-order-provisioning";
import {
  DatabaseDeadLetterReadModel,
  DatabaseDeadLetterRecoveryStore,
  DeadLetterRecoveryError,
} from "./dead-letter";
import { DatabaseOutboxDispatcherStore } from "./outbox";

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
const orderId = "80000000-0000-4000-8000-000000000007";
const suffix = crypto.randomUUID().slice(0, 8);

/**
 * The dispatcher owns availability and lease expiry, and it reads both from a
 * clock this store injects, so exhaustion is driven on a test clock that
 * advances past each backoff rather than by writing counters directly. Ten
 * minutes clears the 300s backoff ceiling in `fail()`.
 */
const dispatchBase = Date.parse("2026-08-05T00:00:00.000Z");
let dispatchNow = dispatchBase;
const dispatcher = new DatabaseOutboxDispatcherStore(db, {
  clock: () => new Date(dispatchNow),
});
/**
 * The claim query is queue-wide, so the fixture claims on a topic no other
 * suite sharing this database writes.
 */
const dispatchTopic = `system.dead_letter.fixture.${suffix}`;
const outboxMaximumAttempts = 8;

/**
 * Populated by the seed. The audit event, its outbox message, and the
 * provisioning attempt come from the production writers -- this file
 * previously hand-built those rows with raw SQL, which let a fixture satisfy
 * joins the real emitters never would. Dispatcher exhaustion is no longer a
 * fixture either: it is driven through `DatabaseOutboxDispatcherStore`, whose
 * `fail()` leaves both the message counter AND the
 * `system.outbox.dispatch.v1` run the claim query joins. Setting
 * `attempt_count` by hand satisfies the list query while leaving no run row at
 * all, which is a state the dispatcher cannot produce -- and it is precisely
 * the run row that decides whether a retried message is claimable again. Only
 * task-runner dead-lettering on the provisioning attempt stays a fixture; no
 * repository emitter produces it.
 */
const fixture = {
  eventId: "",
  // The seeded audit event owns its own aggregate id. Audit rows are
  // append-only, so a shared id would collide with the previous run.
  subjectId: crypto.randomUUID(),
  outboxId: "",
  attemptId: "",
  attemptOutboxId: "",
  runId: crypto.randomUUID(),
};

/**
 * Messages this file exhausts through the dispatcher beyond the shared one, so
 * cleanup can find their `outbox:<id>` runs.
 */
const dispatched: string[] = [];

const RunRowSchema = z.object({ id: z.string(), status: z.string() });

/**
 * The provisioning fixture binds to seeded account …0004, and
 * `createAcceptedOrderProvisioningAttempt` derives the organization from that
 * account alone: it raises PROVISIONING_ORGANIZATION_AMBIGUOUS as soon as any
 * concurrent suite sharing this database leaves a second organization on it.
 * That is an environment failure, and it belongs to the assertions that read
 * the provisioning row -- not to the outbox and workflow-run assertions beside
 * them, which share nothing with it. It is held here and rethrown from those
 * tests unchanged, so the same failure is still reported, at the tests that
 * actually depend on it.
 */
let provisioningSeedFailure: Error | undefined;

const orderLineId = "81000000-0000-4000-8000-000000000007";
const lineSnapshot = {
  id: orderLineId,
  sku: "LOCKED-STORAGE-TB",
  region: "us-central",
  quantity: "1",
};

async function seed() {
  await withInternalTransaction(
    db,
    `dead-letter-seed-${suffix}`,
    async (tx) => {
      const created = await appendAuditAndOutbox(tx, {
        accountId,
        aggregateType: "order",
        aggregateId: fixture.subjectId,
        aggregateVersion: 1,
        eventType: "core.orders.create",
        actor: { kind: "system", id: "dead-letter-test" },
        requestId: `dead-letter-seed-${suffix}`,
        occurredAt: new Date("2026-08-01T00:00:00.000Z"),
        topic: dispatchTopic,
      });
      fixture.eventId = created.event.id;
      fixture.outboxId = created.message.id;
      // The writer stamps availability with database time, which is the real
      // wall clock; the dispatch loop below runs on a fixed test clock. Only
      // the queue timestamp is aligned here -- every counter, backoff, lease
      // and run row still comes from the dispatcher itself.
      await tx.execute(sql`
      update public.outbox_messages
      set available_at = ${new Date(dispatchBase).toISOString()}::timestamptz
      where id = ${fixture.outboxId}::uuid
    `);
      // The run row is the Trigger dispatcher's to write, and that runtime is
      // not running in an integration test, so it stays a hand-built fixture.
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

/** Separated from `seed` only so its environment failure stays local. */
async function seedProvisioningAttempt() {
  await withInternalTransaction(
    db,
    `dead-letter-seed-provisioning-${suffix}`,
    async (tx) => {
      // `core_guard_provisioning_outbox` requires an approved acceptance
      // reservation before the acceptance emitter may enqueue provisioning.
      // The reservation stays afterwards: its protect trigger refuses deletes.
      await tx.execute(sql`
      insert into public.core_order_acceptance_reservations (
        order_id, buyer_account_id, billing_account_id, currency, amount_minor,
        decision, reason
      ) values (
        ${orderId}::uuid, ${accountId}::uuid, ${accountId}::uuid, 'USD', 180000,
        'approved', 'Dead letter read model fixture'
      )
      on conflict (order_id) do nothing
    `);
      const attempt = await createAcceptedOrderProvisioningAttempt(tx, {
        orderId,
        orderVersion: 4,
        accountId,
        provisioningIdempotencyKey: `dead-letter-${suffix}`,
        requestedAt: new Date("2026-08-01T01:00:00.000Z"),
        actor: { kind: "system", id: "dead-letter-test" },
        requestId: `dead-letter-seed-${suffix}`,
        lineSnapshots: [
          {
            orderLineId,
            snapshot: lineSnapshot,
            snapshotHash: coreSnapshotHash(lineSnapshot),
          },
        ],
      });
      fixture.attemptId = attempt.attempt.id;
      fixture.attemptOutboxId = attempt.outboxMessageId;
      // The terminal state is the task runner's to write after provider
      // exhaustion; no repository emitter produces it.
      await tx.execute(sql`
      update public.lifecycle_provisioning_attempts
      set state = 'dead_letter',
          attempt = attempt || ${sql`${JSON.stringify({
            attempts: 5,
            state: "dead_letter",
            lastError: {
              code: "PROVIDER_REJECTED",
              message: "redacted",
              kind: "permanent",
            },
          })}::jsonb`},
          updated_at = '2026-08-01T01:00:00.000Z'::timestamptz
      where id = ${fixture.attemptId}::uuid
    `);
    },
  );
}

/** The provisioning row is the only one these tests cannot seed themselves. */
function requireProvisioningFixture(): void {
  if (provisioningSeedFailure) throw provisioningSeedFailure;
}

/**
 * Exhausts the seeded message through the dispatcher itself, so the rows the
 * recovery path has to undo are the rows `fail()` actually writes: the message
 * counter at the ceiling AND a `system.outbox.dispatch.v1` run left `failed`.
 * The claim query joins that run, so no fixture can stand in for it.
 */
async function exhaustDispatch() {
  for (let attempt = 1; attempt <= outboxMaximumAttempts; attempt += 1) {
    const claimed = await dispatcher.claimNext({
      workerId: `dead-letter-exhaust-${suffix}`,
      topics: [dispatchTopic],
    });
    if (!claimed || claimed.id !== fixture.outboxId)
      throw new Error(
        `EXPECTED_CLAIM_ON_ATTEMPT_${attempt}_GOT_${claimed?.id ?? "null"}`,
      );
    await dispatcher.fail(claimed);
    // Past the 300s backoff ceiling, so the next claim is not blocked on time.
    dispatchNow += 600_000;
  }
}

/**
 * A second incident of the same shape, on its own topic, for the tests that
 * consume a message rather than observe it. Every row comes from the same two
 * production writers as the shared fixture: `appendAuditAndOutbox` enqueues it
 * and the dispatcher exhausts it, so the `system.outbox.dispatch.v1` run this
 * returns is the one `fail()` wrote, not a stand-in.
 */
async function exhaustedIncident(
  label: string,
): Promise<{ outboxId: string; runId: string; topic: string }> {
  const topic = `${dispatchTopic}.${label}`;
  const outboxId = await withInternalTransaction(
    db,
    `dead-letter-seed-${label}-${suffix}`,
    async (tx) => {
      const created = await appendAuditAndOutbox(tx, {
        accountId,
        aggregateType: "order",
        aggregateId: crypto.randomUUID(),
        aggregateVersion: 1,
        eventType: "core.orders.create",
        actor: { kind: "system", id: "dead-letter-test" },
        requestId: `dead-letter-seed-${label}-${suffix}`,
        occurredAt: new Date("2026-08-01T00:00:00.000Z"),
        topic,
      });
      // Availability is stamped with database time; the dispatcher below runs
      // on the test clock, which by now has advanced past it.
      await tx.execute(sql`
        update public.outbox_messages
        set available_at = ${new Date(dispatchNow).toISOString()}::timestamptz
        where id = ${created.message.id}::uuid
      `);
      return created.message.id;
    },
  );
  dispatched.push(outboxId);
  for (let attempt = 1; attempt <= outboxMaximumAttempts; attempt += 1) {
    const claimed = await dispatcher.claimNext({
      workerId: `dead-letter-${label}-${suffix}`,
      topics: [topic],
    });
    if (!claimed || claimed.id !== outboxId)
      throw new Error(
        `EXPECTED_CLAIM_ON_ATTEMPT_${attempt}_GOT_${claimed?.id ?? "null"}`,
      );
    await dispatcher.fail(claimed);
    dispatchNow += 600_000;
  }
  const runs = await withInternalTransaction(
    db,
    `dead-letter-run-${label}-${suffix}`,
    (tx) =>
      tx.execute(sql`
        select id::text as id, status
        from public.workflow_runs
        where task_identifier = 'system.outbox.dispatch.v1'
          and idempotency_key = ${`outbox:${outboxId}`}
      `),
  );
  const run = RunRowSchema.parse(runs[0]);
  // Restated rather than assumed: every claim below is judged against the state
  // the dispatcher's own ceiling leaves, so a change to `fail()` breaks here.
  expect([runs.length, run.status]).toEqual([1, "failed"]);
  return { outboxId, runId: run.id, topic };
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
      for (const outboxId of [fixture.outboxId, ...dispatched]) {
        if (!outboxId) continue;
        await tx.execute(
          sql`delete from public.workflow_runs
              where idempotency_key = ${`outbox:${outboxId}`}`,
        );
        await tx.execute(
          sql`delete from public.outbox_messages where id = ${outboxId}::uuid`,
        );
      }
      // Absent when the provisioning fixture could not be seeded. Deleting on
      // an empty string aborts the whole cleanup transaction, which used to
      // leave every other row behind as well.
      if (fixture.attemptOutboxId)
        await tx.execute(
          sql`delete from public.outbox_messages where id = ${fixture.attemptOutboxId}::uuid`,
        );
      await tx.execute(
        sql`delete from public.workflow_runs where id = ${fixture.runId}::uuid`,
      );
      if (fixture.attemptId)
        await tx.execute(
          sql`delete from public.lifecycle_provisioning_attempts where id = ${fixture.attemptId}::uuid`,
        );
    },
  );
}

beforeAll(async () => {
  await seed();
  await exhaustDispatch();
  try {
    await seedProvisioningAttempt();
  } catch (error) {
    provisioningSeedFailure =
      error instanceof Error ? error : new Error(String(error));
  }
});
afterAll(async () => {
  await cleanup();
  await client.end();
});

describe("dead letter operator read model", () => {
  it("lists all three stopped shapes from their own indexed columns", async () => {
    requireProvisioningFixture();
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
      reference: dispatchTopic,
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

  /**
   * The whole outbox retry contract, end to end.
   *
   * `DatabaseDeadLetterRecoveryStore.retry` and `redriveRetriedWork` both state
   * that the outbox needs no caller-supplied redrive because clearing the
   * ceiling "puts the message back under the dispatcher's own claim query".
   * Nothing else redelivers it, so that sentence is the entire promise the
   * operator's Retry control makes, and the only way to check it is to ask the
   * dispatcher afterwards. Asserting `attempt_count = 0` proves the write
   * landed, not that the work moves again: the claim query also joins the
   * `system.outbox.dispatch.v1` run, which `fail()` leaves `failed` at exactly
   * the ceiling that puts the message on this list.
   */
  it("returns an outbox message to the dispatcher and records why", async () => {
    const before = await withInternalTransaction(
      db,
      `dead-letter-retry-before-${suffix}`,
      (tx) =>
        tx.execute(sql`
          select status from public.workflow_runs
          where idempotency_key = ${`outbox:${fixture.outboxId}`}
        `),
    );
    // The state the dispatcher's own ceiling leaves behind, restated so a
    // change to `fail()` breaks here rather than silently voiding this test.
    expect(before).toEqual([{ status: "failed" }]);

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

    // Read before the reclaim, asserted after it. The dispatch run is itself a
    // `workflow_run` and the read model lists any run left `failed`, so a retry
    // that clears the message but not its run leaves the same incident on the
    // queue under a second identity -- but claiming the message moves that run
    // to `running`, so the queue has to be sampled first and judged later.
    // Claimability is the promise the control makes, so it is judged first.
    const queued = await readModel.list({
      limit: 200,
      requestId: `dead-letter-retry-list-${suffix}`,
    });

    dispatchNow += 600_000;
    const reclaimed = await dispatcher.claimNext({
      workerId: `dead-letter-reclaim-${suffix}`,
      topics: [dispatchTopic],
    });
    expect(reclaimed?.id).toBe(fixture.outboxId);
    expect(reclaimed?.attempt).toBe(1);

    expect(queued.some((operation) => operation.id === fixture.outboxId)).toBe(
      false,
    );
    expect(
      queued.some(
        (operation) =>
          operation.source === "workflow_run" &&
          operation.subjectId === fixture.outboxId,
      ),
    ).toBe(false);
  });

  /**
   * The dispatcher writes two rows for one exhaustion: the message at the
   * ceiling and the `system.outbox.dispatch.v1` run it was dispatched under.
   * Both satisfy this list -- the message on the outbox branch, the run on the
   * workflow branch's `status = 'failed'` -- so one incident used to occupy two
   * lines of the operator's queue under two identities, only one of which any
   * control can act on.
   */
  it("lists a stopped dispatch once, not again as the dispatcher's own run", async () => {
    const incident = await exhaustedIncident("listed-once");
    const operations = await readModel.list({
      limit: 200,
      requestId: `dead-letter-once-${suffix}`,
    });
    expect(
      operations.some((operation) => operation.id === incident.outboxId),
    ).toBe(true);
    expect(
      operations.some((operation) => operation.id === incident.runId),
    ).toBe(false);
    expect(
      operations.some(
        (operation) => operation.reference === "system.outbox.dispatch.v1",
      ),
    ).toBe(false);
  });

  /**
   * The refusal, and the reason for it.
   *
   * Neither decision reaches this run's claimer. `retry` writes `pending` and
   * `abandon` writes `cancelled`, and the claim query in `outbox.ts` admits a
   * joined run only when it is absent, `running` past its lease, or `retrying`
   * past its backoff -- so both used to be recorded, audited, reported to the
   * operator as done, and change nothing.
   *
   * Worse than nothing, in the retry case: `reopenOutboxDispatchRun` reopens
   * the run only while it is still `failed`, so a retry here also disarms the
   * message's own retry, which is the single control that does move this work.
   * That is what the last two assertions hold: the run is left exactly as
   * `fail()` wrote it, and the message lever still fires.
   */
  it("refuses a decision addressed to the dispatcher's own run", async () => {
    const incident = await exhaustedIncident("not-addressable");
    const decision = {
      source: "workflow_run" as const,
      id: incident.runId,
      reason: "Operator picked the dispatch row, not the message row",
      actor,
      requestId: `dead-letter-addressable-${suffix}`,
    };
    // Both decisions, because neither reaches this run's claimer: `retry`
    // writes `pending` and `abandon` writes `cancelled`.
    for (const decide of [
      () => recovery.retry(decision),
      () => recovery.abandon(decision),
    ]) {
      await expect(decide()).rejects.toMatchObject({
        code: "DEAD_LETTER_OPERATION_NOT_ADDRESSABLE",
      });
    }
    const untouched = await withInternalTransaction(
      db,
      `dead-letter-addressable-assert-${suffix}`,
      (tx) =>
        tx.execute(sql`
          select run.status, count(decision.id)::int as decisions
          from public.workflow_runs run
          left join public.audit_events decision
            on decision.aggregate_type = 'workflow_run'
           and decision.aggregate_id = run.id
          where run.id = ${incident.runId}::uuid
          group by run.status
        `),
    );
    expect(untouched).toEqual([{ status: "failed", decisions: 0 }]);

    await recovery.retry({
      source: "outbox_message",
      id: incident.outboxId,
      reason: "The message is the control that moves this work",
      actor,
      requestId: `dead-letter-addressable-retry-${suffix}`,
    });
    dispatchNow += 600_000;
    const reclaimed = await dispatcher.claimNext({
      workerId: `dead-letter-addressable-claim-${suffix}`,
      topics: [incident.topic],
    });
    expect(reclaimed?.id).toBe(incident.outboxId);
  });

  /**
   * Abandonment is decided on the message and recorded against the message's
   * aggregate, so the workflow branch's own abandon filter never sees it. The
   * dispatch run stayed `failed` and kept its place on the queue as an
   * apparently undecided incident -- and retrying it does not merely fail
   * quietly, it reaches `redriveRetriedWork`, which rebuilds the lifecycle task
   * from that same message's payload. The refused delivery would have been made
   * after all.
   */
  it("does not re-offer a message an operator has abandoned", async () => {
    const incident = await exhaustedIncident("abandoned");
    await recovery.abandon({
      source: "outbox_message",
      id: incident.outboxId,
      reason: "This event must never be delivered",
      actor,
      requestId: `dead-letter-abandon-outbox-${suffix}`,
    });
    const operations = await readModel.list({
      limit: 200,
      requestId: `dead-letter-abandon-outbox-list-${suffix}`,
    });
    expect(
      operations.some((operation) =>
        [incident.outboxId, incident.runId].includes(operation.id),
      ),
    ).toBe(false);
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
    requireProvisioningFixture();
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
