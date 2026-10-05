import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";

import { createRuntimeDatabase } from "../../client";
import {
  accounts,
  commerceUsers,
  memberships,
  organizations,
} from "../../schema";
import { withInternalTransaction } from "../../transaction";
import {
  assertAnotherStaffAdmin,
  lockStaffOrganization,
  StaffTeamRepository,
} from "./staff-team";

const url =
  process.env.DIRECT_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const { db, client } = createRuntimeDatabase({
  url,
  role: "clockwork_service",
  ssl: false,
});

// A staff organization of its own, committed, so two transactions can race
// on it the way two administrators' browsers would.
const accountId = randomUUID();
const organizationId = randomUUID();
const users: string[] = [];

async function staff(role: string): Promise<string> {
  const id = randomUUID();
  const compact = id.replaceAll("-", "");
  await db.insert(commerceUsers).values({
    id,
    workosUserId: `user_admins${compact}`,
    email: `admins-${id}@fil.one`,
    name: `Staff ${role}`,
    isInternalStaff: true,
    mfaEnrolled: true,
  });
  await db.insert(memberships).values({
    userId: id,
    organizationId,
    role,
    workosMembershipId: `om_admins${compact}`,
  });
  users.push(id);
  return id;
}

async function roleOf(userId: string): Promise<string | undefined> {
  const [row] = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, userId),
        eq(memberships.organizationId, organizationId),
      ),
    );
  return row?.role;
}

async function versionOf(userId: string): Promise<number> {
  const [row] = await db
    .select({ rowVersion: memberships.rowVersion })
    .from(memberships)
    .where(eq(memberships.userId, userId));
  if (!row) throw new Error("membership missing");
  return row.rowVersion;
}

beforeAll(async () => {
  await db.insert(accounts).values({
    id: accountId,
    legalName: "Administrators Test LLC",
    relationshipRoles: ["direct_client"],
    registeredAddress: {
      line1: "1 Main St",
      city: "Wilmington",
      region: "DE",
      postalCode: "19801",
      country: "US",
    },
    billingContact: { name: "Billing", email: "billing@fil.one" },
    apContact: { name: "AP", email: "ap@fil.one" },
    invoiceDeliveryEmail: "billing@fil.one",
    domain: `admins-${accountId}.test`,
    country: "US",
    currency: "USD",
  } as typeof accounts.$inferInsert);
  await db.insert(organizations).values({
    id: organizationId,
    accountId,
    name: "Administrators Test",
    workosOrganizationId: `org_admins${organizationId.replaceAll("-", "")}`,
  } as typeof organizations.$inferInsert);
});

afterAll(async () => {
  if (users.length)
    await db.delete(memberships).where(inArray(memberships.userId, users));
  await client.end();
});

it("refuses a change that would leave no commerce administrator", async () => {
  const onlyAdmin = await staff("commerce_admin");
  await expect(
    withInternalTransaction(db, `admins-${randomUUID()}`, async (tx) => {
      await lockStaffOrganization(tx, organizationId);
      await assertAnotherStaffAdmin(tx, organizationId, onlyAdmin);
    }),
  ).rejects.toThrow("STAFF_TEAM_LAST_ADMIN");

  const second = await staff("commerce_admin");
  await expect(
    withInternalTransaction(db, `admins-${randomUUID()}`, async (tx) => {
      await lockStaffOrganization(tx, organizationId);
      await assertAnotherStaffAdmin(tx, organizationId, onlyAdmin);
    }),
  ).resolves.toBeUndefined();
  // A seller counts for nothing.
  await db
    .update(memberships)
    .set({ role: "revenue" })
    .where(eq(memberships.userId, second));
  await expect(
    withInternalTransaction(db, `admins-${randomUUID()}`, async (tx) => {
      await assertAnotherStaffAdmin(tx, organizationId, onlyAdmin);
    }),
  ).rejects.toThrow("STAFF_TEAM_LAST_ADMIN");
});

it("lets only one of two administrators demote the other at the same moment", async () => {
  const first = await staff("commerce_admin");
  const second = await staff("commerce_admin");
  // Remove every other administrator this file created, so these two are
  // the organization's only ones.
  await db
    .update(memberships)
    .set({ role: "revenue" })
    .where(
      and(
        eq(memberships.organizationId, organizationId),
        eq(memberships.role, "commerce_admin"),
        inArray(
          memberships.userId,
          users.filter((user) => user !== first && user !== second),
        ),
      ),
    );
  const repository = new StaffTeamRepository(db);
  const demote = async (actor: string, target: string) =>
    repository.changeRole({
      actorUserId: actor,
      organizationId,
      userId: target,
      role: "revenue",
      expectedRowVersion: await versionOf(target),
      requestId: `admins-${randomUUID()}`,
    });
  const results = await Promise.allSettled([
    demote(first, second),
    demote(second, first),
  ]);
  const refused = results.filter((result) => result.status === "rejected");
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(refused).toHaveLength(1);
  expect(String((refused[0] as PromiseRejectedResult).reason)).toMatch(
    /STAFF_TEAM_ADMIN_REQUIRED|STAFF_TEAM_STALE/,
  );
  const remaining = [await roleOf(first), await roleOf(second)];
  expect(remaining.filter((role) => role === "commerce_admin")).toHaveLength(1);
});
