import { describe, expect, it } from "vitest";

import { canAccessCustomerCollection } from "./permissions";

describe("customer collection permissions", () => {
  it("keeps read collections available to owner, member, and billing roles", () => {
    for (const role of ["owner", "member", "billing"]) {
      expect(canAccessCustomerCollection(role, "account:read")).toBe(true);
    }
  });

  it("limits account and amendment mutations to roles with their permissions", () => {
    expect(canAccessCustomerCollection("owner", "account:write")).toBe(true);
    expect(canAccessCustomerCollection("member", "account:write")).toBe(false);
    expect(canAccessCustomerCollection("billing", "order:write")).toBe(false);
    expect(canAccessCustomerCollection("partner_admin", "account:write")).toBe(
      true,
    );
    expect(canAccessCustomerCollection("partner_seller", "account:write")).toBe(
      false,
    );
  });
});
