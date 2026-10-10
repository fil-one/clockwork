import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), demo: vi.fn() }));
vi.mock("@/src/auth/session", () => ({
  getCommerceSession: mocks.session,
  explicitDemoIdentityEnabled: mocks.demo,
}));
vi.mock("@/src/db/service", () => ({ getServiceDatabase: vi.fn() }));
import { mndaCanManage, mndaStaff } from "./server";
const revenue = {
  userId: "019a44ac-0000-7000-8000-000000000006",
  profile: { email: "rw@fil.one", name: "Head of Revenue" },
  roles: ["revenue"],
  isInternalStaff: true,
  mfaVerified: true,
};
beforeEach(() => {
  mocks.session.mockResolvedValue({ ...revenue });
  mocks.demo.mockReturnValue(false);
});
it.each([
  "revenue",
  "commerce_admin",
  "internal_operator",
  "finance_approver",
  "legal_approver",
])("lets %s prepare, send, track and download MNDAs", async (role) => {
  mocks.session.mockResolvedValue({ ...revenue, roles: [role] });
  await expect(mndaStaff("mnda:send")).resolves.toBeDefined();
});
it("limits countersigner and notice settings to commerce administrators", async () => {
  for (const role of [
    "revenue",
    "internal_operator",
    "finance_approver",
    "legal_approver",
  ]) {
    mocks.session.mockResolvedValue({ ...revenue, roles: [role] });
    await expect(mndaStaff("signatory:manage")).rejects.toThrow("FORBIDDEN");
    expect(mndaCanManage(await mndaStaff())).toBe(false);
  }
  mocks.session.mockResolvedValue({ ...revenue, roles: ["commerce_admin"] });
  const admin = await mndaStaff("signatory:manage");
  expect(mndaCanManage(admin)).toBe(true);
});
it.each([
  { roles: ["owner"], isInternalStaff: false },
  { impersonation: { email: "target@example.com" } },
  { assistedSession: {} },
  { roles: ["destructive_action_approver"] },
  { roles: ["billing"] },
])("rejects unauthorized MNDA sessions %j", async (patch) => {
  mocks.session.mockResolvedValue({ ...revenue, ...patch });
  await expect(mndaStaff()).rejects.toThrow("MNDA_FORBIDDEN");
});
it("asks for MFA rather than refusing outright", async () => {
  mocks.session.mockResolvedValue({ ...revenue, mfaVerified: false });
  await expect(mndaStaff()).rejects.toThrow("MNDA_MFA_REQUIRED");
});
it("never uses demo identities to send real documents", async () => {
  mocks.demo.mockReturnValue(true);
  mocks.session.mockClear();
  await expect(mndaStaff()).rejects.toThrow("MNDA_DEMO_UNAVAILABLE");
  expect(mocks.session).not.toHaveBeenCalled();
});
