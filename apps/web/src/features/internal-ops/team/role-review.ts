import { orderStaffRoles, type Permission } from "@clockwork/contracts";
import { z } from "zod";

import {
  staffPermissions,
  teamRoles,
  type TeamErrorCode,
  type TeamMemberView,
  type TeamRole,
  type TeamView,
} from "./model";

export interface StaffRoleReviewRequest {
  userId: string;
  action: "grant" | "revoke";
  role: TeamRole;
  expectedRowVersion: number;
  actorUserId: string;
}

export type StaffRoleReview =
  | {
      state: "ready";
      request: StaffRoleReviewRequest;
      member: TeamMemberView;
      beforeRoles: readonly string[];
      afterRoles: readonly string[];
      beforePermissions: Permission[];
      afterPermissions: Permission[];
      reviewUrl: string;
    }
  | {
      state: "error";
      code: TeamErrorCode | "REVIEW_INVALID" | "REVIEW_ACTOR";
      reviewUrl?: string;
    };

const queryKeys = [
  "reviewAction",
  "reviewUserId",
  "reviewRole",
  "reviewVersion",
  "reviewActorId",
] as const;
const QuerySchema = z.object({
  reviewAction: z.enum(["grant", "revoke"]),
  reviewUserId: z.uuid(),
  reviewRole: z.enum(teamRoles),
  reviewVersion: z
    .string()
    .regex(/^[1-9]\d*$/u)
    .transform(Number)
    .pipe(z.int().positive()),
  reviewActorId: z.uuid(),
});

/** Query values are proposals only. Arrays (including duplicate keys) fail closed. */
export function parseStaffRoleReviewQuery(
  query: Record<string, string | string[] | undefined>,
): StaffRoleReviewRequest | null | "invalid" {
  if (!queryKeys.some((key) => query[key] !== undefined)) return null;
  const result = QuerySchema.safeParse(query);
  if (!result.success) return "invalid";
  return {
    userId: result.data.reviewUserId,
    action: result.data.reviewAction,
    role: result.data.reviewRole,
    expectedRowVersion: result.data.reviewVersion,
    actorUserId: result.data.reviewActorId,
  };
}

export function buildStaffRoleReviewUrl(
  request: StaffRoleReviewRequest,
): string {
  const query = new URLSearchParams({
    reviewAction: request.action,
    reviewUserId: request.userId,
    reviewRole: request.role,
    reviewVersion: String(request.expectedRowVersion),
    reviewActorId: request.actorUserId,
  });
  return `/internal/team?${query.toString()}`;
}

/** Resolve the proposal against current, organization-scoped team data. */
export function resolveStaffRoleReview(
  view: TeamView,
  request: StaffRoleReviewRequest,
): StaffRoleReview {
  const reviewUrl = buildStaffRoleReviewUrl(request);
  const fail = (
    code: Extract<StaffRoleReview, { state: "error" }>["code"],
  ): StaffRoleReview => ({ state: "error", code, reviewUrl });
  if (view.mode !== "live") return fail("NOT_CONFIGURED");
  if (request.actorUserId !== view.actorUserId) return fail("REVIEW_ACTOR");
  if (request.userId === view.actorUserId) return fail("SELF_CHANGE");
  const member = view.members.find(({ userId }) => userId === request.userId);
  if (!member) return fail("MEMBER_NOT_FOUND");
  if (member.rowVersion !== request.expectedRowVersion) return fail("STALE");
  const held = member.roles.includes(request.role);
  if (request.action === "grant" && held) return fail("ROLE_UNCHANGED");
  if (request.action === "revoke" && !held) return fail("ROLE_NOT_HELD");
  if (request.action === "revoke" && member.roles.length === 1)
    return fail("LAST_ROLE");
  if (
    request.action === "revoke" &&
    request.role === "commerce_admin" &&
    view.members.filter(({ roles }) => roles.includes("commerce_admin"))
      .length <= 1
  )
    return fail("LAST_ADMIN");
  const ordered = orderStaffRoles(
    request.action === "grant"
      ? [...member.roles, request.role]
      : member.roles.filter((role) => role !== request.role),
  );
  const primary = ordered.includes(member.role) ? member.role : ordered[0];
  const afterRoles = primary
    ? [primary, ...ordered.filter((role) => role !== primary)]
    : ordered;
  return {
    state: "ready",
    request,
    member,
    beforeRoles: member.roles,
    afterRoles,
    beforePermissions: staffPermissions(member.roles),
    afterPermissions: staffPermissions(afterRoles),
    reviewUrl,
  };
}
