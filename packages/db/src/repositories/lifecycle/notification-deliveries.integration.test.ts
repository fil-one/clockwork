import { randomUUID } from "node:crypto";

import type { Role } from "@clockwork/contracts";
import type { AuthorizationContext } from "@clockwork/domain";
import { afterAll, describe, expect, it } from "vitest";

import { createRuntimeDatabase } from "../../client";
import { notificationDeliveries } from "../../schema";
import { withInternalTransaction } from "../../transaction";
import { DatabaseNotificationDeliveryRepository } from "./notification-deliveries";

const databaseUrl =
  process.env.DIRECT_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable";
const { client, db } = createRuntimeDatabase({
  url: databaseUrl,
  maxConnections: 3,
  role: "clockwork_service",
  ssl: false,
});
const suffix = randomUUID().slice(0, 8);
const ACCOUNT_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_ACCOUNT_ID = "10000000-0000-4000-8000-000000000004";
const USER_ID = "20000000-0000-4000-8000-000000000002";
const repository = new DatabaseNotificationDeliveryRepository({
  database: db,
  authorizationSecret:
    process.env.AUTHORIZATION_CONTEXT_SECRET ??
    "clockwork-local-auth-context-secret-change-me",
});

function authorization(accountIds: readonly string[]): AuthorizationContext {
  return {
    userId: USER_ID,
    accountIds,
    roles: ["owner"] as readonly Role[],
    isInternalStaff: false,
    mfaVerified: true,
    recentAuthenticationVerified: true,
  } as AuthorizationContext;
}

async function seedDelivery(index: number): Promise<void> {
  await withInternalTransaction(db, `delivery-seed-${suffix}`, (tx) =>
    tx.insert(notificationDeliveries).values({
      accountId: ACCOUNT_ID,
      channel: "email",
      alertKind: "renewal_notice_window",
      subjectType: "order",
      subjectId: randomUUID(),
      template: "renewals.notice_window.v1",
      recipients: ["renewals@northstar.test"],
      idempotencyKey: `delivery-read-${suffix}-${index}`,
      status: "sent",
      providerMessageId: `msg_${suffix}_${index}`,
      requestedAt: new Date("2031-04-01T09:00:00.000Z"),
      deliveredAt: new Date("2031-04-01T09:00:01.000Z"),
    }),
  );
}

afterAll(async () => {
  await client.end();
});

// P0-46 residue: the rows existed from 001330 and nothing could read them.
describe.sequential("notification delivery reads", () => {
  it("pages an account's own delivery evidence newest first", async () => {
    await seedDelivery(1);
    await seedDelivery(2);
    const first = await repository.list({
      accountId: ACCOUNT_ID,
      limit: 1,
      authorization: authorization([ACCOUNT_ID]),
      requestId: `delivery-page-a-${suffix}`,
    });
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();
    const second = await repository.list({
      accountId: ACCOUNT_ID,
      limit: 1,
      ...(first.nextCursor ? { cursor: first.nextCursor } : {}),
      authorization: authorization([ACCOUNT_ID]),
      requestId: `delivery-page-b-${suffix}`,
    });
    // UUIDv7 sorts in insertion order, so newest-first means the later row
    // leads and the cursor page carries the earlier one.
    expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
    expect((first.items[0]?.id ?? "") > (second.items[0]?.id ?? "")).toBe(true);
    expect(first.items[0]).toMatchObject({
      accountId: ACCOUNT_ID,
      alertKind: "renewal_notice_window",
      status: "sent",
    });
  });

  it("filters to one alert kind without widening the account scope", async () => {
    await seedDelivery(3);
    const page = await repository.list({
      accountId: ACCOUNT_ID,
      alertKind: "poc_milestone",
      limit: 50,
      authorization: authorization([ACCOUNT_ID]),
      requestId: `delivery-filter-${suffix}`,
    });
    expect(page.items).toEqual([]);
  });

  // The account boundary is `notification_delivery_read`, not a predicate this
  // repository could forget: a caller holding another account sees nothing even
  // though it asked for this one by id.
  it("returns nothing to a caller that does not hold the account", async () => {
    await seedDelivery(4);
    const page = await repository.list({
      accountId: ACCOUNT_ID,
      limit: 50,
      authorization: authorization([OTHER_ACCOUNT_ID]),
      requestId: `delivery-denied-${suffix}`,
    });
    expect(page.items).toEqual([]);
  });
});
