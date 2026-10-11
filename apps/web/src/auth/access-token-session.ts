import "server-only";

import { permissionsForRoles } from "@clockwork/contracts";
import {
  AccessTokenRepository,
  type AuthenticatedAccessToken,
} from "@clockwork/db";

import { listAuthorizedMembershipsForUser } from "@/src/auth/identity-repository";
import type { CommerceSession } from "@/src/auth/session";
import { configuredStaffEmailDomains } from "@/src/auth/staff-domains";
import { getServiceDatabase } from "@/src/db/service";

export const accessTokenRepository = () =>
  new AccessTokenRepository(getServiceDatabase());

/**
 * The session an access token acts with: the person's staff membership in the
 * token's organization as it stands now, with today's roles and permissions.
 * Null when the person no longer holds that membership or an address on a
 * staff domain; the token is then refused like an unknown one.
 *
 * A token is created only after a fresh MFA verification, and it dies when
 * the person's authenticator is reset, so the session counts as MFA-verified
 * while commerce records the person as enrolled. It never counts as a recent
 * sign-in.
 */
export async function accessTokenCommerceSession(
  token: AuthenticatedAccessToken,
): Promise<CommerceSession | null> {
  const repository = accessTokenRepository();
  const [memberships, mfaEnrolled] = await Promise.all([
    listAuthorizedMembershipsForUser(getServiceDatabase(), {
      userId: token.userId,
      requestId: `access-token-memberships:${token.id}`,
    }),
    repository.mfaEnrolled(token.userId),
  ]);
  const staff = memberships.filter(
    (membership) =>
      membership.organizationId === token.organizationId &&
      membership.audience === "internal" &&
      membership.isInternalStaff,
  );
  const selected = staff.length === 1 ? staff[0] : undefined;
  if (!selected) return null;
  const domain = selected.userEmail.split("@")[1]?.toLowerCase() ?? "";
  if (!configuredStaffEmailDomains().includes(domain)) return null;
  return {
    userId: selected.userId,
    organizationId: selected.organizationId,
    accountIds: [],
    roles: selected.roles,
    permissions: permissionsForRoles(selected.roles, { side: selected.side }),
    side: selected.side,
    isInternalStaff: true,
    mfaVerified: mfaEnrolled,
    recentAuthenticationVerified: false,
    profile: { name: selected.userName, email: selected.userEmail },
    memberships: [selected],
    selectedAccountId: selected.accountId,
    effectiveAccountId: selected.accountId,
    providerBacked: true,
    authenticationSource: "access-token",
    accessToken: {
      id: token.id,
      name: token.name,
      scope: token.scope,
      expiresAt: token.expiresAt,
    },
  };
}
