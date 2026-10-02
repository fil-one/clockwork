import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), demo: vi.fn() }));
vi.mock("@/src/auth/session", () => ({
  getCommerceSession: mocks.session,
  explicitDemoIdentityEnabled: mocks.demo,
}));
vi.mock("@/src/db/service", () => ({ getServiceDatabase: vi.fn() }));
import { mndaStaff } from "./server";
const revenue = {
  userId: "019a44ac-0000-7000-8000-000000000006",
  profile: { email: "rw@fil.one", name: "Head of Revenue" },
  roles: ["internal_operator"],
  isInternalStaff: true,
  mfaVerified: true,
};
beforeEach(() => {
  mocks.session.mockResolvedValue({ ...revenue });
  mocks.demo.mockReturnValue(false);
});
it("allows the Head of Revenue internal operator to prepare, send, track and download MNDAs", async () => {
  expect((await mndaStaff()).profile.email).toBe("rw@fil.one");
});
it("allows staff operators and finance/legal approvers to configure countersigners", async () => {
  await expect(mndaStaff(true)).resolves.toBeDefined();
  mocks.session.mockResolvedValue({ ...revenue, roles: ["finance_approver"] });
  await expect(mndaStaff(true)).resolves.toBeDefined();
});
it.each([
  { roles: ["owner"], isInternalStaff: false },
  { mfaVerified: false },
  { impersonation: { email: "target@example.com" } },
  { assistedSession: {} },
  { roles: ["billing"] },
])("rejects unauthorized MNDA sessions %j", async (patch) => {
  mocks.session.mockResolvedValue({ ...revenue, ...patch });
  await expect(mndaStaff()).rejects.toThrow("FORBIDDEN");
});
it("never uses demo identities to send real documents", async () => {
  mocks.demo.mockReturnValue(true);
  await expect(mndaStaff()).rejects.toThrow("FORBIDDEN");
});
