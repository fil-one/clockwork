import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  propose: vi.fn(),
  decide: vi.fn(),
  disable: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock("@/src/auth/session", () => ({
  requireRecentAuthentication: mocks.session,
}));
vi.mock("@/src/db/service", () => ({ getServiceDatabase: () => ({}) }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@clockwork/db", () => ({
  systemCapabilityKeys: [
    "new_business",
    "legal",
    "billing",
    "partner",
    "marketplace",
    "teardown",
  ],
  DatabaseSystemCapabilityAdmin: class {
    propose = mocks.propose;
    decide = mocks.decide;
    disable = mocks.disable;
  },
}));
import { changeCapability } from "./actions";

const staff = {
  userId: "20000000-0000-4000-8000-000000000001",
  providerBacked: true,
  isInternalStaff: true,
  mfaVerified: true,
  roles: ["internal_operator"],
};
function form(action = "propose") {
  const data = new FormData();
  Object.entries({
    capabilityKey: "new_business",
    expectedRowVersion: "3",
    action,
    reason: "Approved production pilot evidence",
    recovery: "false",
    evidenceReference: "evidence:pilot-2026",
  }).forEach(([key, value]) => data.set(key, value));
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue(staff);
});
describe("capability server action", () => {
  it.each([
    { providerBacked: false },
    { isInternalStaff: false },
    { mfaVerified: false },
    { impersonation: { accountId: "customer" } },
    { assistedSession: {} },
    { authenticationProviderImpersonator: true },
  ])(
    "rejects demo, unverified, and assisted identities: %j",
    async (change) => {
      mocks.session.mockResolvedValue({ ...staff, ...change });
      expect(await changeCapability("", form())).toContain(
        "directly authenticated staff session",
      );
      expect(mocks.propose).not.toHaveBeenCalled();
    },
  );
  it("binds the actor and exact reviewed version on the server", async () => {
    const data = form();
    data.set("actor", "attacker");
    expect(await changeCapability("", data)).toContain("distinct approver");
    expect(mocks.propose).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: { kind: "user", id: staff.userId },
        expectedRowVersion: 3,
        enableRecovery: false,
      }),
    );
    expect(mocks.revalidate).toHaveBeenCalledWith("/internal/capabilities");
  });
  it("preserves independent recovery control when disabling", async () => {
    const data = form("disable");
    data.set("recovery", "true");
    await changeCapability("", data);
    expect(mocks.disable).toHaveBeenCalledWith(
      expect.objectContaining({ disableRecovery: true }),
    );
    expect(mocks.propose).not.toHaveBeenCalled();
  });
  it("rejects malformed versions and missing proposal identity", async () => {
    const data = form();
    data.set("expectedRowVersion", "0");
    expect(await changeCapability("", data)).toContain("Check");
    expect(await changeCapability("", form("approve"))).toContain(
      "Select a pending",
    );
    expect(mocks.propose).not.toHaveBeenCalled();
    expect(mocks.decide).not.toHaveBeenCalled();
  });
  it("explains stale and self-approval failures without claiming success", async () => {
    mocks.propose.mockRejectedValueOnce(
      new Error("CAPABILITY_VERSION_CONFLICT"),
    );
    expect(await changeCapability("", form())).toContain("capability changed");
    const data = form("approve");
    data.set("proposalId", "30000000-0000-4000-8000-000000000001");
    mocks.decide.mockRejectedValueOnce(
      new Error("CAPABILITY_DISTINCT_APPROVER_REQUIRED"),
    );
    expect(await changeCapability("", data)).toContain(
      "different authorized staff",
    );
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});
