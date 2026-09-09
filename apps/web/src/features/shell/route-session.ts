import { redirect } from "next/navigation";
import "server-only";

import { cookies, headers } from "next/headers";
import { connection } from "next/server";
import { cache } from "react";

import { roles as commerceRoles, type Role } from "@clockwork/contracts";
import { demoAccountIds } from "@clockwork/testing/personas";
import { withAuth } from "@workos-inc/authkit-nextjs";

import {
  listAuthorizedMemberships,
  type AuthorizedMembership,
} from "@/src/auth/identity-repository";
import {
  DEMO_PERSONA_HEADER,
  demoPersonaCookieName,
  demoPersonaMembership,
  demoPersonaSurfacesEnabled,
  resolveDemoPersona,
} from "@/src/auth/demo-persona";
import { releaseProofConfiguration } from "@/src/auth/release-proof";
import {
  explicitDemoIdentityEnabled,
  getCommerceSession,
  type CommerceSession,
} from "@/src/auth/session";
import { getServiceDatabase } from "@/src/db/service";

import type { ExperienceAudience } from "./navigation";

const demoRoles = {
  customer: ["owner"],
  partner: ["partner_admin"],
  internal: [
    "internal_operator",
    "finance_approver",
    "legal_approver",
    "destructive_action_approver",
  ],
} as const;

const demoMemberships: Readonly<
  Record<ExperienceAudience, AuthorizedMembership>
> = {
  customer: {
    userId: "20000000-0000-4000-8000-000000000002",
    userName: "Maya Chen",
    userEmail: "owner@northstar.test",
    isInternalStaff: false,
    organizationId: "30000000-0000-4000-8000-000000000001",
    workosOrganizationId: "org_local_northstar",
    organizationName: "Northstar Production",
    accountId: demoAccountIds.direct,
    accountName: "Northstar Archive Labs",
    role: "owner",
    audience: "customer",
    home: "/dashboard",
  },
  partner: {
    userId: "20000000-0000-4000-8000-000000000003",
    userName: "Demo partner admin",
    userEmail: "admin@redwood.test",
    isInternalStaff: false,
    organizationId: "30000000-0000-4000-8000-000000000002",
    workosOrganizationId: "org_local_redwood",
    organizationName: "Redwood Partner",
    accountId: demoAccountIds.reseller,
    accountName: "Redwood Channel Group",
    role: "partner_admin",
    audience: "partner",
    home: "/partner",
  },
  internal: {
    userId: "20000000-0000-4000-8000-000000000001",
    userName: "Demo internal operator",
    userEmail: "operator@filone.test",
    isInternalStaff: true,
    organizationId: "30000000-0000-4000-8000-000000000008",
    workosOrganizationId: "org_local_clockwork_staff",
    organizationName: "Fil One Staff",
    accountId: "10000000-0000-4000-8000-000000000009",
    accountName: "Fil One Internal Operations",
    role: "internal_operator",
    audience: "internal",
    home: "/internal",
  },
};

/**
 * How a session with no stated preference is formatted.
 *
 * UTC rather than a deployment-local zone, because UTC is the only zone that
 * reads the same for every person looking at the record, and every surface
 * that renders a timestamp now names the zone alongside it. The previous
 * behaviour -- an unlabelled `America/New_York` compiled into each dashboard --
 * showed a reader in London a New York wall clock with nothing on the page to
 * say so.
 *
 * A provider-backed session has no locale or zone on it yet; when the identity
 * provider starts carrying them, this is the one place that changes.
 */
export const defaultRouteFormatting = {
  locale: "en-US",
  timeZone: "UTC",
} as const;

export interface RouteSession {
  roles: readonly string[];
  profile: CommerceSession["profile"];
  /** BCP-47 tag the surface formats dates and numbers with. */
  locale: string;
  /** IANA zone every rendered timestamp is converted to, and labelled with. */
  timeZone: string;
  memberships: readonly AuthorizedMembership[];
  selectedAccountId: string;
  effectiveAccountId: string;
  providerBacked: boolean;
  assistedSession?: CommerceSession["assistedSession"];
  assistedSessionProvider?: CommerceSession["assistedSessionProvider"];
  authenticationSource: CommerceSession["authenticationSource"];
}

function workosConfigured(): boolean {
  return Boolean(
    process.env.WORKOS_API_KEY &&
    process.env.WORKOS_CLIENT_ID &&
    process.env.WORKOS_COOKIE_PASSWORD,
  );
}

function providerAuthenticationConfigured(): boolean {
  return workosConfigured() || Boolean(releaseProofConfiguration());
}

function isCommerceRole(value: string | null): value is Role {
  return Boolean(value && (commerceRoles as readonly string[]).includes(value));
}

function demoPersonaOverrideAllowed(): boolean {
  return (
    explicitDemoIdentityEnabled() ||
    (process.env.NODE_ENV !== "production" &&
      process.env.NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV !== "production")
  );
}

const getCachedCommerceSession = cache(getCommerceSession);

export async function getRouteSession(
  audience: ExperienceAudience,
): Promise<RouteSession> {
  await connection();
  if (!providerAuthenticationConfigured()) {
    if (!explicitDemoIdentityEnabled())
      throw new Error(
        "Portal identity is unavailable without an explicit non-production demo adapter",
      );
    // A demo deploy signs in as a catalog persona, whose own account and
    // audience replace the audience-shaped placeholder identity.
    const persona = demoPersonaSurfacesEnabled(process.env)
      ? resolveDemoPersona({
          header: (await headers()).get(DEMO_PERSONA_HEADER),
          cookie: (await cookies()).get(demoPersonaCookieName)?.value,
        })
      : undefined;
    if (persona) {
      const membership = demoPersonaMembership(persona);
      return {
        roles: [persona.role],
        profile: { name: membership.userName, email: membership.userEmail },
        // The catalog has carried a locale and a zone per persona all along --
        // `en-GB`/`Europe/London` for the reseller and the distributor,
        // `America/Los_Angeles` for the end client. Nothing read them.
        locale: persona.locale,
        timeZone: persona.timeZone,
        memberships: [membership],
        selectedAccountId: membership.accountId,
        effectiveAccountId: membership.accountId,
        providerBacked: false,
        authenticationSource: "local",
      };
    }
    const demoRole = demoPersonaOverrideAllowed()
      ? (await headers()).get("x-clockwork-persona")
      : null;
    const selected = demoMemberships[audience];
    return {
      roles: isCommerceRole(demoRole) ? [demoRole] : demoRoles[audience],
      profile: { name: selected.userName, email: selected.userEmail },
      ...defaultRouteFormatting,
      memberships: Object.values(demoMemberships),
      selectedAccountId: selected.accountId,
      effectiveAccountId: selected.accountId,
      providerBacked: false,
      authenticationSource: "local",
    };
  }
  const session = await getCachedCommerceSession().catch((error: unknown) => {
    if (
      error instanceof Error &&
      error.message ===
        "Privileged commerce roles require an MFA-policy-enforced session"
    )
      redirect("/access/mfa");
    throw error;
  });
  if (!session.selectedAccountId)
    throw new Error("Selected commerce account is unavailable");
  return {
    roles: session.roles,
    profile: session.profile,
    ...defaultRouteFormatting,
    memberships: session.memberships,
    selectedAccountId: session.selectedAccountId,
    effectiveAccountId: session.effectiveAccountId ?? session.selectedAccountId,
    providerBacked: session.providerBacked,
    authenticationSource: session.authenticationSource,
    ...(session.assistedSession
      ? { assistedSession: session.assistedSession }
      : {}),
    ...(session.assistedSessionProvider
      ? { assistedSessionProvider: session.assistedSessionProvider }
      : {}),
  };
}

export async function getRouteRoles(
  audience: ExperienceAudience,
): Promise<readonly string[]> {
  return (await getRouteSession(audience)).roles;
}

export interface RouteIdentity {
  accountId: string;
  accountName: string;
  organizationName: string;
  role: string;
  userId: string;
  userName: string;
  userEmail: string;
}

/**
 * The account and acting user a commercial mutation must be bound to. The
 * server rejects an order whose signer is not the authenticated actor, so a
 * surface that submits one reads its identifiers from here rather than from a
 * component-level constant.
 */
export async function getRouteIdentity(
  audience: ExperienceAudience,
): Promise<RouteIdentity> {
  const session = await getRouteSession(audience);
  const membership =
    session.memberships.find(
      ({ accountId }) => accountId === session.effectiveAccountId,
    ) ??
    session.memberships.find(
      ({ accountId }) => accountId === session.selectedAccountId,
    );
  if (!membership)
    throw new Error(
      "Authorized membership for the selected account is missing",
    );
  return {
    accountId: session.effectiveAccountId,
    accountName: membership.accountName,
    organizationName: membership.organizationName,
    role: membership.role,
    userId: membership.userId,
    userName: membership.userName,
    userEmail: membership.userEmail,
  };
}

export async function getAuthenticatedHome(): Promise<
  | "/dashboard"
  | "/partner"
  | "/internal"
  | "/choose-organization"
  | "/access/mfa"
> {
  if (!providerAuthenticationConfigured()) {
    if (explicitDemoIdentityEnabled()) return "/dashboard";
    throw new Error(
      "Portal identity is unavailable without an explicit non-production demo adapter",
    );
  }
  try {
    const session = await getCachedCommerceSession();
    const selected = session.memberships.find(
      ({ organizationId }) => organizationId === session.organizationId,
    );
    return selected?.home ?? "/choose-organization";
  } catch (error) {
    if (
      error instanceof Error &&
      error.message ===
        "Privileged commerce roles require an MFA-policy-enforced session"
    )
      return "/access/mfa";
    if (
      error instanceof Error &&
      error.message === "Organization selection is required"
    )
      return "/choose-organization";
    throw error;
  }
}

export async function getOrganizationChoices(): Promise<
  readonly AuthorizedMembership[]
> {
  await connection();
  if (!workosConfigured()) return [];
  const auth = await withAuth({ ensureSignedIn: true });
  return listAuthorizedMemberships(getServiceDatabase(), {
    workosUserId: auth.user.id,
    requestId: `choose-organization:${auth.sessionId}`,
  });
}
