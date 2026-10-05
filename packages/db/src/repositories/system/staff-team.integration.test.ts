import { randomUUID } from "node:crypto";
import { afterAll, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createRuntimeDatabase } from "../../client";
import { auditEvents, commerceUsers, memberships } from "../../schema";
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

it("invites, changes roles and deactivates staff with audit events and guard rails", async () => {
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

        // Role changes.
        await expect(
          repository.changeRole({
            ...base,
            userId: admin,
            role: "revenue",
            expectedRowVersion: 1,
            requestId: requestId(),
          }),
        ).rejects.toThrow("STAFF_TEAM_SELF_CHANGE");
        await expect(
          repository.changeRole({
            ...base,
            userId: customer,
            role: "revenue",
            expectedRowVersion: 1,
            requestId: requestId(),
          }),
        ).rejects.toThrow("STAFF_TEAM_MEMBER_NOT_FOUND");
        await expect(
          repository.changeRole({
            ...base,
            userId: invited.userId,
            role: "commerce_admin",
            expectedRowVersion: invited.rowVersion + 5,
            requestId: requestId(),
          }),
        ).rejects.toThrow("STAFF_TEAM_STALE");
        const promoted = await repository.changeRole({
          ...base,
          userId: invited.userId,
          role: "commerce_admin",
          expectedRowVersion: invited.rowVersion,
          requestId: requestId(),
        });
        expect(promoted.role).toBe("commerce_admin");
        expect(promoted.rowVersion).toBe(invited.rowVersion + 1);

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
          "staff.role_changed",
        ]);
      } finally {
        nested.mockRestore();
      }
      throw rollback;
    })
    .catch((error: unknown) => error);
  expect(outcome).toBe(rollback);
});
