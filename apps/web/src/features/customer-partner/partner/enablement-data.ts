import type { Route } from "next";

import type { MessageId } from "@/src/i18n";

import type { PartnerRole } from "./partner-data";
import { currentPartnerRole } from "./partner-rules";

export type EnablementAudience = "client_safe" | "partner_internal";

export interface EnablementItem {
  id: string;
  /** Message IDs; the page renders them in the reader's language. */
  title: MessageId;
  description: MessageId;
  href: Route;
  audience: EnablementAudience;
  allowedRoles: readonly PartnerRole[];
}

const bothPartnerRoles = ["partner_admin", "partner_seller"] as const;

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
    allowedRoles: bothPartnerRoles,
  },
  {
    id: "developers",
    title: "partner.enablement.item.developers.title",
    description: "partner.enablement.item.developers.description",
    href: "/developers",
    audience: "client_safe",
    allowedRoles: bothPartnerRoles,
  },
  {
    id: "demo",
    title: "partner.enablement.item.demo.title",
    description: "partner.enablement.item.demo.description",
    href: "/demo",
    audience: "client_safe",
    allowedRoles: bothPartnerRoles,
  },
  {
    id: "portfolio",
    title: "partner.enablement.item.portfolio.title",
    description: "partner.enablement.item.portfolio.description",
    href: "/partner/portfolio",
    audience: "partner_internal",
    allowedRoles: bothPartnerRoles,
  },
  {
    id: "registrations",
    title: "partner.enablement.item.registrations.title",
    description: "partner.enablement.item.registrations.description",
    href: "/partner/registrations",
    audience: "partner_internal",
    allowedRoles: bothPartnerRoles,
  },
  {
    id: "quotes",
    title: "partner.enablement.item.quotes.title",
    description: "partner.enablement.item.quotes.description",
    href: "/partner/quotes",
    audience: "partner_internal",
    allowedRoles: bothPartnerRoles,
  },
  {
    id: "quote-new",
    title: "partner.enablement.item.quoteNew.title",
    description: "partner.enablement.item.quoteNew.description",
    href: "/partner/quotes/new",
    audience: "partner_internal",
    allowedRoles: bothPartnerRoles,
  },
  {
    id: "marketplace",
    title: "partner.enablement.item.marketplace.title",
    description: "partner.enablement.item.marketplace.description",
    href: "/partner/marketplace",
    audience: "partner_internal",
    allowedRoles: bothPartnerRoles,
  },
  {
    id: "disputes",
    title: "partner.enablement.item.disputes.title",
    description: "partner.enablement.item.disputes.description",
    href: "/partner/disputes",
    audience: "partner_internal",
    allowedRoles: bothPartnerRoles,
  },
  {
    id: "support",
    title: "partner.enablement.item.support.title",
    description: "partner.enablement.item.support.description",
    href: "/partner/support",
    audience: "partner_internal",
    allowedRoles: bothPartnerRoles,
  },
  {
    id: "billing",
    title: "partner.enablement.item.billing.title",
    description: "partner.enablement.item.billing.description",
    href: "/partner/billing",
    audience: "partner_internal",
    allowedRoles: ["partner_admin"],
  },
  {
    id: "commissions",
    title: "partner.enablement.item.commissions.title",
    description: "partner.enablement.item.commissions.description",
    href: "/partner/commissions",
    audience: "partner_internal",
    allowedRoles: ["partner_admin"],
  },
  {
    id: "renewals",
    title: "partner.enablement.item.renewals.title",
    description: "partner.enablement.item.renewals.description",
    href: "/partner/renewals",
    audience: "partner_internal",
    allowedRoles: ["partner_admin"],
  },
  {
    id: "sandboxes",
    title: "partner.enablement.item.sandboxes.title",
    description: "partner.enablement.item.sandboxes.description",
    href: "/partner/sandboxes",
    audience: "partner_internal",
    allowedRoles: ["partner_admin"],
  },
  {
    id: "brand",
    title: "partner.enablement.item.brand.title",
    description: "partner.enablement.item.brand.description",
    href: "/partner/brand",
    audience: "partner_internal",
    allowedRoles: ["partner_admin"],
  },
] as const;

export function clientSafeEnablementItems(): readonly EnablementItem[] {
  return enablementItems.filter((item) => item.audience === "client_safe");
}

export function internalEnablementItems(
  roles: readonly string[],
): readonly EnablementItem[] {
  const role = currentPartnerRole(roles);
  if (!role) return [];
  return enablementItems.filter(
    (item) =>
      item.audience === "partner_internal" && item.allowedRoles.includes(role),
  );
}
