import "server-only";

import { staffEmailDomains } from "@clockwork/contracts";
import { StaffTeamRepository, type StaffTeamMember } from "@clockwork/db";

import { getRequestCommerceSession } from "@/src/auth/session";
import { getOptionalServiceDatabase } from "@/src/db/service";

import { demoTeamMembers, type TeamMemberView, type TeamView } from "./model";

/**
 * The staff email domains, read the way the sign-in boundary reads them, so
 * nobody is added with an address the portal would then refuse at sign-in.
 * Unset means no domain is allowed, so every invitation is refused.
 */
export function configuredStaffDomains(): string | undefined {
  return process.env.INTERNAL_EMAIL_DOMAINS;
}

export function teamMemberView(member: StaffTeamMember): TeamMemberView {
  return {
    userId: member.userId,
    name: member.name,
    email: member.email,
    role: member.role,
    roles: member.roles,
    mfa: member.lastMfaVerifiedAt
      ? { state: "verified", at: member.lastMfaVerifiedAt }
      : { state: member.mfaEnrolled ? "enrolled" : "unknown" },
    addedAt: member.addedAt.toISOString(),
    rowVersion: member.rowVersion,
  };
}

/**
 * The team as the page shows it. The page itself is already limited to
 * `staff:manage`; this only decides where the people come from.
 */
export async function loadTeamView(): Promise<TeamView> {
  const session = await getRequestCommerceSession();
  const emailDomains = staffEmailDomains(configuredStaffDomains());
  const database = getOptionalServiceDatabase();
  if (!session.providerBacked || !database)
    return {
      mode: "demo",
      members: demoTeamMembers,
      actorUserId: session.userId,
      emailDomains,
    };
  if (!session.organizationId)
    return {
      mode: "unavailable",
      members: [],
      actorUserId: session.userId,
      emailDomains,
    };
  try {
    const members = await new StaffTeamRepository(database).list({
      organizationId: session.organizationId,
      requestId: `staff-team-list:${crypto.randomUUID()}`,
    });
    return {
      mode: "live",
      members: members.map(teamMemberView),
      actorUserId: session.userId,
      emailDomains,
    };
  } catch (error) {
    console.error("Staff team could not be read", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return {
      mode: "unavailable",
      members: [],
      actorUserId: session.userId,
      emailDomains,
    };
  }
}
