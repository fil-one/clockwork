import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as Db from "@clockwork/db";

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  database: vi.fn(),
  revalidate: vi.fn(),
  provision: vi.fn(),
  deactivateWorkos: vi.fn(),
  prepareInvite: vi.fn(),
  completeInvite: vi.fn(),
  changeRole: vi.fn(),
  prepareDeactivate: vi.fn(),
  completeDeactivate: vi.fn(),
}));

vi.mock("@/src/features/shell/staff-access", () => {
  class StaffPermissionError extends Error {
    public constructor() {
      super("STAFF_PERMISSION_REQUIRED");
    }
  }
  return {
    StaffPermissionError,
    requireStaffPermission: mocks.requirePermission,
  };
});
vi.mock("@/src/auth/session", () => ({ getCommerceSession: vi.fn() }));
vi.mock("@/src/db/service", () => ({
  getOptionalServiceDatabase: mocks.database,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@clockwork/integrations", () => ({
  provisionWorkosStaff: mocks.provision,
  deactivateWorkosStaffMembership: mocks.deactivateWorkos,
}));
vi.mock("@clockwork/db", async (importOriginal) => {
  // The real codes, so a renamed refusal fails here rather than in production.
  const { staffTeamErrorCodes, StaffTeamError } =
    await importOriginal<typeof Db>();
  return {
    staffTeamErrorCodes,
    StaffTeamError,
    StaffTeamRepository: class {
      prepareInvite = mocks.prepareInvite;
      completeInvite = mocks.completeInvite;
      changeRole = mocks.changeRole;
      prepareDeactivate = mocks.prepareDeactivate;
      completeDeactivate = mocks.completeDeactivate;
    },
  };
});

import { StaffPermissionError } from "@/src/features/shell/staff-access";
import { StaffTeamError } from "@clockwork/db";

import {
  changeStaffRole,
  deactivateStaffMember,
  inviteStaffMember,
} from "./actions";

const admin = {
  userId: "20000000-0000-4000-8000-000000000001",
  organizationId: "30000000-0000-4000-8000-000000000008",
  roles: ["commerce_admin", "internal_operator"],
  isInternalStaff: true,
  mfaVerified: true,
  recentAuthenticationVerified: true,
  providerBacked: true,
};
const seller = "20000000-0000-4000-8000-000000000002";
const invite = { name: "Sam Ortiz", email: "Sam@Fil.One", role: "revenue" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("WORKOS_API_KEY", "sk_test_private");
  vi.stubEnv("INTERNAL_EMAIL_DOMAINS", "fil.org,fil.one");
  mocks.requirePermission.mockResolvedValue({ ...admin });
  mocks.database.mockReturnValue({});
  mocks.prepareInvite.mockResolvedValue({
    plan: { kind: "create" },
    workosOrganizationId: "org_staff",
  });
  mocks.provision.mockResolvedValue({
    workosUserId: "user_sam",
    workosMembershipId: "om_sam",
  });
  mocks.completeInvite.mockResolvedValue({});
  mocks.changeRole.mockResolvedValue({});
  mocks.prepareDeactivate.mockResolvedValue({
    member: { workosMembershipId: "om_seller" },
    workosOrganizationId: "org_staff",
  });
  mocks.deactivateWorkos.mockResolvedValue("deactivated");
  mocks.completeDeactivate.mockResolvedValue(undefined);
});

describe("inviting staff", () => {
  it("creates the WorkOS identity without an email, then the commerce membership", async () => {
    await expect(inviteStaffMember(invite)).resolves.toEqual({ ok: true });
    expect(mocks.requirePermission).toHaveBeenCalledWith("staff:manage");
    expect(mocks.provision).toHaveBeenCalledWith(
      "sk_test_private",
      "org_staff",
      {
        email: "sam@fil.one",
        name: "Sam Ortiz",
      },
    );
    expect(mocks.completeInvite).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: admin.userId,
        organizationId: admin.organizationId,
        email: "sam@fil.one",
        role: "revenue",
        binding: { workosUserId: "user_sam", workosMembershipId: "om_sam" },
      }),
    );
    expect(mocks.provision.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.completeInvite.mock.invocationCallOrder[0] ?? 0,
    );
    expect(mocks.revalidate).toHaveBeenCalledWith("/internal/team");
  });

  it("refuses addresses outside the staff domains before calling WorkOS", async () => {
    await expect(
      inviteStaffMember({ ...invite, email: "sam@gmail.com" }),
    ).resolves.toEqual({ ok: false, code: "DOMAIN_NOT_ALLOWED" });
    expect(mocks.prepareInvite).not.toHaveBeenCalled();
    expect(mocks.provision).not.toHaveBeenCalled();
  });

  it.each([
    [{ ...invite, role: "finance_approver" }],
    [{ ...invite, role: "internal_operator" }],
    [{ ...invite, name: "" }],
    [{ ...invite, admin: true }],
    ["not an object"],
  ])("refuses malformed input %j", async (raw) => {
    await expect(inviteStaffMember(raw)).resolves.toEqual({
      ok: false,
      code: "INVALID_INPUT",
    });
    expect(mocks.provision).not.toHaveBeenCalled();
  });

  it("does not reach WorkOS when the database refuses the person", async () => {
    mocks.prepareInvite.mockRejectedValueOnce(
      new StaffTeamError("STAFF_TEAM_IDENTITY_CONFLICT"),
    );
    await expect(inviteStaffMember(invite)).resolves.toEqual({
      ok: false,
      code: "IDENTITY_CONFLICT",
    });
    expect(mocks.provision).not.toHaveBeenCalled();
  });

  it("reports a provider failure without recording anyone", async () => {
    mocks.provision.mockRejectedValueOnce(new Error("STAFF_WORKOS_HTTP_503"));
    await expect(inviteStaffMember(invite)).resolves.toEqual({
      ok: false,
      code: "PROVIDER_FAILED",
    });
    expect(mocks.completeInvite).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});

describe("authorization", () => {
  it("refuses anyone without staff management", async () => {
    mocks.requirePermission.mockRejectedValueOnce(
      new StaffPermissionError("staff:manage"),
    );
    await expect(inviteStaffMember(invite)).resolves.toEqual({
      ok: false,
      code: "NOT_PERMITTED",
    });
  });

  it("asks for a fresh sign-in check before a sensitive change", async () => {
    mocks.requirePermission.mockResolvedValueOnce({
      ...admin,
      recentAuthenticationVerified: false,
    });
    await expect(
      changeStaffRole({
        userId: seller,
        role: "commerce_admin",
        expectedRowVersion: 1,
      }),
    ).resolves.toEqual({ ok: false, code: "RECENT_SIGN_IN_REQUIRED" });
    expect(mocks.changeRole).not.toHaveBeenCalled();
  });

  it.each([
    { impersonation: { accountId: "x" } },
    { assistedSession: { id: "x" } },
    { authenticationProviderImpersonator: true },
    { mfaVerified: false },
  ])("refuses an assisted or unverified session %j", async (patch) => {
    mocks.requirePermission.mockResolvedValueOnce({ ...admin, ...patch });
    await expect(
      deactivateStaffMember({ userId: seller, expectedRowVersion: 1 }),
    ).resolves.toEqual({ ok: false, code: "DIRECT_SESSION_REQUIRED" });
    expect(mocks.deactivateWorkos).not.toHaveBeenCalled();
  });

  it("changes nothing in the demo or without a WorkOS key", async () => {
    mocks.requirePermission.mockResolvedValueOnce({
      ...admin,
      providerBacked: false,
    });
    await expect(inviteStaffMember(invite)).resolves.toEqual({
      ok: false,
      code: "NOT_CONFIGURED",
    });
    vi.stubEnv("WORKOS_API_KEY", "");
    await expect(inviteStaffMember(invite)).resolves.toEqual({
      ok: false,
      code: "NOT_CONFIGURED",
    });
    expect(mocks.provision).not.toHaveBeenCalled();
  });
});

describe("role changes", () => {
  it("passes the version the reader saw and maps guard refusals", async () => {
    await expect(
      changeStaffRole({
        userId: seller,
        role: "commerce_admin",
        expectedRowVersion: 4,
      }),
    ).resolves.toEqual({ ok: true });
    expect(mocks.changeRole).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: admin.userId,
        userId: seller,
        role: "commerce_admin",
        expectedRowVersion: 4,
      }),
    );
    for (const code of ["SELF_CHANGE", "LAST_ADMIN", "STALE"] as const) {
      mocks.changeRole.mockRejectedValueOnce(
        new StaffTeamError(`STAFF_TEAM_${code}`),
      );
      await expect(
        changeStaffRole({
          userId: seller,
          role: "revenue",
          expectedRowVersion: 4,
        }),
      ).resolves.toEqual({ ok: false, code });
    }
  });
});

describe("deactivation", () => {
  it("removes the WorkOS membership first, then the commerce membership", async () => {
    await expect(
      deactivateStaffMember({ userId: seller, expectedRowVersion: 2 }),
    ).resolves.toEqual({ ok: true });
    expect(mocks.deactivateWorkos).toHaveBeenCalledWith("sk_test_private", {
      organizationId: "org_staff",
      membershipId: "om_seller",
    });
    expect(mocks.completeDeactivate).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: seller,
        expectedRowVersion: 2,
        workos: "deactivated",
      }),
    );
    expect(mocks.deactivateWorkos.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.completeDeactivate.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("keeps commerce access untouched when WorkOS fails", async () => {
    mocks.deactivateWorkos.mockRejectedValueOnce(
      new Error("STAFF_WORKOS_HTTP_500"),
    );
    await expect(
      deactivateStaffMember({ userId: seller, expectedRowVersion: 2 }),
    ).resolves.toEqual({ ok: false, code: "PROVIDER_FAILED" });
    expect(mocks.completeDeactivate).not.toHaveBeenCalled();
  });

  it("records a membership WorkOS never linked without calling WorkOS", async () => {
    mocks.prepareDeactivate.mockResolvedValueOnce({
      member: { workosMembershipId: null },
      workosOrganizationId: "org_staff",
    });
    await deactivateStaffMember({ userId: seller, expectedRowVersion: 2 });
    expect(mocks.deactivateWorkos).not.toHaveBeenCalled();
    expect(mocks.completeDeactivate).toHaveBeenCalledWith(
      expect.objectContaining({ workos: "not_linked" }),
    );
  });
});
