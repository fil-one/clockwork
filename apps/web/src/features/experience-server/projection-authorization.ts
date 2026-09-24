// i18n-exempt-file: HTTP API problem+json titles are the integrator contract (stable English, logged, never rendered); interface boundaries choose the reader's sentence from `code`/`status` in problem-text.ts.
import {
  hasPermission,
  RoleSchema,
  type Permission,
} from "@clockwork/contracts";

import { ExperienceProblem } from "./model";
import type { ExperienceAudience, ProjectionChannel } from "./model";

function requiredPermissions(
  audience: ExperienceAudience,
  channel: ProjectionChannel,
  action: string,
): readonly Permission[] {
  if (audience === "partner") return ["partner:quote:write"];
  if (audience === "internal") {
    if (channel !== "approvals") return ["system:operate"];
    if (/delete|offboard|destructive/i.test(action))
      return ["destructive:approve"];
    if (/legal|agreement/i.test(action)) return ["agreement:approve"];
    return ["quote:approve", "billing:approve"];
  }
  const customerPermissions: Partial<Record<ProjectionChannel, Permission>> = {
    agreements: "agreement:execute",
    quotes: "quote:write",
    orders: "order:write",
    billing: "billing:write",
    pocs: "poc:manage",
    amendments: "order:write",
    procurement: "account:write",
    users: "account:write",
    support: "account:write",
    marketplace: "account:write",
  };
  return [customerPermissions[channel] ?? "account:write"];
}

export function canRunProjectionAction(
  roles: readonly string[],
  audience: ExperienceAudience,
  channel: ProjectionChannel,
  action: string,
): boolean {
  const permissions = requiredPermissions(audience, channel, action);
  return roles.some((value) => {
    const role = RoleSchema.safeParse(value);
    return (
      role.success &&
      permissions.some((permission) => hasPermission(role.data, permission))
    );
  });
}

export function requireProjectionActionAuthority(
  roles: readonly string[],
  audience: ExperienceAudience,
  channel: ProjectionChannel,
  action: string,
): void {
  if (!canRunProjectionAction(roles, audience, channel, action))
    throw new ExperienceProblem(
      403,
      "ACTION_AUTHORITY_FORBIDDEN",
      "The authenticated role cannot run this projection action",
    );
}
