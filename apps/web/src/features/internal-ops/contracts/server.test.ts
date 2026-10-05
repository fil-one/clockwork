import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Permission } from "@clockwork/contracts";

const mocks = vi.hoisted(() => ({ session: vi.fn(), demo: vi.fn() }));
vi.mock("@/src/auth/session", () => ({
  getCommerceSession: mocks.session,
  explicitDemoIdentityEnabled: mocks.demo,
}));
vi.mock("@/src/db/service", () => ({ getServiceDatabase: vi.fn() }));
import { contractStaff, documentStores } from "./server";

const staff = (roles: string[]) => ({
  userId: "019a44ac-0000-7000-8000-000000000006",
  profile: { email: "rw@fil.one", name: "Head of Revenue" },
  roles,
  isInternalStaff: true,
  mfaVerified: true,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.demo.mockReturnValue(false);
});

describe("contract and sales library permissions", () => {
  it.each<[string, Permission, boolean]>([
    ["revenue", "contract:read", true],
    ["revenue", "contract:write", true],
    ["revenue", "contract:approve", false],
    ["revenue", "sales:read", true],
    ["revenue", "collateral:manage", false],
    ["commerce_admin", "contract:approve", true],
    ["commerce_admin", "collateral:manage", true],
    ["finance_approver", "contract:approve", true],
    ["finance_approver", "contract:write", false],
    ["legal_approver", "contract:write", true],
    ["destructive_action_approver", "contract:read", false],
  ])("%s %s allowed: %s", async (role, permission, allowed) => {
    mocks.session.mockResolvedValue(staff([role]));
    const result = contractStaff(permission);
    if (allowed) await expect(result).resolves.toBeDefined();
    else await expect(result).rejects.toThrow("CONTRACT_FORBIDDEN");
  });

  it.each([
    [{ isInternalStaff: false, roles: ["owner"] }, "CONTRACT_FORBIDDEN"],
    [{ impersonation: { accountId: "x" } }, "CONTRACT_FORBIDDEN"],
    [{ assistedSession: {} }, "CONTRACT_FORBIDDEN"],
    [{ mfaVerified: false }, "CONTRACT_MFA_REQUIRED"],
  ])("refuses %j", async (patch, code) => {
    mocks.session.mockResolvedValue({ ...staff(["commerce_admin"]), ...patch });
    await expect(contractStaff("contract:read")).rejects.toThrow(code);
  });

  it("never lets a demo identity reach real documents", async () => {
    mocks.demo.mockReturnValue(true);
    mocks.session.mockResolvedValue(staff(["commerce_admin"]));
    await expect(contractStaff("contract:read")).rejects.toThrow(
      "CONTRACT_DEMO_UNAVAILABLE",
    );
    expect(mocks.session).not.toHaveBeenCalled();
  });
});

it("refuses a document store it does not know", () => {
  vi.stubEnv("COMMERCE_DOCUMENT_STORE", "fil_one_s3");
  expect(() => documentStores()).toThrow("DOCUMENT_BACKEND_UNAVAILABLE");
  vi.unstubAllEnvs();
});
