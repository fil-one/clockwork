import { ids } from "@clockwork/contracts";
import type { AuthorizationContext } from "@clockwork/domain";
import { exceptionQueues } from "@clockwork/domain/lifecycle";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createRuntimeDatabase } from "../../client";
import { orders, quotes } from "../../schema";
import { withInternalTransaction } from "../../transaction";
import { coreSnapshotHash } from "../core/finance";
import { createAcceptedOrderProvisioningAttempt } from "./accepted-order-provisioning";
import { DatabaseLifecycleCommandRepository } from "./command-repository";

const databaseUrl =
  process.env.DIRECT_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable";
const authorizationSecret =
  process.env.AUTHORIZATION_CONTEXT_SECRET ??
  "clockwork-local-auth-context-secret-change-me";

const { client, db } = createRuntimeDatabase({
  url: databaseUrl,
  maxConnections: 4,
  role: "clockwork_service",
  ssl: false,
});

const repository = new DatabaseLifecycleCommandRepository({
  database: db,
  serviceDatabase: db,
  authorizationSecret,
  policies: {
    clickThroughThresholdMinor: "1000000",
    migrationFeatureEnabled: false,
    automatedTeardownEnabled: false,
    exceptionQueues: exceptionQueues.map((queue) => ({
      queue,
      ownerId: "20000000-0000-4000-8000-000000000001",
      backupId: "20000000-0000-4000-8000-000000000005",
      targetBusinessHours: 8,
      escalationOwnerId: "20000000-0000-4000-8000-000000000006",
      separationRequired: true,
    })),
  },
});

const suffix = crypto.randomUUID().slice(0, 8);
const accountId = "10000000-0000-4000-8000-000000000001";
const sourceOrderId = "80000000-0000-4000-8000-000000000001";
const orderLineId = "81000000-0000-4000-8000-000000000001";
const organizationId = "30000000-0000-4000-8000-000000000001";
const pocAccountId = "10000000-0000-4000-8000-000000000004";
const pocOrganizationId = "30000000-0000-4000-8000-000000000003";
const pocId = "85000000-0000-4000-8000-000000000001";
const operatorId = "20000000-0000-4000-8000-000000000001";
const occurredAt = "2026-08-05T10:00:00.000Z";

/** Order line snapshot in the shape the acceptance emitter validates. */
const lineSnapshot = {
  id: orderLineId,
  sku: "LOCKED-STORAGE-TB",
  region: "us-central",
  quantity: "1",
};

const seeded = {
  orderId: "",
  quoteId: "",
  attemptId: "",
  recoveredVersion: 0,
  commandId: "",
  idempotencyKey: "",
  dispatchMessageId: "",
  sandboxAttemptId: "",
  sandboxCommandId: "",
  sandboxIdempotencyKey: "",
};

function operatorContext(requestId: string, idempotencyKey: string) {
  const authorization: AuthorizationContext = {
    userId: ids.user.parse(operatorId),
    accountIds: [ids.account.parse(accountId)],
    roles: ["owner"],
    isInternalStaff: true,
    mfaVerified: true,
    recentAuthenticationVerified: true,
  };
  return {
    requestId,
    actor: { kind: "user" as const, id: operatorId },
    idempotencyKey,
    ip: "192.0.2.12",
    userAgent: "Clockwork provisioning recovery integration",
    occurredAt,
    authorization,
  };
}

interface EmittedRow {
  aggregate_type: string;
  aggregate_id: string;
  aggregate_version: number;
  event_type: string;
  topic: string | null;
  message_id: string | null;
  payload: unknown;
}

/** Every audit row an attempt recovery could have produced, by either binding. */
async function emittedFor(
  label: string,
  attemptId: string,
  subjectId: string,
): Promise<readonly EmittedRow[]> {
  const rows = await withInternalTransaction(
    db,
    `recovery-read-${label}-${suffix}`,
    (tx) =>
      tx.execute(sql`
        select event.aggregate_type,
               event.aggregate_id::text as aggregate_id,
               event.aggregate_version,
               event.event_type,
               message.topic,
               message.id::text as message_id,
               message.payload
        from public.audit_events event
        left join public.outbox_messages message on message.event_id = event.id
        where event.aggregate_id in (${attemptId}::uuid, ${subjectId}::uuid)
          and event.event_type like 'order.provisioning_%'
        order by event.occurred_at
      `),
  );
  return rows as unknown as readonly EmittedRow[];
}

async function seed() {
  await withInternalTransaction(db, `recovery-seed-${suffix}`, async (tx) => {
    // A fresh order per run. `audit_events` is append-only with no delete
    // policy, so the colliding row this suite writes below cannot be cleaned
    // up; on a shared order it would poison the next run's version.
    const sourceOrder = await tx.query.orders.findFirst({
      where: eq(orders.id, sourceOrderId),
    });
    if (!sourceOrder) throw new Error("RECOVERY_SOURCE_ORDER_MISSING");
    const sourceQuote = await tx.query.quotes.findFirst({
      where: eq(quotes.id, sourceOrder.quoteId),
    });
    if (!sourceQuote) throw new Error("RECOVERY_SOURCE_QUOTE_MISSING");
    seeded.quoteId = crypto.randomUUID();
    seeded.orderId = crypto.randomUUID();
    await tx.insert(quotes).values({
      ...sourceQuote,
      id: seeded.quoteId,
      seriesId: crypto.randomUUID(),
      previousRevisionId: null,
      rowVersion: 1,
    });
    await tx.insert(orders).values({
      ...sourceOrder,
      id: seeded.orderId,
      quoteId: seeded.quoteId,
      rowVersion: 1,
    });

    // `core_guard_provisioning_outbox` refuses any `order.provisioning_requested`
    // message whose order has no approved acceptance reservation. Production
    // creates it in the accepting transaction; the fixture supplies it.
    await tx.execute(sql`
      insert into public.core_order_acceptance_reservations (
        order_id, buyer_account_id, billing_account_id, currency, amount_minor,
        decision, reason
      ) values (
        ${seeded.orderId}::uuid, ${accountId}::uuid, ${accountId}::uuid, 'USD',
        180000, 'approved', 'Provisioning recovery fixture'
      )
    `);

    // The dispatch under recovery, written by the emitter that writes it in
    // production. Nothing about the attempt or its event is hand-built.
    const created = await createAcceptedOrderProvisioningAttempt(tx, {
      orderId: seeded.orderId,
      orderVersion: 4,
      accountId,
      provisioningIdempotencyKey: `recovery-dispatch-${suffix}`,
      requestedAt: new Date("2026-08-04T00:30:00.000Z"),
      actor: { kind: "user", id: operatorId },
      requestId: `recovery-seed-${suffix}`,
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
    seeded.idempotencyKey = created.command.idempotencyKey;
    seeded.dispatchMessageId = created.outboxMessageId;

    // Terminal state is the task runner's to write after provider exhaustion;
    // no repository emitter produces it, so the column moves by fixture.
    const deadLettered = await tx.execute(sql`
      update public.lifecycle_provisioning_attempts
      set state = 'dead_letter',
          attempt = attempt || '{"state":"dead_letter","attempts":5}'::jsonb
      where id = ${seeded.attemptId}::uuid
      returning row_version
    `);
    // The version recovery will write. `touch_versioned_row` owns the column,
    // so it is read back rather than assumed.
    seeded.recoveredVersion =
      (deadLettered[0] as { row_version: number }).row_version + 1;

    // The provider-effect row as `claimProviderEffect` leaves it after a
    // permanent provider failure: provider `lifecycle-provisioning`, status
    // `failed`. This is the row the recovered dispatch has to be able to
    // reclaim, and the row the pre-fix recovery never touched because it
    // matched on provider `provisioning`.
    await tx.execute(sql`
      insert into public.provider_operations (
        provider, operation, idempotency_key, aggregate_type, aggregate_id,
        status, attempt_count, last_error
      ) values (
        'lifecycle-provisioning', 'provision', ${seeded.idempotencyKey},
        'provider_operation', ${seeded.attemptId}::uuid, 'failed', 5,
        'PROVIDER_REJECTED'
      )
    `);

    // The order's own audit history, occupying the version the pre-fix
    // recovery would have claimed: it keyed `('order', orderId)` with the
    // ATTEMPT's next row version, whatever that happens to be. Written as
    // a fixture rather than by a command because the point is only that the
    // order aggregate already owns version 2 -- which, for a real order, it
    // does long before anyone recovers a provisioning attempt.
    await tx.execute(sql`
      insert into public.audit_events (
        account_id, aggregate_type, aggregate_id, aggregate_version,
        event_type, event_version, actor, occurred_at, request_id, after
      ) values (
        ${accountId}::uuid, 'order', ${seeded.orderId}::uuid,
        ${seeded.recoveredVersion},
        'core.orders.activated', 1,
        ${sql`${JSON.stringify({ kind: "user", id: operatorId })}::jsonb`},
        '2026-08-04T01:00:00.000Z'::timestamptz, ${`recovery-order-history-${suffix}`},
        '{}'::jsonb
      )
    `);

    // A dead-lettered sandbox attempt. `decide_poc` writes this row shape
    // (command-repository.ts, decidePoc) and `ingest_provisioning_event`
    // drives it to `dead_letter` on a failed provider confirmation; both are
    // long chains whose producers are covered elsewhere, and the producer
    // under test here is `recoverProvisioning`.
    seeded.sandboxCommandId = `poc-recovery-${suffix}`;
    seeded.sandboxIdempotencyKey = `recovery-sandbox-${suffix}-0123456789`;
    const sandboxAttempt = {
      command: {
        commandId: seeded.sandboxCommandId,
        idempotencyKey: seeded.sandboxIdempotencyKey,
        orderId: pocId,
        orderVersion: 1,
        organizationId: pocOrganizationId,
        operation: "sandbox",
        tenantId: null,
        entitlements: [
          {
            sku: "POC-SANDBOX",
            productCode: "poc-sandbox",
            entitlementKind: "sandbox",
            quantity: "1",
            region: "isolated",
          },
        ],
        requestedAt: "2026-08-04T00:30:00.000Z",
      },
      state: "dead_letter",
      attempts: 3,
      nextAttemptAt: null,
      lastError: {
        code: "PROVISIONING_CONFIRMATION_FAILED",
        message: "Provisioning provider reported a failed operation",
        kind: "permanent",
      },
      providerOperationId: null,
      confirmedAt: null,
      operatorRecovery: null,
    };
    const inserted = await tx.execute(sql`
      insert into public.lifecycle_provisioning_attempts (
        command_id, account_id, poc_id, organization_id, operation, state,
        attempt
      ) values (
        ${seeded.sandboxCommandId}, ${pocAccountId}::uuid, ${pocId}::uuid,
        ${pocOrganizationId}::uuid, 'sandbox', 'dead_letter',
        ${sql`${JSON.stringify(sandboxAttempt)}::jsonb`}
      )
      returning id::text as id
    `);
    seeded.sandboxAttemptId = (inserted[0] as { id: string }).id;
    await tx.execute(sql`
      insert into public.provider_operations (
        provider, operation, idempotency_key, aggregate_type, aggregate_id,
        status, attempt_count, last_error
      ) values (
        'provisioning', 'sandbox', ${seeded.sandboxIdempotencyKey}, 'poc',
        ${pocId}::uuid, 'failed', 3, 'PROVIDER_REJECTED'
      )
    `);
  });
}

async function cleanup() {
  if (!seeded.attemptId || !seeded.sandboxAttemptId) return;
  await withInternalTransaction(db, `recovery-clean-${suffix}`, async (tx) => {
    await tx.execute(sql`
      delete from public.outbox_messages
      where payload->>'aggregateId' in (
        ${seeded.attemptId}, ${seeded.sandboxAttemptId}, ${seeded.orderId}
      )
    `);
    await tx.execute(sql`
      delete from public.provider_operations
      where idempotency_key in (
        ${seeded.idempotencyKey}, ${seeded.sandboxIdempotencyKey}
      )
    `);
    await tx.execute(sql`
      delete from public.lifecycle_provisioning_attempts
      where id in (${seeded.attemptId}::uuid, ${seeded.sandboxAttemptId}::uuid)
    `);
  });
}

beforeAll(seed);
afterAll(async () => {
  await cleanup();
  await client.end();
});

describe.sequential("operator provisioning recovery", () => {
  /**
   * The defect this file exists to pin. `recoverProvisioning` enqueues the run
   * that re-issues a stuck provisioning command, and it used to enqueue one
   * that could not run: a payload of `{ commandId, state, recoveredBy, reason }`
   * bound to the order aggregate, against a consumer
   * (`ProvisioningRequestedEventSchema`) that requires
   * `aggregateType: 'provider_operation'`, the attempt id, and
   * `data.orderId` / `data.organizationId`. The command returned success and
   * the run died at parse.
   *
   * Asserted on the row the real command wrote, not on a fixture: the outbox
   * payload is read back from `outbox_messages`.
   */
  it("emits the dispatch the consumer can parse, keyed on the attempt", async () => {
    const outcome = await repository.executeInTransaction({
      command: "recover_provisioning",
      payload: {
        commandId: seeded.commandId,
        reason: "Provider capacity restored, the command is safe to re-issue",
      },
      context: operatorContext(
        `recovery-order-${suffix}`,
        `recover-order-${suffix}`,
      ),
    });
    expect(outcome).toMatchObject({
      id: seeded.attemptId,
      status: "retry_scheduled",
      eventType: "order.provisioning_requested",
    });

    const emitted = await emittedFor("order", seeded.attemptId, seeded.orderId);
    const recovery = emitted.find(
      (row) => row.aggregate_version === seeded.recoveredVersion,
    );
    expect(recovery).toBeDefined();
    expect(recovery).toMatchObject({
      aggregate_type: "provider_operation",
      aggregate_id: seeded.attemptId,
      event_type: "order.provisioning_requested",
      topic: "order.provisioning_requested",
    });

    // The consumer reads these four. `aggregateType` is a literal, the
    // aggregate is the attempt, and `data` carries the order and organization.
    const payload = recovery?.payload as {
      aggregateType: string;
      aggregateId: string;
      aggregateVersion: number;
      data: Record<string, unknown>;
    };
    expect(payload.aggregateType).toBe("provider_operation");
    expect(payload.aggregateId).toBe(seeded.attemptId);
    expect(payload.aggregateVersion).toBe(seeded.recoveredVersion);
    expect(payload.data.orderId).toBe(seeded.orderId);
    expect(payload.data.organizationId).toBe(organizationId);

    // `loadDeadLetterDispatch` finds a dispatch by `after.command.commandId`,
    // and the handler re-issues `attempt.command`. A recovery that omitted the
    // command left no redrivable record of itself.
    expect(payload.data.command).toMatchObject({
      commandId: seeded.commandId,
      idempotencyKey: seeded.idempotencyKey,
      orderId: seeded.orderId,
      organizationId,
      operation: "provision",
    });
  });

  /**
   * The second half of "the run cannot execute". The provider-effect row the
   * dispatch handler claims is written by `claimProviderEffect` under provider
   * `lifecycle-provisioning`; recovery matched only `provisioning`, a name
   * used exclusively by the eager sandbox and teardown inserts. So the effect
   * row stayed `failed`, and the recovered dispatch would have read
   * `permanent_failure` from `claimProviderEffect` and raised
   * `PROVISIONING_DISPATCH_PREVIOUSLY_FAILED` before reaching the provider.
   */
  it("releases the provider-effect row the recovered dispatch has to reclaim", async () => {
    const rows = await withInternalTransaction(
      db,
      `recovery-effect-${suffix}`,
      (tx) =>
        tx.execute(sql`
          select provider, status, last_error
          from public.provider_operations
          where idempotency_key = ${seeded.idempotencyKey}
        `),
    );
    expect(rows).toEqual([
      {
        provider: "lifecycle-provisioning",
        status: "retrying",
        last_error: null,
      },
    ]);
  });

  /**
   * Defect (2). The pre-fix binding wrote `('order', orderId, attempt.rowVersion + 1)`
   * -- an ORDER aggregate key carrying an ATTEMPT version -- into a table whose
   * `audit_aggregate_version_unique` index is `(aggregate_type, aggregate_id,
   * aggregate_version)`. The seed put the order's own history at that version
   * first, so the pre-fix write is a unique violation that aborts the whole
   * recovery transaction: not a stray audit row, a recovery the operator
   * cannot perform. The two rows below coexist only because they no longer
   * share a key space.
   */
  it("keeps the recovery event out of the subject aggregate's version sequence", async () => {
    const rows = await withInternalTransaction(
      db,
      `recovery-collision-${suffix}`,
      (tx) =>
        tx.execute(sql`
          select aggregate_type,
                 aggregate_id::text as aggregate_id,
                 event_type
          from public.audit_events
          where aggregate_version = ${seeded.recoveredVersion}
            and aggregate_id in (
              ${seeded.orderId}::uuid, ${seeded.attemptId}::uuid
            )
          order by aggregate_type
        `),
    );
    expect(rows).toEqual([
      {
        aggregate_type: "order",
        aggregate_id: seeded.orderId,
        event_type: "core.orders.activated",
      },
      {
        aggregate_type: "provider_operation",
        aggregate_id: seeded.attemptId,
        event_type: "order.provisioning_requested",
      },
    ]);
  });

  /**
   * A sandbox attempt has no order, and no consumer can dispatch it:
   * `DatabaseProvisioningDispatchStore.load` refuses `sandbox` outright.
   * Emitting `order.provisioning_requested` for one used to abort the whole
   * recovery inside `core_guard_provisioning_outbox` with a 23514 about
   * acceptance reservations -- an operator refused a legitimate operation, and
   * told nothing useful about why. Recovery now records the decision and
   * resets the attempt without minting a dispatch nobody can run.
   */
  it("recovers a sandbox attempt without enqueueing a run nothing can execute", async () => {
    const outcome = await repository.executeInTransaction({
      command: "recover_provisioning",
      payload: {
        commandId: seeded.sandboxCommandId,
        reason: "Sandbox tenancy restored, the operator re-issues by hand",
      },
      context: operatorContext(
        `recovery-sandbox-${suffix}`,
        `recover-sandbox-${suffix}`,
      ),
    });
    expect(outcome).toMatchObject({
      id: seeded.sandboxAttemptId,
      status: "retry_scheduled",
      eventType: "order.provisioning_recovered",
    });

    const emitted = await emittedFor("sandbox", seeded.sandboxAttemptId, pocId);
    const recovery = emitted.find(
      (row) => row.aggregate_id === seeded.sandboxAttemptId,
    );
    expect(recovery).toMatchObject({
      aggregate_type: "provider_operation",
      aggregate_id: seeded.sandboxAttemptId,
      aggregate_version: 2,
      event_type: "order.provisioning_recovered",
      topic: "order.provisioning_recovered",
    });
    expect(
      emitted.some(
        (row) =>
          row.topic === "order.provisioning_requested" &&
          row.aggregate_id === seeded.sandboxAttemptId,
      ),
    ).toBe(false);

    const state = await withInternalTransaction(
      db,
      `recovery-sandbox-state-${suffix}`,
      (tx) =>
        tx.execute(sql`
          select attempt.state,
                 operation.status as operation_status
          from public.lifecycle_provisioning_attempts attempt
          join public.provider_operations operation
            on operation.idempotency_key = attempt.attempt->'command'->>'idempotencyKey'
          where attempt.id = ${seeded.sandboxAttemptId}::uuid
        `),
    );
    expect(state).toEqual([
      { state: "retry_scheduled", operation_status: "retrying" },
    ]);
  });
});
