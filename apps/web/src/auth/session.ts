import { internalRoles, privilegedRoles } from "@clockwork/contracts";
import {
  LocalSessionResolver,
  type SessionClaims,
  type SessionResolver,
} from "@clockwork/api";
import {
  resolveActiveImpersonation,
  resolveWorkosIdentity,
} from "@clockwork/db";
import { checkRecentAuth, withAuth } from "@workos-inc/authkit-nextjs";

import { getServiceDatabase } from "@/src/db/service";

const configured = () =>
  Boolean(
    process.env.WORKOS_API_KEY &&
    process.env.WORKOS_CLIENT_ID &&
    process.env.WORKOS_COOKIE_PASSWORD,
  );

function assertAuthenticationConfiguration() {
  if (!configured() && process.env.NODE_ENV === "production")
    throw new Error("WorkOS credentials are required in production");
}

export async function requireRecentAuthentication(maxAge = 300) {
  assertAuthenticationConfiguration();
  if (!configured()) return;
  const recent = await checkRecentAuth({ maxAge });
  if (recent.isStale)
    throw new Error("Sensitive action requires recent authentication");
}

export async function getCommerceSession(): Promise<SessionClaims> {
  assertAuthenticationConfiguration();
  if (!configured()) {
    return {
      userId: "20000000-0000-4000-8000-000000000001",
      organizationId: "30000000-0000-4000-8000-000000000008",
      accountIds: [],
      roles: ["internal_operator"],
      isInternalStaff: true,
      mfaVerified: true,
      recentAuthenticationVerified: true,
    };
  }

  const session = await withAuth({ ensureSignedIn: true });
  if (!session.organizationId)
    throw new Error("Organization selection is required");
  const identity = await resolveWorkosIdentity(getServiceDatabase(), {
    workosUserId: session.user.id,
    workosOrganizationId: session.organizationId,
    requestId: `auth:${session.sessionId}`,
  });
  const impersonation = session.impersonator
    ? await resolveActiveImpersonation(getServiceDatabase(), {
        impersonatorEmail: session.impersonator.email,
        targetAccountId: identity.accountId,
        reason: session.impersonator.reason ?? "",
        requestId: `impersonation:${session.sessionId}`,
      })
    : undefined;
  const normalizedRoles = impersonation?.actualRoles ?? [identity.role];
  const actorEmail = impersonation?.actualActorEmail ?? session.user.email;
  const emailDomain = actorEmail.split("@")[1]?.toLowerCase() ?? "";
  const staffDomains = (process.env.INTERNAL_EMAIL_DOMAINS ?? "filone.com")
    .split(",")
    .map((domain) => domain.trim().toLowerCase());
  const hasInternalRole = normalizedRoles.some((role) =>
    internalRoles.includes(role as (typeof internalRoles)[number]),
  );
  const isInternalStaff = impersonation
    ? impersonation.isInternalStaff
    : identity.isInternalStaff;
  if (
    hasInternalRole !== isInternalStaff ||
    (isInternalStaff && !staffDomains.includes(emailDomain))
  )
    throw new Error(
      "Commerce role violates the internal-staff identity boundary",
    );
  const policyOrganizations = (
    process.env.WORKOS_MFA_POLICY_ORGANIZATION_IDS ?? ""
  )
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const assuranceOrganizations = impersonation
    ? impersonation.actualWorkosOrganizationIds
    : [session.organizationId];
  const mfaVerified = assuranceOrganizations.some((organizationId) =>
    policyOrganizations.includes(organizationId),
  );
  if (
    normalizedRoles.some((role) =>
      privilegedRoles.includes(role as (typeof privilegedRoles)[number]),
    ) &&
    !mfaVerified
  ) {
    throw new Error(
      "Privileged commerce roles require an MFA-policy-enforced session",
    );
  }
  const recentAuthentication = await checkRecentAuth({ maxAge: 300 });
  const accountIds = isInternalStaff ? [] : [identity.accountId];
  return {
    userId: identity.userId,
    organizationId: identity.organizationId,
    accountIds,
    roles: normalizedRoles,
    isInternalStaff,
    mfaVerified,
    recentAuthenticationVerified: !recentAuthentication.isStale,
    ...(session.impersonator && impersonation
      ? {
          impersonation: {
            accountId: identity.accountId,
            reason: session.impersonator.reason ?? "",
            sessionId: impersonation.sessionId,
            actualUserId: impersonation.actualUserId,
            actualActorEmail: impersonation.actualActorEmail,
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
    if (!configured()) return new LocalSessionResolver().resolve(request);
    return getCommerceSession();
  }
}
