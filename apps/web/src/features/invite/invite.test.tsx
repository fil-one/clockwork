import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  SessionExpiredError: class SessionExpiredError extends Error {},
  configured: vi.fn(() => true),
  session: vi.fn(),
  withAuth: vi.fn(),
  switchOrganization: vi.fn(),
  provision: vi.fn(),
  remove: vi.fn(),
  deactivate: vi.fn(),
  repository: {
    preview: vi.fn(),
    checkAcceptable: vi.fn(),
    accept: vi.fn(),
    workosMembershipInUse: vi.fn(),
    recordCompensation: vi.fn(),
  },
}));
vi.mock("@/src/auth/session", () => ({
  workosAuthenticationConfigured: mocks.configured,
  getVerifiedWorkosSession: mocks.session,
  SessionExpiredError: mocks.SessionExpiredError,
}));
vi.mock("@workos-inc/authkit-nextjs", () => ({
  withAuth: mocks.withAuth,
  switchToOrganization: mocks.switchOrganization,
}));
vi.mock("@clockwork/integrations", () => ({
  provisionWorkosStaff: mocks.provision,
  removeWorkosOrganizationMembership: mocks.remove,
  deactivateWorkosStaffMembership: mocks.deactivate,
}));
vi.mock("./server", () => ({
  inviteRepository: () => mocks.repository,
  inviteTokenShape: /^[A-Za-z0-9_-]{43}$/u,
}));

import InvitePage from "@/app/invite/[token]/page";
import { acceptInvite } from "./actions";

const token = "a".repeat(43);
const workosOrganizationId = "org_01PARTNER";
const preview = (patch: Record<string, unknown> = {}) => ({
  inviteId: "019a44ac-0000-7000-8000-0000000000e1",
  organizationId: "019a44ac-0000-7000-8000-0000000000f1",
  organizationName: "Bluefin Data Co.",
  side: "channel_partner",
  role: "partner_admin",
  email: "lead@bluefin.test",
  expiresAt: "2026-10-24T00:00:00.000Z",
  state: "pending",
  workosOrganizationId,
  ...patch,
});
const signedIn = (patch: Record<string, unknown> = {}) => ({
  user: {
    id: "user_01LEAD",
    email: "Lead@bluefin.test",
    emailVerified: true,
    firstName: "Lee",
    lastName: "Ad",
    ...patch,
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.configured.mockReturnValue(true);
  vi.stubEnv("WORKOS_API_KEY", "sk_test_invite");
  mocks.session.mockResolvedValue(signedIn());
  mocks.withAuth.mockResolvedValue(signedIn());
  mocks.repository.preview.mockResolvedValue(preview());
  mocks.repository.checkAcceptable.mockResolvedValue({
    inviteId: "invite-1",
    organizationId: "o",
    side: "channel_partner",
    workosOrganizationId,
  });
  mocks.repository.workosMembershipInUse.mockResolvedValue(false);
  mocks.repository.recordCompensation.mockResolvedValue(undefined);
  mocks.remove.mockResolvedValue("removed");
  mocks.deactivate.mockResolvedValue("deactivated");
  mocks.repository.accept.mockResolvedValue({
    membershipId: "m",
    organizationId: "o",
    userId: "u",
    side: "channel_partner",
  });
  mocks.provision.mockResolvedValue({
    workosUserId: "user_01LEAD",
    workosMembershipId: "om_01LEAD",
    outcome: "created",
  });
});

const refusedAfterProvider = () =>
  mocks.repository.accept.mockRejectedValue(
    new Error("INVITE_ALREADY_ACCEPTED"),
  );
const compensation = (action: string, outcome: string) => ({
  inviteId: "invite-1",
  workosUserId: "user_01LEAD",
  workosMembershipId: "om_01LEAD",
  outcome,
  action,
  reason: "INVITE_ALREADY_ACCEPTED",
});

describe("acceptInvite", () => {
  it("joins the WorkOS organization, records the membership and switches to it", async () => {
    await acceptInvite(token);
    expect(mocks.provision).toHaveBeenCalledWith(
      "sk_test_invite",
      workosOrganizationId,
      { email: "Lead@bluefin.test", name: "Lee Ad" },
    );
    expect(mocks.repository.accept).toHaveBeenCalledWith({
      token,
      workosUserId: "user_01LEAD",
      email: "Lead@bluefin.test",
      emailVerified: true,
      name: "Lee Ad",
      workosMembershipId: "om_01LEAD",
    });
    expect(mocks.switchOrganization).toHaveBeenCalledWith(
      workosOrganizationId,
      { returnTo: "/partner" },
    );
  });

  it("refuses a malformed link before reading anything", async () => {
    await expect(acceptInvite("short")).resolves.toEqual({
      ok: false,
      code: "INVITE_NOT_FOUND",
    });
    await expect(acceptInvite(42)).resolves.toEqual({
      ok: false,
      code: "INVITE_NOT_FOUND",
    });
    expect(mocks.session).not.toHaveBeenCalled();
  });

  it.each([
    "INVITE_EXPIRED",
    "INVITE_ALREADY_ACCEPTED",
    "INVITE_EMAIL_MISMATCH",
    "INVITE_EMAIL_UNVERIFIED",
    "INVITE_STAFF_IDENTITY",
    "INVITE_ALREADY_MEMBER",
    "INVITE_IDENTITY_CONFLICT",
  ])("refuses %s before WorkOS is asked anything", async (code) => {
    mocks.repository.checkAcceptable.mockRejectedValue(new Error(code));
    await expect(acceptInvite(token)).resolves.toEqual({ ok: false, code });
    expect(mocks.provision).not.toHaveBeenCalled();
    expect(mocks.repository.accept).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("waits for an organization WorkOS does not have yet", async () => {
    mocks.repository.checkAcceptable.mockResolvedValue({
      inviteId: "invite-1",
      organizationId: "o",
      side: "customer",
      workosOrganizationId: null,
    });
    await expect(acceptInvite(token)).resolves.toEqual({
      ok: false,
      code: "INVITE_ORGANIZATION_NOT_READY",
    });
    expect(mocks.provision).not.toHaveBeenCalled();
  });

  it("refuses an impersonated session", async () => {
    mocks.session.mockResolvedValue({
      ...signedIn(),
      impersonator: { email: "support@fil.one" },
    });
    await expect(acceptInvite(token)).resolves.toEqual({
      ok: false,
      code: "INVITE_IMPERSONATION_REFUSED",
    });
    expect(mocks.repository.checkAcceptable).not.toHaveBeenCalled();
    expect(mocks.provision).not.toHaveBeenCalled();
  });

  it("removes a membership it created when WorkOS knows the address as someone else", async () => {
    mocks.provision.mockResolvedValue({
      workosUserId: "user_01OTHER",
      workosMembershipId: "om_x",
      outcome: "created",
    });
    await expect(acceptInvite(token)).resolves.toEqual({
      ok: false,
      code: "INVITE_IDENTITY_CONFLICT",
    });
    expect(mocks.repository.accept).not.toHaveBeenCalled();
    expect(mocks.remove).toHaveBeenCalledWith("sk_test_invite", {
      organizationId: workosOrganizationId,
      membershipId: "om_x",
    });
    expect(mocks.repository.recordCompensation).toHaveBeenCalledWith(
      expect.objectContaining({
        workosUserId: "user_01OTHER",
        workosMembershipId: "om_x",
        action: "removed",
      }),
    );
  });

  it("deletes a membership provisioning created when Commerce refuses after it", async () => {
    refusedAfterProvider();
    await expect(acceptInvite(token)).resolves.toEqual({
      ok: false,
      code: "INVITE_ALREADY_ACCEPTED",
    });
    expect(mocks.remove).toHaveBeenCalledWith("sk_test_invite", {
      organizationId: workosOrganizationId,
      membershipId: "om_01LEAD",
    });
    expect(mocks.deactivate).not.toHaveBeenCalled();
    expect(mocks.repository.recordCompensation).toHaveBeenCalledWith(
      compensation("removed", "created"),
    );
    expect(mocks.switchOrganization).not.toHaveBeenCalled();
  });

  it("deactivates again a membership provisioning reactivated", async () => {
    refusedAfterProvider();
    mocks.provision.mockResolvedValue({
      workosUserId: "user_01LEAD",
      workosMembershipId: "om_01LEAD",
      outcome: "reactivated",
    });
    await acceptInvite(token);
    expect(mocks.deactivate).toHaveBeenCalledWith("sk_test_invite", {
      organizationId: workosOrganizationId,
      membershipId: "om_01LEAD",
    });
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.repository.recordCompensation).toHaveBeenCalledWith(
      compensation("deactivated", "reactivated"),
    );
  });

  it("leaves alone a membership that was already active", async () => {
    refusedAfterProvider();
    mocks.provision.mockResolvedValue({
      workosUserId: "user_01LEAD",
      workosMembershipId: "om_01LEAD",
      outcome: "existing",
    });
    await acceptInvite(token);
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.deactivate).not.toHaveBeenCalled();
    expect(mocks.repository.recordCompensation).toHaveBeenCalledWith(
      compensation("kept_existing", "existing"),
    );
  });

  it("keeps a membership a Commerce membership already holds (the race winner's)", async () => {
    refusedAfterProvider();
    mocks.repository.workosMembershipInUse.mockResolvedValue(true);
    await expect(acceptInvite(token)).resolves.toEqual({
      ok: false,
      code: "INVITE_ALREADY_ACCEPTED",
    });
    expect(mocks.repository.workosMembershipInUse).toHaveBeenCalledWith(
      "om_01LEAD",
    );
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.repository.recordCompensation).toHaveBeenCalledWith(
      compensation("kept_in_use", "created"),
    );
  });

  it("words a provider failure, and still refuses when the undo fails", async () => {
    mocks.provision.mockRejectedValue(new Error("STAFF_WORKOS_HTTP_500"));
    await expect(acceptInvite(token)).resolves.toEqual({
      ok: false,
      code: "INVITE_FAILED",
    });
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.repository.recordCompensation).not.toHaveBeenCalled();
    mocks.provision.mockResolvedValue({
      workosUserId: "user_01LEAD",
      workosMembershipId: "om_01LEAD",
      outcome: "created",
    });
    mocks.repository.accept.mockRejectedValue(new Error("db down"));
    mocks.remove.mockRejectedValue(new Error("STAFF_WORKOS_HTTP_503"));
    mocks.repository.recordCompensation.mockRejectedValue(new Error("db down"));
    await expect(acceptInvite(token)).resolves.toEqual({
      ok: false,
      code: "INVITE_FAILED",
    });
    expect(mocks.remove).toHaveBeenCalledOnce();
    expect(mocks.repository.recordCompensation).toHaveBeenCalledWith(
      expect.objectContaining({ action: "failed", reason: "unexpected" }),
    );
  });

  it("asks for a reload when the session expired, and refuses unconfigured", async () => {
    mocks.session.mockRejectedValue(new mocks.SessionExpiredError());
    await expect(acceptInvite(token)).resolves.toEqual({
      ok: false,
      code: "SESSION_EXPIRED",
    });
    mocks.configured.mockReturnValue(false);
    await expect(acceptInvite(token)).resolves.toEqual({
      ok: false,
      code: "INVITE_UNAVAILABLE",
    });
  });
});

describe("the invite page", () => {
  const page = async () =>
    render(await InvitePage({ params: Promise.resolve({ token }) }));

  it("says who invited whom, as what, and offers to accept", async () => {
    await page();
    expect(
      screen.getByText(
        "Bluefin Data Co. invited lead@bluefin.test to Fil One Commerce as Partner administrator.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("You are signed in as Lead@bluefin.test."),
    ).toBeInTheDocument();
    mocks.switchOrganization.mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole("button", { name: "Accept invitation" }));
    await waitFor(() => expect(mocks.repository.accept).toHaveBeenCalled());
  });

  it("tells a person signed in with another address what to do", async () => {
    mocks.withAuth.mockResolvedValue(signedIn({ email: "x@other.test" }));
    await page();
    expect(
      screen.getByText(
        "This invitation is for lead@bluefin.test. Sign out, then sign in with that address to accept it.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Accept invitation" }),
    ).not.toBeInTheDocument();
  });

  it("offers nothing to an impersonated session", async () => {
    mocks.withAuth.mockResolvedValue({
      ...signedIn(),
      impersonator: { email: "support@fil.one" },
    });
    await page();
    expect(
      screen.getByText(
        "An invitation cannot be accepted while acting as someone else. The invited person accepts it from their own sign-in.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Accept invitation" }),
    ).not.toBeInTheDocument();
  });

  it("treats a link from before a secret rotation as unknown", async () => {
    mocks.repository.preview.mockResolvedValue(preview({ state: "void" }));
    await page();
    expect(
      screen.getByText(
        "This invitation link is not valid. Check that you copied all of it, or ask for a new one.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Bluefin Data Co\./u)).not.toBeInTheDocument();
  });

  it("explains an expired or unknown link", async () => {
    mocks.repository.preview.mockResolvedValue(preview({ state: "expired" }));
    await page();
    expect(
      screen.getByText(
        "This invitation has expired. Ask the person who invited you for a new one.",
      ),
    ).toBeInTheDocument();
  });
});
