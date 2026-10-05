import { randomUUID } from "node:crypto";
import { afterAll, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { StaffTeamRole } from "@clockwork/contracts";

import { createRuntimeDatabase } from "../../client";
import { auditEvents, commerceUsers, memberships } from "../../schema";
import { membershipRoles } from "../../schema/access";
import { OwnerConsoleRepository } from "./owner-console";
import { StaffTeamRepository } from "./staff-team";

const url =
  process.env.DIRECT_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const { db, client } = createRuntimeDatabase({
  url,
  role: "clockwork_service",
  ssl: false,
});
afterAll(() => client.end());

const staffOrganization = "30000000-0000-4000-8000-000000000008";
const customerOrganization = "30000000-0000-4000-8000-000000000001";

it("invites, grants and removes roles and deactivates staff with audit events and guard rails", async () => {
  const rollback = new Error("ROLLBACK_STAFF_TEAM_FIXTURE");
  const outcome = await db
    .transaction(async (outer) => {
      const person = async (
        role: string,
        organizationId = staffOrganization,
      ) => {
        const id = randomUUID();
        await outer.insert(commerceUsers).values({
          id,
          workosUserId: `user_team${id.replaceAll("-", "")}`,
          email: `team-${id}@fil.one`,
          name: `Team ${role}`,
          isInternalStaff: organizationId === staffOrganization,
          mfaEnrolled: true,
        });
        await outer.insert(memberships).values({
          userId: id,
          organizationId,
          role,
          workosMembershipId: `om_team${id.replaceAll("-", "")}`,
        });
        return id;
      };
      const admin = await person("commerce_admin");
      const seller = await person("revenue");
      const operator = await person("internal_operator");
      const customer = await person("owner", customerOrganization);
      await outer.execute(sql`
        insert into public.experience_mfa_receipts
          (challenge_id, session_id, workos_user_id, workos_organization_id,
           factor_id, verified_at, expires_at)
        values (${`challenge-${admin}`}, 'session-team',
          ${`user_team${admin.replaceAll("-", "")}`}, 'org_local_clockwork_staff',
          'factor-team', '2026-10-01T09:30:00Z', '2026-10-01T10:30:00Z')`);
      const nested = vi
        .spyOn(db, "transaction")
        .mockImplementation(outer.transaction.bind(outer));
      try {
        const repository = new StaffTeamRepository(db);
        const requestId = () => `staff-team-${randomUUID()}`;
        const base = {
          actorUserId: admin,
          organizationId: staffOrganization,
        };

        const listed = await repository.list({
          organizationId: staffOrganization,
          requestId: requestId(),
        });
        expect(listed.map((member) => member.userId)).toEqual(
          expect.arrayContaining([admin, seller, operator]),
        );
        expect(listed.map((member) => member.userId)).not.toContain(customer);
        expect(
          listed.find((member) => member.userId === admin)?.lastMfaVerifiedAt,
        ).toBe("2026-10-01T09:30:00Z");
        expect(
          listed.find((member) => member.userId === seller)?.lastMfaVerifiedAt,
        ).toBeNull();

        // Only a commerce administrator's own membership authorizes.
        await expect(
          repository.prepareInvite({
            ...base,
            actorUserId: operator,
            email: "new@fil.one",
            requestId: requestId(),
          }),
        ).rejects.toThrow("STAFF_TEAM_ADMIN_REQUIRED");

        // Invite a new person.
        const email = `invitee-${randomUUID()}@fil.one`;
        const prepared = await repository.prepareInvite({
          ...base,
          email,
          requestId: requestId(),
        });
        expect(prepared.plan).toEqual({ kind: "create" });
        const invited = await repository.completeInvite({
          ...base,
          email,
          name: "New seller",
          role: "revenue",
          binding: {
            workosUserId: "user_invitee",
            workosMembershipId: "om_invitee",
          },
          requestId: requestId(),
        });
        expect(invited).toMatchObject({
          email,
          role: "revenue",
          mfaEnrolled: false,
        });
        await expect(
          repository.prepareInvite({ ...base, email, requestId: requestId() }),
        ).rejects.toThrow("STAFF_TEAM_ALREADY_MEMBER");
        await expect(
          repository.prepareInvite({
            ...base,
            // A customer identity's address can never become staff.
            email: `team-${customer}@fil.one`,
            requestId: requestId(),
          }),
        ).rejects.toThrow("STAFF_TEAM_IDENTITY_CONFLICT");

        // Granting and removing roles.
        const grant = (
          userId: string,
          role: StaffTeamRole,
          expectedRowVersion: number,
          actorUserId = admin,
        ) =>
          repository.grantRole({
            ...base,
            actorUserId,
            userId,
            role,
            expectedRowVersion,
            requestId: requestId(),
          });
        const revoke = (
          userId: string,
          role: StaffTeamRole,
          expectedRowVersion: number,
        ) =>
          repository.revokeRole({
            ...base,
            userId,
            role,
            expectedRowVersion,
            reason: "Moved to the legal desk",
            requestId: requestId(),
          });
        const storedRoles = async (userId: string) =>
          (
            await outer
              .select({ role: membershipRoles.role })
              .from(membershipRoles)
              .innerJoin(
                memberships,
                eq(memberships.id, membershipRoles.membershipId),
              )
              .where(eq(memberships.userId, userId))
          )
            .map((row) => row.role)
            .sort();
        await expect(grant(admin, "legal_approver", 1)).rejects.toThrow(
          "STAFF_TEAM_SELF_CHANGE",
        );
        await expect(grant(customer, "revenue", 1)).rejects.toThrow(
          "STAFF_TEAM_MEMBER_NOT_FOUND",
        );
        await expect(
          grant(invited.userId, "legal_approver", invited.rowVersion + 5),
        ).rejects.toThrow("STAFF_TEAM_STALE");
        await expect(
          grant(invited.userId, "owner" as StaffTeamRole, invited.rowVersion),
        ).rejects.toThrow("STAFF_TEAM_ROLE_NOT_MANAGED");
        await expect(
          grant(invited.userId, "revenue", invited.rowVersion),
        ).rejects.toThrow("STAFF_TEAM_ROLE_UNCHANGED");
        const lawyer = await grant(
          invited.userId,
          "legal_approver",
          invited.rowVersion,
        );
        expect(lawyer).toMatchObject({
          role: "revenue",
          roles: ["revenue", "legal_approver"],
          rowVersion: invited.rowVersion + 1,
        });
        expect(await storedRoles(invited.userId)).toEqual([
          "legal_approver",
          "revenue",
        ]);
        // The screen that granted it holds an old version now.
        await expect(
          grant(invited.userId, "finance_approver", invited.rowVersion),
        ).rejects.toThrow("STAFF_TEAM_STALE");
        await expect(
          revoke(invited.userId, "finance_approver", lawyer.rowVersion),
        ).rejects.toThrow("STAFF_TEAM_ROLE_NOT_HELD");

        // Removing the primary role moves the primary to what is left.
        const moved = await revoke(
          invited.userId,
          "revenue",
          lawyer.rowVersion,
        );
        expect(moved).toMatchObject({
          role: "legal_approver",
          roles: ["legal_approver"],
          rowVersion: lawyer.rowVersion + 1,
        });
        expect(await storedRoles(invited.userId)).toEqual(["legal_approver"]);
        await expect(
          revoke(invited.userId, "legal_approver", moved.rowVersion),
        ).rejects.toThrow("STAFF_TEAM_LAST_ROLE");
        const listedAgain = await repository.list({
          organizationId: staffOrganization,
          requestId: requestId(),
        });
        expect(
          listedAgain.find((member) => member.userId === invited.userId),
        ).toMatchObject({ role: "legal_approver", roles: ["legal_approver"] });

        // An extra administrator role carries the authority with it.
        await expect(
          repository.prepareInvite({
            ...base,
            actorUserId: operator,
            email: "later@fil.one",
            requestId: requestId(),
          }),
        ).rejects.toThrow("STAFF_TEAM_ADMIN_REQUIRED");
        const operatorAdmin = await grant(operator, "commerce_admin", 1);
        expect(operatorAdmin).toMatchObject({
          role: "internal_operator",
          roles: ["internal_operator", "commerce_admin"],
        });
        await expect(
          repository.prepareInvite({
            ...base,
            actorUserId: operator,
            email: "later@fil.one",
            requestId: requestId(),
          }),
        ).resolves.toMatchObject({ plan: { kind: "create" } });

        // Every other administrator hears about it; the one who acted does not.
        const consoleReads = new OwnerConsoleRepository(db);
        const operatorNotices = await consoleReads.unreadNotices({
          viewerUserId: operator,
          requestId: requestId(),
        });
        expect(operatorNotices.map((notice) => notice.eventType)).toEqual(
          expect.arrayContaining(["staff.role_granted"]),
        );
        expect(operatorNotices[0]).toMatchObject({
          actor: { userId: admin, name: "Team commerce_admin" },
        });
        const adminNotices = await consoleReads.unreadNotices({
          viewerUserId: admin,
          requestId: requestId(),
        });
        expect(adminNotices).toEqual([]);
        const [firstNotice] = operatorNotices;
        if (!firstNotice) throw new Error("No notice for the operator");
        // Nobody marks another person's notice read.
        await expect(
          consoleReads.markNoticesRead({
            viewerUserId: admin,
            noticeIds: operatorNotices.map((notice) => notice.noticeId),
            requestId: requestId(),
          }),
        ).resolves.toBe(0);
        await expect(
          consoleReads.markNoticesRead({
            viewerUserId: operator,
            noticeIds: [firstNotice.noticeId],
            requestId: requestId(),
          }),
        ).resolves.toBe(1);
        expect(
          (
            await consoleReads.unreadNotices({
              viewerUserId: operator,
              requestId: requestId(),
            })
          ).map((notice) => notice.noticeId),
        ).not.toContain(firstNotice.noticeId);
        await consoleReads.markNoticesRead({
          viewerUserId: operator,
          noticeIds: "all",
          requestId: requestId(),
        });
        expect(
          await consoleReads.unreadNotices({
            viewerUserId: operator,
            requestId: requestId(),
          }),
        ).toEqual([]);
        const security = await consoleReads.securityEvents({
          requestId: requestId(),
        });
        expect(security.map((event) => event.eventType)).toEqual(
          expect.arrayContaining(["staff.role_granted", "staff.role_revoked"]),
        );

        // Removing the operator's administration needs another administrator,
        // and there is one: the admin who granted it.
        const operatorBack = await revoke(
          operator,
          "commerce_admin",
          operatorAdmin.rowVersion,
        );
        expect(operatorBack.roles).toEqual(["internal_operator"]);

        // Deactivation keeps the identity and its history.
        const target = await repository.prepareDeactivate({
          ...base,
          userId: seller,
          expectedRowVersion: 1,
          requestId: requestId(),
        });
        expect(target.member.workosMembershipId).toMatch(/^om_/);
        await repository.completeDeactivate({
          ...base,
          userId: seller,
          expectedRowVersion: 1,
          workos: "deactivated",
          requestId: requestId(),
        });
        expect(
          await outer
            .select()
            .from(memberships)
            .where(eq(memberships.userId, seller)),
        ).toHaveLength(0);
        expect(
          await outer
            .select()
            .from(commerceUsers)
            .where(eq(commerceUsers.id, seller)),
        ).toHaveLength(1);
        const sellerEmail = `team-${seller}@fil.one`;
        expect(
          await repository.prepareInvite({
            ...base,
            email: sellerEmail,
            requestId: requestId(),
          }),
        ).toMatchObject({ plan: { kind: "restore", userId: seller } });

        const events = (
          await outer
            .select({
              eventType: auditEvents.eventType,
              actor: auditEvents.actor,
            })
            .from(auditEvents)
            .where(eq(auditEvents.aggregateType, "membership"))
        ).filter((event) => (event.actor as { id?: string }).id === admin);
        expect(events.map((event) => event.eventType).sort()).toEqual([
          "staff.deactivated",
          "staff.invited",
          "staff.role_granted",
          "staff.role_granted",
          "staff.role_revoked",
          "staff.role_revoked",
        ]);
      } finally {
        nested.mockRestore();
      }
      throw rollback;
    })
    .catch((error: unknown) => error);
  expect(outcome).toBe(rollback);
});
