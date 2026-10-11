// i18n-exempt-file: MCP tool names, descriptions and results are read by MCP clients and the model, not rendered in the interface
import "server-only";

import { z } from "zod";

import { staffTeamRoles } from "@clockwork/contracts";

import { staffPermissions } from "@/src/features/internal-ops/team/model";
import { resolveStaffRoleReview } from "@/src/features/internal-ops/team/role-review";
import { loadTeamView } from "@/src/features/internal-ops/team/server";
import { requireStaffPermission } from "@/src/features/shell/staff-access";

import { appLink, defineTool, McpToolError } from "../tool";

async function team() {
  await requireStaffPermission("staff:manage");
  const view = await loadTeamView();
  if (view.mode !== "live") throw new McpToolError("UNAVAILABLE");
  return view;
}

export const listStaff = defineTool({
  name: "list_staff",
  title: "List staff",
  description:
    "Read the staff in your current organization, their roles and effective permissions, MFA status and current membership version. Requires staff administration permission. Use the version to prepare a role change for browser review.",
  input: {},
  access: "read",
  run: async (_args, context) => {
    const view = await team();
    return {
      actorUserId: view.actorUserId,
      members: view.members.map((member) => ({
        ...member,
        permissions: staffPermissions(member.roles),
      })),
      availableRoles: staffTeamRoles.map((role) => ({
        role,
        permissions: staffPermissions([role]),
      })),
      link: appLink(context, "/internal/team"),
    };
  },
});

export const prepareStaffRoleChange = defineTool({
  name: "prepare_staff_role_change",
  title: "Prepare a staff role change",
  description:
    "Prepare adding or removing one staff role using the membership version from list_staff. Returns the exact proposed access change and a review link. This never changes access: the same administrator must open the link, verify recent authentication if needed, and explicitly confirm in Commerce. You cannot change your own roles.",
  input: {
    userId: z.uuid(),
    action: z.enum(["grant", "revoke"]),
    role: z.enum(staffTeamRoles),
    expectedRowVersion: z.int().positive(),
  },
  // Preparing an administrative write remains opt-in for read_write tokens,
  // although the preparation itself changes no membership or role.
  access: "write",
  run: async ({ userId, action, role, expectedRowVersion }, context) => {
    context.targets.userId = userId;
    const view = await team();
    const review = resolveStaffRoleReview(view, {
      userId,
      action,
      role,
      expectedRowVersion,
      actorUserId: context.session.userId,
    });
    if (review.state === "error")
      throw new McpToolError(
        `STAFF_TEAM_${review.code}`,
        review.code === "STALE"
          ? "The staff member changed. Run list_staff again and prepare a new review."
          : undefined,
      );
    const { member } = review;
    return {
      status: "awaiting_browser_confirmation",
      requiresBrowserConfirmation: true,
      member: { userId, name: member.name, email: member.email },
      action,
      role,
      expectedRowVersion,
      before: {
        roles: review.beforeRoles,
        permissions: review.beforePermissions,
      },
      after: { roles: review.afterRoles, permissions: review.afterPermissions },
      reviewUrl: appLink(context, review.reviewUrl),
    };
  },
});

export const staffTools = [listStaff, prepareStaffRoleChange];
