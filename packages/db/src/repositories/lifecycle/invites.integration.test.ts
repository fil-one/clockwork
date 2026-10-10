import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createRuntimeDatabase } from "../../client";
import {
  InviteRepository,
  inviteToken,
  inviteTokenHash,
  type InvitePreview,
} from "./invites";
import { OrganizationOnboardingRepository } from "./organization-onboarding";

const { client, db } = createRuntimeDatabase({
  url:
    process.env.DIRECT_DATABASE_URL ??
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable",
  role: "clockwork_service",
  ssl: false,
});

const secret = "invite-integration-secret-of-at-least-32-bytes";
let clock = new Date();
const invitesRepo = new InviteRepository(db, secret, () => clock);
const onboarding = new OrganizationOnboardingRepository(db);
const operator: { kind: "user"; id: string; display: string } = {
  kind: "user",
  id: randomUUID(),
  display: "Ops",
};
const suffix = randomUUID().slice(0, 8);
const domain = `invites-${suffix}.test`;
let customerId = "";
let partnerId = "";
const tokenOf = (path: string) => path.replace("/invite/", "");

const person = (local: string, patch: Record<string, unknown> = {}) => ({
  workosUserId: `user_${local}${suffix}`,
  email: `${local}@${domain}`,
  emailVerified: true,
  name: `${local} Example`,
  workosMembershipId: `om_${local}${suffix}`,
  ...patch,
});

const organization = (side: string, name: string) =>
  onboarding.create(
    {
      id: randomUUID(),
      legalName: `${name} ${suffix}`,
      side,
      country: "US",
      currency: "USD",
      domain: `${name.toLowerCase()}-${domain}`,
      registeredAddress: {
        line1: "1 Main St",
        city: "Austin",
        postalCode: "78701",
      },
      billingContact: { name: "Ada", email: `ada@${domain}` },
      invoiceDeliveryEmail: `ada@${domain}`,
    },
    operator,
  );

beforeAll(async () => {
  // `invited_by` references a real person: a seeded staff member.
  const [staff] = await client<{ id: string }[]>`
    select id from commerce_users where is_internal_staff order by created_at limit 1`;
  if (!staff) throw new Error("A seeded staff member is required");
  operator.id = staff.id;
  customerId = (await organization("customer", "Customer")).organizationId;
  partnerId = (await organization("channel_partner", "Partner")).organizationId;
});

afterAll(async () => {
  await client.end();
});

describe("InviteRepository", () => {
  it("lets operations invite a first administrator and shows the link again", async () => {
    const created = await invitesRepo.createAsStaff(
      { organizationId: customerId, email: `Owner@${domain}`, role: "owner" },
      operator,
    );
    expect(created.path).toBe(
      `/invite/${inviteToken(secret, created.inviteId)}`,
    );
    const [stored] = await client<
      { token_hash: string; invited_by: string; email: string }[]
    >`select token_hash, invited_by, email from invites where id = ${created.inviteId}`;
    expect(stored).toEqual({
      token_hash: inviteTokenHash(tokenOf(created.path)),
      invited_by: operator.id,
      email: `owner@${domain}`,
    });
    const [listed] = await invitesRepo.list(customerId);
    expect(listed).toMatchObject({
      inviteId: created.inviteId,
      state: "pending",
      path: created.path,
    });
    await expect(
      invitesRepo.createAsStaff(
        { organizationId: customerId, email: `owner@${domain}`, role: "admin" },
        operator,
      ),
    ).rejects.toThrow("INVITE_ALREADY_PENDING");
  });

  it("refuses a role the organization's side cannot hold", async () => {
    await expect(
      invitesRepo.createAsStaff(
        {
          organizationId: customerId,
          email: `pa@${domain}`,
          role: "partner_admin",
        },
        operator,
      ),
    ).rejects.toThrow("INVITE_ROLE_NOT_ALLOWED_ON_SIDE");
    await expect(
      invitesRepo.createAsStaff(
        { organizationId: partnerId, email: `o@${domain}`, role: "owner" },
        operator,
      ),
    ).rejects.toThrow("INVITE_ROLE_NOT_ALLOWED_ON_SIDE");
    await expect(
      invitesRepo.createAsStaff(
        {
          organizationId: partnerId,
          email: `ops@${domain}`,
          role: "internal_operator",
        },
        operator,
      ),
    ).rejects.toThrow("INVITE_ROLE_NOT_ALLOWED_ON_SIDE");
    // An invite written around the check still cannot become a membership.
    const forgedId = randomUUID();
    const token = inviteToken(secret, forgedId);
    await client`insert into invites (id, organization_id, email, role, token_hash, expires_at)
      values (${forgedId}, ${customerId}, ${`forged@${domain}`}, 'partner_seller',
        ${inviteTokenHash(token)}, now() + interval '1 day')`;
    await expect(
      invitesRepo.accept({ token, ...person("forged") }),
    ).rejects.toThrow("INVITE_ROLE_NOT_ALLOWED_ON_SIDE");
  });

  it("accepts once, for the verified address it was sent to", async () => {
    const created = await invitesRepo.createAsStaff(
      {
        organizationId: partnerId,
        email: `lead@${domain}`,
        role: "partner_admin",
      },
      operator,
    );
    const token = tokenOf(created.path);
    const preview: InvitePreview = await invitesRepo.preview(token);
    expect(preview).toMatchObject({
      organizationId: partnerId,
      side: "channel_partner",
      role: "partner_admin",
      email: `lead@${domain}`,
      state: "pending",
    });
    await expect(
      invitesRepo.accept({ token, ...person("someone") }),
    ).rejects.toThrow("INVITE_EMAIL_MISMATCH");
    await expect(
      invitesRepo.accept({
        token,
        ...person("lead", { emailVerified: false }),
      }),
    ).rejects.toThrow("INVITE_EMAIL_UNVERIFIED");
    const accepted = await invitesRepo.accept({
      token,
      ...person("lead", { email: `LEAD@${domain}` }),
    });
    expect(accepted).toMatchObject({
      organizationId: partnerId,
      side: "channel_partner",
    });
    const [membership] = await client<
      { role: string; workos_membership_id: string; email: string }[]
    >`select m.role, m.workos_membership_id, u.email from memberships m
      join commerce_users u on u.id = m.user_id where m.id = ${accepted.membershipId}`;
    expect(membership).toEqual({
      role: "partner_admin",
      workos_membership_id: `om_lead${suffix}`,
      email: `lead@${domain}`,
    });
    const [invite] = await client<
      { accepted_by: string; accepted_at: Date | null }[]
    >`select accepted_by, accepted_at from invites where id = ${created.inviteId}`;
    expect(invite?.accepted_by).toBe(accepted.userId);
    expect(invite?.accepted_at).not.toBeNull();
    const events = await client<
      { event_type: string; actor: { id: string } }[]
    >`
      select event_type, actor from audit_events
      where aggregate_type = 'invite' and aggregate_id = ${created.inviteId}
      order by aggregate_version`;
    expect(events.map((event) => event.event_type)).toEqual([
      "membership.invited",
      "invite.accepted",
    ]);
    expect(events[1]?.actor.id).toBe(accepted.userId);
    await expect(
      invitesRepo.accept({ token, ...person("lead") }),
    ).rejects.toThrow("INVITE_ALREADY_ACCEPTED");
    expect((await invitesRepo.preview(token)).state).toBe("accepted");
    expect((await invitesRepo.list(partnerId))[0]).toMatchObject({
      state: "accepted",
      path: null,
    });
  });

  it("refuses an expired invite and an unknown link", async () => {
    const created = await invitesRepo.createAsStaff(
      { organizationId: customerId, email: `late@${domain}`, role: "admin" },
      operator,
    );
    clock = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);
    try {
      expect((await invitesRepo.preview(tokenOf(created.path))).state).toBe(
        "expired",
      );
      await expect(
        invitesRepo.accept({ token: tokenOf(created.path), ...person("late") }),
      ).rejects.toThrow("INVITE_EXPIRED");
    } finally {
      clock = new Date();
    }
    await expect(invitesRepo.preview("not-a-real-token")).rejects.toThrow(
      "INVITE_NOT_FOUND",
    );
    await expect(
      invitesRepo.accept({ token: "not-a-real-token", ...person("late") }),
    ).rejects.toThrow("INVITE_NOT_FOUND");
  });

  it("never rebinds an address another sign-in already holds", async () => {
    const first = await invitesRepo.createAsStaff(
      { organizationId: customerId, email: `pat@${domain}`, role: "member" },
      operator,
    );
    await invitesRepo.accept({ token: tokenOf(first.path), ...person("pat") });
    const second = await invitesRepo.createAsStaff(
      {
        organizationId: partnerId,
        email: `pat@${domain}`,
        role: "partner_seller",
      },
      operator,
    );
    await expect(
      invitesRepo.accept({
        token: tokenOf(second.path),
        ...person("pat", { workosUserId: `user_other${suffix}` }),
      }),
    ).rejects.toThrow("INVITE_IDENTITY_CONFLICT");
    // The same person joins a second organization under the same identity.
    const joined = await invitesRepo.accept({
      token: tokenOf(second.path),
      ...person("pat", { workosMembershipId: `om_pat2${suffix}` }),
    });
    expect(joined.organizationId).toBe(partnerId);
    await expect(
      invitesRepo.createAsStaff(
        { organizationId: customerId, email: `pat@${domain}`, role: "admin" },
        operator,
      ),
    ).rejects.toThrow("INVITE_ALREADY_MEMBER");
  });

  it("keeps Fil One staff out of customer and partner organizations", async () => {
    const [staff] = await client<{ workos_user_id: string; email: string }[]>`
      select workos_user_id, email from commerce_users
      where is_internal_staff limit 1`;
    if (!staff) return;
    const created = await invitesRepo.createAsStaff(
      { organizationId: customerId, email: staff.email, role: "member" },
      operator,
    );
    await expect(
      invitesRepo.accept({
        token: tokenOf(created.path),
        workosUserId: staff.workos_user_id,
        email: staff.email,
        emailVerified: true,
        name: "Staff",
        workosMembershipId: null,
      }),
    ).rejects.toThrow("INVITE_STAFF_IDENTITY");
    // The same refusal comes before any provider step, writing nothing.
    await expect(
      invitesRepo.checkAcceptable({
        token: tokenOf(created.path),
        workosUserId: staff.workos_user_id,
        email: staff.email,
        emailVerified: true,
      }),
    ).rejects.toThrow("INVITE_STAFF_IDENTITY");
  });

  it("checks an acceptance without writing anything", async () => {
    const created = await invitesRepo.createAsStaff(
      { organizationId: customerId, email: `new@${domain}`, role: "billing" },
      operator,
    );
    const token = tokenOf(created.path);
    await expect(
      invitesRepo.checkAcceptable({ token, ...person("new") }),
    ).resolves.toMatchObject({ organizationId: customerId, side: "customer" });
    const users = await client`select 1 from commerce_users
      where email = ${`new@${domain}`}`;
    expect(users).toHaveLength(0);
    // Someone already a member, or bound to another sign-in, is refused here.
    await expect(
      invitesRepo.checkAcceptable({
        token,
        ...person("new", { workosUserId: `user_pat${suffix}` }),
      }),
    ).rejects.toThrow("INVITE_IDENTITY_CONFLICT");
    // An invite written by an organization's own administrator to someone
    // who has since joined.
    const againId = randomUUID();
    const againToken = inviteToken(secret, againId);
    await client`insert into invites (id, organization_id, email, role, token_hash, expires_at)
      values (${againId}, ${partnerId}, ${`lead@${domain}`}, 'partner_seller',
        ${inviteTokenHash(againToken)}, now() + interval '1 day')`;
    await expect(
      invitesRepo.checkAcceptable({ token: againToken, ...person("lead") }),
    ).rejects.toThrow("INVITE_ALREADY_MEMBER");
    expect(await invitesRepo.workosMembershipInUse(`om_lead${suffix}`)).toBe(
      true,
    );
    expect(await invitesRepo.workosMembershipInUse(`om_nobody${suffix}`)).toBe(
      false,
    );
  });

  it("lets exactly one of two racing acceptances through", async () => {
    const created = await invitesRepo.createAsStaff(
      { organizationId: customerId, email: `race@${domain}`, role: "member" },
      operator,
    );
    const token = tokenOf(created.path);
    const results = await Promise.allSettled([
      invitesRepo.accept({ token, ...person("race") }),
      invitesRepo.accept({ token, ...person("race") }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const refused = results.find((r) => r.status === "rejected");
    expect(refused?.status === "rejected" && String(refused.reason)).toMatch(
      /INVITE_ALREADY_ACCEPTED|INVITE_ALREADY_MEMBER/u,
    );
    const memberships = await client`select 1 from memberships m
      join commerce_users u on u.id = m.user_id
      where u.email = ${`race@${domain}`} and m.organization_id = ${customerId}`;
    expect(memberships).toHaveLength(1);
    // The loser's provider step is undone and recorded on the invite.
    await invitesRepo.recordCompensation({
      inviteId: created.inviteId,
      workosUserId: `user_race${suffix}`,
      workosMembershipId: `om_race${suffix}`,
      outcome: "existing",
      action: "kept_in_use",
      reason: "INVITE_ALREADY_ACCEPTED",
    });
    const events = await client<
      { event_type: string; after: { action: string; workosUserId: string } }[]
    >`select event_type, after from audit_events
      where aggregate_type = 'invite' and aggregate_id = ${created.inviteId}
      order by aggregate_version`;
    expect(events.map((event) => event.event_type)).toEqual([
      "membership.invited",
      "invite.accepted",
      "invite.compensated",
    ]);
    expect(events[2]?.after).toMatchObject({
      action: "kept_in_use",
      workosUserId: `user_race${suffix}`,
    });
  });

  it("revokes a pending invite, audited, so the address can be invited again", async () => {
    const created = await invitesRepo.createAsStaff(
      { organizationId: customerId, email: `gone@${domain}`, role: "member" },
      operator,
    );
    await expect(
      invitesRepo.revokeAsStaff(
        { organizationId: partnerId, inviteId: created.inviteId },
        operator,
      ),
    ).rejects.toThrow("INVITE_NOT_FOUND");
    await invitesRepo.revokeAsStaff(
      { organizationId: customerId, inviteId: created.inviteId },
      operator,
    );
    const listed = (await invitesRepo.list(customerId)).find(
      (invite) => invite.inviteId === created.inviteId,
    );
    expect(listed).toMatchObject({ state: "expired", path: null });
    await expect(
      invitesRepo.accept({ token: tokenOf(created.path), ...person("gone") }),
    ).rejects.toThrow("INVITE_EXPIRED");
    await expect(
      invitesRepo.revokeAsStaff(
        { organizationId: customerId, inviteId: created.inviteId },
        operator,
      ),
    ).rejects.toThrow("INVITE_NOT_PENDING");
    const events = await client<{ event_type: string }[]>`
      select event_type from audit_events
      where aggregate_type = 'invite' and aggregate_id = ${created.inviteId}
      order by aggregate_version`;
    expect(events.map((event) => event.event_type)).toEqual([
      "membership.invited",
      "invite.revoked",
    ]);
    await expect(
      invitesRepo.createAsStaff(
        { organizationId: customerId, email: `gone@${domain}`, role: "member" },
        operator,
      ),
    ).resolves.toMatchObject({
      path: expect.stringMatching(/^\/invite\//u) as unknown,
    });
  });

  it("voids links a rotated secret no longer derives, without blocking a new invite", async () => {
    const created = await invitesRepo.createAsStaff(
      { organizationId: customerId, email: `rot@${domain}`, role: "member" },
      operator,
    );
    const rotated = new InviteRepository(
      db,
      "rotated-invite-secret-of-at-least-32-bytes",
      () => clock,
    );
    const listed = (await rotated.list(customerId)).find(
      (invite) => invite.inviteId === created.inviteId,
    );
    expect(listed).toMatchObject({ state: "void", path: null });
    const replacement = await rotated.createAsStaff(
      { organizationId: customerId, email: `rot@${domain}`, role: "member" },
      operator,
    );
    expect(
      (await rotated.list(customerId)).find(
        (invite) => invite.inviteId === replacement.inviteId,
      ),
    ).toMatchObject({ state: "pending", path: replacement.path });
    // The link sent before the rotation still hashes to its row, and is
    // refused anyway; the new link works.
    const oldToken = tokenOf(created.path);
    expect((await rotated.preview(oldToken)).state).toBe("void");
    await expect(
      rotated.checkAcceptable({ token: oldToken, ...person("rot") }),
    ).rejects.toThrow("INVITE_NOT_FOUND");
    await expect(
      rotated.accept({ token: oldToken, ...person("rot") }),
    ).rejects.toThrow("INVITE_NOT_FOUND");
    await expect(
      rotated.accept({ token: tokenOf(replacement.path), ...person("rot") }),
    ).resolves.toMatchObject({ organizationId: customerId });
    await rotated.revokeAsStaff(
      { organizationId: customerId, inviteId: created.inviteId },
      operator,
    );
  });
});
