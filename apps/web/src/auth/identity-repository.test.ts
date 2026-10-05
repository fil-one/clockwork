import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { AuthorizedMembership } from "./identity-repository";
import {
  audienceForMembership,
  homeForAudience,
  membershipRoles,
  selectedMembership,
} from "./identity-repository";

function membership(
  overrides: Partial<AuthorizedMembership> = {},
): AuthorizedMembership {
  return {
    userId: "20000000-0000-4000-8000-000000000002",
    userName: "Customer owner",
    userEmail: "owner@customer.example",
    isInternalStaff: false,
    organizationId: "30000000-0000-4000-8000-000000000001",
    workosOrganizationId: "org_customer",
    organizationName: "Customer workspace",
    accountId: "10000000-0000-4000-8000-000000000001",
    accountName: "Customer account",
    role: "owner",
    roles: ["owner"],
    side: "customer",
    audience: "customer",
    home: "/dashboard",
    ...overrides,
  };
}

describe("membership-owned portal routing", () => {
  it.each([
    ["customer", false, "customer", "/dashboard"],
    ["channel_partner", false, "partner", "/partner"],
    ["referral_partner", false, "partner", "/partner"],
    ["fil_one", true, "internal", "/internal"],
  ] as const)(
    "routes a %s membership to its authorized portal",
    (side, isInternalStaff, expectedAudience, expectedHome) => {
      const audience = audienceForMembership({ side, isInternalStaff });
      expect(audience).toBe(expectedAudience);
      expect(homeForAudience(audience)).toBe(expectedHome);
    },
  );

  it("never opens the internal portal to a person who is not staff", () => {
    expect(
      audienceForMembership({ side: "fil_one", isInternalStaff: false }),
    ).toBe("customer");
  });

  it("lists every role a membership holds, the primary role first", () => {
    expect(
      membershipRoles("revenue", [
        "legal_approver",
        "revenue",
        "legal_approver",
      ]),
    ).toEqual(["revenue", "legal_approver"]);
    expect(membershipRoles("owner", [])).toEqual(["owner"]);
    expect(() => membershipRoles("revenue", ["not_a_role"])).toThrow();
  });

  it("rejects a selected organization absent from server memberships", () => {
    expect(() => selectedMembership([membership()], "org_forged")).toThrow(
      "Selected organization is not an authorized membership",
    );
  });

  it("rejects ambiguous duplicate organization mappings", () => {
    expect(() =>
      selectedMembership(
        [membership(), membership({ accountId: "different-account" })],
        "org_customer",
      ),
    ).toThrow("Selected organization is not an authorized membership");
  });
});
