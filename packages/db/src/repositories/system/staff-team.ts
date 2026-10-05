import { and, asc, eq, ne, sql } from "drizzle-orm";

import {
  isStaffTeamRole,
  orderStaffRoles,
  planStaffProvisioning,
  rolesHavePermission,
  StaffProvisioningSchema,
  uuidV7,
  type Actor,
  type ExistingStaffIdentityRow,
  type StaffTeamRole,
} from "@clockwork/contracts";

import type { RuntimeDatabase, RuntimeTransaction } from "../../client";
import { commerceUsers, memberships, organizations } from "../../schema";
import { membershipRoles } from "../../schema/access";
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
 * A person may hold several roles (`membership_roles`); `memberships.role` is
 * the primary one, which picks their home page. Roles live only in Postgres,
 * so granting or removing one is a single write. Authority is a permission,
 * never a role name: the acting administrator must hold `staff:manage`, and
 * the organization must always keep someone else who holds it.
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
  "STAFF_TEAM_ROLE_NOT_HELD",
  "STAFF_TEAM_LAST_ROLE",
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
  /** The primary role, which picks the home page. */
  role: string;
  /** Every role held, the primary one first. */
  roles: string[];
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

const staffManage = "staff:manage";

function userActor(actorUserId: string): Actor {
  return { kind: "user", id: actorUserId };
}

/**
 * Locks every staff membership of the organization. Every team change takes
 * it before it checks the acting administrator, so two administrators
 * changing each other run one after the other and the second sees the first's
 * result: an administrator demoted a moment ago is refused, and the
 * organization never loses its last administrator.
 */
export async function lockStaffOrganization(
  tx: RuntimeTransaction,
  organizationId: string,
): Promise<void> {
  await tx
    .select({ id: memberships.id })
    .from(memberships)
    .where(eq(memberships.organizationId, organizationId))
    .for("update");
}

/**
 * Refuses a change that would leave the organization without anyone else who
 * may manage staff. Counts holders of `staff:manage` through every role they
 * hold, so a seller who was also granted administration counts. Call it under
 * {@link lockStaffOrganization}.
 */
export async function assertAnotherStaffAdmin(
  tx: RuntimeTransaction,
  organizationId: string,
  targetUserId: string,
): Promise<void> {
  const [row] = await tx
    .select({ total: sql<number>`count(*)::int` })
    .from(memberships)
    .innerJoin(commerceUsers, eq(commerceUsers.id, memberships.userId))
    .where(
      and(
        eq(memberships.organizationId, organizationId),
        eq(commerceUsers.isInternalStaff, true),
        ne(memberships.userId, targetUserId),
        sql`public.member_has_permission(${memberships.userId}, ${staffManage}, ${organizationId})`,
      ),
    );
  if (!row || Number(row.total) === 0)
    throw new StaffTeamError("STAFF_TEAM_LAST_ADMIN");
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
    role: StaffTeamRole;
    binding: { workosUserId: string; workosMembershipId: string };
    requestId: string;
  }): Promise<StaffTeamMember> {
    const email = input.email.toLowerCase();
    if (!isStaffTeamRole(input.role))
      throw new StaffTeamError("STAFF_TEAM_ROLE_NOT_MANAGED");
    return withInternalTransaction(
      this.database,
      input.requestId,
      async (tx) => {
        await lockStaffOrganization(tx, input.organizationId);
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

  /**
   * Gives a staff member one more role. The primary role stays as it is, so
   * the person keeps their home page. WorkOS holds no role, so this is one
   * write.
   */
  public grantRole(input: {
    actorUserId: string;
    organizationId: string;
    userId: string;
    role: StaffTeamRole;
    expectedRowVersion: number;
    reason?: string;
    requestId: string;
  }): Promise<StaffTeamMember> {
    return withInternalTransaction(
      this.database,
      input.requestId,
      async (tx) => {
        await lockStaffOrganization(tx, input.organizationId);
        await this.requireAdmin(tx, input.actorUserId, input.organizationId);
        const target = await this.lockedTarget(tx, input);
        if (target.rowVersion !== input.expectedRowVersion)
          throw new StaffTeamError("STAFF_TEAM_STALE");
        if (!isStaffTeamRole(input.role))
          throw new StaffTeamError("STAFF_TEAM_ROLE_NOT_MANAGED");
        if (target.roles.includes(input.role))
          throw new StaffTeamError("STAFF_TEAM_ROLE_UNCHANGED");
        await tx.insert(membershipRoles).values({
          membershipId: target.membershipId,
          role: input.role,
          grantedBy: input.actorUserId,
          reason: input.reason ?? null,
        });
        const rowVersion = await this.advance(tx, target, {});
        const roles = [
          target.role,
          ...orderStaffRoles([...target.roles, input.role]).filter(
            (role) => role !== target.role,
          ),
        ];
        await appendAuditAndOutbox(tx, {
          aggregateType: "membership",
          aggregateId: target.membershipId,
          aggregateVersion: rowVersion,
          eventType: "staff.role_granted",
          actor: userActor(input.actorUserId),
          requestId: input.requestId,
          before: { email: target.email, roles: target.roles },
          after: {
            email: target.email,
            role: input.role,
            roles,
            ...(input.reason ? { reason: input.reason } : {}),
          },
        });
        return { ...target, roles, rowVersion };
      },
    );
  }

  /**
   * Takes one role away. A person always keeps at least one role (deactivate
   * them instead), and the organization always keeps someone else who holds
   * `staff:manage`. Removing the primary role moves the primary to the first
   * remaining role in `staffTeamRoles` order.
   */
  public revokeRole(input: {
    actorUserId: string;
    organizationId: string;
    userId: string;
    role: StaffTeamRole;
    expectedRowVersion: number;
    reason?: string;
    requestId: string;
  }): Promise<StaffTeamMember> {
    return withInternalTransaction(
      this.database,
      input.requestId,
      async (tx) => {
        await lockStaffOrganization(tx, input.organizationId);
        await this.requireAdmin(tx, input.actorUserId, input.organizationId);
        const target = await this.lockedTarget(tx, input);
        if (target.rowVersion !== input.expectedRowVersion)
          throw new StaffTeamError("STAFF_TEAM_STALE");
        if (!isStaffTeamRole(input.role))
          throw new StaffTeamError("STAFF_TEAM_ROLE_NOT_MANAGED");
        if (!target.roles.includes(input.role))
          throw new StaffTeamError("STAFF_TEAM_ROLE_NOT_HELD");
        const remaining = target.roles.filter((role) => role !== input.role);
        if (remaining.length === 0)
          throw new StaffTeamError("STAFF_TEAM_LAST_ROLE");
        if (
          rolesHavePermission(target.roles, staffManage) &&
          !rolesHavePermission(remaining, staffManage)
        )
          await assertAnotherStaffAdmin(
            tx,
            input.organizationId,
            target.userId,
          );
        const primary =
          input.role === target.role
            ? (orderStaffRoles(remaining)[0] ?? target.role)
            : target.role;
        let rowVersion: number;
        if (primary !== target.role) {
          // Moving the primary role drops the old primary's row with it
          // (memberships_sync_primary_role), which is the removal itself.
          rowVersion = await this.advance(tx, target, { role: primary });
        } else {
          await tx
            .delete(membershipRoles)
            .where(
              and(
                eq(membershipRoles.membershipId, target.membershipId),
                eq(membershipRoles.role, input.role),
              ),
            );
          rowVersion = await this.advance(tx, target, {});
        }
        const roles = [
          primary,
          ...orderStaffRoles(remaining).filter((role) => role !== primary),
        ];
        await appendAuditAndOutbox(tx, {
          aggregateType: "membership",
          aggregateId: target.membershipId,
          aggregateVersion: rowVersion,
          eventType: "staff.role_revoked",
          actor: userActor(input.actorUserId),
          requestId: input.requestId,
          before: { email: target.email, roles: target.roles },
          after: {
            email: target.email,
            role: input.role,
            roles,
            ...(input.reason ? { reason: input.reason } : {}),
          },
        });
        return { ...target, role: primary, roles, rowVersion };
      },
    );
  }

  /**
   * Moves the membership's row version on, so a screen still holding the old
   * one is refused. Returns the new version.
   */
  private async advance(
    tx: RuntimeTransaction,
    target: StaffTeamMember,
    change: { role?: string },
  ): Promise<number> {
    const [updated] = await tx
      .update(memberships)
      // The row-version trigger sets updated_at itself; naming it here makes
      // the update a real one when the role stays.
      .set({ updatedAt: new Date(), ...change })
      .where(
        and(
          eq(memberships.id, target.membershipId),
          eq(memberships.rowVersion, target.rowVersion),
        ),
      )
      .returning({ rowVersion: memberships.rowVersion });
    if (!updated) throw new StaffTeamError("STAFF_TEAM_STALE");
    return updated.rowVersion;
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
        await lockStaffOrganization(tx, input.organizationId);
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
        await lockStaffOrganization(tx, input.organizationId);
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
            roles: target.roles,
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
    if (rolesHavePermission(target.roles, staffManage))
      await assertAnotherStaffAdmin(tx, input.organizationId, target.userId);
    return target;
  }

  private async lockedTarget(
    tx: RuntimeTransaction,
    input: { actorUserId: string; organizationId: string; userId: string },
  ): Promise<StaffTeamMember> {
    if (input.userId === input.actorUserId)
      throw new StaffTeamError("STAFF_TEAM_SELF_CHANGE");
    const target = (await this.members(tx, input.organizationId)).find(
      (member) => member.userId === input.userId,
    );
    if (!target) throw new StaffTeamError("STAFF_TEAM_MEMBER_NOT_FOUND");
    return target;
  }

  /**
   * The actor's own stored roles decide, not the session: someone whose
   * administrator role was removed a moment ago is refused here. Only the Fil
   * One staff organization is managed this way. Returns the organization's
   * WorkOS id.
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
          eq(organizations.side, "fil_one"),
          eq(commerceUsers.isInternalStaff, true),
          sql`public.member_has_permission(${actorUserId}, ${staffManage}, ${organizationId})`,
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
    const rows = await tx
      .select({
        userId: commerceUsers.id,
        membershipId: memberships.id,
        name: commerceUsers.name,
        email: commerceUsers.email,
        role: memberships.role,
        roles: sql<string[]>`array(
          select granted.role from public.membership_roles granted
          where granted.membership_id = ${memberships.id}
        )`,
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
    return rows.map((row) => ({
      ...row,
      // The primary role leads, then the rest in their usual order.
      roles: [
        row.role,
        ...orderStaffRoles(row.roles).filter((role) => role !== row.role),
      ],
    }));
  }
}
