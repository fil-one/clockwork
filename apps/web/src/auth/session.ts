import { internalRoles, privilegedRoles } from "@clockwork/contracts";
import {
  LocalSessionResolver,
  type SessionClaims,
  type SessionResolver,
} from "@clockwork/api";
import { findDemoProductionMarker } from "@clockwork/testing/demo-state";
import { demoAccountIds, type DemoPersona } from "@clockwork/testing/personas";
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
import { findMfaReceipt, resolveWorkosIdentity } from "@clockwork/db";
import {
  getTokenClaims,
  type UserInfo,
  withAuth,
} from "@workos-inc/authkit-nextjs";
import { cookies, headers } from "next/headers";
import { WorkOS } from "@workos-inc/node";

import {
  demoAccessConfiguration,
  demoAccessCookieName,
  verifyDemoAccessCookie,
} from "@/src/auth/demo-access";
import { getServiceDatabase } from "@/src/db/service";

export const workosAuthenticationConfigured = () =>
  Boolean(
    process.env.WORKOS_API_KEY &&
    process.env.WORKOS_CLIENT_ID &&
    process.env.WORKOS_COOKIE_PASSWORD,
  );

export const assistedSessionCookieName = "clockwork-assisted-session";

export interface CommerceSession extends SessionClaims {
  authenticationSessionId?: string;
  authenticationProviderUserId?: string;
  authenticationProviderImpersonator?: boolean;
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
    !workosAuthenticationConfigured() &&
    !releaseProofConfiguration() &&
    process.env.NODE_ENV === "production" &&
    !explicitDemoIdentityEnabled()
  )
    // i18n-exempt: server-side invariant for logs; in production readers get the translated error page and a digest
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
      // i18n-exempt: server-side invariant for logs; in production readers get the translated error page and a digest
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
      // i18n-exempt: control signal matched verbatim by route-session.ts to redirect to /access/mfa; never rendered
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

type RequestHeaders = Pick<Headers, "get">;

/**
 * Fetch actions carry their reference in `next-action`; a native form action
 * carries it in a multipart body instead. Both forms deliberately bypass the
 * proxy on Netlify, where entering the proxy consumes the body before Next can
 * decode it. Treat both as direct destination requests, never as requests that
 * inherited a trusted proxy header.
 */
function isDirectServerAction(headersList: RequestHeaders): boolean {
  if (headersList.get("next-action")) return true;
  const contentType = headersList.get("content-type")?.toLowerCase() ?? "";
  return (
    contentType.startsWith("multipart/form-data") ||
    contentType.startsWith("application/x-www-form-urlencoded")
  );
}

/** A configured shared demo never synthesizes identity without its grant. */
async function demoAccessGranted(value: string | undefined): Promise<boolean> {
  const secret = demoAccessConfiguration(process.env);
  return (
    !secret || Boolean(value && (await verifyDemoAccessCookie(value, secret)))
  );
}

/**
 * Release-proof page renders receive a proxy-overwritten origin header. A
 * skipped Server Action cannot trust that header because a caller can supply
 * it directly, so it re-establishes the browser's canonical Origin and Host at
 * the destination.
 */
function releaseProofRequestOrigin(
  headersList: RequestHeaders,
  configuredOrigin: string,
): string | undefined {
  if (!isDirectServerAction(headersList))
    return headersList.get("x-clockwork-proof-origin") ?? undefined;
  const canonical = new URL(configuredOrigin);
  const origin = headersList.get("origin");
  const host = headersList.get("host")?.trim().toLowerCase();
  const fetchSite = headersList.get("sec-fetch-site")?.trim().toLowerCase();
  return origin === canonical.origin &&
    host === canonical.host.toLowerCase() &&
    (!fetchSite || fetchSite === "same-origin")
    ? canonical.origin
    : undefined;
}

let sealedSessionClient: WorkOS | undefined;
function getSealedSessionClient(): WorkOS {
  const apiKey = process.env.WORKOS_API_KEY;
  const clientId = process.env.WORKOS_CLIENT_ID;
  if (!apiKey || !clientId)
    // i18n-exempt: server-side invariant for logs; in production readers get the translated error page and a digest
    throw new Error("WorkOS authentication is required");
  // AuthKit constructs its own client without an explicit clientId. Its token
  // refresh calls pass that ID per request, but the read-only cookie verifier
  // needs it on the client to locate the application's JWKS in bundled builds.
  return (sealedSessionClient ??= new WorkOS(apiKey, { clientId }));
}

/**
 * Actions skip AuthKit's proxy to preserve their body. Authenticate their
 * sealed cookie without rotating it: Next renders the action response with
 * the same POST headers, but its cookie store is read-only during that render.
 * Normal navigations remain responsible for refreshing expired sessions.
 */
export async function getVerifiedWorkosSession(): Promise<UserInfo> {
  const requestHeaders = await headers();
  if (isDirectServerAction(requestHeaders)) {
    const cookieStore = await cookies();
    const sessionData = cookieStore.get(
      process.env.WORKOS_COOKIE_NAME || "wos-session",
    )?.value;
    const cookiePassword = process.env.WORKOS_COOKIE_PASSWORD;
    if (!sessionData || !cookiePassword)
      // i18n-exempt: server-side invariant for logs; in production readers get the translated error page and a digest
      throw new Error("WorkOS authentication is required");
    const resolved = await getSealedSessionClient()
      .userManagement.loadSealedSession({
        sessionData,
        cookiePassword,
      })
      .authenticate();
    if (!resolved.authenticated || !resolved.user)
      // i18n-exempt: server-side invariant for logs; in production readers get the translated error page and a digest
      throw new Error("WorkOS authentication is required");
    const claims = await getTokenClaims(resolved.accessToken);
    if (claims.sub !== resolved.user.id)
      // i18n-exempt: server-side invariant for logs; in production readers get the translated error page and a digest
      throw new Error("WorkOS authentication is required");
    return resolved;
  }
  const resolved = await withAuth();
  // i18n-exempt: server-side invariant for logs; in production readers get the translated error page and a digest
  if (!resolved.user) throw new Error("WorkOS authentication is required");
  return resolved;
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
    // i18n-exempt: server-side invariant for logs; in production readers get the translated error page and a digest
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

export async function requireRecentAuthentication(): Promise<CommerceSession> {
  const session = await getCommerceSession();
  if (!session.recentAuthenticationVerified)
    // i18n-exempt: thrown to server actions, which catch it into their own copy or let Next redact it to a digest; never rendered
    throw new Error("Sensitive action requires recent authentication");
  return session;
}

export async function getCommerceSession(): Promise<CommerceSession> {
  assertAuthenticationConfiguration();
  if (releaseProofConfiguration()) {
    const [cookieStore, headerStore] = await Promise.all([
      cookies(),
      headers(),
    ]);
    const configuration = releaseProofConfiguration();
    return getReleaseProofCommerceSession({
      proofCookie: cookieStore.get(releaseProofCookieName)?.value,
      assistedCookie: cookieStore.get(assistedSessionCookieName)?.value,
      requestOrigin: configuration
        ? releaseProofRequestOrigin(headerStore, configuration.origin)
        : undefined,
    });
  }
  if (!workosAuthenticationConfigured()) {
    if (!explicitDemoIdentityEnabled())
      throw new Error(
        // i18n-exempt: server-side invariant for logs; in production readers get the translated error page and a digest
        "Authentication is unavailable without an explicit non-production demo adapter",
      );
    const cookieStore = await cookies();
    if (
      !(await demoAccessGranted(cookieStore.get(demoAccessCookieName)?.value))
    )
      // i18n-exempt: server-side invariant for logs; in production readers get the translated error page and a digest
      throw new Error("A valid demo access grant is required");
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
          ? demoAccountIds.reseller
          : demoAccountIds.direct);
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
        ? { name: "Local operator", email: "operator@filone.test" } // i18n-exempt: local placeholder identity; no surface renders this profile (route-session builds the shell profile from its own demo memberships)
        : { name: "Local portal user", email: "portal-user@demo.test" }, // i18n-exempt: local placeholder identity; no surface renders this profile (route-session builds the shell profile from its own demo memberships)
      memberships: [],
      selectedAccountId,
      effectiveAccountId: selectedAccountId,
      providerBacked: false,
      authenticationSource: "local",
    };
  }

  const session = await getVerifiedWorkosSession();
  const assistedCookie = (await cookies()).get(
    assistedSessionCookieName,
  )?.value;
  return workosCommerceSession(session, assistedCookie);
}

async function workosCommerceSession(
  session: UserInfo,
  assistedCookie: string | undefined,
): Promise<CommerceSession> {
  if (!session.organizationId)
    // i18n-exempt: control signal matched verbatim by route-session.ts to redirect to /choose-organization; never rendered
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
    // i18n-exempt: server-side invariant for logs; in production readers get the translated error page and a digest
    throw new Error("Selected WorkOS membership does not match commerce scope");

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
    // i18n-exempt: server-side invariant for logs; in production readers get the translated error page and a digest
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
      // i18n-exempt: server-side invariant for logs; in production readers get the translated error page and a digest
      "Provider assisted actor is not linked to exactly one staff organization",
    );
  const actorSelected = providerAssistedSession
    ? internalActorMemberships[0]
    : selected;
  if (!actorSelected)
    // i18n-exempt: server-side invariant for logs; in production readers get the translated error page and a digest
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
  const receiptTime = session.impersonator
    ? undefined
    : await findMfaReceipt(database, {
        sessionId: session.sessionId,
        workosUserId: session.user.id,
        workosOrganizationId: session.organizationId,
      });
  const mfaVerified =
    ((await sessionAssuranceVerified(session.accessToken)) ||
      receiptTime !== undefined) &&
    assuranceOrganizations.some((organizationId) =>
      policyOrganizations.includes(organizationId),
    );
  assertPrivilegedMfa(normalizedRoles, mfaVerified);
  const recentClaims = await getTokenClaims<{ auth_time?: unknown }>(
    session.accessToken,
  ).catch(() => undefined);
  const authTime = recentClaims?.auth_time;
  const recentAuthenticationVerified =
    (typeof authTime === "number" &&
      Number.isFinite(authTime) &&
      Math.floor(Date.now() / 1000) >= authTime &&
      Math.floor(Date.now() / 1000) - authTime <= 300) ||
    (receiptTime !== undefined &&
      receiptTime <= Date.now() &&
      Date.now() - receiptTime <= 300_000);
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
    recentAuthenticationVerified,
    authenticationSessionId: session.sessionId,
    authenticationProviderUserId: session.user.id,
    authenticationProviderImpersonator: Boolean(session.impersonator),
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
  readonly #verifiedSessions = new WeakMap<Request, UserInfo>();
  readonly #requireBoundSession: boolean;

  public constructor(options: { requireBoundSession?: boolean } = {}) {
    this.#requireBoundSession = options.requireBoundSession ?? false;
  }

  public bindVerifiedSession(request: Request, session: UserInfo): void {
    this.#verifiedSessions.set(request, session);
  }

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
    if (!workosAuthenticationConfigured()) {
      if (!explicitDemoIdentityEnabled())
        throw new Error(
          // i18n-exempt: server-side invariant for logs; in production readers get the translated error page and a digest
          "Authentication is unavailable without an explicit non-production demo adapter",
        );
      if (
        !(await demoAccessGranted(
          cookieValue(request.headers.get("cookie"), demoAccessCookieName),
        ))
      )
        return null;
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
    const verified = this.#verifiedSessions.get(request);
    this.#verifiedSessions.delete(request);
    if (verified)
      return workosCommerceSession(
        verified,
        cookieValue(request.headers.get("cookie"), assistedSessionCookieName),
      );
    // `/api/experience/*` still runs behind AuthKit's proxy and legitimately
    // resolves the trusted request-scoped middleware session. Only the raw-body
    // Hono boundary opts into strict request binding.
    return this.#requireBoundSession ? null : getCommerceSession();
  }
}
