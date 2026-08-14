import { internalRoles, privilegedRoles } from "@clockwork/contracts";
import {
  LocalSessionResolver,
  type SessionClaims,
  type SessionResolver,
} from "@clockwork/api";
import { findDemoProductionMarker } from "@clockwork/testing/demo-state";
import type { DemoPersona } from "@clockwork/testing/personas";
import {
  DEMO_PERSONA_HEADER,
  demoPersonaCookieName,
  demoPersonaMembership,
  demoPersonaSurfacesEnabled,
  resolveDemoPersona,
} from "@/src/auth/demo-persona";
import {
  listAuthorizedMemberships,
  listAuthorizedMembershipsForUser,
  selectedMembership,
  type AuthorizedMembership,
} from "@/src/auth/identity-repository";
import { resolveReleaseProofIdentity } from "@/src/auth/release-proof-repository";
import {
  releaseProofConfiguration,
  releaseProofCookieName,
  verifyReleaseProofCookieValue,
} from "@/src/auth/release-proof";
import {
  resolveAssistedSession,
  resolveProviderAssistedSession,
  type AssistedSessionView,
} from "@/src/features/internal-ops/assisted-session/repository";
import { resolveWorkosIdentity } from "@clockwork/db";
import {
  checkRecentAuth,
  getTokenClaims,
  withAuth,
} from "@workos-inc/authkit-nextjs";
import { cookies, headers } from "next/headers";

import { getServiceDatabase } from "@/src/db/service";

const configured = () =>
  Boolean(
    process.env.WORKOS_API_KEY &&
    process.env.WORKOS_CLIENT_ID &&
    process.env.WORKOS_COOKIE_PASSWORD,
  );

export const assistedSessionCookieName = "clockwork-assisted-session";

export interface CommerceSession extends SessionClaims {
  authenticationSessionId?: string;
  profile: { name: string; email: string };
  memberships: readonly AuthorizedMembership[];
  selectedAccountId?: string;
  effectiveAccountId?: string;
  assistedSession?: AssistedSessionView;
  assistedSessionProvider?: "clockwork" | "workos";
  providerBacked: boolean;
  authenticationSource: "local" | "workos" | "release-proof";
}

export function explicitDemoIdentityEnabled(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return (
    !findDemoProductionMarker(environment) &&
    environment.NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV?.trim().toLowerCase() !==
      "production" &&
    environment.CLOCKWORK_EXPERIENCE_ADAPTER === "demo"
  );
}

function assertAuthenticationConfiguration() {
  if (
    !configured() &&
    !releaseProofConfiguration() &&
    process.env.NODE_ENV === "production" &&
    !explicitDemoIdentityEnabled()
  )
    throw new Error("WorkOS credentials are required in production");
}

function assertStaffBoundary(
  roles: readonly SessionClaims["roles"][number][],
  isInternalStaff: boolean,
  actorEmail: string,
) {
  const emailDomain = actorEmail.split("@")[1]?.toLowerCase() ?? "";
  const staffDomains = (process.env.INTERNAL_EMAIL_DOMAINS ?? "filone.com")
    .split(",")
    .map((domain) => domain.trim().toLowerCase());
  const hasInternalRole = roles.some((role) =>
    internalRoles.includes(role as (typeof internalRoles)[number]),
  );
  if (
    hasInternalRole !== isInternalStaff ||
    (isInternalStaff && !staffDomains.includes(emailDomain))
  )
    throw new Error(
      "Commerce role violates the internal-staff identity boundary",
    );
}

function assertPrivilegedMfa(
  roles: readonly SessionClaims["roles"][number][],
  mfaVerified: boolean,
) {
  if (
    roles.some((role) =>
      privilegedRoles.includes(role as (typeof privilegedRoles)[number]),
    ) &&
    !mfaVerified
  )
    throw new Error(
      "Privileged commerce roles require an MFA-policy-enforced session",
    );
}

/**
 * Whether THIS session presented a second factor. The organization allow-list
 * answers whether a factor policy is configured, and the identity's enrolment
 * flag answers whether the user could present a factor; neither is evidence
 * that one was presented, so the assurance claim on the access token decides
 * and the list is only allowed to narrow it further.
 *
 * The installed AuthKit (4.3.1) types no assurance claim -- `AccessToken`
 * carries sub, sid, org_id, role(s), permissions, entitlements and feature
 * flags and nothing else -- so the claim is read the way AuthKit reads its own
 * undeclared `auth_time` for `checkRecentAuth`: through `getTokenClaims`. Which
 * claim carries it and which values count is a property of the WorkOS
 * environment, so both are configuration; anything unrecognised, absent or
 * misshapen is not a second factor.
 */
async function sessionAssuranceVerified(
  accessToken: string | undefined,
): Promise<boolean> {
  const claimName = process.env.WORKOS_MFA_ASSURANCE_CLAIM?.trim() || "amr";
  const accepted = (
    process.env.WORKOS_MFA_ASSURANCE_VALUES ?? "mfa,mca,totp,otp"
  )
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (!accessToken || accepted.length === 0) return false;
  // `getTokenClaims` decodes without verifying the signature, which is only
  // safe because this token comes from the sealed session cookie `withAuth`
  // has already validated -- never from a request-supplied token.
  const claims = await getTokenClaims<Record<string, unknown>>(
    accessToken,
  ).catch(() => undefined);
  const presented = claims?.[claimName];
  const values = Array.isArray(presented)
    ? presented
    : typeof presented === "string"
      ? [presented]
      : [];
  return values.some(
    (value) =>
      typeof value === "string" &&
      accepted.includes(value.trim().toLowerCase()),
  );
}

function cookieValue(header: string | null, name: string): string | undefined {
  return header
    ?.split(";")
    .map((part) => part.trim().split("="))
    .find(([candidate]) => candidate === name)
    ?.slice(1)
    .join("=");
}

async function getReleaseProofCommerceSession(input: {
  proofCookie: string | undefined;
  assistedCookie: string | undefined;
  requestOrigin: string | undefined;
}): Promise<CommerceSession> {
  const configuration = releaseProofConfiguration();
  if (
    !configuration ||
    input.requestOrigin !== configuration.origin ||
    !input.proofCookie
  )
    throw new Error("Release-proof authentication is unavailable");
  const payload = verifyReleaseProofCookieValue(
    input.proofCookie,
    configuration,
  );
  const database = getServiceDatabase();
  const proof = await resolveReleaseProofIdentity(database, {
    payload,
    requestId: `release-proof:${payload.sessionId}`,
  });
  let assistedSession: AssistedSessionView | undefined;
  if (input.assistedCookie && proof.selected.isInternalStaff) {
    try {
      assistedSession = await resolveAssistedSession(database, {
        id: input.assistedCookie,
        authenticationSessionId: payload.sessionId,
        internalUserId: proof.selected.userId,
        requestId: `release-proof-assisted:${payload.sessionId}`,
      });
    } catch {
      // Invalid or expired assisted proof never establishes effective scope.
    }
  }
  const roles = assistedSession?.actualRoles ?? [proof.selected.role];
  const actorEmail =
    assistedSession?.actualActorEmail ?? proof.selected.userEmail;
  const isInternalStaff = assistedSession
    ? true
    : proof.selected.isInternalStaff;
  assertStaffBoundary(roles, isInternalStaff, actorEmail);
  assertPrivilegedMfa(roles, proof.mfaVerified);
  const effectiveAccountId =
    assistedSession?.targetAccountId ?? proof.selected.accountId;
  return {
    userId: proof.selected.userId,
    organizationId: proof.selected.organizationId,
    accountIds: isInternalStaff
      ? assistedSession
        ? [assistedSession.targetAccountId]
        : []
      : [proof.selected.accountId],
    roles,
    isInternalStaff,
    mfaVerified: proof.mfaVerified,
    recentAuthenticationVerified: proof.recentAuthenticationVerified,
    authenticationSessionId: payload.sessionId,
    profile: {
      name: assistedSession?.actualActorName ?? proof.selected.userName,
      email: actorEmail,
    },
    memberships: proof.memberships,
    selectedAccountId: proof.selected.accountId,
    effectiveAccountId,
    providerBacked: true,
    authenticationSource: "release-proof",
    ...(assistedSession ? { assistedSession } : {}),
    ...(assistedSession
      ? { assistedSessionProvider: "clockwork" as const }
      : {}),
    ...(assistedSession
      ? {
          impersonation: {
            accountId: effectiveAccountId,
            reason: assistedSession.reason,
            sessionId: assistedSession.id,
            actualUserId: assistedSession.actualUserId,
            actualActorEmail: assistedSession.actualActorEmail,
          },
        }
      : {}),
  };
}

function demoPersonaSession(persona: DemoPersona): CommerceSession {
  return {
    userId: persona.userId,
    organizationId: persona.organizationId,
    accountIds: persona.isInternalStaff ? [] : [persona.selectedAccountId],
    roles: [persona.role],
    isInternalStaff: persona.isInternalStaff,
    mfaVerified: persona.mfaVerified,
    recentAuthenticationVerified: true,
    profile: { name: persona.displayName, email: persona.email },
    memberships: [demoPersonaMembership(persona)],
    selectedAccountId: persona.selectedAccountId,
    effectiveAccountId: persona.selectedAccountId,
    providerBacked: false,
    authenticationSource: "local",
  };
}

export async function requireRecentAuthentication(maxAge = 300) {
  assertAuthenticationConfiguration();
  if (releaseProofConfiguration()) {
    const session = await getCommerceSession();
    if (!session.recentAuthenticationVerified)
      throw new Error("Sensitive action requires recent authentication");
    return;
  }
  if (!configured()) {
    if (!explicitDemoIdentityEnabled())
      throw new Error(
        "Authentication is unavailable without an explicit non-production demo adapter",
      );
    return;
  }
  const recent = await checkRecentAuth({ maxAge });
  if (recent.isStale)
    throw new Error("Sensitive action requires recent authentication");
}

export async function getCommerceSession(): Promise<CommerceSession> {
  assertAuthenticationConfiguration();
  if (releaseProofConfiguration()) {
    const [cookieStore, headerStore] = await Promise.all([
      cookies(),
      headers(),
    ]);
    return getReleaseProofCommerceSession({
      proofCookie: cookieStore.get(releaseProofCookieName)?.value,
      assistedCookie: cookieStore.get(assistedSessionCookieName)?.value,
      requestOrigin: headerStore.get("x-clockwork-proof-origin") ?? undefined,
    });
  }
  if (!configured()) {
    if (!explicitDemoIdentityEnabled())
      throw new Error(
        "Authentication is unavailable without an explicit non-production demo adapter",
      );
    const requestHeaders = await headers();
    // A demo deploy signs in as a catalog persona. The header still decides
    // first, so a role-driven suite keeps the identity it has always had and a
    // persona cookie can never reach it.
    if (demoPersonaSurfacesEnabled(process.env)) {
      const persona = resolveDemoPersona({
        header: requestHeaders.get(DEMO_PERSONA_HEADER),
        cookie: (await cookies()).get(demoPersonaCookieName)?.value,
      });
      if (persona) return demoPersonaSession(persona);
    }
    const requestedRole = requestHeaders.get("x-clockwork-persona");
    const role = (
      requestedRole &&
      (internalRoles as readonly string[]).includes(requestedRole)
        ? requestedRole
        : requestedRole &&
            [
              "owner",
              "admin",
              "billing",
              "member",
              "partner_admin",
              "partner_seller",
            ].includes(requestedRole)
          ? requestedRole
          : "internal_operator"
    ) as SessionClaims["roles"][number];
    const isInternalStaff = internalRoles.includes(
      role as (typeof internalRoles)[number],
    );
    const selectedAccountId =
      requestHeaders.get("x-clockwork-account") ??
      (isInternalStaff
        ? "10000000-0000-4000-8000-000000000009"
        : role === "partner_admin" || role === "partner_seller"
          ? "10000000-0000-4000-8000-000000000002"
          : "10000000-0000-4000-8000-000000000001");
    return {
      userId: isInternalStaff
        ? "20000000-0000-4000-8000-000000000001"
        : "20000000-0000-4000-8000-000000000002",
      organizationId: isInternalStaff
        ? "30000000-0000-4000-8000-000000000008"
        : "30000000-0000-4000-8000-000000000001",
      accountIds: isInternalStaff ? [] : [selectedAccountId],
      roles: [role],
      isInternalStaff,
      mfaVerified: true,
      recentAuthenticationVerified: true,
      profile: isInternalStaff
        ? { name: "Local operator", email: "operator@filone.test" }
        : { name: "Local portal user", email: "portal-user@demo.test" },
      memberships: [],
      selectedAccountId,
      effectiveAccountId: selectedAccountId,
      providerBacked: false,
      authenticationSource: "local",
    };
  }

  const session = await withAuth({ ensureSignedIn: true });
  if (!session.organizationId)
    throw new Error("Organization selection is required");
  const database = getServiceDatabase();
  const [identity, memberships] = await Promise.all([
    resolveWorkosIdentity(database, {
      workosUserId: session.user.id,
      workosOrganizationId: session.organizationId,
      requestId: `auth:${session.sessionId}`,
    }),
    listAuthorizedMemberships(database, {
      workosUserId: session.user.id,
      requestId: `auth-memberships:${session.sessionId}`,
    }),
  ]);
  const selected = selectedMembership(memberships, session.organizationId);
  if (
    selected.userId !== identity.userId ||
    selected.organizationId !== identity.organizationId ||
    selected.accountId !== identity.accountId ||
    selected.role !== identity.role
  )
    throw new Error("Selected WorkOS membership does not match commerce scope");

  const assistedCookie = (await cookies()).get(
    assistedSessionCookieName,
  )?.value;
  let assistedSession: AssistedSessionView | undefined;
  if (assistedCookie && identity.isInternalStaff) {
    try {
      assistedSession = await resolveAssistedSession(database, {
        id: assistedCookie,
        authenticationSessionId: session.sessionId,
        internalUserId: identity.userId,
        requestId: `assisted-session:${session.sessionId}`,
      });
    } catch {
      // An expired, ended, forged, or role-revoked session grants no effective
      // account. The underlying staff session remains valid and unassisted.
    }
  }
  const providerAssistedSession = session.impersonator
    ? await resolveProviderAssistedSession(database, {
        authenticationSessionId: session.sessionId,
        impersonatorEmail: session.impersonator.email,
        targetAccountId: identity.accountId,
        reason: session.impersonator.reason ?? "",
        requestId: `provider-impersonation:${session.sessionId}`,
      })
    : undefined;
  if (providerAssistedSession && identity.isInternalStaff)
    throw new Error("Provider assisted access requires a tenant target");
  const actorMemberships = providerAssistedSession
    ? await listAuthorizedMembershipsForUser(database, {
        userId: providerAssistedSession.actualUserId,
        requestId: `provider-actor-memberships:${session.sessionId}`,
      })
    : memberships;
  const internalActorMemberships = providerAssistedSession
    ? actorMemberships.filter(
        ({ audience, isInternalStaff }) =>
          audience === "internal" && isInternalStaff,
      )
    : [];
  if (providerAssistedSession && internalActorMemberships.length !== 1)
    throw new Error(
      "Provider assisted actor is not linked to exactly one staff organization",
    );
  const actorSelected = providerAssistedSession
    ? internalActorMemberships[0]
    : selected;
  if (!actorSelected)
    throw new Error("Provider assisted actor membership is unavailable");
  const activeAssistedSession = assistedSession ?? providerAssistedSession;
  const normalizedRoles = activeAssistedSession?.actualRoles ?? [identity.role];
  const actorEmail =
    activeAssistedSession?.actualActorEmail ?? selected.userEmail;
  const isInternalStaff = activeAssistedSession
    ? true
    : identity.isInternalStaff;
  assertStaffBoundary(normalizedRoles, isInternalStaff, actorEmail);
  const policyOrganizations = (
    process.env.WORKOS_MFA_POLICY_ORGANIZATION_IDS ?? ""
  )
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const assuranceOrganizations = providerAssistedSession
    ? internalActorMemberships.map(
        ({ workosOrganizationId }) => workosOrganizationId,
      )
    : [session.organizationId];
  // Assurance first, policy second: an organization added to the variable
  // before its factor policy exists, or one whose policy is later relaxed,
  // cannot make a single-factor session read as verified.
  const mfaVerified =
    (await sessionAssuranceVerified(session.accessToken)) &&
    assuranceOrganizations.some((organizationId) =>
      policyOrganizations.includes(organizationId),
    );
  assertPrivilegedMfa(normalizedRoles, mfaVerified);
  const recentAuthentication = await checkRecentAuth({ maxAge: 300 });
  const accountIds = activeAssistedSession
    ? [activeAssistedSession.targetAccountId]
    : isInternalStaff
      ? []
      : [identity.accountId];
  return {
    userId: activeAssistedSession?.actualUserId ?? identity.userId,
    organizationId: providerAssistedSession
      ? actorSelected.organizationId
      : identity.organizationId,
    accountIds,
    roles: normalizedRoles,
    isInternalStaff,
    mfaVerified,
    recentAuthenticationVerified: !recentAuthentication.isStale,
    authenticationSessionId: session.sessionId,
    profile: {
      name: activeAssistedSession?.actualActorName ?? selected.userName,
      email: actorEmail,
    },
    memberships: providerAssistedSession ? actorMemberships : memberships,
    selectedAccountId: providerAssistedSession
      ? actorSelected.accountId
      : selected.accountId,
    effectiveAccountId:
      activeAssistedSession?.targetAccountId ?? selected.accountId,
    providerBacked: true,
    authenticationSource: "workos",
    ...(activeAssistedSession
      ? { assistedSession: activeAssistedSession }
      : {}),
    ...(activeAssistedSession
      ? {
          assistedSessionProvider: providerAssistedSession
            ? ("workos" as const)
            : ("clockwork" as const),
        }
      : {}),
    ...(activeAssistedSession
      ? {
          impersonation: {
            accountId: activeAssistedSession.targetAccountId,
            reason: activeAssistedSession.reason,
            sessionId: activeAssistedSession.id,
            actualUserId: activeAssistedSession.actualUserId,
            actualActorEmail: actorEmail,
          },
        }
      : {}),
  };
}

export class WorkosNextSessionResolver implements SessionResolver {
  public async resolve(request: Request): Promise<SessionClaims | null> {
    assertAuthenticationConfiguration();
    if (
      request.method === "POST" &&
      new URL(request.url).pathname.endsWith("/v1/lifecycle/registrations")
    )
      return null;
    if (releaseProofConfiguration()) {
      const requestUrl = new URL(request.url);
      return getReleaseProofCommerceSession({
        proofCookie: cookieValue(
          request.headers.get("cookie"),
          releaseProofCookieName,
        ),
        assistedCookie: cookieValue(
          request.headers.get("cookie"),
          assistedSessionCookieName,
        ),
        requestOrigin: requestUrl.origin,
      });
    }
    if (!configured()) {
      if (!explicitDemoIdentityEnabled())
        throw new Error(
          "Authentication is unavailable without an explicit non-production demo adapter",
        );
      // The chosen persona is the identity for API calls too. Without it the
      // signed-in name on the page and the actor the commerce API records would
      // disagree, and a signing return would never match its correlation.
      if (demoPersonaSurfacesEnabled(process.env)) {
        const persona = resolveDemoPersona({
          header: request.headers.get(DEMO_PERSONA_HEADER),
          cookie: cookieValue(
            request.headers.get("cookie"),
            demoPersonaCookieName,
          ),
        });
        if (persona) return demoPersonaSession(persona);
      }
      return new LocalSessionResolver().resolve(request);
    }
    return getCommerceSession();
  }
}
