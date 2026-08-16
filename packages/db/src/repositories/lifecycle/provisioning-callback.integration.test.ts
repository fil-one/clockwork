import { ids } from "@clockwork/contracts";
import type { AuthorizationContext } from "@clockwork/domain";
import { exceptionQueues } from "@clockwork/domain/lifecycle";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createRuntimeDatabase } from "../../client";
import { orders, organizations, pocs, quotes } from "../../schema";
import { withInternalTransaction } from "../../transaction";
import { coreSnapshotHash } from "../core/finance";
import { DatabaseProvisioningDispatchStore } from "../workflows/lifecycle";
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

/** The production dispatch store. The handler around it is transcribed below. */
const store = new DatabaseProvisioningDispatchStore(db);

const suffix = crypto.randomUUID().slice(0, 8);
// Account …0001 has exactly one production organization. Account …0004 now
// carries three isolated ones and makes the acceptance emitter raise
// PROVISIONING_ORGANIZATION_AMBIGUOUS, which is another lane's problem.
const accountId = "10000000-0000-4000-8000-000000000001";
const organizationId = "30000000-0000-4000-8000-000000000001";
const sourceOrderId = "80000000-0000-4000-8000-000000000001";
const orderLineId = "81000000-0000-4000-8000-000000000001";
const sourcePocId = "85000000-0000-4000-8000-000000000001";
const operatorId = "20000000-0000-4000-8000-000000000001";

/** Order line snapshot in the shape the acceptance emitter validates. */
const lineSnapshot = {
  id: orderLineId,
  sku: "LOCKED-STORAGE-TB",
  region: "us-central",
  quantity: "1",
};

interface SeededAttempt {
  orderId: string;
  quoteId: string;
  attemptId: string;
  attemptVersion: number;
  commandId: string;
  idempotencyKey: string;
}

const seeded = {
  /** Drives the full dispatch -> failed callback -> recovery -> dispatch path. */
  effect: undefined as SeededAttempt | undefined,
  /** Carries an order whose own audit history already owns the next version. */
  collision: undefined as SeededAttempt | undefined,
  sandbox: {
    pocId: "",
    accountId: "",
    attemptId: "",
    commandId: "",
    idempotencyKey: "",
  },
  tenantId: "",
};

function providerContext(label: string, occurredAt: string) {
  return {
    requestId: `provisioning-callback-${label}-${suffix}`,
    actor: { kind: "provider" as const, id: "provisioning-platform" },
    idempotencyKey: `provisioning-platform:${label}:${suffix}`,
    ip: null,
    userAgent: null,
    occurredAt,
    authorization: null,
  };
}

function operatorContext(label: string, occurredAt: string) {
  const authorization: AuthorizationContext = {
    userId: ids.user.parse(operatorId),
    accountIds: [ids.account.parse(accountId)],
    roles: ["owner"],
    isInternalStaff: true,
    mfaVerified: true,
    recentAuthenticationVerified: true,
  };
  return {
    requestId: `provisioning-callback-${label}-${suffix}`,
    actor: { kind: "user" as const, id: operatorId },
    idempotencyKey: `callback-${label}-${suffix}`,
    ip: "192.0.2.12",
    userAgent: "Clockwork provisioning callback integration",
    occurredAt,
    authorization,
  };
}

/**
 * A disposable order carrying a real accepted-order provisioning attempt.
 *
 * `audit_events` is append-only with no delete policy, so every aggregate this
 * suite writes a version into has to be one no other suite reads. The order,
 * its quote and (below) the POC are therefore cloned per run rather than
 * shared, and the attempt on top of them is written by the emitter that writes
 * it in production.
 */
async function seedAttempt(label: string): Promise<SeededAttempt> {
  return withInternalTransaction(
    db,
    `callback-seed-${label}-${suffix}`,
    async (tx) => {
      const sourceOrder = await tx.query.orders.findFirst({
        where: eq(orders.id, sourceOrderId),
      });
      if (!sourceOrder) throw new Error("CALLBACK_SOURCE_ORDER_MISSING");
      const sourceQuote = await tx.query.quotes.findFirst({
        where: eq(quotes.id, sourceOrder.quoteId),
      });
      if (!sourceQuote) throw new Error("CALLBACK_SOURCE_QUOTE_MISSING");
      const quoteId = crypto.randomUUID();
      const orderId = crypto.randomUUID();
      await tx.insert(quotes).values({
        ...sourceQuote,
        id: quoteId,
        seriesId: crypto.randomUUID(),
        previousRevisionId: null,
        rowVersion: 1,
      });
      await tx.insert(orders).values({
        ...sourceOrder,
        id: orderId,
        quoteId,
        rowVersion: 1,
      });
      // `core_guard_provisioning_outbox` refuses the acceptance emitter's
      // `order.provisioning_requested` message without one of these.
      await tx.execute(sql`
        insert into public.core_order_acceptance_reservations (
          order_id, buyer_account_id, billing_account_id, currency,
          amount_minor, decision, reason
        ) values (
          ${orderId}::uuid, ${accountId}::uuid, ${accountId}::uuid, 'USD',
          180000, 'approved', 'Provisioning callback fixture'
        )
      `);
      const created = await createAcceptedOrderProvisioningAttempt(tx, {
        orderId,
        orderVersion: 4,
        accountId,
        provisioningIdempotencyKey: `callback-${label}-${suffix}`,
        requestedAt: new Date("2026-08-04T00:30:00.000Z"),
        actor: { kind: "user", id: operatorId },
        requestId: `callback-seed-${label}-${suffix}`,
        lineSnapshots: [
          {
            orderLineId,
            snapshot: lineSnapshot,
            snapshotHash: coreSnapshotHash(lineSnapshot),
          },
        ],
      });
      return {
        orderId,
        quoteId,
        attemptId: created.attempt.id,
        attemptVersion: created.attempt.rowVersion,
        commandId: created.command.commandId,
        idempotencyKey: created.command.idempotencyKey,
      };
    },
  );
}

async function effectRow(idempotencyKey: string) {
  const rows = await withInternalTransaction(
    db,
    `callback-effect-${suffix}`,
    (tx) =>
      tx.execute(sql`
        select provider, operation, status, last_error, provider_reference
        from public.provider_operations
        where idempotency_key = ${idempotencyKey}
      `),
  );
  return rows as unknown as readonly {
    provider: string;
    operation: string;
    status: string;
    last_error: string | null;
    provider_reference: string | null;
  }[];
}

async function attemptRow(attemptId: string) {
  const rows = await withInternalTransaction(
    db,
    `callback-attempt-${suffix}`,
    (tx) =>
      tx.execute(sql`
        select state,
               row_version,
               attempt->>'confirmedAt' as confirmed_at,
               attempt->>'providerOperationId' as provider_operation_id,
               attempt->'lastError'->>'code' as last_error_code
        from public.lifecycle_provisioning_attempts
        where id = ${attemptId}::uuid
      `),
  );
  const row = rows[0] as
    | {
        state: string;
        row_version: number;
        confirmed_at: string | null;
        provider_operation_id: string | null;
        last_error_code: string | null;
      }
    | undefined;
  if (!row) throw new Error("CALLBACK_ATTEMPT_ROW_MISSING");
  return row;
}

/**
 * The audit rows a provisioning callback could have written, under either
 * binding, for one attempt and one subject.
 *
 * Both ids are in scope deliberately. A query that looked only where the fix
 * puts the row would pass against the unfixed code by finding nothing and
 * asserting nothing.
 */
async function callbackEvents(attemptId: string, subjectId: string) {
  const rows = await withInternalTransaction(
    db,
    `callback-events-${suffix}`,
    (tx) =>
      tx.execute(sql`
        select event.aggregate_type,
               event.aggregate_id::text as aggregate_id,
               event.aggregate_version,
               event.event_type,
               event.account_id::text as account_id,
               message.topic
        from public.audit_events event
        left join public.outbox_messages message on message.event_id = event.id
        where event.aggregate_id in (${attemptId}::uuid, ${subjectId}::uuid)
          and event.event_type in (
            'order.provisioning_confirmed', 'order.provisioning_dead_lettered'
          )
        order by event.occurred_at
      `),
  );
  return rows as unknown as readonly {
    aggregate_type: string;
    aggregate_id: string;
    aggregate_version: number;
    event_type: string;
    account_id: string | null;
    topic: string | null;
  }[];
}

async function seed() {
  seeded.effect = await seedAttempt("effect");
  seeded.collision = await seedAttempt("collision");
  const collision = seeded.collision;
  await withInternalTransaction(db, `callback-seed-${suffix}`, async (tx) => {
    const organization = await tx.query.organizations.findFirst({
      where: eq(organizations.id, organizationId),
    });
    seeded.tenantId =
      organization?.externalProvisioningId ?? "tenant-northstar-production";

    // The order's own history, occupying the version the pre-fix callback
    // would have claimed for it: the binding was `('order', orderId)` carrying
    // the ATTEMPT's next row version. A real order owns versions in that range
    // long before any provider answers.
    await tx.execute(sql`
      insert into public.audit_events (
        account_id, aggregate_type, aggregate_id, aggregate_version,
        event_type, event_version, actor, occurred_at, request_id, after
      ) values (
        ${accountId}::uuid, 'order', ${collision.orderId}::uuid,
        ${collision.attemptVersion + 1},
        'core.orders.activated', 1,
        ${sql`${JSON.stringify({ kind: "user", id: operatorId })}::jsonb`},
        '2026-08-04T01:00:00.000Z'::timestamptz,
        ${`callback-order-history-${suffix}`}, '{}'::jsonb
      )
    `);

    // A sandbox attempt on its own disposable POC. `decide_poc` writes exactly
    // this pair -- the attempt and an eager `provisioning` provider row keyed
    // on the same idempotency key -- and the producer under test here is
    // `ingest_provisioning_event`, not `decide_poc`.
    const sourcePoc = await tx.query.pocs.findFirst({
      where: eq(pocs.id, sourcePocId),
    });
    if (!sourcePoc) throw new Error("CALLBACK_SOURCE_POC_MISSING");
    seeded.sandbox.pocId = crypto.randomUUID();
    seeded.sandbox.accountId = sourcePoc.accountId;
    await tx.insert(pocs).values({
      ...sourcePoc,
      id: seeded.sandbox.pocId,
      convertedQuoteId: null,
      status: "approved",
      rowVersion: 1,
    });
    seeded.sandbox.commandId = `poc-callback-${suffix}`;
    seeded.sandbox.idempotencyKey = `callback-sandbox-${suffix}-0123456789`;
    const sandboxAttempt = {
      command: {
        commandId: seeded.sandbox.commandId,
        idempotencyKey: seeded.sandbox.idempotencyKey,
        orderId: seeded.sandbox.pocId,
        orderVersion: 1,
        organizationId: sourcePoc.organizationId,
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
      state: "in_flight",
      attempts: 1,
      nextAttemptAt: null,
      lastError: null,
      providerOperationId: null,
      confirmedAt: null,
      operatorRecovery: null,
    };
    const inserted = await tx.execute(sql`
      insert into public.lifecycle_provisioning_attempts (
        command_id, account_id, poc_id, organization_id, operation, state,
        attempt
      ) values (
        ${seeded.sandbox.commandId}, ${sourcePoc.accountId}::uuid,
        ${seeded.sandbox.pocId}::uuid, ${sourcePoc.organizationId}::uuid,
        'sandbox', 'in_flight',
        ${sql`${JSON.stringify(sandboxAttempt)}::jsonb`}
      )
      returning id::text as id
    `);
    seeded.sandbox.attemptId = (inserted[0] as { id: string }).id;
    await tx.execute(sql`
      insert into public.provider_operations (
        provider, operation, idempotency_key, aggregate_type, aggregate_id,
        status, attempt_count
      ) values (
        'provisioning', 'sandbox', ${seeded.sandbox.idempotencyKey}, 'poc',
        ${seeded.sandbox.pocId}::uuid, 'running', 1
      )
    `);
  });
}

async function cleanup() {
  const keys = [
    seeded.effect?.idempotencyKey,
    seeded.collision?.idempotencyKey,
    seeded.sandbox.idempotencyKey,
  ].filter((value): value is string => Boolean(value));
  const attemptIds = [
    seeded.effect?.attemptId,
    seeded.collision?.attemptId,
    seeded.sandbox.attemptId,
  ].filter((value): value is string => Boolean(value));
  if (attemptIds.length === 0) return;
  const attemptList = sql.join(
    attemptIds.map((value) => sql`${value}`),
    sql`, `,
  );
  const keyList = sql.join(
    keys.map((value) => sql`${value}`),
    sql`, `,
  );
  await withInternalTransaction(db, `callback-clean-${suffix}`, async (tx) => {
    await tx.execute(sql`
      delete from public.outbox_messages
      where payload->>'aggregateId' in (${attemptList})
    `);
    await tx.execute(sql`
      delete from public.provider_operations
      where idempotency_key in (${keyList})
    `);
    await tx.execute(sql`
      delete from public.lifecycle_provisioning_attempts
      where id::text in (${attemptList})
    `);
  });
}

beforeAll(seed);
afterAll(async () => {
  await cleanup();
  await client.end();
});

const effectOperationId = `operation-effect-${suffix}`;

describe.sequential("provisioning provider callback", () => {
  /**
   * The setup, and already a real one: the production dispatch store, driven in
   * the order `ProvisioningCommandDispatchHandler.execute` drives it
   * (packages/workflows/src/runtime/provider-lifecycle.ts:615-703). The handler
   * itself cannot be imported here -- `@clockwork/workflows` depends on
   * `@clockwork/db`, not the reverse -- so its sequence is transcribed and
   * every write below is the store's own.
   */
  it("claims and commits the provider-effect row the way a real dispatch does", async () => {
    const attempt = seeded.effect;
    if (!attempt) throw new Error("CALLBACK_EFFECT_SEED_MISSING");
    const target = await store.load({
      attemptId: attempt.attemptId,
      orderId: attempt.orderId,
      organizationId,
      expectedAggregateVersion: attempt.attemptVersion,
      requestId: `callback-load-1-${suffix}`,
    });
    const claim = await store.claimProviderEffect({
      target,
      requestId: `callback-claim-1-${suffix}`,
    });
    expect(claim.status).toBe("invoke");
    if (claim.status !== "invoke") throw new Error("CALLBACK_CLAIM_UNEXPECTED");

    // The provider accepts the request. Asynchronous provisioning is exactly
    // this: acceptance now, the verdict later, by callback.
    await store.checkpointProviderEffect({
      target,
      leaseToken: claim.leaseToken,
      result: { ok: true, operationId: effectOperationId },
      requestId: `callback-checkpoint-1-${suffix}`,
    });
    await store.record({
      target,
      result: { ok: true, operationId: effectOperationId },
      requestId: `callback-record-1-${suffix}`,
    });
    await store.finalizeProviderEffect({
      target,
      leaseToken: claim.leaseToken,
      operationId: effectOperationId,
      requestId: `callback-finalize-1-${suffix}`,
    });

    const rows = await effectRow(attempt.idempotencyKey);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      // The name that matters. Nothing writes `provisioning` for a `provision`
      // attempt; `claimProviderEffect` writes this one, lazily, on dispatch.
      provider: "lifecycle-provisioning",
      operation: "provision",
      status: "succeeded",
    });
    expect(JSON.parse(rows[0]?.provider_reference ?? "{}")).toMatchObject({
      phase: "committed",
      reference: effectOperationId,
    });
    expect((await attemptRow(attempt.attemptId)).state).toBe("in_flight");
  });

  /**
   * Defect (1). The callback carries the provider's verdict, and the verdict
   * has to land on the row the dispatch claimed. It did not: the update matched
   * `provider = 'provisioning'`, a name written only by the eager sandbox and
   * teardown inserts, so for every `provision` attempt it matched zero rows and
   * the effect row kept saying `succeeded`/`committed` after the provider had
   * said the opposite.
   */
  it("lands the provider's failure on the effect row the dispatch claimed", async () => {
    const attempt = seeded.effect;
    if (!attempt) throw new Error("CALLBACK_EFFECT_SEED_MISSING");
    const outcome = await repository.executeInTransaction({
      command: "ingest_provisioning_event",
      payload: {
        type: "provisioning.confirmed",
        confirmationId: `failed-${suffix}`,
        commandId: attempt.commandId,
        operationId: effectOperationId,
        status: "failed",
        tenantId: seeded.tenantId,
        resources: [],
        occurredAt: "2026-08-05T10:00:00.000Z",
      },
      context: providerContext("failed", "2026-08-05T10:00:00.000Z"),
    });
    expect(outcome).toMatchObject({
      id: attempt.attemptId,
      status: "dead_letter",
      eventType: "order.provisioning_dead_lettered",
    });

    const rows = await effectRow(attempt.idempotencyKey);
    expect(rows).toEqual([
      {
        provider: "lifecycle-provisioning",
        operation: "provision",
        status: "failed",
        last_error: "Provisioning provider reported failure",
        provider_reference: effectOperationId,
      },
    ]);
  });

  /**
   * The consequence of defect (1), and the reason this file exists.
   *
   * This is the DEAD-LETTER REDRIVE, not an operator recovery, and the
   * distinction is the whole point. `loadDeadLetterDispatch`
   * (packages/db/src/repositories/system/dead-letter-dispatch.ts) re-delivers
   * the ORIGINAL acceptance `order.provisioning_requested` message -- the bytes
   * the first dispatch ran on -- and `DatabaseProvisioningDispatchStore.load`
   * admits a `dead_letter` attempt by name, so the handler runs again with
   * nothing in between. No command clears the effect row on this path.
   *
   * With the effect row left on `succeeded`/`committed`, that redrive never
   * reaches the provider. `claimProviderEffect` hands it
   * `{status: 'succeeded'}`, the handler takes its checkpoint-recovery branch
   * (provider-lifecycle.ts:623-639) and records a SUCCESSFUL provider dispatch
   * of the operation the provider rejected: the attempt leaves `dead_letter`
   * for `in_flight`, carrying the failed operation's id with its lastError
   * cleared. That state is a trap in both directions -- `store.load` and the
   * handler both treat `in_flight` as work already underway, and
   * `recoverDeadLetter` refuses anything that is not `dead_letter` -- so the
   * order is at once un-provisioned, recorded as provisioning-in-progress, and
   * beyond every recovery the platform offers.
   *
   * An earlier draft of this test put an operator recovery in front of the
   * redispatch and PASSED against the unfixed code: `recoverProvisioning`
   * releases the same effect row, so it laundered the defect out of the way
   * before the claim could read it. The recovery is asserted separately below,
   * after this.
   */
  it("refuses a redriven dispatch instead of replaying a success the provider never gave", async () => {
    const attempt = seeded.effect;
    if (!attempt) throw new Error("CALLBACK_EFFECT_SEED_MISSING");
    const before = await attemptRow(attempt.attemptId);
    expect(before.state).toBe("dead_letter");

    const target = await store.load({
      attemptId: attempt.attemptId,
      orderId: attempt.orderId,
      organizationId,
      expectedAggregateVersion: before.row_version,
      requestId: `callback-load-2-${suffix}`,
    });
    const claim = await store.claimProviderEffect({
      target,
      requestId: `callback-claim-2-${suffix}`,
    });

    // The branch the handler takes, transcribed. Driving it rather than
    // asserting on `claim` alone is the point: the damage is what gets written
    // when the claim lies, and it has to be visible on the attempt row.
    if (claim.status === "succeeded") {
      await store.record({
        target,
        result: { ok: true, operationId: claim.operationId },
        requestId: `callback-record-2-${suffix}`,
      });
      await store.finalizeProviderEffect({
        target,
        leaseToken: claim.leaseToken,
        operationId: claim.operationId,
        requestId: `callback-finalize-2-${suffix}`,
      });
    }
    // `permanent_failure` is the handler raising
    // PROVISIONING_DISPATCH_PREVIOUSLY_FAILED before touching the provider or
    // the attempt, which is the correct answer to redriving a command the
    // provider has already refused.

    // The customer-facing assertion first: anything other than `dead_letter`
    // here is the platform recording provisioning work the provider refused.
    const after = await attemptRow(attempt.attemptId);
    expect(after.state).toBe("dead_letter");
    expect(after.confirmed_at).toBeNull();
    expect(after.last_error_code).toBe("PROVISIONING_CONFIRMATION_FAILED");

    // And the mechanism. `succeeded` means the provider was never asked.
    expect(claim.status).toBe("permanent_failure");
    if (claim.status !== "permanent_failure") return;
    expect(claim.code).toBe("Provisioning provider reported failure");
  });

  /**
   * The way back, which has to keep working. Operator recovery is the one path
   * that is allowed to release a permanently failed effect row, and it does --
   * `recoverProvisioning` moves it to `retrying` -- so the next dispatch claims
   * it and asks the provider. Asserted here so the refusal above cannot be
   * mistaken for an attempt nobody can re-issue.
   */
  it("still lets an operator recovery hand the next dispatch back to the provider", async () => {
    const attempt = seeded.effect;
    if (!attempt) throw new Error("CALLBACK_EFFECT_SEED_MISSING");
    const recovered = await repository.executeInTransaction({
      command: "recover_provisioning",
      payload: {
        commandId: attempt.commandId,
        reason: "Provider capacity restored, the command is safe to re-issue",
      },
      context: operatorContext("recover", "2026-08-05T11:00:00.000Z"),
    });
    expect(recovered.status).toBe("retry_scheduled");

    const recoveredVersion = (await attemptRow(attempt.attemptId)).row_version;
    const target = await store.load({
      attemptId: attempt.attemptId,
      orderId: attempt.orderId,
      organizationId,
      expectedAggregateVersion: recoveredVersion,
      requestId: `callback-load-3-${suffix}`,
    });
    const claim = await store.claimProviderEffect({
      target,
      requestId: `callback-claim-3-${suffix}`,
    });
    expect(claim.status).toBe("invoke");
  });

  /**
   * Defect (3), the sibling of the collision already fixed for `teardown`.
   *
   * The callback bound its audit row to `('order', orderId)` while carrying the
   * ATTEMPT's row version, so it wrote into the order's own
   * `audit_aggregate_version_unique` sequence. The seed put the order's own
   * history at that version first, which makes the pre-fix write a 23505 that
   * aborts the entire callback: the provider's verdict is not merely misfiled,
   * it is refused and lost. The two rows below coexist only because they no
   * longer share a key space.
   */
  it("keeps a failed callback out of the order's version sequence", async () => {
    const attempt = seeded.collision;
    if (!attempt) throw new Error("CALLBACK_COLLISION_SEED_MISSING");
    const outcome = await repository.executeInTransaction({
      command: "ingest_provisioning_event",
      payload: {
        type: "provisioning.confirmed",
        confirmationId: `collision-${suffix}`,
        commandId: attempt.commandId,
        operationId: `operation-collision-${suffix}`,
        status: "failed",
        tenantId: seeded.tenantId,
        resources: [],
        occurredAt: "2026-08-05T10:05:00.000Z",
      },
      context: providerContext("collision", "2026-08-05T10:05:00.000Z"),
    });
    expect(outcome.status).toBe("dead_letter");

    const events = await callbackEvents(attempt.attemptId, attempt.orderId);
    expect(events).toEqual([
      {
        aggregate_type: "provider_operation",
        aggregate_id: attempt.attemptId,
        aggregate_version: attempt.attemptVersion + 1,
        event_type: "order.provisioning_dead_lettered",
        // The account stays on the row, so `audit_events_scope` still admits
        // the tenant read the `order` binding admitted.
        account_id: accountId,
        topic: "order.provisioning_dead_lettered",
      },
    ]);

    const collided = await withInternalTransaction(
      db,
      `callback-collision-${suffix}`,
      (tx) =>
        tx.execute(sql`
          select aggregate_type, event_type
          from public.audit_events
          where aggregate_id = ${attempt.orderId}::uuid
            and aggregate_version = ${attempt.attemptVersion + 1}
        `),
    );
    expect(collided).toEqual([
      { aggregate_type: "order", event_type: "core.orders.activated" },
    ]);
  });

  /**
   * The sandbox branch, which the pre-fix code got half right: its eager
   * `provisioning` row was the one name the update did match, so the provider's
   * verdict landed -- but the audit row went to `('poc', pocId)` carrying the
   * attempt's version, the same shared key space the order branch was writing
   * into. Both halves are asserted so the working half stays working.
   */
  it("lands a failed sandbox callback on its eager row and off the POC's sequence", async () => {
    const outcome = await repository.executeInTransaction({
      command: "ingest_provisioning_event",
      payload: {
        type: "provisioning.confirmed",
        confirmationId: `sandbox-${suffix}`,
        commandId: seeded.sandbox.commandId,
        operationId: `operation-sandbox-${suffix}`,
        status: "failed",
        tenantId: "tenant-sandbox",
        resources: [],
        occurredAt: "2026-08-05T10:10:00.000Z",
      },
      context: providerContext("sandbox", "2026-08-05T10:10:00.000Z"),
    });
    expect(outcome.status).toBe("dead_letter");

    const rows = await effectRow(seeded.sandbox.idempotencyKey);
    expect(rows).toEqual([
      {
        provider: "provisioning",
        operation: "sandbox",
        status: "failed",
        last_error: "Provisioning provider reported failure",
        provider_reference: `operation-sandbox-${suffix}`,
      },
    ]);

    const events = await callbackEvents(
      seeded.sandbox.attemptId,
      seeded.sandbox.pocId,
    );
    expect(events).toEqual([
      {
        aggregate_type: "provider_operation",
        aggregate_id: seeded.sandbox.attemptId,
        aggregate_version: 2,
        event_type: "order.provisioning_dead_lettered",
        account_id: seeded.sandbox.accountId,
        topic: "order.provisioning_dead_lettered",
      },
    ]);
  });
});
