import { and, eq } from "drizzle-orm";

import { RoleSchema } from "@clockwork/contracts";

import type { RuntimeDatabase } from "../client";
import { commerceUsers, memberships, organizations } from "../schema";
import { withInternalTransaction } from "../transaction";

/**
 * Translate WorkOS identity keys to commerce-owned authorization state. WorkOS
 * proves identity and MFA; account scope and roles always come from Postgres.
 */
export async function resolveWorkosIdentity(
  db: RuntimeDatabase,
  input: {
    workosUserId: string;
    workosOrganizationId: string;
    requestId: string;
  },
) {
  return withInternalTransaction(db, input.requestId, async (transaction) => {
    const rows = await transaction
      .select({
        userId: commerceUsers.id,
        organizationId: organizations.id,
        accountId: organizations.accountId,
        role: memberships.role,
        isInternalStaff: commerceUsers.isInternalStaff,
        mfaEnrolled: commerceUsers.mfaEnrolled,
      })
      .from(memberships)
      .innerJoin(commerceUsers, eq(commerceUsers.id, memberships.userId))
      .innerJoin(
        organizations,
        eq(organizations.id, memberships.organizationId),
      )
      .where(
        and(
          eq(commerceUsers.workosUserId, input.workosUserId),
          eq(organizations.workosOrganizationId, input.workosOrganizationId),
        ),
      )
      .limit(2);

    if (rows.length !== 1)
      throw new Error(
        "WorkOS identity is not linked to exactly one commerce membership",
      );
    const identity = rows[0];
    if (!identity) throw new Error("Commerce identity lookup failed");
    return { ...identity, role: RoleSchema.parse(identity.role) };
  });
}
