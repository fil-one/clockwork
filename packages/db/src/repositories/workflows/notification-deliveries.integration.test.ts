import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { createRuntimeDatabase } from "../../client";
import { notificationDeliveries, orders } from "../../schema";
import { withInternalTransaction } from "../../transaction";
import { DatabaseAuthoritativeLifecycleTaskStore } from "./lifecycle";

const databaseUrl =
  process.env.DIRECT_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable";
const { client, db } = createRuntimeDatabase({
  url: databaseUrl,
  maxConnections: 3,
  role: "clockwork_service",
  ssl: false,
});
const ORDER_ID = "80000000-0000-4000-8000-000000000002";
const suffix = randomUUID().slice(0, 8);
const now = new Date("2031-03-01T09:00:00.000Z");
const store = new DatabaseAuthoritativeLifecycleTaskStore(db, () => now);

async function termAlertEffect(effectKey: string) {
  const order = await withInternalTransaction(
    db,
    `alert-read-${suffix}`,
    (tx) => tx.query.orders.findFirst({ where: eq(orders.id, ORDER_ID) }),
  );
  if (!order) throw new Error("seed order expected");
  return {
    effectKey,
    taskId: "lifecycle-renewals-term-alerts-v1",
    aggregateId: order.id,
    aggregateVersion: order.rowVersion,
    loader: "order" as const,
    transition: `plan_renewal_term_alerts-${suffix}`,
    effectBoundary: "notification_provider" as const,
    persistedState: {
      ...order,
      providerInput: {
        template: "renewals.term_end.v1",
        recipients: ["renewals@example.test"],
        data: { subjectId: order.id, window: "service_end" },
      },
    },
  };
}

function deliveryFor(effectKey: string) {
  return withInternalTransaction(db, `alert-delivery-${suffix}`, (tx) =>
    tx.query.notificationDeliveries.findFirst({
      where: eq(notificationDeliveries.idempotencyKey, effectKey),
    }),
  );
}

afterAll(async () => {
  await client.end();
});

describe.sequential("notification delivery evidence", () => {
  it("records who a committed term alert reached and the message that proves it", async () => {
    const effectKey = `notification-sent-${suffix}`;
    const effect = await termAlertEffect(effectKey);
    const claim = await store.claimEffect({
      effect,
      requestId: `alert-claim-${suffix}`,
    });
    if (claim.status !== "invoke") throw new Error("effect claim expected");
    await store.checkpointEffectSuccess({
      effect,
      leaseToken: claim.leaseToken,
      reference: `msg_term_${suffix}`,
      requestId: `alert-checkpoint-${suffix}`,
    });
    await store.finalizeEffect({
      effect,
      leaseToken: claim.leaseToken,
      reference: `msg_term_${suffix}`,
      requestId: `alert-finalize-${suffix}`,
    });
    expect(await deliveryFor(effectKey)).toMatchObject({
      accountId: "10000000-0000-4000-8000-000000000004",
      channel: "email",
      alertKind: "renewal_term_window",
      subjectType: "order",
      subjectId: ORDER_ID,
      template: "renewals.term_end.v1",
      recipients: ["renewals@example.test"],
      status: "sent",
      providerMessageId: `msg_term_${suffix}`,
    });
  });

  it("records why an alert that permanently failed never reached anyone", async () => {
    const effectKey = `notification-failed-${suffix}`;
    const effect = await termAlertEffect(effectKey);
    const claim = await store.claimEffect({
      effect,
      requestId: `alert-fail-claim-${suffix}`,
    });
    if (claim.status !== "invoke") throw new Error("effect claim expected");
    await store.failEffect({
      effect,
      leaseToken: claim.leaseToken,
      failure: {
        kind: "permanent",
        code: "PROVIDER_REJECTED_RECIPIENT",
        message: "The transactional provider rejected every recipient",
      },
      requestId: `alert-fail-${suffix}`,
    });
    expect(await deliveryFor(effectKey)).toMatchObject({
      alertKind: "renewal_term_window",
      status: "failed",
      failureCode: "PROVIDER_REJECTED_RECIPIENT",
      providerMessageId: null,
      deliveredAt: null,
    });
  });
});
