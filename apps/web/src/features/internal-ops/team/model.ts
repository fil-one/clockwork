import {
  isStaffTeamRole,
  orderStaffRoles,
  permissionsForRoles,
  staffTeamRoles,
  type Permission,
  type StaffTeamRole,
} from "@clockwork/contracts";

import type { MessageId } from "@/src/i18n";

/**
 * Every role the team page can give or take away. A person may hold several
 * and can do whatever any of them allows; the first they hold in this order
 * is their primary role, which picks their home page.
 */
export const teamRoles = staffTeamRoles;
export type TeamRole = StaffTeamRole;

/** A new team member starts with any one staff role; more can follow. */
export const inviteRoles = staffTeamRoles;

export function isTeamRole(role: string): role is TeamRole {
  return isStaffTeamRole(role);
}

export interface TeamMemberView {
  userId: string;
  name: string;
  email: string;
  /** The primary role, which picks the home page. */
  role: string;
  /** Every role held, the primary one first. */
  roles: readonly string[];
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

/** What a set of staff roles lets a person do, in the access model's order. */
export function staffPermissions(roles: readonly string[]): Permission[] {
  return permissionsForRoles(roles, { side: "fil_one" });
}

export const teamErrorCodes = [
  "NOT_PERMITTED",
  "DIRECT_SESSION_REQUIRED",
  "RECENT_SIGN_IN_REQUIRED",
  "SESSION_EXPIRED",
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
  "ROLE_NOT_HELD",
  "LAST_ROLE",
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
  SESSION_EXPIRED: "operations.session.expired",
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
  ROLE_NOT_HELD: "operations.team.error.roleNotHeld",
  LAST_ROLE: "operations.team.error.lastRole",
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
  "ROLE_UNCHANGED",
  "ROLE_NOT_HELD",
]);

export const staffRoleLabels: Readonly<Record<string, MessageId>> = {
  revenue: "role.revenue",
  commerce_admin: "role.commerceAdmin",
  internal_operator: "role.internalOperator",
  finance_approver: "role.financeApprover",
  legal_approver: "role.legalApprover",
  destructive_action_approver: "role.destructiveActionApprover",
};

/** One line on what each staff role is for. */
export const staffRoleSummaries: Readonly<Record<TeamRole, MessageId>> = {
  commerce_admin: "operations.team.roles.commerceAdmin",
  internal_operator: "operations.team.roles.internalOperator",
  revenue: "operations.team.roles.revenue",
  finance_approver: "operations.team.roles.financeApprover",
  legal_approver: "operations.team.roles.legalApprover",
  destructive_action_approver:
    "operations.team.roles.destructiveActionApprover",
};

/** Each permission in plain words, for the team page and the access matrix. */
export const permissionLabels: Readonly<Record<Permission, MessageId>> = {
  "account:read": "operations.team.permission.accountRead",
  "account:write": "operations.team.permission.accountWrite",
  "agreement:read": "operations.team.permission.agreementRead",
  "agreement:execute": "operations.team.permission.agreementExecute",
  "agreement:approve": "operations.team.permission.agreementApprove",
  "quote:read": "operations.team.permission.quoteRead",
  "quote:write": "operations.team.permission.quoteWrite",
  "quote:approve": "operations.team.permission.quoteApprove",
  "order:read": "operations.team.permission.orderRead",
  "order:write": "operations.team.permission.orderWrite",
  "billing:read": "operations.team.permission.billingRead",
  "billing:write": "operations.team.permission.billingWrite",
  "billing:approve": "operations.team.permission.billingApprove",
  "partner:portfolio:read": "operations.team.permission.partnerPortfolioRead",
  "partner:quote:write": "operations.team.permission.partnerQuoteWrite",
  "poc:manage": "operations.team.permission.pocManage",
  "report:read": "operations.team.permission.reportRead",
  "system:operate": "operations.team.permission.systemOperate",
  "impersonation:assume": "operations.team.permission.impersonationAssume",
  "destructive:request": "operations.team.permission.destructiveRequest",
  "destructive:approve": "operations.team.permission.destructiveApprove",
  "migration:execute": "operations.team.permission.migrationExecute",
  "mnda:send": "operations.team.permission.mndaSend",
  "contract:read": "operations.team.permission.contractRead",
  "contract:write": "operations.team.permission.contractWrite",
  "contract:approve": "operations.team.permission.contractApprove",
  "signatory:manage": "operations.team.permission.signatoryManage",
  "sales:read": "operations.team.permission.salesRead",
  "collateral:manage": "operations.team.permission.collateralManage",
  "operations:read": "operations.team.permission.operationsRead",
  "staff:manage": "operations.team.permission.staffManage",
  "operations:write": "operations.team.permission.operationsWrite",
  "audit:read": "operations.team.permission.auditRead",
  "audit:append": "operations.team.permission.auditAppend",
  "deal:register": "operations.team.permission.dealRegister",
  "approval:self": "operations.team.permission.approvalSelf",
};

function demoMember(
  member: Omit<TeamMemberView, "role" | "roles"> & { roles: string[] },
): TeamMemberView {
  const roles = orderStaffRoles(member.roles);
  return { ...member, role: roles[0] ?? "revenue", roles };
}

/** Fictional people for the demo deploy, which has no team to read. */
export const demoTeamMembers: readonly TeamMemberView[] = [
  demoMember({
    // The demo's commerce administrator persona, so Demo controls and this
    // list name the same person.
    userId: "21000000-0000-4000-8000-000000000011",
    name: "Elena Brooks",
    email: "elena.brooks@fil-one-internal.test",
    roles: ["commerce_admin"],
    mfa: { state: "verified", at: "2026-09-28T14:05:00Z" },
    addedAt: "2026-06-02T09:00:00Z",
    rowVersion: 1,
  }),
  demoMember({
    userId: "21000000-0000-4000-8000-000000000021",
    name: "Theo Lindqvist",
    email: "theo.lindqvist@fil-one-internal.test",
    roles: ["revenue", "legal_approver"],
    mfa: { state: "verified", at: "2026-10-01T16:40:00Z" },
    addedAt: "2026-09-15T13:30:00Z",
    rowVersion: 2,
  }),
  demoMember({
    userId: "21000000-0000-4000-8000-000000000022",
    name: "Priya Raman",
    email: "priya.raman@fil-one-internal.test",
    roles: ["revenue"],
    mfa: { state: "unknown" },
    addedAt: "2026-10-02T10:15:00Z",
    rowVersion: 1,
  }),
  demoMember({
    userId: "21000000-0000-4000-8000-000000000009",
    name: "Ada Mercer",
    email: "ada.mercer@fil-one-internal.test",
    roles: ["internal_operator", "finance_approver"],
    mfa: { state: "verified", at: "2026-09-30T08:20:00Z" },
    addedAt: "2026-04-11T08:00:00Z",
    rowVersion: 3,
  }),
];
