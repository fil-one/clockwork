import { and, asc, eq, sql } from "drizzle-orm";

import {
  planStaffProvisioning,
  StaffProvisioningRoleSchema,
  StaffProvisioningSchema,
  uuidV7,
  type Actor,
  type ExistingStaffIdentityRow,
  type StaffProvisioningRole,
} from "@clockwork/contracts";

import type { RuntimeDatabase, RuntimeTransaction } from "../../client";
import { commerceUsers, memberships, organizations } from "../../schema";
import { withInternalTransaction } from "../../transaction";
import { appendAuditAndOutbox } from "../audit-outbox";

/**
 * The Fil One staff team, managed by a commerce administrator from the
 * portal. WorkOS proves who someone is; the commerce membership decides what
 * they may do, so every change here lands in Postgres with an audit event.
 *
 * Deactivation deletes the person's staff membership. Nothing references a
 * membership row by key, the identity row and every audit event stay, and the
 * person keeps no way into the portal: sign-in resolves access from
 * memberships alone. Inviting them again restores a membership.
 *
 * The identity-provider half of each change runs between a `prepare*` and a
 * `complete*` call, so the caller performs it only after the database has
 * agreed to the change, and the database records it only after the provider
 * has done it. Each `complete*` call checks the guards again under a lock.
 */

export const staffTeamErrorCodes = [
  "STAFF_TEAM_ADMIN_REQUIRED",
  "STAFF_TEAM_MEMBER_NOT_FOUND",
  "STAFF_TEAM_SELF_CHANGE",
  "STAFF_TEAM_LAST_ADMIN",
  "STAFF_TEAM_ALREADY_MEMBER",
  "STAFF_TEAM_IDENTITY_CONFLICT",
  "STAFF_TEAM_ROLE_NOT_MANAGED",
  "STAFF_TEAM_ROLE_UNCHANGED",
  "STAFF_TEAM_STALE",
  "STAFF_TEAM_WORKOS_NOT_LINKED",
] as const;
export type StaffTeamErrorCode = (typeof staffTeamErrorCodes)[number];

export class StaffTeamError extends Error {
  public constructor(public readonly code: StaffTeamErrorCode) {
    super(code);
  }
}

export interface StaffTeamMember {
  userId: string;
  membershipId: string;
  name: string;
  email: string;
  role: string;
  mfaEnrolled: boolean;
  addedAt: Date;
  rowVersion: number;
  workosMembershipId: string | null;
  /** When this person last passed the in-app MFA check, as an ISO timestamp. */
  lastMfaVerifiedAt: string | null;
}

export type StaffInvitePlan =
  | { kind: "create" }
  | { kind: "restore"; userId: string; workosUserId: string };

const managedRoles = StaffProvisioningRoleSchema.options as readonly string[];

function userActor(actorUserId: string): Actor {
  return { kind: "user", id: actorUserId };
}

export class StaffTeamRepository {
  public constructor(private readonly database: RuntimeDatabase) {}

  /** Internal staff of one organization, oldest first. */
  public list(input: {
    organizationId: string;
    requestId: string;
  }): Promise<StaffTeamMember[]> {
    return withInternalTransaction(this.database, input.requestId, (tx) =>
      this.members(tx, input.organizationId),
    );
  }

  /** Checks an invitation before WorkOS is asked to create anything. */
  public prepareInvite(input: {
    actorUserId: string;
    organizationId: string;
    email: string;
    requestId: string;
  }): Promise<{ plan: StaffInvitePlan; workosOrganizationId: string }> {
    return withInternalTransaction(
      this.database,
      input.requestId,
      async (tx) => {
        const workosOrganizationId = await this.requireAdmin(
          tx,
          input.actorUserId,
          input.organizationId,
        );
        if (!workosOrganizationId)
          throw new StaffTeamError("STAFF_TEAM_WORKOS_NOT_LINKED");
        return {
          plan: await this.invitePlan(tx, input.email, input.organizationId),
          workosOrganizationId,
        };
      },
    );
  }

  /** Records a staff member WorkOS now holds in the staff organization. */
  public completeInvite(input: {
    actorUserId: string;
    organizationId: string;
    email: string;
    name: string;
    role: StaffProvisioningRole;
    binding: { workosUserId: string; workosMembershipId: string };
    requestId: string;
  }): Promise<StaffTeamMember> {
    const email = input.email.toLowerCase();
    return withInternalTransaction(
      this.database,
      input.requestId,
      async (tx) => {
        await this.requireAdmin(tx, input.actorUserId, input.organizationId);
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`staff:${email}`}))`,
        );
        const plan = await this.invitePlan(tx, email, input.organizationId);
        let userId: string;
        if (plan.kind === "restore") {
          if (plan.workosUserId !== input.binding.workosUserId)
            throw new StaffTeamError("STAFF_TEAM_IDENTITY_CONFLICT");
          userId = plan.userId;
        } else {
          userId = uuidV7();
          await tx.insert(commerceUsers).values({
            id: userId,
            workosUserId: input.binding.workosUserId,
            email,
            name: input.name,
            isInternalStaff: true,
            mfaEnrolled: false,
          });
        }
        const membershipId = uuidV7();
        await tx.insert(memberships).values({
          id: membershipId,
          organizationId: input.organizationId,
          userId,
          workosMembershipId: input.binding.workosMembershipId,
          role: input.role,
        });
        await appendAuditAndOutbox(tx, {
          aggregateType: "membership",
          aggregateId: membershipId,
          aggregateVersion: 1,
          eventType:
            plan.kind === "restore" ? "staff.reactivated" : "staff.invited",
          actor: userActor(input.actorUserId),
          requestId: input.requestId,
          after: {
            email,
            name: input.name,
            role: input.role,
            organizationId: input.organizationId,
            workosUserId: input.binding.workosUserId,
            mfaRequiredAtLogin: true,
          },
        });
        const member = (await this.members(tx, input.organizationId)).find(
          (candidate) => candidate.membershipId === membershipId,
        );
        if (!member) throw new StaffTeamError("STAFF_TEAM_MEMBER_NOT_FOUND");
        return member;
      },
    );
  }

  /** Changes a staff member's role. WorkOS holds no role, so this is one write. */
  public changeRole(input: {
    actorUserId: string;
    organizationId: string;
    userId: string;
    role: StaffProvisioningRole;
    expectedRowVersion: number;
    requestId: string;
  }): Promise<StaffTeamMember> {
    return withInternalTransaction(
      this.database,
      input.requestId,
      async (tx) => {
        await this.requireAdmin(tx, input.actorUserId, input.organizationId);
        const target = await this.lockedTarget(tx, input);
        if (!managedRoles.includes(target.role))
          throw new StaffTeamError("STAFF_TEAM_ROLE_NOT_MANAGED");
        if (target.role === input.role)
          throw new StaffTeamError("STAFF_TEAM_ROLE_UNCHANGED");
        if (target.role === "commerce_admin")
          await this.assertAnotherAdmin(tx, input.organizationId, target);
        const [updated] = await tx
          .update(memberships)
          .set({ role: input.role })
          .where(
            and(
              eq(memberships.id, target.membershipId),
              eq(memberships.rowVersion, input.expectedRowVersion),
            ),
          )
          .returning({ rowVersion: memberships.rowVersion });
        if (!updated) throw new StaffTeamError("STAFF_TEAM_STALE");
        await appendAuditAndOutbox(tx, {
          aggregateType: "membership",
          aggregateId: target.membershipId,
          aggregateVersion: updated.rowVersion,
          eventType: "staff.role_changed",
          actor: userActor(input.actorUserId),
          requestId: input.requestId,
          before: { email: target.email, role: target.role },
          after: { email: target.email, role: input.role },
        });
        return { ...target, role: input.role, rowVersion: updated.rowVersion };
      },
    );
  }

  /** Checks a deactivation and returns what WorkOS must be told. */
  public prepareDeactivate(input: {
    actorUserId: string;
    organizationId: string;
    userId: string;
    expectedRowVersion: number;
    requestId: string;
  }): Promise<{
    member: StaffTeamMember;
    workosOrganizationId: string | null;
  }> {
    return withInternalTransaction(
      this.database,
      input.requestId,
      async (tx) => {
        const workosOrganizationId = await this.requireAdmin(
          tx,
          input.actorUserId,
          input.organizationId,
        );
        const member = await this.deactivationTarget(tx, input);
        return { member, workosOrganizationId };
      },
    );
  }

  /** Removes the staff membership. The identity and its history stay. */
  public completeDeactivate(input: {
    actorUserId: string;
    organizationId: string;
    userId: string;
    expectedRowVersion: number;
    workos: "deactivated" | "already_inactive" | "not_linked";
    requestId: string;
  }): Promise<void> {
    return withInternalTransaction(
      this.database,
      input.requestId,
      async (tx) => {
        await this.requireAdmin(tx, input.actorUserId, input.organizationId);
        const target = await this.deactivationTarget(tx, input);
        await tx
          .delete(memberships)
          .where(eq(memberships.id, target.membershipId));
        await appendAuditAndOutbox(tx, {
          aggregateType: "membership",
          aggregateId: target.membershipId,
          aggregateVersion: target.rowVersion + 1,
          eventType: "staff.deactivated",
          actor: userActor(input.actorUserId),
          requestId: input.requestId,
          before: {
            email: target.email,
            role: target.role,
            workosMembershipId: target.workosMembershipId,
          },
          after: {
            email: target.email,
            organizationId: input.organizationId,
            workos: input.workos,
          },
        });
      },
    );
  }

  private async deactivationTarget(
    tx: RuntimeTransaction,
    input: {
      actorUserId: string;
      organizationId: string;
      userId: string;
      expectedRowVersion: number;
    },
  ): Promise<StaffTeamMember> {
    const target = await this.lockedTarget(tx, input);
    if (target.rowVersion !== input.expectedRowVersion)
      throw new StaffTeamError("STAFF_TEAM_STALE");
    if (target.role === "commerce_admin")
      await this.assertAnotherAdmin(tx, input.organizationId, target);
    return target;
  }

  private async lockedTarget(
    tx: RuntimeTransaction,
    input: { actorUserId: string; organizationId: string; userId: string },
  ): Promise<StaffTeamMember> {
    if (input.userId === input.actorUserId)
      throw new StaffTeamError("STAFF_TEAM_SELF_CHANGE");
    // Locking every staff membership of the organization serializes the
    // last-administrator check against a concurrent change to another one.
    await tx
      .select({ id: memberships.id })
      .from(memberships)
      .where(eq(memberships.organizationId, input.organizationId))
      .for("update");
    const target = (await this.members(tx, input.organizationId)).find(
      (member) => member.userId === input.userId,
    );
    if (!target) throw new StaffTeamError("STAFF_TEAM_MEMBER_NOT_FOUND");
    return target;
  }

  private async assertAnotherAdmin(
    tx: RuntimeTransaction,
    organizationId: string,
    target: StaffTeamMember,
  ): Promise<void> {
    const others = (await this.members(tx, organizationId)).filter(
      (member) =>
        member.role === "commerce_admin" && member.userId !== target.userId,
    );
    if (others.length === 0) throw new StaffTeamError("STAFF_TEAM_LAST_ADMIN");
  }

  /**
   * The actor's own membership row decides, not the session: someone whose
   * administrator membership was removed a moment ago is refused here.
   * Returns the organization's WorkOS id.
   */
  private async requireAdmin(
    tx: RuntimeTransaction,
    actorUserId: string,
    organizationId: string,
  ): Promise<string | null> {
    const [row] = await tx
      .select({ workosOrganizationId: organizations.workosOrganizationId })
      .from(memberships)
      .innerJoin(commerceUsers, eq(commerceUsers.id, memberships.userId))
      .innerJoin(
        organizations,
        eq(organizations.id, memberships.organizationId),
      )
      .where(
        and(
          eq(memberships.userId, actorUserId),
          eq(memberships.organizationId, organizationId),
          eq(memberships.role, "commerce_admin"),
          eq(commerceUsers.isInternalStaff, true),
        ),
      )
      .limit(1);
    if (!row) throw new StaffTeamError("STAFF_TEAM_ADMIN_REQUIRED");
    return row.workosOrganizationId;
  }

  private async invitePlan(
    tx: RuntimeTransaction,
    email: string,
    organizationId: string,
  ): Promise<StaffInvitePlan> {
    const existing: ExistingStaffIdentityRow[] = await tx
      .select({
        id: commerceUsers.id,
        workos_user_id: commerceUsers.workosUserId,
        is_internal_staff: commerceUsers.isInternalStaff,
        role: memberships.role,
        organization_id: memberships.organizationId,
      })
      .from(commerceUsers)
      .leftJoin(memberships, eq(memberships.userId, commerceUsers.id))
      .where(sql`lower(${commerceUsers.email}) = ${email.toLowerCase()}`);
    if (
      existing.some(
        (row) =>
          row.is_internal_staff && row.organization_id === organizationId,
      )
    )
      throw new StaffTeamError("STAFF_TEAM_ALREADY_MEMBER");
    let plan;
    try {
      plan = planStaffProvisioning({
        existing,
        // Only the role matters to the plan; the invitation never updates one.
        person: StaffProvisioningSchema.parse({
          email,
          name: "staff",
          title: "staff",
        }),
        organizationId,
      });
    } catch {
      throw new StaffTeamError("STAFF_TEAM_IDENTITY_CONFLICT");
    }
    if (plan.kind === "create") return plan;
    if (plan.kind === "restore")
      return {
        kind: "restore",
        userId: plan.userId,
        workosUserId: plan.workosUserId,
      };
    // Unreachable: a member of this organization was refused above.
    throw new StaffTeamError("STAFF_TEAM_ALREADY_MEMBER");
  }

  private async members(
    tx: RuntimeTransaction,
    organizationId: string,
  ): Promise<StaffTeamMember[]> {
    return tx
      .select({
        userId: commerceUsers.id,
        membershipId: memberships.id,
        name: commerceUsers.name,
        email: commerceUsers.email,
        role: memberships.role,
        mfaEnrolled: commerceUsers.mfaEnrolled,
        addedAt: memberships.createdAt,
        rowVersion: memberships.rowVersion,
        workosMembershipId: memberships.workosMembershipId,
        // The in-app MFA check leaves a receipt per sign-in; the latest one
        // is the evidence that this person has a working authenticator.
        lastMfaVerifiedAt: sql<string | null>`(
          select to_char(max(receipt.verified_at) at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS"Z"')
          from public.experience_mfa_receipts receipt
          where receipt.workos_user_id = ${commerceUsers.workosUserId}
        )`,
      })
      .from(memberships)
      .innerJoin(commerceUsers, eq(commerceUsers.id, memberships.userId))
      .where(
        and(
          eq(memberships.organizationId, organizationId),
          eq(commerceUsers.isInternalStaff, true),
        ),
      )
      .orderBy(asc(memberships.createdAt), asc(commerceUsers.email));
  }
}
