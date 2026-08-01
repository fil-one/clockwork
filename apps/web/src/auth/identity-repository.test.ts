import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { AuthorizedMembership } from "./identity-repository";
import {
  audienceForMembership,
  homeForAudience,
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
    audience: "customer",
    home: "/dashboard",
    ...overrides,
  };
}

describe("membership-owned portal routing", () => {
  it.each([
    ["owner", false, "customer", "/dashboard"],
    ["partner_admin", false, "partner", "/partner"],
    ["internal_operator", true, "internal", "/internal"],
  ] as const)(
    "routes %s to its authorized portal",
    (role, isInternalStaff, expectedAudience, expectedHome) => {
      const audience = audienceForMembership({ role, isInternalStaff });
      expect(audience).toBe(expectedAudience);
      expect(homeForAudience(audience)).toBe(expectedHome);
    },
  );

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
