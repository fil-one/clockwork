import type { Route } from "next";

import type { MessageId } from "@/src/i18n";

import type { Permission } from "@clockwork/contracts";

export type EnablementAudience = "client_safe" | "partner_internal";

export interface EnablementItem {
  id: string;
  /** Message IDs; the page renders them in the reader's language. */
  title: MessageId;
  description: MessageId;
  href: Route;
  audience: EnablementAudience;
  /** What a partner must hold to see the item. */
  requiredPermission: Permission;
}

/** Every partner, channel or referral, registers deals. */
const everyPartner = "deal:register" as const satisfies Permission;

/**
 * Every entry is a route that exists in the application tree. Client-safe
 * destinations are intentionally outside `/partner`; internal motions never
 * cross that boundary in the other direction.
 */
export const enablementItems: readonly EnablementItem[] = [
  {
    id: "trust",
    title: "partner.enablement.item.trust.title",
    description: "partner.enablement.item.trust.description",
    href: "/trust",
    audience: "client_safe",
    requiredPermission: everyPartner,
  },
  {
    id: "developers",
    title: "partner.enablement.item.developers.title",
    description: "partner.enablement.item.developers.description",
    href: "/developers",
    audience: "client_safe",
    requiredPermission: everyPartner,
  },
  {
    id: "demo",
    title: "partner.enablement.item.demo.title",
    description: "partner.enablement.item.demo.description",
    href: "/demo",
    audience: "client_safe",
    requiredPermission: everyPartner,
  },
  {
    id: "portfolio",
    title: "partner.enablement.item.portfolio.title",
    description: "partner.enablement.item.portfolio.description",
    href: "/partner/portfolio",
    audience: "partner_internal",
    requiredPermission: everyPartner,
  },
  {
    id: "registrations",
    title: "partner.enablement.item.registrations.title",
    description: "partner.enablement.item.registrations.description",
    href: "/partner/registrations",
    audience: "partner_internal",
    requiredPermission: everyPartner,
  },
  {
    id: "quotes",
    title: "partner.enablement.item.quotes.title",
    description: "partner.enablement.item.quotes.description",
    href: "/partner/quotes",
    audience: "partner_internal",
    requiredPermission: everyPartner,
  },
  {
    id: "quote-new",
    title: "partner.enablement.item.quoteNew.title",
    description: "partner.enablement.item.quoteNew.description",
    href: "/partner/quotes/new",
    audience: "partner_internal",
    // Pricing is a channel partner's work; a referral partner never quotes.
    requiredPermission: "partner:quote:write",
  },
  {
    id: "marketplace",
    title: "partner.enablement.item.marketplace.title",
    description: "partner.enablement.item.marketplace.description",
    href: "/partner/marketplace",
    audience: "partner_internal",
    requiredPermission: everyPartner,
  },
  {
    id: "disputes",
    title: "partner.enablement.item.disputes.title",
    description: "partner.enablement.item.disputes.description",
    href: "/partner/disputes",
    audience: "partner_internal",
    requiredPermission: everyPartner,
  },
  {
    id: "support",
    title: "partner.enablement.item.support.title",
    description: "partner.enablement.item.support.description",
    href: "/partner/support",
    audience: "partner_internal",
    requiredPermission: everyPartner,
  },
  {
    id: "billing",
    title: "partner.enablement.item.billing.title",
    description: "partner.enablement.item.billing.description",
    href: "/partner/billing",
    audience: "partner_internal",
    requiredPermission: "billing:read",
  },
  {
    id: "commissions",
    title: "partner.enablement.item.commissions.title",
    description: "partner.enablement.item.commissions.description",
    href: "/partner/commissions",
    audience: "partner_internal",
    requiredPermission: "billing:read",
  },
  {
    id: "renewals",
    title: "partner.enablement.item.renewals.title",
    description: "partner.enablement.item.renewals.description",
    href: "/partner/renewals",
    audience: "partner_internal",
    requiredPermission: "order:write",
  },
  {
    id: "sandboxes",
    title: "partner.enablement.item.sandboxes.title",
    description: "partner.enablement.item.sandboxes.description",
    href: "/partner/sandboxes",
    audience: "partner_internal",
    requiredPermission: "poc:manage",
  },
  {
    id: "brand",
    title: "partner.enablement.item.brand.title",
    description: "partner.enablement.item.brand.description",
    href: "/partner/brand",
    audience: "partner_internal",
    requiredPermission: "account:write",
  },
] as const;

export function clientSafeEnablementItems(): readonly EnablementItem[] {
  return enablementItems.filter((item) => item.audience === "client_safe");
}

export function internalEnablementItems(
  permissions: readonly Permission[],
): readonly EnablementItem[] {
  if (!permissions.includes("deal:register")) return [];
  return enablementItems.filter(
    (item) =>
      item.audience === "partner_internal" &&
      permissions.includes(item.requiredPermission),
  );
}
