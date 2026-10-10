import { createHash, createHmac, randomUUID } from "node:crypto";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";

import {
  OrganizationSideSchema,
  RoleSchema,
  roleAllowedOnSide,
  type Actor,
  type OrganizationSide,
  type Role,
} from "@clockwork/contracts";

import type { RuntimeDatabase, RuntimeTransaction } from "../../client";
import {
  auditEvents,
  commerceUsers,
  invites,
  memberships,
  organizations,
} from "../../schema";
import { withInternalTransaction } from "../../transaction";
import { appendAuditAndOutbox } from "../audit-outbox";

/**
 * An invite link carries a token derived from the invite's id with the
 * deployment's authorization secret; the database keeps only its SHA-256.
 * The organization page can show the link again without storing it. A
 * rotated secret voids links still pending: a token is honoured only while it
 * is the one the current secret derives, so a link from before the rotation
 * no longer opens or accepts its invite, and a new invite replaces it.
 */
export function inviteToken(secret: string, inviteId: string): string {
  if (secret.length < 32) throw new Error("INVITE_SECRET_INVALID");
  const key = createHmac("sha256", secret)
    .update("clockwork.invite.v1")
    .digest();
  return createHmac("sha256", key).update(inviteId).digest("base64url");
}

export function inviteTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** The path an invite link opens; the token is its only secret. */
export const invitePath = (token: string) => `/invite/${token}`;

export const inviteLifetimeDays = 14;

/**
 * `void`: still pending in the database, but the current secret no longer
 * derives the token its hash was made from (the secret was rotated). Neither
 * the old link nor any other can accept it; it does not block a new invite to
 * the same address, and staff can revoke it.
 */
export type InviteState = "pending" | "accepted" | "expired" | "void";

export interface InvitePreview {
  inviteId: string;
  organizationId: string;
  organizationName: string;
  side: OrganizationSide;
  role: Role;
  email: string;
  expiresAt: string;
  state: InviteState;
  workosOrganizationId: string | null;
}

/** Who is accepting: the signed-in identity-provider user. */
export interface AcceptanceInput {
  token: string;
  workosUserId: string;
  email: string;
  emailVerified: boolean;
}

export interface OrganizationInvite {
  inviteId: string;
  email: string;
  role: Role;
  expiresAt: string;
  acceptedAt: string | null;
  state: InviteState;
  /** The link to copy, while the invite can still be accepted. */
  path: string | null;
}

/** Whether an invite may give `role` in an organization on `side`. */
export function inviteRoleFitsOrganization(role: Role, side: OrganizationSide) {
  return side !== "fil_one" && roleAllowedOnSide(role, side);
}

const stateOf = (
  row: { acceptedAt: Date | null; expiresAt: Date },
  now: Date,
): InviteState =>
  row.acceptedAt
    ? "accepted"
    : row.expiresAt.getTime() <= now.getTime()
      ? "expired"
      : "pending";

/**
 * Invites to customer and partner organizations: sending one as Fil One
 * operations, reading them back with their links, and accepting one as the
 * signed-in person it was sent to. An organization's own administrators
 * invite through the lifecycle command, which applies their role ceiling.
 */
export class InviteRepository {
  constructor(
    private readonly db: RuntimeDatabase,
    private readonly secret: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private tx<T>(fn: (tx: RuntimeTransaction) => Promise<T>) {
    return withInternalTransaction(this.db, randomUUID(), fn);
  }

  /**
   * Operations invites someone into a customer or partner organization,
   * usually its first administrator, with any role the side allows. One
   * pending invite per address and organization.
   */
  createAsStaff(
    input: { organizationId: string; email: string; role: string },
    actor: Actor & { kind: "user" },
  ): Promise<{ inviteId: string; path: string }> {
    const role = RoleSchema.parse(input.role);
    const email = input.email.trim().toLowerCase();
    return this.tx(async (tx) => {
      const [organization] = await tx
        .select()
        .from(organizations)
        .where(eq(organizations.id, input.organizationId))
        .for("update");
      if (!organization || organization.side === "fil_one")
        throw new Error("INVITE_ORGANIZATION_NOT_FOUND");
      const side = OrganizationSideSchema.parse(organization.side);
      if (!inviteRoleFitsOrganization(role, side))
        throw new Error("INVITE_ROLE_NOT_ALLOWED_ON_SIDE");
      const now = this.now();
      const pending = await tx
        .select({ id: invites.id, tokenHash: invites.tokenHash })
        .from(invites)
        .where(
          and(
            eq(invites.organizationId, organization.id),
            eq(invites.email, email),
            isNull(invites.acceptedAt),
            gt(invites.expiresAt, now),
          ),
        );
      if (pending.some((row) => this.linkWorks(row)))
        throw new Error("INVITE_ALREADY_PENDING");
      const [member] = await tx
        .select({ id: memberships.id })
        .from(memberships)
        .innerJoin(commerceUsers, eq(commerceUsers.id, memberships.userId))
        .where(
          and(
            eq(memberships.organizationId, organization.id),
            eq(commerceUsers.email, email),
          ),
        );
      if (member) throw new Error("INVITE_ALREADY_MEMBER");
      const inviteId = randomUUID();
      const token = inviteToken(this.secret, inviteId);
      const [invite] = await tx
        .insert(invites)
        .values({
          id: inviteId,
          organizationId: organization.id,
          email,
          role,
          tokenHash: inviteTokenHash(token),
          expiresAt: new Date(
            now.getTime() + inviteLifetimeDays * 24 * 60 * 60 * 1000,
          ),
          invitedBy: actor.id,
        })
        .returning();
      if (!invite) throw new Error("INVITE_INSERT_FAILED");
      await appendAuditAndOutbox(tx, {
        accountId: organization.accountId,
        aggregateType: "invite",
        aggregateId: invite.id,
        aggregateVersion: invite.rowVersion,
        eventType: "membership.invited",
        actor,
        requestId: randomUUID(),
        after: {
          inviteId: invite.id,
          organizationId: organization.id,
          email,
          role,
          expiresAt: invite.expiresAt.toISOString(),
          invitedBy: "staff",
        },
      });
      return { inviteId: invite.id, path: invitePath(token) };
    });
  }

  /** An organization's invites, newest first, with links for pending ones. */
  list(organizationId: string): Promise<OrganizationInvite[]> {
    return this.tx(async (tx) => {
      const now = this.now();
      const rows = await tx
        .select()
        .from(invites)
        .where(eq(invites.organizationId, organizationId))
        .orderBy(desc(invites.createdAt))
        .limit(100);
      return rows.map((row) => {
        const state = this.stateOf(row, now);
        return {
          inviteId: row.id,
          email: row.email,
          role: RoleSchema.parse(row.role),
          expiresAt: row.expiresAt.toISOString(),
          acceptedAt: row.acceptedAt?.toISOString() ?? null,
          state,
          // Shown only when it is the link the database will accept.
          path:
            state === "pending"
              ? invitePath(inviteToken(this.secret, row.id))
              : null,
        };
      });
    });
  }

  /**
   * Ends a pending invite now, so its link stops working and the address can
   * be invited again. Audited as `invite.revoked`.
   */
  revokeAsStaff(
    input: { organizationId: string; inviteId: string },
    actor: Actor & { kind: "user" },
  ): Promise<void> {
    return this.tx(async (tx) => {
      const [invite] = await tx
        .select()
        .from(invites)
        .where(
          and(
            eq(invites.id, input.inviteId),
            eq(invites.organizationId, input.organizationId),
          ),
        )
        .for("update");
      const [organization] = invite
        ? await tx
            .select()
            .from(organizations)
            .where(eq(organizations.id, invite.organizationId))
        : [];
      if (!invite || !organization || organization.side === "fil_one")
        throw new Error("INVITE_NOT_FOUND");
      const now = this.now();
      const state = this.stateOf(invite, now);
      if (state !== "pending" && state !== "void")
        throw new Error("INVITE_NOT_PENDING");
      const [revoked] = await tx
        .update(invites)
        .set({
          expiresAt: now,
          updatedAt: sql`now()`,
          rowVersion: invite.rowVersion + 1,
        })
        .where(and(eq(invites.id, invite.id), isNull(invites.acceptedAt)))
        .returning();
      if (!revoked) throw new Error("INVITE_NOT_PENDING");
      await appendAuditAndOutbox(tx, {
        accountId: organization.accountId,
        aggregateType: "invite",
        aggregateId: invite.id,
        aggregateVersion: revoked.rowVersion,
        eventType: "invite.revoked",
        actor,
        requestId: randomUUID(),
        before: { expiresAt: invite.expiresAt.toISOString() },
        after: {
          inviteId: invite.id,
          organizationId: organization.id,
          email: invite.email,
          role: invite.role,
          expiresAt: now.toISOString(),
        },
      });
    });
  }

  /** Whether the link derived from the current secret opens this invite. */
  private linkWorks(row: { id: string; tokenHash: string }): boolean {
    return inviteTokenHash(inviteToken(this.secret, row.id)) === row.tokenHash;
  }

  private stateOf(
    row: {
      id: string;
      tokenHash: string;
      acceptedAt: Date | null;
      expiresAt: Date;
    },
    now: Date,
  ): InviteState {
    const state = stateOf(row, now);
    return state === "pending" && !this.linkWorks(row) ? "void" : state;
  }

  /** What an invite link offers, for the page that shows it. */
  preview(token: string): Promise<InvitePreview> {
    return this.tx(async (tx) => {
      const [row] = await tx
        .select({ invite: invites, organization: organizations })
        .from(invites)
        .innerJoin(organizations, eq(organizations.id, invites.organizationId))
        .where(eq(invites.tokenHash, inviteTokenHash(token)));
      if (!row || row.organization.side === "fil_one")
        throw new Error("INVITE_NOT_FOUND");
      return {
        inviteId: row.invite.id,
        organizationId: row.organization.id,
        organizationName: row.organization.name,
        side: OrganizationSideSchema.parse(row.organization.side),
        role: RoleSchema.parse(row.invite.role),
        email: row.invite.email,
        expiresAt: row.invite.expiresAt.toISOString(),
        state: this.stateOf(row.invite, this.now()),
        workosOrganizationId: row.organization.workosOrganizationId,
      };
    });
  }

  /**
   * Every check acceptance makes, without writing anything: run it before
   * the identity provider is asked to add the person to the organization,
   * so a refusal never leaves a provider membership behind.
   */
  checkAcceptable(input: AcceptanceInput): Promise<{
    inviteId: string;
    organizationId: string;
    side: OrganizationSide;
    workosOrganizationId: string | null;
  }> {
    return this.tx(async (tx) => {
      const checked = await this.checks(tx, input, false);
      return {
        inviteId: checked.invite.id,
        organizationId: checked.organization.id,
        side: checked.side,
        workosOrganizationId: checked.organization.workosOrganizationId,
      };
    });
  }

  /**
   * Turns the invite into a membership for the signed-in person it was sent
   * to: their verified email must match, it must be pending and unexpired,
   * and it is used once. A person new to Commerce gets their identity record
   * here, bound to their identity-provider user.
   */
  accept(
    input: AcceptanceInput & {
      name: string;
      workosMembershipId: string | null;
    },
  ): Promise<{
    membershipId: string;
    organizationId: string;
    userId: string;
    side: OrganizationSide;
  }> {
    return this.tx(async (tx) => {
      const { invite, organization, side, role, user } = await this.checks(
        tx,
        input,
        true,
      );
      const person = user ?? (await this.createIdentity(tx, input));
      const now = this.now();
      const [membership] = await tx
        .insert(memberships)
        .values({
          organizationId: organization.id,
          userId: person.id,
          role,
          workosMembershipId: input.workosMembershipId,
        })
        .returning();
      if (!membership) throw new Error("MEMBERSHIP_INSERT_FAILED");
      const [accepted] = await tx
        .update(invites)
        .set({
          acceptedAt: now,
          acceptedBy: person.id,
          updatedAt: sql`now()`,
          rowVersion: invite.rowVersion + 1,
        })
        .where(and(eq(invites.id, invite.id), isNull(invites.acceptedAt)))
        .returning();
      if (!accepted) throw new Error("INVITE_ALREADY_ACCEPTED");
      await appendAuditAndOutbox(tx, {
        accountId: organization.accountId,
        aggregateType: "invite",
        aggregateId: invite.id,
        aggregateVersion: accepted.rowVersion,
        eventType: "invite.accepted",
        actor: { kind: "user", id: person.id, display: person.name },
        requestId: randomUUID(),
        after: {
          inviteId: invite.id,
          organizationId: organization.id,
          membershipId: membership.id,
          userId: person.id,
          email: invite.email,
          role,
        },
      });
      return {
        membershipId: membership.id,
        organizationId: organization.id,
        userId: person.id,
        side,
      };
    });
  }

  /**
   * Records what was done to the identity provider's organization membership
   * after Commerce refused an acceptance, as `invite.compensated` on the
   * invite. The invite itself does not change.
   */
  recordCompensation(input: {
    inviteId: string;
    workosUserId: string;
    workosMembershipId: string;
    outcome: "created" | "reactivated" | "existing";
    action:
      "removed" | "deactivated" | "kept_existing" | "kept_in_use" | "failed";
    reason: string;
  }): Promise<void> {
    return this.tx(async (tx) => {
      const [invite] = await tx
        .select()
        .from(invites)
        .where(eq(invites.id, input.inviteId))
        .for("update");
      if (!invite) throw new Error("INVITE_NOT_FOUND");
      const [organization] = await tx
        .select({ accountId: organizations.accountId })
        .from(organizations)
        .where(eq(organizations.id, invite.organizationId));
      const [latest] = await tx
        .select({
          version: sql<number>`coalesce(max(${auditEvents.aggregateVersion}), 0)::int`,
        })
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.aggregateType, "invite"),
            eq(auditEvents.aggregateId, invite.id),
          ),
        );
      await appendAuditAndOutbox(tx, {
        ...(organization ? { accountId: organization.accountId } : {}),
        aggregateType: "invite",
        aggregateId: invite.id,
        aggregateVersion: Number(latest?.version ?? 0) + 1,
        eventType: "invite.compensated",
        actor: { kind: "system", id: "invite-acceptance" },
        requestId: randomUUID(),
        after: {
          inviteId: invite.id,
          organizationId: invite.organizationId,
          workosUserId: input.workosUserId,
          workosMembershipId: input.workosMembershipId,
          outcome: input.outcome,
          action: input.action,
          reason: input.reason,
        },
      });
    });
  }

  /**
   * Whether a Commerce membership holds this provider membership. A failed
   * acceptance removes the provider membership it created only when nothing
   * here depends on it, so a lost race never undoes the winner's.
   */
  workosMembershipInUse(workosMembershipId: string): Promise<boolean> {
    return this.tx(async (tx) => {
      const [row] = await tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(eq(memberships.workosMembershipId, workosMembershipId));
      return Boolean(row);
    });
  }

  private async checks(
    tx: RuntimeTransaction,
    input: AcceptanceInput,
    lock: boolean,
  ) {
    const query = tx
      .select()
      .from(invites)
      .where(eq(invites.tokenHash, inviteTokenHash(input.token)));
    const [invite] = lock ? await query.for("update") : await query;
    // A token from before a secret rotation still matches its stored hash;
    // only the token the current secret derives is honoured.
    if (!invite || !this.linkWorks(invite)) throw new Error("INVITE_NOT_FOUND");
    if (invite.acceptedAt) throw new Error("INVITE_ALREADY_ACCEPTED");
    if (invite.expiresAt.getTime() <= this.now().getTime())
      throw new Error("INVITE_EXPIRED");
    if (!input.emailVerified) throw new Error("INVITE_EMAIL_UNVERIFIED");
    if (input.email.trim().toLowerCase() !== invite.email.toLowerCase())
      throw new Error("INVITE_EMAIL_MISMATCH");
    const [organization] = await tx
      .select()
      .from(organizations)
      .where(eq(organizations.id, invite.organizationId));
    if (!organization || organization.side === "fil_one")
      throw new Error("INVITE_NOT_FOUND");
    const side = OrganizationSideSchema.parse(organization.side);
    const role = RoleSchema.parse(invite.role);
    if (!inviteRoleFitsOrganization(role, side))
      throw new Error("INVITE_ROLE_NOT_ALLOWED_ON_SIDE");
    const user = await this.findIdentity(tx, input);
    if (user?.isInternalStaff) throw new Error("INVITE_STAFF_IDENTITY");
    if (user) {
      const [existing] = await tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(
          and(
            eq(memberships.organizationId, organization.id),
            eq(memberships.userId, user.id),
          ),
        );
      if (existing) throw new Error("INVITE_ALREADY_MEMBER");
    }
    return { invite, organization, side, role, user };
  }

  /**
   * The commerce identity already bound to the identity-provider user, if
   * any. An address already bound to a different provider user is a conflict
   * for a person to resolve, never a silent rebinding.
   */
  private async findIdentity(
    tx: RuntimeTransaction,
    input: { workosUserId: string; email: string },
  ) {
    const email = input.email.trim().toLowerCase();
    const [byProvider] = await tx
      .select()
      .from(commerceUsers)
      .where(eq(commerceUsers.workosUserId, input.workosUserId));
    if (byProvider) {
      if (byProvider.email.toLowerCase() !== email)
        throw new Error("INVITE_IDENTITY_CONFLICT");
      return byProvider;
    }
    const [byEmail] = await tx
      .select()
      .from(commerceUsers)
      .where(eq(commerceUsers.email, email));
    if (byEmail) throw new Error("INVITE_IDENTITY_CONFLICT");
    return null;
  }

  /** A person new to Commerce, on their first acceptance. */
  private async createIdentity(
    tx: RuntimeTransaction,
    input: { workosUserId: string; email: string; name: string },
  ) {
    const email = input.email.trim().toLowerCase();
    const [created] = await tx
      .insert(commerceUsers)
      .values({
        workosUserId: input.workosUserId,
        email,
        name: input.name.trim() || email,
        mfaEnrolled: false,
      })
      .returning();
    if (!created) throw new Error("USER_INSERT_FAILED");
    return created;
  }
}
