import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ids,
  type IdempotencyKey,
  type ProvisioningPort,
} from "@clockwork/contracts";
import {
  coreSnapshotHash,
  createAcceptedOrderProvisioningAttempt,
  createRuntimeDatabase,
  DatabaseLifecycleCommandRepository,
  DatabaseProvisioningDispatchStore,
  DatabaseWorkflowRunStore,
  loadDeadLetterDispatch,
  withInternalTransaction,
} from "@clockwork/db";
import { orders, quotes } from "@clockwork/db/schema";
import {
  createAuthoritativeLifecycleHandlers,
  DatabaseLifecycleTaskRuntime,
  type AuthoritativeLifecycleTaskStore,
  type LifecycleEffectExecutor,
  type LifecycleTaskInvocation,
} from "@clockwork/workflows";
import { payloadHash } from "@clockwork/workflows/core";
import {
  createLifecycleTaskOutboxHandlers,
  type LifecycleTaskSubmissionPort,
} from "@clockwork/workflows/system";

/**
 * The operator recovery verb end to end: command -> outbox row -> the
 * production outbox handler -> the production task runtime -> the provider.
 *
 * It lives here rather than beside the command because `@clockwork/workflows`
 * depends on `@clockwork/db`; the consumer contract cannot be exercised from
 * inside the package that emits for it. The producer-side assertions are in
 * packages/db/src/repositories/lifecycle/provisioning-recovery.integration.test.ts.
 *
 * Nothing about the dispatch is hand-built. The attempt comes from the
 * acceptance emitter, the recovery message from the real command, the
 * invocation from `createLifecycleTaskOutboxHandlers`, and the claim and
 * execution from `DatabaseLifecycleTaskRuntime` over the real dispatch store.
 * Only the provider itself is a double, because there is no provider.
 */

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

const suffix = crypto.randomUUID().slice(0, 8);
const accountId = "10000000-0000-4000-8000-000000000001";
const sourceOrderId = "80000000-0000-4000-8000-000000000001";
const orderLineId = "81000000-0000-4000-8000-000000000001";
const operatorId = "20000000-0000-4000-8000-000000000001";

/**
 * `apps/web` does not depend on `@clockwork/domain`, so the queue roster is
 * supplied as a routing port instead of a policy table. Neither is reachable
 * from `recover_provisioning`; the port exists only to satisfy construction.
 */
const repository = new DatabaseLifecycleCommandRepository({
  database: db,
  serviceDatabase: db,
  authorizationSecret,
  exceptionRouting: {
    resolve: () => Promise.reject(new Error("EXCEPTION_ROUTING_NOT_EXPECTED")),
  },
  policies: {
    clickThroughThresholdMinor: "1000000",
    migrationFeatureEnabled: false,
    automatedTeardownEnabled: false,
    exceptionQueues: [],
  },
});

const lineSnapshot = {
  id: orderLineId,
  sku: "LOCKED-STORAGE-TB",
  region: "us-central",
  quantity: "1",
};

const seeded = {
  orderId: "",
  attemptId: "",
  commandId: "",
  idempotencyKey: "",
};

const provisionCalls: { idempotencyKey: string; orderId: string }[] = [];
const provider: ProvisioningPort = {
  provision: (input) => {
    provisionCalls.push({
      idempotencyKey: input.idempotencyKey,
      orderId: input.orderId,
    });
    return Promise.resolve({
      ok: true,
      value: { operationId: `provider-op-${suffix}` },
    });
  },
  teardown: () =>
    Promise.reject(new Error("TEARDOWN_NOT_EXPECTED_IN_THIS_SUITE")),
};

/** The generic handlers are never reached for this task id. */
const unusedTaskStore = new Proxy({} as AuthoritativeLifecycleTaskStore, {
  get: () => () => {
    throw new Error("AUTHORITATIVE_TASK_STORE_NOT_EXPECTED");
  },
});

const effects: LifecycleEffectExecutor = {
  authorize: () => Promise.resolve(),
  execute: () =>
    Promise.reject(new Error("EFFECT_EXECUTOR_NOT_EXPECTED_IN_THIS_SUITE")),
};

const handlers = createAuthoritativeLifecycleHandlers({
  store: unusedTaskStore,
  effects,
  provisioning: {
    store: new DatabaseProvisioningDispatchStore(db),
    provider,
  },
});
const runtime = new DatabaseLifecycleTaskRuntime(
  new DatabaseWorkflowRunStore(db),
  handlers,
);

function operatorContext(requestId: string, idempotencyKey: string) {
  const authorization = {
    userId: ids.user.parse(operatorId),
    accountIds: [ids.account.parse(accountId)],
    roles: ["owner" as const],
    isInternalStaff: true,
    mfaVerified: true,
    recentAuthenticationVerified: true,
  };
  return {
    requestId,
    actor: { kind: "user" as const, id: operatorId },
    idempotencyKey,
    ip: "192.0.2.13",
    userAgent: "Clockwork recovery dispatch integration",
    occurredAt: new Date().toISOString(),
    authorization,
  };
}

async function seed() {
  await withInternalTransaction(db, `dispatch-seed-${suffix}`, async (tx) => {
    const sourceOrder = await tx.query.orders.findFirst({
      where: eq(orders.id, sourceOrderId),
    });
    if (!sourceOrder) throw new Error("DISPATCH_SOURCE_ORDER_MISSING");
    const sourceQuote = await tx.query.quotes.findFirst({
      where: eq(quotes.id, sourceOrder.quoteId),
    });
    if (!sourceQuote) throw new Error("DISPATCH_SOURCE_QUOTE_MISSING");
    const quoteId = crypto.randomUUID();
    seeded.orderId = crypto.randomUUID();
    await tx.insert(quotes).values({
      ...sourceQuote,
      id: quoteId,
      seriesId: crypto.randomUUID(),
      previousRevisionId: null,
      rowVersion: 1,
    });
    await tx.insert(orders).values({
      ...sourceOrder,
      id: seeded.orderId,
      quoteId,
      rowVersion: 1,
    });

    await tx.execute(sql`
      insert into public.core_order_acceptance_reservations (
        order_id, buyer_account_id, billing_account_id, currency, amount_minor,
        decision, reason
      ) values (
        ${seeded.orderId}::uuid, ${accountId}::uuid, ${accountId}::uuid, 'USD',
        180000, 'approved', 'Recovery dispatch fixture'
      )
    `);

    const created = await createAcceptedOrderProvisioningAttempt(tx, {
      orderId: seeded.orderId,
      orderVersion: 4,
      accountId,
      provisioningIdempotencyKey: `recovery-e2e-${suffix}`,
      requestedAt: new Date("2026-08-04T00:30:00.000Z"),
      actor: { kind: "user", id: operatorId },
      requestId: `dispatch-seed-${suffix}`,
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

    await tx.execute(sql`
      update public.lifecycle_provisioning_attempts
      set state = 'dead_letter',
          attempt = attempt || '{"state":"dead_letter","attempts":5}'::jsonb
      where id = ${seeded.attemptId}::uuid
    `);
    // The effect row as a permanent provider failure leaves it.
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
  });
}

async function cleanup() {
  if (!seeded.attemptId) return;
  await withInternalTransaction(db, `dispatch-clean-${suffix}`, async (tx) => {
    await tx.execute(sql`
      delete from public.workflow_runs
      where aggregate_id = ${seeded.attemptId}::uuid
    `);
    await tx.execute(sql`
      delete from public.outbox_messages
      where payload->>'aggregateId' = ${seeded.attemptId}
    `);
    await tx.execute(sql`
      delete from public.provider_operations
      where idempotency_key = ${seeded.idempotencyKey}
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

describe.sequential(
  "operator provisioning recovery reaches the provider",
  () => {
    it("enqueues a run that claims and executes", async () => {
      const recoveryRequestId = `recovery-e2e-${suffix}`;
      const outcome = await repository.executeInTransaction({
        command: "recover_provisioning",
        payload: {
          commandId: seeded.commandId,
          reason: "Provider capacity restored, the command is safe to re-issue",
        },
        context: operatorContext(recoveryRequestId, `recover-e2e-${suffix}`),
      });
      expect(outcome).toMatchObject({
        eventType: "order.provisioning_requested",
      });

      // The message THIS command committed, found by its request id so the
      // acceptance dispatch behind the same attempt cannot stand in for it, and
      // read back from the row rather than reconstructed.
      const messages = await withInternalTransaction(
        db,
        `dispatch-read-${suffix}`,
        (tx) =>
          tx.execute(sql`
          select message.id::text as id, message.topic, message.payload
          from public.outbox_messages message
          join public.audit_events event on event.id = message.event_id
          where event.request_id = ${recoveryRequestId}
        `),
      );
      expect(messages).toHaveLength(1);
      const message = messages[0] as {
        id: string;
        topic: string;
        payload: unknown;
      };
      expect(message.topic).toBe("order.provisioning_requested");

      // The production outbox handler builds the invocation. It parses the
      // envelope and picks the task from `lifecycleOutboxTaskMap`.
      const submitted: LifecycleTaskInvocation[] = [];
      const submission: LifecycleTaskSubmissionPort = {
        submit: (invocation) => {
          submitted.push(invocation);
          return Promise.resolve(undefined);
        },
      };
      const handler = createLifecycleTaskOutboxHandlers(submission).get(
        "order.provisioning_requested",
      );
      if (!handler) throw new Error("OUTBOX_HANDLER_NOT_CONFIGURED");
      await handler({
        messageId: message.id,
        eventId: message.id,
        topic: message.topic,
        payload: message.payload,
        idempotencyKey: `outbox:${message.id}`,
      });
      const invocation = submitted[0];
      if (!invocation) throw new Error("NO_INVOCATION_SUBMITTED");
      expect(invocation.taskId).toBe(
        "lifecycle-provisioning-command-dispatch-v1",
      );

      // The claim parses `ProvisioningRequestedEventSchema`. Before the fix this
      // is where the recovered run died. A fresh outbox id means a fresh
      // invocation key, so the claim is `acquired`, not a payload conflict
      // against the original dispatch's run.
      const claim = await runtime.claim({
        ...invocation,
        idempotencyKey: `outbox:${message.id}` as IdempotencyKey,
      });
      expect(claim).toMatchObject({ status: "claimed" });

      // And it runs: the real dispatch store loads the attempt, reclaims the
      // provider-effect row recovery released, and calls the provider.
      const executed = await runtime.execute({
        ...invocation,
        idempotencyKey: `outbox:${message.id}` as IdempotencyKey,
      });
      expect(executed).toEqual({
        operationId: `provider-op-${suffix}`,
        duplicate: false,
      });
      expect(provisionCalls).toEqual([
        { idempotencyKey: seeded.idempotencyKey, orderId: seeded.orderId },
      ]);

      // The interaction with the dead-letter dispatch read, stated rather than
      // left to be discovered. That query takes the most recent
      // `order.provisioning_requested` audit row carrying a command for the
      // attempt. Before the fix the recovery event carried no command and was
      // excluded on purpose, because picking it would have handed a redrive
      // bytes that hash differently. Now it carries the command and is the
      // newest real dispatch for the attempt, so it is what a subsequent
      // redrive rebuilds -- which is right: it is the dispatch that last ran,
      // and its own `outbox:<id>` is the run holding those bytes.
      const dispatch = await loadDeadLetterDispatch(db, {
        source: "provisioning_attempt",
        id: seeded.attemptId,
        requestId: `dispatch-lookup-${suffix}`,
      });
      expect(dispatch).toMatchObject({
        outboxMessageId: message.id,
        topic: "order.provisioning_requested",
      });
      expect(payloadHash(dispatch?.payload)).toBe(payloadHash(message.payload));
    });
  },
);
