import { inArray } from "drizzle-orm";

import { membershipRolesActingAs, type Role } from "@clockwork/contracts";

import { memberships } from "../schema";

/**
 * Matches a stored membership that holds `role`, counting a commerce
 * administrator, who acts as every internal role. Use it wherever a check
 * reads the membership table rather than the session's roles.
 */
export function membershipActsAs(role: Role) {
  return inArray(memberships.role, membershipRolesActingAs(role));
}
