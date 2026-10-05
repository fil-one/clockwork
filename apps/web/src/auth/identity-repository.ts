import "server-only";

import { sql } from "drizzle-orm";

import {
  OrganizationSideSchema,
  RoleSchema,
  type OrganizationSide,
  type Role,
} from "@clockwork/contracts";
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
  /** The primary role: it picks the label people see. */
  role: Role;
  /** Every role the membership holds, the primary role first. */
  roles: readonly Role[];
  /** Which side of the business the organization is on. */
  side: OrganizationSide;
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
  roles: string[] | null;
  side: string;
}

/**
 * The portal a membership opens, decided by the organization's side: Fil One
 * staff work in the internal portal, channel and referral partners in the
 * partner portal, and everyone else in the customer portal.
 */
export function audienceForMembership(input: {
  side: OrganizationSide;
  isInternalStaff: boolean;
}): PortalAudience {
  if (input.side === "fil_one" && input.isInternalStaff) return "internal";
  if (input.side === "channel_partner" || input.side === "referral_partner")
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

/** The primary role first, then every other role the membership holds. */
export function membershipRoles(
  primary: Role,
  granted: readonly string[],
): Role[] {
  return [
    primary,
    ...granted
      .map((role) => RoleSchema.parse(role))
      .filter(
        (role, index, all) => role !== primary && all.indexOf(role) === index,
      ),
  ];
}

function membership(row: MembershipRow): AuthorizedMembership {
  const role = RoleSchema.parse(row.role);
  const side = OrganizationSideSchema.parse(row.side);
  const audience = audienceForMembership({
    side,
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
    roles: membershipRoles(role, row.roles ?? []),
    side,
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
             m.role,
             array(
               select granted.role
               from public.membership_roles granted
               where granted.membership_id = m.id
               order by granted.granted_at, granted.role
             )::text[] as roles,
             o.side
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
             m.role,
             array(
               select granted.role
               from public.membership_roles granted
               where granted.membership_id = m.id
               order by granted.granted_at, granted.role
             )::text[] as roles,
             o.side
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
    // i18n-exempt: caught by switchCommerceAccount, which returns { ok: false }; never rendered
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
    // i18n-exempt: server-side invariant for logs; in production readers get the translated error page and a digest
    throw new Error("Selected organization is not an authorized membership");
  return matches[0] as AuthorizedMembership;
}
