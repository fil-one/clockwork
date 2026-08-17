import type { PartnerSurfaceKey } from "./partner-data";

/** Partner channels whose rows carry account-level commercial or money truth. */
export const partnerAdminOnlyChannels = [
  "billing",
  "commissions",
  "renewals",
  "sandboxes",
  "brand",
] as const satisfies readonly PartnerSurfaceKey[];

export function canReadPartnerChannel(
  roles: readonly string[],
  channel: string,
  assistedInternal = false,
): boolean {
  if (assistedInternal) return true;
  if (
    !roles.some((role) => role === "partner_admin" || role === "partner_seller")
  )
    return false;
  return (
    !partnerAdminOnlyChannels.some((restricted) => restricted === channel) ||
    roles.includes("partner_admin")
  );
}
