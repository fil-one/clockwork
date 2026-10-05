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
  // Invite Fil One staff, change their roles and deactivate them. Held by the
  // commerce administrator only.
  "staff:manage",
  // Work the operations queues and records: exceptions, provisioning,
  // recovery and the operational projections.
  "operations:write",
  // The full activity history of the accounts a person can reach, and adding
  // to it as their work requires. A finance approver holds neither: it reads
  // and records only its own activity and the finance records it decides.
  "audit:read",
  "audit:append",
  // Register a deal with Fil One. Referral and channel partners both do.
  "deal:register",
  // Decide one's own request on a two-person control (price books, tax rule
  // books, switches, channel policy, PAYG offers, exceptions, account
  // closures and teardown), with a written reason that is recorded, audited
  // and sent to the other commerce administrators. Held by the commerce
  // administrator only.
  "approval:self",
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
    "audit:read",
    "audit:append",
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
    "audit:read",
    "audit:append",
  ],
  billing: [
    "account:read",
    "quote:read",
    "order:read",
    "billing:read",
    "billing:write",
    "report:read",
    "audit:read",
    "audit:append",
  ],
  member: [
    "account:read",
    "agreement:read",
    "quote:read",
    "order:read",
    "billing:read",
    "audit:read",
    "audit:append",
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
    "deal:register",
    "audit:read",
    "audit:append",
  ],
  partner_seller: [
    "account:read",
    "quote:read",
    "partner:quote:write",
    "order:read",
    "partner:portfolio:read",
    "deal:register",
    "audit:read",
    "audit:append",
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
    "operations:write",
    "audit:read",
    "audit:append",
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
    "audit:read",
    "audit:append",
  ],
  destructive_action_approver: [
    "account:read",
    "order:read",
    "system:operate",
    "destructive:approve",
    "operations:read",
    "audit:read",
    "audit:append",
  ],
  // A seller has no assisted session and the sales gate refuses staff-wide
  // tenant reads, so the bundle holds only what the sales workspace uses.
  revenue: [
    "mnda:send",
    "contract:read",
    "contract:write",
    "sales:read",
    "audit:read",
    "audit:append",
  ],
  // Every internal permission, including deciding one's own two-person
  // requests. The partner-only permissions stay with partners.
  commerce_admin: permissions.filter(
    (permission) =>
      permission !== "partner:quote:write" && permission !== "deal:register",
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

/**
 * Which side of the business an organization is on. Fil One staff work in the
 * `fil_one` organization; customers, channel partners (resale, MSP,
 * distribution, white label and marketplace) and referral partners each have
 * their own. The side decides which roles its members may hold and which
 * portal they see.
 */
export const organizationSides = [
  "fil_one",
  "customer",
  "channel_partner",
  "referral_partner",
] as const;
export const OrganizationSideSchema = z.enum(organizationSides);
export type OrganizationSide = z.infer<typeof OrganizationSideSchema>;

/** The roles a member of an organization on each side may hold. */
export const sideRoles = {
  fil_one: internalRoles,
  customer: ["owner", "admin", "billing", "member"],
  channel_partner: ["partner_admin", "partner_seller"],
  referral_partner: ["partner_admin", "partner_seller"],
} as const satisfies Record<OrganizationSide, readonly Role[]>;

/**
 * Permissions a side never confers, whatever its roles carry. A referral
 * partner introduces customers who then contract with Fil One directly, so it
 * registers deals but never prices or resells: the partner quote belongs to
 * channel partners.
 */
export const sideWithheldPermissions = {
  fil_one: [],
  customer: [],
  channel_partner: [],
  referral_partner: ["partner:quote:write"],
} as const satisfies Record<OrganizationSide, readonly Permission[]>;

/** Whether a role may be held by a member of an organization on `side`. */
export function roleAllowedOnSide(role: Role, side: OrganizationSide): boolean {
  return (sideRoles[side] as readonly Role[]).includes(role);
}

/**
 * The roles each role may invite someone into its own organization with. An
 * administrator never makes an owner; a role not listed invites no one. A
 * person with several roles may invite the union of their roles' lists, and
 * the invited role must still fit the organization's side.
 */
export const inviteRoleCeilings: Partial<Record<Role, readonly Role[]>> = {
  owner: ["owner", "admin", "billing", "member"],
  admin: ["admin", "billing", "member"],
  partner_admin: ["partner_admin", "partner_seller"],
};

/**
 * Permissions an assisted session never carries. Acting inside someone else's
 * account is for helping them; deciding approvals (one's own included),
 * managing staff and changing who signs for Fil One all wait until the staff
 * member is back in their own session.
 */
export const assistedSessionWithheldPermissions = [
  "agreement:approve",
  "quote:approve",
  "billing:approve",
  "contract:approve",
  "destructive:approve",
  "signatory:manage",
  "staff:manage",
  "approval:self",
] as const satisfies readonly Permission[];

export function hasPermission(role: Role, permission: Permission): boolean {
  return (rolePermissions[role] as readonly Permission[]).includes(permission);
}

/**
 * The permissions a set of roles confers: the union of the roles' bundles,
 * less what the organization's side withholds and, inside an assisted
 * session, less the approver permissions. Returned in the canonical order of
 * `permissions`. Unknown role names confer nothing.
 */
export function permissionsForRoles(
  grantedRoles: readonly string[],
  options: { side?: OrganizationSide; assisted?: boolean } = {},
): Permission[] {
  const withheld = new Set<Permission>([
    ...(options.side ? sideWithheldPermissions[options.side] : []),
    ...(options.assisted ? assistedSessionWithheldPermissions : []),
  ]);
  return permissions.filter(
    (permission) =>
      !withheld.has(permission) &&
      grantedRoles.some(
        (role) =>
          (roles as readonly string[]).includes(role) &&
          hasPermission(role as Role, permission),
      ),
  );
}

/** Whether any of a set of roles grants `permission`. */
export function rolesHavePermission(
  grantedRoles: readonly string[],
  permission: Permission,
): boolean {
  return permissionsForRoles(grantedRoles).includes(permission);
}

/**
 * The permissions a session or authorization context holds. A context built
 * by the server carries them; one that does not (an older test fixture, a
 * local persona) gets the answer from its roles, less what its organization's
 * side withholds and less the approver permissions when it is an assisted
 * session. Without a known side it withholds what any side withholds.
 */
export function contextPermissions(context: {
  readonly roles: readonly string[];
  readonly permissions?: readonly Permission[] | undefined;
  readonly impersonation?: unknown;
  readonly side?: OrganizationSide | undefined;
}): readonly Permission[] {
  if (context.permissions) return context.permissions;
  const assisted = Boolean(context.impersonation);
  if (context.side) {
    return permissionsForRoles(context.roles, { side: context.side, assisted });
  }
  const withheld = new Set<Permission>(
    organizationSides.flatMap((side) => sideWithheldPermissions[side]),
  );
  return permissionsForRoles(context.roles, { assisted }).filter(
    (permission) => !withheld.has(permission),
  );
}

/** Whether a session or authorization context holds `permission`. */
export function contextHasPermission(
  context: Parameters<typeof contextPermissions>[0],
  permission: Permission,
): boolean {
  return contextPermissions(context).includes(permission);
}

/** Whether a session or authorization context holds any of `candidates`. */
export function contextHasAnyPermission(
  context: Parameters<typeof contextPermissions>[0],
  candidates: readonly Permission[],
): boolean {
  const held = contextPermissions(context);
  return candidates.some((permission) => held.includes(permission));
}
