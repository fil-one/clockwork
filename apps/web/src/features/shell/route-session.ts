import "server-only";

import { headers } from "next/headers";
import { connection } from "next/server";

import { roles as commerceRoles, type Role } from "@clockwork/contracts";

import { getCommerceSession } from "@/src/auth/session";

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

function workosConfigured(): boolean {
  return Boolean(
    process.env.WORKOS_API_KEY &&
    process.env.WORKOS_CLIENT_ID &&
    process.env.WORKOS_COOKIE_PASSWORD,
  );
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

export async function getRouteRoles(
  audience: ExperienceAudience,
): Promise<readonly string[]> {
  await connection();
  if (!workosConfigured()) {
    const demoRole = demoPersonaOverrideAllowed()
      ? (await headers()).get("x-clockwork-persona")
      : null;
    return isCommerceRole(demoRole) ? [demoRole] : demoRoles[audience];
  }
  const session = await getCommerceSession();
  return session.roles;
}
