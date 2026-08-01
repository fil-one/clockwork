import "server-only";

import { sql } from "drizzle-orm";

import { internalRoles, RoleSchema, type Role } from "@clockwork/contracts";
import { type RuntimeDatabase, withInternalTransaction } from "@clockwork/db";

export type PortalAudience = "customer" | "partner" | "internal";

export interface AuthorizedMembership {
  userId: string;
  userName: string;
  userEmail: string;
  isInternalStaff: boolean;
  organizationId: string;
  workosOrganizationId: string;
  organizationName: string;
  accountId: string;
  accountName: string;
  role: Role;
  audience: PortalAudience;
  home: "/dashboard" | "/partner" | "/internal";
}

interface MembershipRow extends Record<string, unknown> {
  user_id: string;
  user_name: string;
  user_email: string;
  is_internal_staff: boolean;
  organization_id: string;
  workos_organization_id: string;
  organization_name: string;
  account_id: string;
  account_name: string;
  role: string;
}

export function audienceForMembership(input: {
  role: Role;
  isInternalStaff: boolean;
}): PortalAudience {
  if (
    input.isInternalStaff &&
    internalRoles.includes(input.role as (typeof internalRoles)[number])
  )
    return "internal";
  if (input.role === "partner_admin" || input.role === "partner_seller")
    return "partner";
  return "customer";
}

export function homeForAudience(
  audience: PortalAudience,
): AuthorizedMembership["home"] {
  if (audience === "partner") return "/partner";
  if (audience === "internal") return "/internal";
  return "/dashboard";
}

function membership(row: MembershipRow): AuthorizedMembership {
  const role = RoleSchema.parse(row.role);
  const audience = audienceForMembership({
    role,
    isInternalStaff: row.is_internal_staff,
  });
  return {
    userId: row.user_id,
    userName: row.user_name,
    userEmail: row.user_email,
    isInternalStaff: row.is_internal_staff,
    organizationId: row.organization_id,
    workosOrganizationId: row.workos_organization_id,
    organizationName: row.organization_name,
    accountId: row.account_id,
    accountName: row.account_name,
    role,
    audience,
    home: homeForAudience(audience),
  };
}

export async function listAuthorizedMemberships(
  db: RuntimeDatabase,
  input: { workosUserId: string; requestId: string },
): Promise<AuthorizedMembership[]> {
  return withInternalTransaction(db, input.requestId, async (transaction) => {
    const rows = await transaction.execute<MembershipRow>(sql`
      select u.id as user_id,
             u.name as user_name,
             u.email as user_email,
             u.is_internal_staff,
             o.id as organization_id,
             o.workos_organization_id,
             o.name as organization_name,
             a.id as account_id,
             a.legal_name as account_name,
             m.role
      from public.memberships m
      join public.commerce_users u on u.id = m.user_id
      join public.organizations o on o.id = m.organization_id
      join public.accounts a on a.id = o.account_id
      where u.workos_user_id = ${input.workosUserId}
        and o.workos_organization_id is not null
      order by a.legal_name, o.name, o.id
    `);
    return rows.map(membership);
  });
}

/** Membership projection for a commerce-owned actor already authenticated by
 * a provider-backed, persisted assisted-session record. */
export async function listAuthorizedMembershipsForUser(
  db: RuntimeDatabase,
  input: { userId: string; requestId: string },
): Promise<AuthorizedMembership[]> {
  return withInternalTransaction(db, input.requestId, async (transaction) => {
    const rows = await transaction.execute<MembershipRow>(sql`
      select u.id as user_id,
             u.name as user_name,
             u.email as user_email,
             u.is_internal_staff,
             o.id as organization_id,
             o.workos_organization_id,
             o.name as organization_name,
             a.id as account_id,
             a.legal_name as account_name,
             m.role
      from public.memberships m
      join public.commerce_users u on u.id = m.user_id
      join public.organizations o on o.id = m.organization_id
      join public.accounts a on a.id = o.account_id
      where u.id = ${input.userId}::uuid
        and o.workos_organization_id is not null
      order by a.legal_name, o.name, o.id
    `);
    return rows.map(membership);
  });
}

export async function resolveAuthorizedAccountSwitch(
  db: RuntimeDatabase,
  input: {
    workosUserId: string;
    requestedAccountId: string;
    requestId: string;
  },
): Promise<AuthorizedMembership> {
  const memberships = await listAuthorizedMemberships(db, input);
  const matches = memberships.filter(
    ({ accountId }) => accountId === input.requestedAccountId,
  );
  if (matches.length !== 1)
    throw new Error("Requested account is not an authorized membership");
  return matches[0] as AuthorizedMembership;
}

export function selectedMembership(
  memberships: readonly AuthorizedMembership[],
  workosOrganizationId: string,
): AuthorizedMembership {
  const matches = memberships.filter(
    (item) => item.workosOrganizationId === workosOrganizationId,
  );
  if (matches.length !== 1)
    throw new Error("Selected organization is not an authorized membership");
  return matches[0] as AuthorizedMembership;
}
