// i18n-exempt-file: HTTP API problem+json titles are the integrator contract (stable English, logged); an interface shows the reader a sentence chosen from `code`/`status` (contracts/error-text.ts), never this title.
import type { Permission } from "@clockwork/contracts";

import { ExperienceProblem } from "./model";
import type { ExperienceAudience, ProjectionChannel } from "./model";

function requiredPermissions(
  audience: ExperienceAudience,
  channel: ProjectionChannel,
  action: string,
): readonly Permission[] {
  if (audience === "partner")
    // Pricing and reselling (a quote, a supply order, a resale renewal) is a
    // channel partner's work, wherever the record sits. Everything else,
    // registering deals and raising disputes included, is every partner's,
    // referral partners too.
    return channel === "quotes" ||
      channel === "orders" ||
      channel === "renewals" ||
      /quote|resale|order|renew/i.test(action)
      ? ["partner:quote:write"]
      : ["deal:register"];
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
  permissions: readonly Permission[],
  audience: ExperienceAudience,
  channel: ProjectionChannel,
  action: string,
): boolean {
  return requiredPermissions(audience, channel, action).some((permission) =>
    permissions.includes(permission),
  );
}

export function requireProjectionActionAuthority(
  permissions: readonly Permission[],
  audience: ExperienceAudience,
  channel: ProjectionChannel,
  action: string,
): void {
  if (!canRunProjectionAction(permissions, audience, channel, action))
    throw new ExperienceProblem(
      403,
      "ACTION_AUTHORITY_FORBIDDEN",
      "The authenticated role cannot run this projection action",
    );
}
