import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  database: vi.fn(),
  revalidate: vi.fn(),
  markRead: vi.fn(),
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
vi.mock("@/src/auth/session", () => ({
  getCommerceSession: vi.fn(),
  SessionExpiredError: class SessionExpiredError extends Error {},
}));
vi.mock("@/src/db/service", () => ({
  getOptionalServiceDatabase: mocks.database,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@clockwork/db", () => ({
  OwnerConsoleRepository: class {
    markNoticesRead = mocks.markRead;
  },
}));

import { SessionExpiredError } from "@/src/auth/session";
import { StaffPermissionError } from "@/src/features/shell/staff-access";

import { markNoticesRead } from "./actions";

const admin = {
  userId: "20000000-0000-4000-8000-000000000001",
  roles: ["commerce_admin"],
  isInternalStaff: true,
  mfaVerified: true,
  providerBacked: true,
};
const notice = "60000000-0000-4000-8000-000000000001";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requirePermission.mockResolvedValue({ ...admin });
  mocks.database.mockReturnValue({});
  mocks.markRead.mockResolvedValue(1);
});

it("marks only the reader's own notices, as the reader", async () => {
  await expect(markNoticesRead({ noticeIds: [notice] })).resolves.toEqual({
    ok: true,
    marked: 1,
  });
  expect(mocks.requirePermission).toHaveBeenCalledWith("staff:manage");
  expect(mocks.markRead).toHaveBeenCalledWith(
    expect.objectContaining({
      viewerUserId: admin.userId,
      noticeIds: [notice],
    }),
  );
  expect(mocks.revalidate).toHaveBeenCalledWith("/internal/owner");
  await markNoticesRead({ noticeIds: "all" });
  expect(mocks.markRead).toHaveBeenLastCalledWith(
    expect.objectContaining({ noticeIds: "all" }),
  );
});

it("refuses anyone without staff management", async () => {
  mocks.requirePermission.mockRejectedValueOnce(
    new StaffPermissionError("staff:manage"),
  );
  await expect(markNoticesRead({ noticeIds: "all" })).resolves.toEqual({
    ok: false,
    code: "NOT_PERMITTED",
  });
  expect(mocks.markRead).not.toHaveBeenCalled();
});

it("reports an expired session apart from a direct-session refusal", async () => {
  mocks.requirePermission.mockRejectedValueOnce(new SessionExpiredError());
  await expect(markNoticesRead({ noticeIds: "all" })).resolves.toEqual({
    ok: false,
    code: "SESSION_EXPIRED",
  });
  mocks.requirePermission.mockRejectedValueOnce(new Error("unverified"));
  await expect(markNoticesRead({ noticeIds: "all" })).resolves.toEqual({
    ok: false,
    code: "DIRECT_SESSION_REQUIRED",
  });
  expect(mocks.markRead).not.toHaveBeenCalled();
});

it.each([
  { impersonation: { accountId: "x" } },
  { assistedSession: { id: "x" } },
  { authenticationProviderImpersonator: true },
  { mfaVerified: false },
])("refuses an assisted or unverified session %j", async (patch) => {
  mocks.requirePermission.mockResolvedValueOnce({ ...admin, ...patch });
  await expect(markNoticesRead({ noticeIds: "all" })).resolves.toEqual({
    ok: false,
    code: "DIRECT_SESSION_REQUIRED",
  });
  expect(mocks.markRead).not.toHaveBeenCalled();
});

it.each([
  { noticeIds: [] },
  { noticeIds: ["not-a-uuid"] },
  { noticeIds: "some" },
  { noticeIds: "all", recipient: "someone-else" },
  "all",
])("refuses malformed input %j", async (raw) => {
  await expect(markNoticesRead(raw)).resolves.toEqual({
    ok: false,
    code: "INVALID_INPUT",
  });
  expect(mocks.markRead).not.toHaveBeenCalled();
});

it("changes nothing in the demo", async () => {
  mocks.requirePermission.mockResolvedValueOnce({
    ...admin,
    providerBacked: false,
  });
  await expect(markNoticesRead({ noticeIds: "all" })).resolves.toEqual({
    ok: false,
    code: "NOT_CONFIGURED",
  });
});
