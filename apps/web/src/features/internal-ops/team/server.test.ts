import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  database: vi.fn(),
  list: vi.fn(),
}));
vi.mock("@/src/auth/session", () => ({ getCommerceSession: mocks.session }));
vi.mock("@/src/db/service", () => ({
  getOptionalServiceDatabase: mocks.database,
}));
vi.mock("@clockwork/db", () => ({
  StaffTeamRepository: class {
    list = mocks.list;
  },
}));

import { demoTeamMembers } from "./model";
import { loadTeamView } from "./server";

const session = {
  userId: "20000000-0000-4000-8000-000000000001",
  organizationId: "30000000-0000-4000-8000-000000000008",
  providerBacked: true,
};
const member = {
  userId: "20000000-0000-4000-8000-000000000002",
  membershipId: "40000000-0000-4000-8000-000000000002",
  name: "Sam Ortiz",
  email: "sam@fil.one",
  role: "revenue",
  mfaEnrolled: false,
  addedAt: new Date("2026-10-02T10:00:00Z"),
  rowVersion: 3,
  workosMembershipId: "om_sam",
  lastMfaVerifiedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("INTERNAL_EMAIL_DOMAINS", "fil.org, fil.one");
  mocks.session.mockResolvedValue(session);
  mocks.database.mockReturnValue({});
  mocks.list.mockResolvedValue([
    member,
    { ...member, userId: "x", lastMfaVerifiedAt: "2026-10-03T08:00:00Z" },
  ]);
});

it("reads the acting administrator's own organization and keeps provider ids off the page", async () => {
  const view = await loadTeamView();
  expect(mocks.list).toHaveBeenCalledWith(
    expect.objectContaining({ organizationId: session.organizationId }),
  );
  expect(view).toMatchObject({
    mode: "live",
    actorUserId: session.userId,
    emailDomains: ["fil.org", "fil.one"],
  });
  expect(view.members[0]).toEqual({
    userId: member.userId,
    name: "Sam Ortiz",
    email: "sam@fil.one",
    role: "revenue",
    mfa: { state: "unknown" },
    addedAt: "2026-10-02T10:00:00.000Z",
    rowVersion: 3,
  });
  expect(view.members[1]?.mfa).toEqual({
    state: "verified",
    at: "2026-10-03T08:00:00Z",
  });
});

it("shows fixtures, not a database, in the demo", async () => {
  mocks.session.mockResolvedValue({ ...session, providerBacked: false });
  const view = await loadTeamView();
  expect(view.mode).toBe("demo");
  expect(view.members).toBe(demoTeamMembers);
  expect(mocks.list).not.toHaveBeenCalled();
});

it("says the list is unavailable when it cannot be read", async () => {
  mocks.list.mockRejectedValueOnce(new Error("connection refused"));
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  expect(await loadTeamView()).toMatchObject({
    mode: "unavailable",
    members: [],
  });
});
