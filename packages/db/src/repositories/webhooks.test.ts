import { describe, expect, it } from "vitest";

import type { RuntimeDatabase } from "../client";
import { memberships, roleSyncEvents } from "../schema";
import {
  DatabaseRoleSynchronizationSink,
  roleSynchronizationReasons,
  sanitizeWebhookProcessingError,
} from "./webhooks";

describe("webhook processing error persistence", () => {
  it("does not persist provider messages containing secrets or PII", () => {
    const unsafe =
      "Authorization: Bearer live-secret; customer jane@example.test failed";
    const sanitized = sanitizeWebhookProcessingError(unsafe);
    expect(sanitized).toBe("WEBHOOK_PROCESSING_FAILED");
    expect(sanitized).not.toContain("live-secret");
    expect(sanitized).not.toContain("jane@example.test");
  });
});

interface RecordedUpdate {
  table: unknown;
  values: Record<string, unknown>;
}

/**
 * A transaction double that records every write instead of issuing it. Enough
 * of the Drizzle builder surface for `DatabaseRoleSynchronizationSink.apply`;
 * the point is the recorded `.set()` payloads, not the SQL.
 */
function fakeServiceDatabase(seed: {
  organization?: { id: string };
  user?: { id: string };
  membership?: { id: string; role: string };
  latestProcessedAt?: Date;
}) {
  const updates: RecordedUpdate[] = [];
  const deletes: unknown[] = [];
  const chain = <T>(result: T) => ({
    where: () => Promise.resolve(result),
    onConflictDoNothing: () => Promise.resolve(result),
  });
  const transaction = {
    execute: () => Promise.resolve(undefined),
    query: {
      roleSyncEvents: {
        // `orderBy` is only passed on the "latest processed event" lookup.
        findFirst: (input: { where?: unknown; orderBy?: unknown }) =>
          Promise.resolve(
            input.orderBy && seed.latestProcessedAt
              ? {
                  providerOccurredAt: seed.latestProcessedAt,
                  processedAt: seed.latestProcessedAt,
                }
              : undefined,
          ),
      },
      organizations: { findFirst: () => Promise.resolve(seed.organization) },
      commerceUsers: { findFirst: () => Promise.resolve(seed.user) },
      memberships: { findFirst: () => Promise.resolve(seed.membership) },
    },
    insert: () => ({ values: () => chain(undefined) }),
    delete: (table: unknown) => {
      deletes.push(table);
      return chain(undefined);
    },
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => {
        updates.push({ table, values });
        return chain(undefined);
      },
    }),
  };
  const db = {
    transaction: (operation: (tx: unknown) => Promise<unknown>) =>
      operation(transaction),
  } as unknown as RuntimeDatabase;
  return { db, updates, deletes };
}

const activeUpsert = {
  eventId: "evt_role_change",
  action: "upsert" as const,
  workosMembershipId: "om_workos_1",
  workosOrganizationId: "org_workos_1",
  workosUserId: "user_workos_1",
  membershipStatus: "active",
  occurredAt: "2026-08-01T10:00:00.000Z",
};

/**
 * ADR 0004 (Accepted): "WorkOS role slugs never grant commerce roles:
 * membership webhooks link or revoke identity records, while commerce approval
 * remains authoritative", and "WorkOS role webhooks synchronize identifiers
 * into commerce; they do not grant access without a matching commerce
 * membership."
 *
 * This is not a latent bug waiting to be fixed. `resolveWorkosIdentity` selects
 * `memberships.role` straight into the session identity, so writing a WorkOS
 * slug here would let a WorkOS-side actor set the commerce role with no
 * `commerceRoleApproved` check, no staff allow-list and no MFA policy check --
 * every refusal `evaluateMembershipPolicy` exists to make would be bypassed.
 * These tests fail the moment a role write is reintroduced.
 */
describe("WorkOS membership webhooks never write memberships.role", () => {
  it("records the membership identifier and nothing else on a role-change event", async () => {
    const { db, updates } = fakeServiceDatabase({
      organization: { id: "org-1" },
      user: { id: "user-1" },
      membership: { id: "membership-1", role: "owner" },
    });

    await new DatabaseRoleSynchronizationSink(db).apply({
      ...activeUpsert,
      roleSlugs: ["member"],
    });

    const membershipUpdates = updates.filter(
      (update) => update.table === memberships,
    );
    expect(membershipUpdates).toHaveLength(1);
    expect(Object.keys(membershipUpdates[0]?.values ?? {}).sort()).toEqual([
      "updatedAt",
      "workosMembershipId",
    ]);
    expect(membershipUpdates[0]?.values).not.toHaveProperty("role");
    expect(membershipUpdates[0]?.values.workosMembershipId).toBe("om_workos_1");
  });

  it("ignores every slug spelling, including a privileged one", async () => {
    for (const roleSlugs of [
      ["owner"],
      ["Internal-Operator"],
      ["finance_approver", "admin"],
      ["superuser"],
      [],
    ]) {
      const { db, updates } = fakeServiceDatabase({
        organization: { id: "org-1" },
        user: { id: "user-1" },
        membership: { id: "membership-1", role: "member" },
      });
      await new DatabaseRoleSynchronizationSink(db).apply({
        ...activeUpsert,
        roleSlugs,
      });
      for (const update of updates.filter(({ table }) => table === memberships))
        expect(update.values).not.toHaveProperty("role");
    }
  });

  it("revokes by deleting the membership rather than by downgrading its role", async () => {
    const { db, updates, deletes } = fakeServiceDatabase({
      organization: { id: "org-1" },
      user: { id: "user-1" },
      membership: { id: "membership-1", role: "owner" },
    });

    await new DatabaseRoleSynchronizationSink(db).apply({
      ...activeUpsert,
      action: "delete",
      roleSlugs: ["member"],
    });

    expect(deletes).toEqual([memberships]);
    expect(updates.filter(({ table }) => table === memberships)).toEqual([]);
  });
});

describe("WorkOS role synchronization outcomes", () => {
  /**
   * The complete set of reasons the sink records, and what each does to the
   * event row. Neither is raised: both are terminal for the delivery, so the
   * event is acknowledged and the reason is left for
   * `listUnresolvedRoleSynchronizations` to read.
   */
  it("acknowledges an event with no commerce membership and records why", async () => {
    const { db, updates } = fakeServiceDatabase({
      organization: { id: "org-1" },
      user: { id: "user-1" },
    });

    await expect(
      new DatabaseRoleSynchronizationSink(db).apply({
        ...activeUpsert,
        roleSlugs: ["member"],
      }),
    ).resolves.toBeUndefined();

    const eventUpdate = updates.find(({ table }) => table === roleSyncEvents);
    expect(eventUpdate?.values.error).toBe(
      "AWAITING_COMMERCE_MEMBERSHIP_APPROVAL",
    );
    expect(eventUpdate?.values.processedAt).toBeInstanceOf(Date);
    expect(updates.filter(({ table }) => table === memberships)).toEqual([]);
  });

  it("acknowledges a superseded event and records why", async () => {
    const { db, updates } = fakeServiceDatabase({
      organization: { id: "org-1" },
      user: { id: "user-1" },
      membership: { id: "membership-1", role: "member" },
      latestProcessedAt: new Date("2026-08-02T10:00:00.000Z"),
    });

    await new DatabaseRoleSynchronizationSink(db).apply({
      ...activeUpsert,
      roleSlugs: ["owner"],
    });

    const eventUpdate = updates.find(({ table }) => table === roleSyncEvents);
    expect(eventUpdate?.values.error).toBe("STALE_WORKOS_EVENT_IGNORED");
    expect(eventUpdate?.values.processedAt).toBeInstanceOf(Date);
    expect(updates.filter(({ table }) => table === memberships)).toEqual([]);
  });

  it("clears the reason when the identifier is linked", async () => {
    const { db, updates } = fakeServiceDatabase({
      organization: { id: "org-1" },
      user: { id: "user-1" },
      membership: { id: "membership-1", role: "member" },
    });

    await new DatabaseRoleSynchronizationSink(db).apply({
      ...activeUpsert,
      roleSlugs: ["member"],
    });

    expect(
      updates.find(({ table }) => table === roleSyncEvents)?.values.error,
    ).toBeNull();
  });

  it("states the reason vocabulary in one place", () => {
    expect([...roleSynchronizationReasons]).toEqual([
      "STALE_WORKOS_EVENT_IGNORED",
      "AWAITING_COMMERCE_MEMBERSHIP_APPROVAL",
    ]);
  });
});
