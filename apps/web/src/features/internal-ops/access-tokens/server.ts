import "server-only";

import {
  contextHasPermission,
  type AccessTokenRecord,
} from "@clockwork/contracts";

import { accessTokenRepository } from "@/src/auth/access-token-session";
import {
  explicitDemoIdentityEnabled,
  getRequestCommerceSession,
  type CommerceSession,
} from "@/src/auth/session";
import { getOptionalServiceDatabase } from "@/src/db/service";

import type { OwnAccessTokensView, StaffAccessTokensView } from "./model";

/**
 * Who may hold access tokens: a staff member in their own MFA-verified
 * session, never an assisted, impersonated or token-authenticated one.
 */
export function mayHoldAccessTokens(session: CommerceSession): boolean {
  return (
    session.isInternalStaff &&
    session.providerBacked &&
    session.mfaVerified &&
    Boolean(session.organizationId) &&
    !session.impersonation &&
    !session.assistedSession &&
    !session.authenticationProviderImpersonator &&
    session.authenticationSource !== "access-token"
  );
}

/**
 * The authenticator a new token is bound to: a WorkOS session needs an MFA
 * verification of its own in the last 30 minutes, whose factor the token
 * records, so a later reset of that authenticator revokes it. A release-proof
 * session has no provider factor. Undefined when no fresh verification exists.
 */
export async function tokenCreationFactor(
  session: CommerceSession,
): Promise<{ factorId: string | null } | undefined> {
  if (!session.recentAuthenticationVerified) return undefined;
  if (session.authenticationSource === "release-proof")
    return { factorId: null };
  const membership = session.memberships.find(
    ({ organizationId, isInternalStaff }) =>
      organizationId === session.organizationId && isInternalStaff,
  );
  if (
    session.authenticationSource !== "workos" ||
    !session.authenticationSessionId ||
    !session.authenticationProviderUserId ||
    !membership
  )
    return undefined;
  const factorId = await accessTokenRepository().sessionFactor({
    sessionId: session.authenticationSessionId,
    workosUserId: session.authenticationProviderUserId,
    workosOrganizationId: membership.workosOrganizationId,
  });
  return factorId ? { factorId } : undefined;
}

/** The signed-in staff member's own tokens. */
export async function loadOwnAccessTokens(): Promise<OwnAccessTokensView> {
  if (explicitDemoIdentityEnabled()) return { mode: "demo" };
  if (!getOptionalServiceDatabase()) return { mode: "unavailable" };
  try {
    const session = await getRequestCommerceSession();
    if (!mayHoldAccessTokens(session)) return { mode: "unavailable" };
    const tokens: AccessTokenRecord[] = await accessTokenRepository().list(
      session.userId,
    );
    return {
      mode: "live",
      tokens,
      recentlyVerified: (await tokenCreationFactor(session)) !== undefined,
    };
  } catch (error) {
    console.error("Access tokens could not be read", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return { mode: "unavailable" };
  }
}

/** Every token in the staff organization; the Team page is `staff:manage`. */
export async function loadStaffAccessTokens(): Promise<StaffAccessTokensView> {
  if (explicitDemoIdentityEnabled()) return { mode: "demo" };
  if (!getOptionalServiceDatabase()) return { mode: "unavailable" };
  try {
    const session = await getRequestCommerceSession();
    if (
      !session.providerBacked ||
      !session.organizationId ||
      !contextHasPermission(session, "staff:manage")
    )
      return { mode: "unavailable" };
    return {
      mode: "live",
      tokens: await accessTokenRepository().listForOrganization(
        session.organizationId,
      ),
    };
  } catch (error) {
    console.error("Staff access tokens could not be read", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return { mode: "unavailable" };
  }
}
