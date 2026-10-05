import type { MessageId } from "@/src/i18n";

/** Roles the team page can give. Approver roles stay with deployment provisioning. */
export const teamRoles = [
  "revenue",
  "commerce_admin",
  "internal_operator",
] as const;
export type TeamRole = (typeof teamRoles)[number];

/** A new team member starts as a seller or an administrator. */
export const inviteRoles = ["revenue", "commerce_admin"] as const;

export function isTeamRole(role: string): role is TeamRole {
  return (teamRoles as readonly string[]).includes(role);
}

export interface TeamMemberView {
  userId: string;
  name: string;
  email: string;
  role: string;
  mfa: { state: "verified"; at: string } | { state: "enrolled" | "unknown" };
  addedAt: string;
  rowVersion: number;
}

export interface TeamView {
  /** `live` reads and changes the team; `demo` shows fixtures; `unavailable` could not read it. */
  mode: "live" | "demo" | "unavailable";
  members: readonly TeamMemberView[];
  actorUserId: string;
  /** The staff email domains a new member's address must use. */
  emailDomains: readonly string[];
}

export const teamErrorCodes = [
  "NOT_PERMITTED",
  "DIRECT_SESSION_REQUIRED",
  "RECENT_SIGN_IN_REQUIRED",
  "INVALID_INPUT",
  "DOMAIN_NOT_ALLOWED",
  "NOT_CONFIGURED",
  "ADMIN_REQUIRED",
  "MEMBER_NOT_FOUND",
  "SELF_CHANGE",
  "LAST_ADMIN",
  "ALREADY_MEMBER",
  "IDENTITY_CONFLICT",
  "ROLE_NOT_MANAGED",
  "ROLE_UNCHANGED",
  "STALE",
  "WORKOS_NOT_LINKED",
  "PROVIDER_FAILED",
  "UNEXPECTED",
] as const;
export type TeamErrorCode = (typeof teamErrorCodes)[number];

export type TeamActionResult =
  { ok: true } | { ok: false; code: TeamErrorCode };

export const teamErrorMessages: Readonly<Record<TeamErrorCode, MessageId>> = {
  NOT_PERMITTED: "operations.team.error.notPermitted",
  DIRECT_SESSION_REQUIRED: "operations.team.error.directSession",
  RECENT_SIGN_IN_REQUIRED: "operations.team.error.recentSignIn",
  INVALID_INPUT: "operations.team.error.invalid",
  DOMAIN_NOT_ALLOWED: "operations.team.error.domain",
  NOT_CONFIGURED: "operations.team.error.notConfigured",
  ADMIN_REQUIRED: "operations.team.error.adminRequired",
  MEMBER_NOT_FOUND: "operations.team.error.notFound",
  SELF_CHANGE: "operations.team.error.self",
  LAST_ADMIN: "operations.team.error.lastAdmin",
  ALREADY_MEMBER: "operations.team.error.alreadyMember",
  IDENTITY_CONFLICT: "operations.team.error.identityConflict",
  ROLE_NOT_MANAGED: "operations.team.error.roleNotManaged",
  ROLE_UNCHANGED: "operations.team.error.roleUnchanged",
  STALE: "operations.team.error.stale",
  WORKOS_NOT_LINKED: "operations.team.error.workosNotLinked",
  PROVIDER_FAILED: "operations.team.error.provider",
  UNEXPECTED: "operations.team.error.unexpected",
};

/** Errors after which the list on screen is out of date and should be reread. */
export const teamErrorsThatRefresh: ReadonlySet<TeamErrorCode> = new Set([
  "MEMBER_NOT_FOUND",
  "STALE",
  "ALREADY_MEMBER",
]);

export const staffRoleLabels: Readonly<Record<string, MessageId>> = {
  revenue: "role.revenue",
  commerce_admin: "role.commerceAdmin",
  internal_operator: "role.internalOperator",
  finance_approver: "role.financeApprover",
  legal_approver: "role.legalApprover",
  destructive_action_approver: "role.destructiveActionApprover",
};

/** Fictional people for the demo deploy, which has no team to read. */
export const demoTeamMembers: readonly TeamMemberView[] = [
  {
    userId: "21000000-0000-4000-8000-000000000020",
    name: "Noor Haddad",
    email: "noor.haddad@fil-one-internal.test",
    role: "commerce_admin",
    mfa: { state: "verified", at: "2026-09-28T14:05:00Z" },
    addedAt: "2026-06-02T09:00:00Z",
    rowVersion: 1,
  },
  {
    userId: "21000000-0000-4000-8000-000000000021",
    name: "Theo Lindqvist",
    email: "theo.lindqvist@fil-one-internal.test",
    role: "revenue",
    mfa: { state: "verified", at: "2026-10-01T16:40:00Z" },
    addedAt: "2026-09-15T13:30:00Z",
    rowVersion: 1,
  },
  {
    userId: "21000000-0000-4000-8000-000000000022",
    name: "Priya Raman",
    email: "priya.raman@fil-one-internal.test",
    role: "revenue",
    mfa: { state: "unknown" },
    addedAt: "2026-10-02T10:15:00Z",
    rowVersion: 1,
  },
  {
    userId: "21000000-0000-4000-8000-000000000009",
    name: "Ada Mercer",
    email: "ada.mercer@fil-one-internal.test",
    role: "internal_operator",
    mfa: { state: "verified", at: "2026-09-30T08:20:00Z" },
    addedAt: "2026-04-11T08:00:00Z",
    rowVersion: 1,
  },
];
