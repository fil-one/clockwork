import { describe, expect, it } from "vitest";

import {
  commerceAdminActsAs,
  hasPermission,
  internalRoles,
  membershipRolesActingAs,
  rolePermissions,
  roles,
  rolesHavePermission,
  sessionRolesFor,
} from "./auth";
import type { Role } from "./auth";

describe("migration:execute grant", () => {
  const tenantRoles = roles.filter(
    (role) => !(internalRoles as readonly Role[]).includes(role),
  );

  it("is held by internal_operator and the commerce administrator only", () => {
    const holders = roles.filter((role) =>
      hasPermission(role, "migration:execute"),
    );
    expect(holders).toEqual(["internal_operator", "commerce_admin"]);
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
    ).toEqual(["owner", "admin", "internal_operator", "commerce_admin"]);
  });

  it("adds no other grant to any role", () => {
    expect(rolePermissions.internal_operator).toContain("migration:execute");
    expect(rolePermissions.destructive_action_approver).not.toContain(
      "migration:execute",
    );
    expect(rolePermissions.revenue).not.toContain("migration:execute");
  });
});

describe("sales and administrator roles", () => {
  it("keeps the seller out of the operations workspace and platform tools", () => {
    for (const permission of [
      "operations:read",
      "system:operate",
      "impersonation:assume",
      "billing:read",
      "report:read",
      "destructive:request",
      "migration:execute",
      "signatory:manage",
      "staff:manage",
    ] as const)
      expect(hasPermission("revenue", permission)).toBe(false);
    for (const permission of [
      "mnda:send",
      "contract:read",
      "contract:write",
      "sales:read",
    ] as const)
      expect(hasPermission("revenue", permission)).toBe(true);
  });

  it("grants the operations workspace to every internal role except the seller", () => {
    expect(
      internalRoles.filter((role) => hasPermission(role, "operations:read")),
    ).toEqual([
      "internal_operator",
      "finance_approver",
      "legal_approver",
      "destructive_action_approver",
      "commerce_admin",
    ]);
  });

  it("expands the administrator into every role it acts as, granted role first", () => {
    expect(sessionRolesFor(["commerce_admin"])).toEqual([
      "commerce_admin",
      ...commerceAdminActsAs,
    ]);
    expect(sessionRolesFor(["revenue"])).toEqual(["revenue"]);
    expect(sessionRolesFor(["internal_operator"])).toEqual([
      "internal_operator",
    ]);
    expect(
      sessionRolesFor([
        "finance_approver",
        "commerce_admin",
        "finance_approver",
      ]),
    ).toEqual([
      "finance_approver",
      "commerce_admin",
      "internal_operator",
      "legal_approver",
      "destructive_action_approver",
    ]);
  });

  it("gives the expanded administrator every internal permission and nothing partner-only", () => {
    const expanded = sessionRolesFor(["commerce_admin"]);
    for (const role of commerceAdminActsAs)
      for (const permission of rolePermissions[role])
        expect(rolesHavePermission(expanded, permission)).toBe(true);
    expect(rolesHavePermission(expanded, "signatory:manage")).toBe(true);
    expect(rolesHavePermission(expanded, "partner:quote:write")).toBe(false);
  });

  it("reserves staff and signatory management for the administrator", () => {
    for (const permission of ["staff:manage", "signatory:manage"] as const)
      expect(roles.filter((role) => hasPermission(role, permission))).toEqual([
        "commerce_admin",
      ]);
  });

  it("accepts an administrator membership wherever an acted-as role is checked", () => {
    expect(membershipRolesActingAs("finance_approver")).toEqual([
      "finance_approver",
      "commerce_admin",
    ]);
    expect(membershipRolesActingAs("owner")).toEqual(["owner"]);
    expect(membershipRolesActingAs("revenue")).toEqual(["revenue"]);
  });

  it("ignores unknown role names when testing a permission", () => {
    expect(rolesHavePermission(["not_a_role"], "sales:read")).toBe(false);
    expect(rolesHavePermission(["revenue"], "sales:read")).toBe(true);
  });
});
