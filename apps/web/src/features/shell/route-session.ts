import "server-only";

import { headers } from "next/headers";
import { connection } from "next/server";
import { cache } from "react";

import { roles as commerceRoles, type Role } from "@clockwork/contracts";
import { withAuth } from "@workos-inc/authkit-nextjs";

import {
  listAuthorizedMemberships,
  type AuthorizedMembership,
} from "@/src/auth/identity-repository";
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
    userName: "Demo customer owner",
    userEmail: "owner@northstar.test",
    isInternalStaff: false,
    organizationId: "30000000-0000-4000-8000-000000000001",
    workosOrganizationId: "org_local_northstar",
    organizationName: "Northstar Production",
    accountId: "10000000-0000-4000-8000-000000000001",
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
    accountId: "10000000-0000-4000-8000-000000000002",
    accountName: "Redwood Channel Group",
    role: "partner_admin",
    audience: "partner",
    home: "/partner",
  },
  internal: {
    userId: "20000000-0000-4000-8000-000000000001",
    userName: "Demo internal operator",
    userEmail: "operator@clockwork.test",
    isInternalStaff: true,
    organizationId: "30000000-0000-4000-8000-000000000008",
    workosOrganizationId: "org_local_clockwork_staff",
    organizationName: "Clockwork Staff",
    accountId: "10000000-0000-4000-8000-000000000009",
    accountName: "Clockwork Internal Operations",
    role: "internal_operator",
    audience: "internal",
    home: "/internal",
  },
};

export interface RouteSession {
  roles: readonly string[];
  profile: CommerceSession["profile"];
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
    process.env.NODE_ENV !== "production" &&
    process.env.NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV !== "production"
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
    const demoRole = demoPersonaOverrideAllowed()
      ? (await headers()).get("x-clockwork-persona")
      : null;
    const selected = demoMemberships[audience];
    return {
      roles: isCommerceRole(demoRole) ? [demoRole] : demoRoles[audience],
      profile: { name: selected.userName, email: selected.userEmail },
      memberships: Object.values(demoMemberships),
      selectedAccountId: selected.accountId,
      effectiveAccountId: selected.accountId,
      providerBacked: false,
      authenticationSource: "local",
    };
  }
  const session = await getCachedCommerceSession();
  if (!session.selectedAccountId)
    throw new Error("Selected commerce account is unavailable");
  return {
    roles: session.roles,
    profile: session.profile,
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

export async function getAuthenticatedHome(): Promise<
  "/dashboard" | "/partner" | "/internal" | "/choose-organization"
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
