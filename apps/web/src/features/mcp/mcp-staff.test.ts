import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CommerceSession } from "@/src/auth/session";
import {
  staffPermissions,
  type TeamView,
} from "@/src/features/internal-ops/team/model";

import type { McpToolContext } from "./tool";

const mocks = vi.hoisted(() => ({
  requireStaffPermission: vi.fn(),
  loadTeamView: vi.fn(),
}));

vi.mock("@/src/features/shell/staff-access", () => ({
  requireStaffPermission: mocks.requireStaffPermission,
}));
vi.mock("@/src/features/internal-ops/team/server", () => ({
  loadTeamView: mocks.loadTeamView,
}));
vi.mock("@workos-inc/authkit-nextjs", () => ({
  getTokenClaims: vi.fn(),
  withAuth: vi.fn(),
  getWorkOS: vi.fn(),
  signOut: vi.fn(),
}));

const { listStaff, prepareStaffRoleChange } = await import("./tools/staff");
const { runTool } = await import("./server");

const actorId = "20000000-0000-4000-8000-000000000001";
const targetId = "20000000-0000-4000-8000-000000000002";
const session = {
  userId: actorId,
  organizationId: "30000000-0000-4000-8000-000000000008",
  accountIds: [],
  roles: ["commerce_admin"],
  permissions: staffPermissions(["commerce_admin"]),
  side: "fil_one",
  isInternalStaff: true,
  mfaVerified: true,
  recentAuthenticationVerified: false,
  profile: { name: "Administrator", email: "admin@clockwork.test" },
  memberships: [],
  providerBacked: true,
  authenticationSource: "access-token",
  accessToken: {
    id: "019a44ae-0000-7000-8000-0000000e0001",
    name: "MCP test",
    scope: "read_write",
    expiresAt: "2027-01-01T00:00:00.000Z",
  },
} satisfies CommerceSession;

const context = (): McpToolContext => ({
  session,
  origin: "https://commerce.fil.one",
  targets: {},
});

function view(): TeamView {
  return {
    mode: "live",
    actorUserId: actorId,
    emailDomains: ["clockwork.test"],
    members: [
      {
        userId: actorId,
        name: "Administrator",
        email: "admin@clockwork.test",
        role: "commerce_admin",
        roles: ["commerce_admin"],
        mfa: { state: "enrolled" },
        addedAt: "2026-10-01T00:00:00.000Z",
        rowVersion: 1,
      },
      {
        userId: targetId,
        name: "Seller",
        email: "seller@clockwork.test",
        role: "revenue",
        roles: ["revenue"],
        mfa: { state: "enrolled" },
        addedAt: "2026-10-01T00:00:00.000Z",
        rowVersion: 7,
      },
    ],
  };
}

const args = {
  userId: targetId,
  action: "grant",
  role: "commerce_admin",
  expectedRowVersion: 7,
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireStaffPermission.mockResolvedValue(session);
  mocks.loadTeamView.mockResolvedValue(view());
});

describe("MCP staff review workflow", () => {
  it("reads the current team with effective permissions and versions", async () => {
    const result = await listStaff.run({}, context());
    expect(mocks.requireStaffPermission).toHaveBeenCalledWith("staff:manage");
    expect(result).toMatchObject({
      actorUserId: actorId,
      members: [
        { userId: actorId },
        { userId: targetId, rowVersion: 7, roles: ["revenue"] },
      ],
      link: "https://commerce.fil.one/internal/team",
    });
    expect(result).toHaveProperty(
      "members.0.permissions",
      expect.arrayContaining(["staff:manage"]),
    );
  });

  it.each([listStaff, prepareStaffRoleChange])(
    "refuses $name before reading staff when permission is missing",
    async (tool) => {
      mocks.requireStaffPermission.mockRejectedValue(new Error("Denied"));
      await expect(tool.run(args, context())).rejects.toThrow("Denied");
      expect(mocks.loadTeamView).not.toHaveBeenCalled();
    },
  );

  it.each(["demo", "unavailable"])(
    "never substitutes %s data for a live team",
    async (mode) => {
      mocks.loadTeamView.mockResolvedValue({ ...view(), mode });
      await expect(listStaff.run({}, context())).rejects.toMatchObject({
        code: "UNAVAILABLE",
      });
    },
  );

  it("prepares the precise actor and version bound review without granting recent authentication", async () => {
    const ctx = context();
    const result = await prepareStaffRoleChange.run(args, ctx);
    expect(result).toMatchObject({
      status: "awaiting_browser_confirmation",
      requiresBrowserConfirmation: true,
      member: { userId: targetId, email: "seller@clockwork.test" },
      expectedRowVersion: 7,
      before: { roles: ["revenue"] },
      after: {
        roles: ["revenue", "commerce_admin"],
      },
    });
    expect(result).toHaveProperty(
      "after.permissions",
      expect.arrayContaining(["staff:manage"]),
    );
    const link = new URL((result as { reviewUrl: string }).reviewUrl);
    expect(link.origin + link.pathname).toBe(
      "https://commerce.fil.one/internal/team",
    );
    expect(Object.fromEntries(link.searchParams)).toEqual({
      reviewAction: "grant",
      reviewUserId: targetId,
      reviewRole: "commerce_admin",
      reviewVersion: "7",
      reviewActorId: actorId,
    });
    expect(ctx.targets).toEqual({ userId: targetId });
    expect(session.recentAuthenticationVerified).toBe(false);
  });

  it.each([
    [{ expectedRowVersion: 6 }, "STAFF_TEAM_STALE"],
    [{ userId: actorId, expectedRowVersion: 1 }, "STAFF_TEAM_SELF_CHANGE"],
    [
      { userId: "20000000-0000-4000-8000-000000000003" },
      "STAFF_TEAM_MEMBER_NOT_FOUND",
    ],
    [{ role: "revenue" }, "STAFF_TEAM_ROLE_UNCHANGED"],
    [{ action: "revoke" }, "STAFF_TEAM_ROLE_NOT_HELD"],
    [{ action: "revoke", role: "revenue" }, "STAFF_TEAM_LAST_ROLE"],
  ])("refuses invalid or outdated preparation %j", async (change, code) => {
    await expect(
      prepareStaffRoleChange.run({ ...args, ...change }, context()),
    ).rejects.toMatchObject({ code });
  });

  it("refuses an actor mismatch", async () => {
    mocks.loadTeamView.mockResolvedValue({ ...view(), actorUserId: targetId });
    await expect(
      prepareStaffRoleChange.run(args, context()),
    ).rejects.toMatchObject({ code: "STAFF_TEAM_REVIEW_ACTOR" });
  });

  it("refuses read-only preparation before reading the team and audits the refusal", async () => {
    const ctx = context();
    ctx.session = {
      ...session,
      accessToken: { ...session.accessToken, scope: "read" },
    };
    const record = vi.fn().mockResolvedValue(undefined);
    const result = await runTool(prepareStaffRoleChange, args, ctx, record);
    expect(result.isError).toBe(true);
    expect(mocks.loadTeamView).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledWith({
      tool: "prepare_staff_role_change",
      outcome: "refused",
      code: "READ_ONLY_TOKEN",
      targets: {},
    });
  });

  it("audits successful preparation against the selected user", async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    const result = await runTool(
      prepareStaffRoleChange,
      args,
      context(),
      record,
    );
    expect(result.isError).not.toBe(true);
    expect(record).toHaveBeenCalledOnce();
    expect(record).toHaveBeenCalledWith({
      tool: "prepare_staff_role_change",
      outcome: "ok",
      targets: { userId: targetId },
    });
  });
});
