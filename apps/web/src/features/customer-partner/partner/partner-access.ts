import type { Permission } from "@clockwork/contracts";

import type { PartnerSurfaceKey } from "./partner-data";

/**
 * Partner channels whose rows carry account-level commercial or money truth,
 * and the permission each needs: a partner administrator holds all of them,
 * a partner seller none.
 */
export const partnerAdminOnlyChannels = {
  billing: "billing:read",
  commissions: "billing:read",
  renewals: "order:write",
  sandboxes: "poc:manage",
  brand: "account:write",
} as const satisfies Partial<Record<PartnerSurfaceKey, Permission>>;

export function canReadPartnerChannel(
  permissions: readonly Permission[],
  channel: string,
  assistedInternal = false,
): boolean {
  if (assistedInternal) return true;
  // Every partner, channel or referral, registers deals.
  if (!permissions.includes("deal:register")) return false;
  const required = Object.hasOwn(partnerAdminOnlyChannels, channel)
    ? partnerAdminOnlyChannels[channel as keyof typeof partnerAdminOnlyChannels]
    : undefined;
  return !required || permissions.includes(required);
}
