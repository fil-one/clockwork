import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { createRuntimeDatabase } from "../client";
import { memberships, roleSyncEvents } from "../schema";
import { withInternalTransaction } from "../transaction";
import {
  DatabaseRoleSynchronizationSink,
  listUnresolvedRoleSynchronizations,
} from "./webhooks";

const databaseUrl =
  process.env.DIRECT_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable";
const requestPrefix = `integration:workos-role-sync:${crypto.randomUUID()}`;

/** Seeded in supabase/seed.sql: Dana Direct owns Northstar Production. */
const northstar = "org_local_northstar";
const redwood = "org_local_redwood";
const dana = "local_direct_owner";
const danaMembership = "31000000-0000-4000-8000-000000000001";

const { client, db } = createRuntimeDatabase({
  url: databaseUrl,
  maxConnections: 2,
  role: "clockwork_service",
  ssl: false,
});
const sink = new DatabaseRoleSynchronizationSink(db);
const raisedEventIds: string[] = [];

function event(overrides: {
  eventId: string;
  action?: "upsert" | "delete";
  workosOrganizationId?: string;
  roleSlugs?: readonly string[];
  membershipStatus?: string;
  occurredAt: string;
}) {
  raisedEventIds.push(overrides.eventId);
  return {
    eventId: overrides.eventId,
    action: overrides.action ?? ("upsert" as const),
    workosMembershipId: `om_${overrides.eventId}`,
    workosOrganizationId: overrides.workosOrganizationId ?? northstar,
    workosUserId: dana,
    roleSlugs: overrides.roleSlugs ?? ["member"],
    ...(overrides.membershipStatus
      ? { membershipStatus: overrides.membershipStatus }
      : {}),
    occurredAt: overrides.occurredAt,
  };
}

function readMembership() {
  return withInternalTransaction(db, `${requestPrefix}:read`, (tx) =>
    tx.query.memberships.findFirst({
      where: eq(memberships.id, danaMembership),
    }),
  );
}

function readEvent(eventId: string) {
  return withInternalTransaction(db, `${requestPrefix}:read-event`, (tx) =>
    tx.query.roleSyncEvents.findFirst({
      where: eq(roleSyncEvents.workosEventId, eventId),
    }),
  );
}

afterAll(async () => {
  await withInternalTransaction(db, `${requestPrefix}:restore`, async (tx) => {
    if (raisedEventIds.length > 0)
      await tx
        .delete(roleSyncEvents)
        .where(inArray(roleSyncEvents.workosEventId, raisedEventIds));
    await tx
      .update(memberships)
      .set({ role: "owner", workosMembershipId: null })
      .where(eq(memberships.id, danaMembership));
  });
  await client.end({ timeout: 5 });
});

/**
 * ADR 0004 (Accepted, 2026-07-31), stated twice: "WorkOS role webhooks
 * synchronize identifiers into commerce; they do not grant access without a
 * matching commerce membership", and "WorkOS role slugs never grant commerce
 * roles: membership webhooks link or revoke identity records, while commerce
 * approval remains authoritative."
 *
 * `resolveWorkosIdentity` (./identity.ts) reads `memberships.role` straight
 * into the session identity, so applying a WorkOS slug here would hand a
 * WorkOS-side actor the commerce role with none of the checks
 * `evaluateMembershipPolicy` makes. The webhook links identifiers only.
 */
describe("WorkOS membership synchronization keeps commerce roles authoritative", () => {
  it("links the membership identifier without touching the role", async () => {
    const before = await readMembership();
    expect(before?.role).toBe("owner");

    await sink.apply(
      event({
        eventId: "evt_role_demotion_1",
        roleSlugs: ["member"],
        membershipStatus: "active",
        occurredAt: "2026-08-01T10:00:00.000Z",
      }),
    );

    const after = await readMembership();
    expect(after?.role).toBe("owner");
    expect(after?.workosMembershipId).toBe("om_evt_role_demotion_1");
    const recorded = await readEvent("evt_role_demotion_1");
    expect(recorded?.processedAt).not.toBeNull();
    expect(recorded?.error).toBeNull();
  });

  it("ignores a privileged slug the identity provider tries to grant", async () => {
    await sink.apply(
      event({
        eventId: "evt_role_escalation_1",
        roleSlugs: ["internal_operator"],
        membershipStatus: "active",
        occurredAt: "2026-08-01T11:00:00.000Z",
      }),
    );
    const after = await readMembership();
    expect(after?.role).toBe("owner");
    expect(after?.workosMembershipId).toBe("om_evt_role_escalation_1");
  });

  it("revokes an inactive membership by deleting the row, not by rewriting the role", async () => {
    // Restored by afterAll; asserted here because deletion, not demotion, is
    // the only revocation the webhook is allowed to perform.
    await sink.apply(
      event({
        eventId: "evt_role_revoked_1",
        membershipStatus: "inactive",
        occurredAt: "2026-08-01T12:00:00.000Z",
      }),
    );
    expect(await readMembership()).toBeUndefined();

    await withInternalTransaction(db, `${requestPrefix}:reinstate`, (tx) =>
      tx.insert(memberships).values({
        id: danaMembership,
        organizationId: "30000000-0000-4000-8000-000000000001",
        userId: "20000000-0000-4000-8000-000000000002",
        role: "owner",
      }),
    );
  });
});

describe("WorkOS role synchronization reasons reach an operator", () => {
  it("acknowledges a superseded event and records the reason", async () => {
    await sink.apply(
      event({
        eventId: "evt_role_stale_1",
        roleSlugs: ["owner"],
        membershipStatus: "active",
        occurredAt: "2026-07-01T09:00:00.000Z",
      }),
    );
    const recorded = await readEvent("evt_role_stale_1");
    expect(recorded?.processedAt).not.toBeNull();
    expect(recorded?.error).toBe("STALE_WORKOS_EVENT_IGNORED");
  });

  it("acknowledges an event with no commerce membership and records the reason", async () => {
    // Dana is a linked identity and Redwood is a linked organization, but no
    // commerce membership joins them. ADR 0004 makes that the expected
    // ordering, so the delivery is acknowledged rather than retried forever.
    await sink.apply(
      event({
        eventId: "evt_role_awaiting_1",
        workosOrganizationId: redwood,
        roleSlugs: ["member"],
        membershipStatus: "active",
        occurredAt: "2026-08-01T15:00:00.000Z",
      }),
    );

    const recorded = await readEvent("evt_role_awaiting_1");
    expect(recorded?.processedAt).not.toBeNull();
    expect(recorded?.error).toBe("AWAITING_COMMERCE_MEMBERSHIP_APPROVAL");
  });

  /**
   * The reason column was written by `apply` and read by nothing in the tree,
   * which made an unapproved WorkOS membership durable and invisible at once.
   * This is the read path that closes that half of the finding.
   */
  it("surfaces both recorded reasons through the operator read", async () => {
    const unresolved = await listUnresolvedRoleSynchronizations(db, {
      requestId: `${requestPrefix}:unresolved`,
    });
    const byEvent = new Map(
      unresolved.map((row) => [row.workosEventId, row.reason]),
    );
    expect(byEvent.get("evt_role_awaiting_1")).toBe(
      "AWAITING_COMMERCE_MEMBERSHIP_APPROVAL",
    );
    expect(byEvent.get("evt_role_stale_1")).toBe("STALE_WORKOS_EVENT_IGNORED");
    // Events that were applied cleanly carry no reason and stay out of the read.
    expect(byEvent.has("evt_role_demotion_1")).toBe(false);
  });

  it("honours the limit so an operator page cannot be flooded", async () => {
    const page = await listUnresolvedRoleSynchronizations(db, {
      requestId: `${requestPrefix}:unresolved-page`,
      limit: 1,
    });
    expect(page).toHaveLength(1);
  });
});
