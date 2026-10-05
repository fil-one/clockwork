import { describe, expect, it } from "vitest";

import {
  assistedSessionWithheldPermissions,
  contextHasAnyPermission,
  contextHasPermission,
  contextPermissions,
  hasPermission,
  internalRoles,
  inviteRoleCeilings,
  organizationSides,
  permissions,
  permissionsForRoles,
  privilegedRoles,
  roleAllowedOnSide,
  rolePermissions,
  roles,
  rolesHavePermission,
  sideRoles,
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
      // Tenant reads a seller could never use: no assisted session, and the
      // sales gate refuses them staff-wide.
      "account:read",
      "agreement:read",
      "quote:read",
      "partner:portfolio:read",
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

  it("gives the administrator every internal permission and nothing partner-only", () => {
    const granted = permissionsForRoles(["commerce_admin"]);
    for (const role of internalRoles)
      for (const permission of rolePermissions[role])
        expect(granted).toContain(permission);
    expect(granted).toContain("signatory:manage");
    expect(granted).not.toContain("partner:quote:write");
    expect(granted).not.toContain("deal:register");
  });

  it("reserves staff and signatory management for the administrator", () => {
    for (const permission of ["staff:manage", "signatory:manage"] as const)
      expect(roles.filter((role) => hasPermission(role, permission))).toEqual([
        "commerce_admin",
      ]);
  });

  it("ignores unknown role names when testing a permission", () => {
    expect(rolesHavePermission(["not_a_role"], "sales:read")).toBe(false);
    expect(rolesHavePermission(["revenue"], "sales:read")).toBe(true);
  });
});

describe("permissionsForRoles", () => {
  it("is the union of the roles' bundles, in the canonical order", () => {
    const granted = permissionsForRoles(["legal_approver", "finance_approver"]);
    expect(granted).toEqual(
      permissions.filter(
        (permission) =>
          hasPermission("legal_approver", permission) ||
          hasPermission("finance_approver", permission),
      ),
    );
    expect(granted).toContain("billing:approve");
    expect(granted).toContain("agreement:approve");
    expect(permissionsForRoles(["revenue", "revenue"])).toEqual(
      permissionsForRoles(["revenue"]),
    );
  });

  it("never takes away a permission when a role is added", () => {
    for (const first of roles)
      for (const second of roles)
        for (const permission of rolePermissions[first])
          expect(permissionsForRoles([first, second])).toContain(permission);
  });

  it("withholds the partner quote from referral partners only", () => {
    for (const role of ["partner_admin", "partner_seller"] as const) {
      expect(
        permissionsForRoles([role], { side: "channel_partner" }),
      ).toContain("partner:quote:write");
      const referral = permissionsForRoles([role], {
        side: "referral_partner",
      });
      expect(referral).not.toContain("partner:quote:write");
      // Referral partners still register the deals they introduce.
      expect(referral).toContain("deal:register");
    }
    expect(permissionsForRoles(["owner"], { side: "customer" })).toEqual(
      permissionsForRoles(["owner"]),
    );
    expect(
      permissionsForRoles(["commerce_admin"], { side: "fil_one" }),
    ).toEqual(permissionsForRoles(["commerce_admin"]));
  });

  it("withholds every approver permission inside an assisted session", () => {
    const assisted = permissionsForRoles(["commerce_admin"], {
      assisted: true,
    });
    for (const permission of assistedSessionWithheldPermissions)
      expect(assisted).not.toContain(permission);
    expect(assisted).toContain("impersonation:assume");
    expect(assisted).toContain("operations:write");
    expect(
      permissionsForRoles(["internal_operator", "finance_approver"], {
        assisted: true,
      }),
    ).not.toContain("billing:approve");
  });

  it("registers deals for partners only", () => {
    expect(
      roles.filter((role) => hasPermission(role, "deal:register")),
    ).toEqual(["partner_admin", "partner_seller"]);
  });

  it("keeps the finance approver out of the general activity history", () => {
    expect(roles.filter((role) => !hasPermission(role, "audit:read"))).toEqual([
      "finance_approver",
    ]);
    expect(
      roles.filter((role) => !hasPermission(role, "audit:append")),
    ).toEqual(["finance_approver"]);
  });

  it("gives operations write to the operator and the administrator only", () => {
    expect(
      roles.filter((role) => hasPermission(role, "operations:write")),
    ).toEqual(["internal_operator", "commerce_admin"]);
  });
});

describe("context permissions", () => {
  it("prefers the permissions the server signed", () => {
    const context = {
      roles: ["commerce_admin"] as const,
      permissions: ["sales:read"] as const,
    };
    expect(contextPermissions(context)).toEqual(["sales:read"]);
    expect(contextHasPermission(context, "staff:manage")).toBe(false);
  });

  it("derives them from the roles when absent, without approvals when assisted", () => {
    expect(
      contextHasPermission({ roles: ["finance_approver"] }, "quote:approve"),
    ).toBe(true);
    expect(
      contextHasPermission(
        { roles: ["finance_approver"], impersonation: { reason: "help" } },
        "quote:approve",
      ),
    ).toBe(false);
    expect(
      contextHasAnyPermission({ roles: ["revenue"] }, [
        "operations:write",
        "contract:write",
      ]),
    ).toBe(true);
    expect(
      contextHasAnyPermission({ roles: ["revenue"] }, [
        "operations:write",
        "quote:approve",
      ]),
    ).toBe(false);
  });
});

describe("organization sides", () => {
  it("allows every role on exactly one side", () => {
    for (const role of roles)
      expect(
        organizationSides.filter((side) => roleAllowedOnSide(role, side)),
      ).toHaveLength(role.startsWith("partner_") ? 2 : 1);
    expect(roleAllowedOnSide("commerce_admin", "fil_one")).toBe(true);
    expect(roleAllowedOnSide("commerce_admin", "customer")).toBe(false);
    expect(roleAllowedOnSide("owner", "channel_partner")).toBe(false);
    expect(roleAllowedOnSide("partner_seller", "referral_partner")).toBe(true);
    expect(roleAllowedOnSide("internal_operator", "referral_partner")).toBe(
      false,
    );
  });

  it("lets each inviting role invite only roles of its own side", () => {
    expect(inviteRoleCeilings).toEqual({
      owner: ["owner", "admin", "billing", "member"],
      admin: ["admin", "billing", "member"],
      partner_admin: ["partner_admin", "partner_seller"],
    });
    for (const [inviter, invitable] of Object.entries(inviteRoleCeilings))
      for (const side of organizationSides)
        if (roleAllowedOnSide(inviter as Role, side))
          for (const role of invitable ?? [])
            expect(roleAllowedOnSide(role, side)).toBe(true);
  });

  it("keeps the staff boundary and MFA attributes consistent with the sides", () => {
    expect(sideRoles.fil_one).toEqual(internalRoles);
    for (const role of internalRoles)
      expect((privilegedRoles as readonly Role[]).includes(role)).toBe(true);
  });
});
