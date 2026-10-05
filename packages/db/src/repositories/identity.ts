import { and, asc, desc, eq, sql } from "drizzle-orm";

import { OrganizationSideSchema, RoleSchema } from "@clockwork/contracts";

import type { RuntimeDatabase } from "../client";
import { commerceUsers, memberships, organizations } from "../schema";
import { membershipRoles } from "../schema/access";
import { withInternalTransaction } from "../transaction";

/**
 * Translate WorkOS identity keys to commerce-owned authorization state. WorkOS
 * proves identity and MFA; account scope and roles always come from Postgres.
 * `role` is the membership's primary role; `roles` is every role it holds,
 * primary first, and `side` is the organization's side, which together decide
 * the session's permissions.
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
        membershipId: memberships.id,
        userId: commerceUsers.id,
        organizationId: organizations.id,
        accountId: organizations.accountId,
        role: memberships.role,
        side: organizations.side,
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
    const row = rows[0];
    if (!row) throw new Error("Commerce identity lookup failed");
    const granted = await transaction
      .select({ role: membershipRoles.role })
      .from(membershipRoles)
      .where(eq(membershipRoles.membershipId, row.membershipId))
      .orderBy(
        desc(sql`${membershipRoles.role} = ${row.role}`),
        asc(membershipRoles.grantedAt),
        asc(membershipRoles.role),
      );
    return {
      userId: row.userId,
      organizationId: row.organizationId,
      accountId: row.accountId,
      role: RoleSchema.parse(row.role),
      roles: granted.map((grant) => RoleSchema.parse(grant.role)),
      side: OrganizationSideSchema.parse(row.side),
      isInternalStaff: row.isInternalStaff,
      mfaEnrolled: row.mfaEnrolled,
    };
  });
}
