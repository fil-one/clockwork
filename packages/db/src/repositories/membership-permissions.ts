import { or, sql, type SQL } from "drizzle-orm";

import type { Permission } from "@clockwork/contracts";

import { memberships } from "../schema";

/**
 * Matches a stored membership whose roles confer `permission`, across every
 * role the person holds in that organization and less what the
 * organization's side withholds. Use it wherever a check reads the membership
 * table rather than the session's permissions.
 */
export function membershipHasPermission(permission: Permission): SQL<boolean> {
  return sql<boolean>`public.member_has_permission(${memberships.userId}, ${permission}, ${memberships.organizationId})`;
}

/** Matches a stored membership whose roles confer any of `candidates`. */
export function membershipHasAnyPermission(
  candidates: readonly [Permission, ...Permission[]],
): SQL {
  return or(...candidates.map(membershipHasPermission)) as SQL;
}
