import { describe, expect, it } from "vitest";

import { hasPermission, internalRoles, rolePermissions, roles } from "./auth";
import type { Role } from "./auth";

describe("migration:execute grant", () => {
  const tenantRoles = roles.filter(
    (role) => !(internalRoles as readonly Role[]).includes(role),
  );

  it("is held by internal_operator only", () => {
    const holders = roles.filter((role) =>
      hasPermission(role, "migration:execute"),
    );
    expect(holders).toEqual(["internal_operator"]);
  });

  it.each(tenantRoles)("is not held by the tenant role %s", (role) => {
    expect(hasPermission(role, "migration:execute")).toBe(false);
  });

  it("keeps destructive:request on the roles whose account-scoped flows need it", () => {
    // Terminations and novations are legitimate tenant requests against the
    // caller's own account, so this permission must not be stripped.
    expect(hasPermission("owner", "destructive:request")).toBe(true);
    expect(hasPermission("admin", "destructive:request")).toBe(true);
    expect(
      roles.filter((role) => hasPermission(role, "destructive:request")),
    ).toEqual(["owner", "admin", "internal_operator"]);
  });

  it("adds no other grant to any role", () => {
    expect(rolePermissions.internal_operator).toContain("migration:execute");
    expect(rolePermissions.destructive_action_approver).not.toContain(
      "migration:execute",
    );
  });
});
