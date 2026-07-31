import { and, eq, gt, isNull, lte, sql } from "drizzle-orm";

import { hasPermission, ids, RoleSchema } from "@clockwork/contracts";

import type { RuntimeDatabase } from "../client";
import {
  commerceUsers,
  impersonationSessions,
  memberships,
  organizations,
} from "../schema";
import { withInternalTransaction } from "../transaction";
import { appendAuditAndOutbox } from "./audit-outbox";

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

/** Require a pre-authorized, live assisted-action record for WorkOS impersonation. */
export async function resolveActiveImpersonation(
  db: RuntimeDatabase,
  input: {
    impersonatorEmail: string;
    targetAccountId: string;
    reason: string;
    now?: Date;
    requestId: string;
  },
) {
  if (input.reason.trim().length < 8)
    throw new Error("Impersonation requires a meaningful reason");
  const now = input.now ?? new Date();
  return withInternalTransaction(db, input.requestId, async (transaction) => {
    const rows = await transaction
      .select({
        sessionId: impersonationSessions.id,
        actualUserId: commerceUsers.id,
        actualActorEmail: commerceUsers.email,
        isInternalStaff: commerceUsers.isInternalStaff,
      })
      .from(impersonationSessions)
      .innerJoin(
        commerceUsers,
        eq(commerceUsers.id, impersonationSessions.internalUserId),
      )
      .where(
        and(
          sql`lower(${commerceUsers.email}) = lower(${input.impersonatorEmail})`,
          eq(impersonationSessions.targetAccountId, input.targetAccountId),
          eq(impersonationSessions.reason, input.reason),
          lte(impersonationSessions.startedAt, now),
          gt(impersonationSessions.expiresAt, now),
          isNull(impersonationSessions.endedAt),
        ),
      )
      .limit(2);
    if (rows.length !== 1 || !rows[0]?.isInternalStaff)
      throw new Error("No active assisted-action authorization exists");
    const actor = rows[0];
    const actorMemberships = await transaction.query.memberships.findMany({
      where: eq(memberships.userId, actor.actualUserId),
    });
    const actualRoles = actorMemberships.flatMap(({ role }) => {
      const parsed = RoleSchema.safeParse(role);
      return parsed.success ? [parsed.data] : [];
    });
    if (
      !actualRoles.some((role) => hasPermission(role, "impersonation:assume"))
    )
      throw new Error("Actual actor lacks assisted-action permission");
    const actualOrganizations = await transaction
      .select({ workosOrganizationId: organizations.workosOrganizationId })
      .from(memberships)
      .innerJoin(
        organizations,
        eq(organizations.id, memberships.organizationId),
      )
      .where(eq(memberships.userId, actor.actualUserId));
    return {
      ...actor,
      actualRoles,
      actualWorkosOrganizationIds: actualOrganizations.flatMap(
        ({ workosOrganizationId }) =>
          workosOrganizationId ? [workosOrganizationId] : [],
      ),
    };
  });
}

export async function createAssistedActionSession(
  db: RuntimeDatabase,
  input: {
    internalUserId: string;
    targetAccountId: string;
    reason: string;
    requestId: string;
    now?: Date;
    durationMinutes?: number;
  },
) {
  if (input.reason.trim().length < 8)
    throw new Error("Assisted action requires a meaningful reason");
  const durationMinutes = input.durationMinutes ?? 15;
  if (
    !Number.isInteger(durationMinutes) ||
    durationMinutes < 1 ||
    durationMinutes > 15
  )
    throw new Error(
      "Assisted action duration must be between 1 and 15 minutes",
    );
  const now = input.now ?? new Date();
  return withInternalTransaction(db, input.requestId, async (transaction) => {
    const actor = await transaction.query.commerceUsers.findFirst({
      where: eq(commerceUsers.id, input.internalUserId),
    });
    if (!actor?.isInternalStaff)
      throw new Error("Assisted action actor must be internal staff");
    const actorMemberships = await transaction.query.memberships.findMany({
      where: eq(memberships.userId, input.internalUserId),
    });
    if (
      !actorMemberships.some(({ role }) => {
        const parsed = RoleSchema.safeParse(role);
        return (
          parsed.success && hasPermission(parsed.data, "impersonation:assume")
        );
      })
    )
      throw new Error("Actor lacks assisted-action permission");

    const [session] = await transaction
      .insert(impersonationSessions)
      .values({
        internalUserId: input.internalUserId,
        targetAccountId: input.targetAccountId,
        reason: input.reason,
        startedAt: now,
        expiresAt: new Date(now.getTime() + durationMinutes * 60_000),
        requestId: input.requestId,
      })
      .returning();
    if (!session) throw new Error("Assisted-action insert failed");
    await appendAuditAndOutbox(transaction, {
      accountId: input.targetAccountId,
      aggregateType: "account",
      aggregateId: input.targetAccountId,
      aggregateVersion: 1,
      eventType: "security.assisted_action.started",
      actor: {
        kind: "user",
        id: input.internalUserId,
        display: actor.email,
        impersonatedAccountId: ids.account.parse(input.targetAccountId),
        assistedActionReason: input.reason,
      },
      requestId: input.requestId,
      after: {
        sessionId: session.id,
        expiresAt: session.expiresAt.toISOString(),
      },
    });
    return session;
  });
}
