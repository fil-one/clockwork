import {
  demoJourneys,
  type DemoJourney,
} from "@clockwork/testing/demo-journeys";
import {
  DEMO_PERSONA_HEADER,
  demoPersonas,
  type DemoPersona,
  type DemoPersonaKey,
} from "@clockwork/testing/personas";
import { pristineDemoSeed } from "@clockwork/testing/demo-seed";

import { demoDeployIdentityEnabled } from "@/src/auth/demo-deploy";
import type { AuthorizedMembership } from "@/src/auth/identity-repository";
import type { ExperienceAudience } from "@/src/features/shell/navigation";

export { DEMO_PERSONA_HEADER };
export const demoPersonaCookieName = "clockwork-demo-persona";
export const demoPersonaCookieLifetimeSeconds = 12 * 60 * 60;

/**
 * The persona surfaces exist only on a deliberate demo deploy. Without the
 * opt-in the cookie is never read and the header keeps the role-only meaning it
 * has always had, so an unflagged environment behaves exactly as before.
 */
export function demoPersonaSurfacesEnabled(
  environment: Readonly<Record<string, string | undefined>>,
): boolean {
  return demoDeployIdentityEnabled(environment);
}

export function isDemoPersonaKey(value: string): value is DemoPersonaKey {
  return Object.hasOwn(demoPersonas, value);
}

export const demoPersonaCatalog: readonly DemoPersona[] = Object.values(
  demoPersonas,
).toSorted((left, right) => left.displayName.localeCompare(right.displayName));

/**
 * The header decides on its own. Playwright suites send a commerce role here,
 * which is never a persona key, so those runs resolve to no persona and keep
 * the legacy demo identity even if a persona cookie is present in the context.
 */
export function resolveDemoPersona(input: {
  header?: string | null | undefined;
  cookie?: string | null | undefined;
}): DemoPersona | undefined {
  const header = input.header?.trim();
  if (header)
    return isDemoPersonaKey(header) ? demoPersonas[header] : undefined;
  const cookie = input.cookie?.trim();
  return cookie && isDemoPersonaKey(cookie) ? demoPersonas[cookie] : undefined;
}

export function demoJourneyForPersona(
  persona: DemoPersonaKey,
): DemoJourney | undefined {
  return Object.values(demoJourneys).find(
    (journey) => journey.persona === persona,
  );
}

/**
 * The catalog states each persona's start route in audience-prefixed form for
 * journey fixtures. These are the deployed routes those journeys open.
 */
export const demoPersonaStartRoutes = {
  billingUser: "/billing",
  directBuyer: "/dashboard",
  distributor: "/partner/portfolio",
  endClient: "/services",
  financeApprover: "/internal/approvals",
  internalOperator: "/internal/queues",
  legalApprover: "/internal/approvals",
  referralPartner: "/partner/registrations",
  reseller: "/partner",
} as const satisfies Record<DemoPersonaKey, `/${string}`>;

export function demoPersonaStartRoute(
  persona: DemoPersonaKey,
): (typeof demoPersonaStartRoutes)[DemoPersonaKey] {
  return demoPersonaStartRoutes[persona];
}

export function demoPersonaAudience(persona: DemoPersona): ExperienceAudience {
  if (persona.isInternalStaff) return "internal";
  if (persona.role === "partner_admin" || persona.role === "partner_seller")
    return "partner";
  return "customer";
}

const staffOrganizationName = "Fil One Commerce Operations";

export function demoPersonaAccountName(persona: DemoPersona): string {
  return (
    pristineDemoSeed.accounts.find(
      (account) => account.id === persona.selectedAccountId,
    )?.name ?? staffOrganizationName
  );
}

export function demoPersonaOrganizationName(persona: DemoPersona): string {
  return persona.isInternalStaff
    ? staffOrganizationName
    : demoPersonaAccountName(persona);
}

export function demoPersonaMembership(
  persona: DemoPersona,
): AuthorizedMembership {
  const audience = demoPersonaAudience(persona);
  return {
    userId: persona.userId,
    userName: persona.displayName,
    userEmail: persona.email,
    isInternalStaff: persona.isInternalStaff,
    organizationId: persona.organizationId,
    workosOrganizationId: `org_demo_${persona.key}`,
    organizationName: demoPersonaOrganizationName(persona),
    accountId: persona.selectedAccountId,
    accountName: demoPersonaAccountName(persona),
    role: persona.role,
    audience,
    home:
      audience === "partner"
        ? "/partner"
        : audience === "internal"
          ? "/internal"
          : "/dashboard",
  };
}
