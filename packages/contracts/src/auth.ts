import { z } from "zod";

export const roles = [
  "owner",
  "admin",
  "billing",
  "member",
  "partner_admin",
  "partner_seller",
  "internal_operator",
  "finance_approver",
  "legal_approver",
  "destructive_action_approver",
  // Fil One sellers: MNDAs, contracts and sales references, without platform
  // operation, impersonation, billing or destructive tools.
  "revenue",
  // Commerce administrators hold every internal permission, plus the
  // settings that bind Fil One: who may countersign and where notices go.
  "commerce_admin",
] as const;

export const RoleSchema = z.enum(roles);
export type Role = z.infer<typeof RoleSchema>;

export const permissions = [
  "account:read",
  "account:write",
  "agreement:read",
  "agreement:execute",
  "agreement:approve",
  "quote:read",
  "quote:write",
  "quote:approve",
  "order:read",
  "order:write",
  "billing:read",
  "billing:write",
  "billing:approve",
  "partner:portfolio:read",
  "partner:quote:write",
  "poc:manage",
  "report:read",
  "system:operate",
  "impersonation:assume",
  "destructive:request",
  "destructive:approve",
  // `destructive:request` means "a party to this account may ask for a
  // destructive thing to be done to their own account", and every other route
  // holding it is account-scoped. Starting a migration is a platform operation
  // against a third-party legacy system with no account scope at all, so it
  // gets its own permission rather than borrowing a tenant one.
  "migration:execute",
  "mnda:send",
  "contract:read",
  "contract:write",
  "contract:approve",
  "signatory:manage",
  "sales:read",
  "collateral:manage",
  // The operations workspace: queues, provisioning, billing, reports and the
  // platform tools. Sellers work in the sales workspace and do not hold it.
  "operations:read",
  // Invite Fil One staff, change their role and deactivate them. Held by the
  // commerce administrator only.
  "staff:manage",
] as const;

export const PermissionSchema = z.enum(permissions);
export type Permission = z.infer<typeof PermissionSchema>;

export const rolePermissions = {
  owner: [
    "account:read",
    "account:write",
    "agreement:read",
    "agreement:execute",
    "quote:read",
    "quote:write",
    "order:read",
    "order:write",
    "billing:read",
    "billing:write",
    "poc:manage",
    "report:read",
    "destructive:request",
  ],
  admin: [
    "account:read",
    "account:write",
    "agreement:read",
    "agreement:execute",
    "quote:read",
    "quote:write",
    "order:read",
    "order:write",
    "billing:read",
    "poc:manage",
    "report:read",
    "destructive:request",
  ],
  billing: [
    "account:read",
    "quote:read",
    "order:read",
    "billing:read",
    "billing:write",
    "report:read",
  ],
  member: [
    "account:read",
    "agreement:read",
    "quote:read",
    "order:read",
    "billing:read",
  ],
  partner_admin: [
    "account:read",
    "account:write",
    "agreement:read",
    "agreement:execute",
    "quote:read",
    "partner:quote:write",
    "order:read",
    "order:write",
    "billing:read",
    "partner:portfolio:read",
    "poc:manage",
  ],
  partner_seller: [
    "account:read",
    "quote:read",
    "partner:quote:write",
    "order:read",
    "partner:portfolio:read",
  ],
  internal_operator: [
    "account:read",
    "account:write",
    "agreement:read",
    "quote:read",
    "quote:write",
    "order:read",
    "order:write",
    "billing:read",
    "partner:portfolio:read",
    "poc:manage",
    "report:read",
    "system:operate",
    "impersonation:assume",
    "destructive:request",
    "migration:execute",
    "mnda:send",
    "contract:read",
    "contract:write",
    "sales:read",
    "operations:read",
  ],
  finance_approver: [
    "account:read",
    "quote:read",
    "quote:approve",
    "billing:read",
    "billing:approve",
    "report:read",
    "mnda:send",
    "contract:read",
    "contract:approve",
    "sales:read",
    "operations:read",
  ],
  legal_approver: [
    "account:read",
    "agreement:read",
    "agreement:approve",
    "quote:read",
    "order:read",
    "mnda:send",
    "contract:read",
    "contract:write",
    "contract:approve",
    "sales:read",
    "operations:read",
  ],
  destructive_action_approver: [
    "account:read",
    "order:read",
    "system:operate",
    "destructive:approve",
    "operations:read",
  ],
  revenue: [
    "account:read",
    "agreement:read",
    "quote:read",
    "partner:portfolio:read",
    "mnda:send",
    "contract:read",
    "contract:write",
    "sales:read",
  ],
  commerce_admin: permissions.filter(
    (permission) => permission !== "partner:quote:write",
  ),
} as const satisfies Record<Role, readonly Permission[]>;

export const privilegedRoles = [
  "owner",
  "admin",
  "partner_admin",
  "internal_operator",
  "finance_approver",
  "legal_approver",
  "destructive_action_approver",
  "revenue",
  "commerce_admin",
] as const satisfies readonly Role[];

export const internalRoles = [
  "internal_operator",
  "finance_approver",
  "legal_approver",
  "destructive_action_approver",
  "revenue",
  "commerce_admin",
] as const satisfies readonly Role[];

export function hasPermission(role: Role, permission: Permission): boolean {
  return (rolePermissions[role] as readonly Permission[]).includes(permission);
}

/**
 * The internal roles a commerce administrator acts as. A membership holds one
 * role, but much of the platform still asks for a role by name (a finance
 * approver approves a price book, an operator replays a webhook), and the
 * signed database claims test role names too. Expanding the administrator into
 * these roles where a session is built lets every one of those checks hold
 * without a second list to keep in step.
 *
 * Two-person rules are unaffected: they compare the requesting and deciding
 * users, never their roles, so one administrator still cannot approve their
 * own request.
 */
export const commerceAdminActsAs = [
  "internal_operator",
  "finance_approver",
  "legal_approver",
  "destructive_action_approver",
] as const satisfies readonly Role[];

/**
 * The roles a session carries for the roles its memberships grant. The granted
 * role stays first, so anything that records "the" role records the one the
 * person was given.
 */
export function sessionRolesFor(granted: readonly Role[]): Role[] {
  const expanded: Role[] = [];
  const add = (role: Role) => {
    if (!expanded.includes(role)) expanded.push(role);
  };
  for (const role of granted) {
    add(role);
    if (role === "commerce_admin") commerceAdminActsAs.forEach(add);
  }
  return expanded;
}

/**
 * The stored membership roles that satisfy a check for `role`, for checks that
 * read a membership row rather than a session (for example "is the approver of
 * record still a finance approver").
 */
export function membershipRolesActingAs(role: Role): Role[] {
  return (commerceAdminActsAs as readonly Role[]).includes(role)
    ? [role, "commerce_admin"]
    : [role];
}

/** Whether any of a session's roles grants `permission`. */
export function rolesHavePermission(
  sessionRoles: readonly string[],
  permission: Permission,
): boolean {
  return sessionRoles.some(
    (role) =>
      (roles as readonly string[]).includes(role) &&
      hasPermission(role as Role, permission),
  );
}
