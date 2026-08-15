import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import type { Role } from "@clockwork/contracts";
import type { AuthorizationContext } from "@clockwork/domain";
import { afterAll, describe, expect, it } from "vitest";

import { createRuntimeDatabase } from "../../client";
import { notificationPreferences } from "../../schema";
import { accountContacts } from "../../schema/core/finance";
import { withInternalTransaction } from "../../transaction";
import { DatabaseAuthoritativeLifecycleTaskStore } from "../workflows/lifecycle";
import {
  DatabaseNotificationPreferenceRepository,
  NotificationPreferenceError,
} from "./notification-preferences";

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
const ACCOUNT_ID = "10000000-0000-4000-8000-000000000004";
const ORDER_ID = "80000000-0000-4000-8000-000000000007";
const USER_ID = "20000000-0000-4000-8000-000000000002";
const CONTACT_EMAIL = `renewals-${suffix}@juniper.test`;
// Every alert boundary on the seeded order is in the past at this instant, so
// the planner has a reason to emit an effect and the preference is the only
// thing that can stop it.
const now = new Date("2031-09-01T09:00:00.000Z");
const preferences = new DatabaseNotificationPreferenceRepository({
  database: db,
  authorizationSecret:
    process.env.AUTHORIZATION_CONTEXT_SECRET ??
    "clockwork-local-auth-context-secret-change-me",
});
const tasks = new DatabaseAuthoritativeLifecycleTaskStore(db, () => now);

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

function plan(taskId: string, transition: string) {
  return tasks.prepare({
    spec: {
      taskId,
      loader: "order",
      transition: `${transition}-${suffix}`,
      effectBoundary: "notification_provider",
    },
    aggregateId: ORDER_ID,
    expectedAggregateVersion: 1,
    scheduled: true,
    requestId: `preference-plan-${randomUUID()}`,
  });
}

async function setEnabled(alertKind: string, enabled: boolean) {
  return preferences.set({
    accountId: ACCOUNT_ID,
    alertKind,
    channel: "email",
    enabled,
    authorization: authorization([ACCOUNT_ID]),
    requestId: `preference-set-${randomUUID()}`,
  });
}

afterAll(async () => {
  await withInternalTransaction(
    db,
    `preference-cleanup-${suffix}`,
    async (tx) => {
      await tx
        .delete(notificationPreferences)
        .where(eq(notificationPreferences.accountId, ACCOUNT_ID));
      await tx
        .delete(accountContacts)
        .where(
          and(
            eq(accountContacts.accountId, ACCOUNT_ID),
            eq(accountContacts.email, CONTACT_EMAIL),
          ),
        );
    },
  );
  await client.end();
});

/**
 * P0-46 listed per-account preferences as P2 "once P0-46 gives deliveries a
 * record to reference". A preferences table the alert planner never reads would
 * be a setting that does nothing, so the suppression case below is the one that
 * makes the surface real.
 */
describe.sequential("notification preferences", () => {
  it("stores and reads back an account's own settings", async () => {
    const stored = await setEnabled("quote_expiry", false);
    expect(stored).toMatchObject({
      accountId: ACCOUNT_ID,
      alertKind: "quote_expiry",
      channel: "email",
      enabled: false,
    });
    const page = await preferences.list({
      accountId: ACCOUNT_ID,
      authorization: authorization([ACCOUNT_ID]),
      requestId: `preference-list-${suffix}`,
    });
    expect(page.items).toContainEqual(
      expect.objectContaining({ alertKind: "quote_expiry", enabled: false }),
    );
  });

  // The complete refused set is the two notices the platform owes regardless of
  // preference. Nothing advisory is in it: the three kinds the constraint does
  // accept are exercised by `supabase/tests/1400_notification_preferences.test.sql`.
  it.each(["renewal_notice_window", "collections_dunning"])(
    "refuses to switch off %s",
    async (alertKind) => {
      await expect(setEnabled(alertKind, false)).rejects.toBeInstanceOf(
        NotificationPreferenceError,
      );
    },
  );

  it("stops the planner emitting an advisory alert the account switched off", async () => {
    await withInternalTransaction(db, `preference-contact-${suffix}`, (tx) =>
      tx
        .insert(accountContacts)
        .values({
          accountId: ACCOUNT_ID,
          kind: "commercial",
          name: "Renewals Contact",
          email: CONTACT_EMAIL,
        })
        .onConflictDoNothing(),
    );
    await setEnabled("renewal_term_window", true);
    const planned = await plan(
      "lifecycle-renewals-term-alerts-v1",
      "plan_renewal_term_alerts",
    );
    expect(planned.length).toBeGreaterThan(0);

    await setEnabled("renewal_term_window", false);
    const suppressed = await plan(
      "lifecycle-renewals-term-alerts-v1",
      "plan_renewal_term_alerts_off",
    );
    expect(suppressed).toEqual([]);
  });

  it("still emits the contractual notice window for the same account", async () => {
    const planned = await plan(
      "lifecycle-renewals-notice-windows-v1",
      "plan_renewal_notice_windows",
    );
    expect(planned.length).toBeGreaterThan(0);
  });
});
