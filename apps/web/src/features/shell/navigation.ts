import type { Route } from "next";

import type { MessageId } from "@/src/i18n/en";

export type ExperienceAudience = "customer" | "partner" | "internal";

export interface NavigationItem {
  href: Route;
  label: MessageId;
  description?: MessageId;
  keywords?: readonly string[];
  match?: string;
}

export const navigation: Readonly<
  Record<ExperienceAudience, readonly NavigationItem[]>
> = {
  customer: [
    { href: "/dashboard", label: "nav.dashboard", keywords: ["home"] },
    { href: "/agreements", label: "nav.agreements", keywords: ["contracts"] },
    { href: "/quotes", label: "nav.quotes", keywords: ["pricing"] },
    { href: "/orders", label: "nav.orders", keywords: ["services"] },
    { href: "/pocs", label: "nav.pocs", keywords: ["proof of concept"] },
    { href: "/billing", label: "nav.billing", keywords: ["invoices"] },
    { href: "/account", label: "nav.account", keywords: ["users", "settings"] },
  ],
  partner: [
    { href: "/partner", label: "nav.partner.home" },
    { href: "/partner/portfolio", label: "nav.partner.portfolio" },
    { href: "/partner/registrations", label: "nav.partner.registrations" },
    { href: "/partner/quotes", label: "nav.partner.quotes" },
    { href: "/partner/billing", label: "nav.partner.billing" },
    { href: "/partner/commissions", label: "nav.partner.commissions" },
    { href: "/partner/renewals", label: "nav.partner.renewals" },
    { href: "/partner/sandboxes", label: "nav.partner.more" },
  ],
  internal: [
    { href: "/internal", label: "nav.internal.home" },
    { href: "/internal/search", label: "nav.internal.search" },
    { href: "/internal/queues", label: "nav.internal.queues" },
    { href: "/internal/renewals", label: "nav.internal.renewals" },
    { href: "/internal/reports", label: "nav.internal.reports" },
    { href: "/internal/price-books", label: "nav.internal.admin" },
  ],
};

export const allowedRoles = {
  customer: ["owner", "admin", "billing", "member"],
  partner: ["partner_admin", "partner_seller"],
  internal: [
    "internal_operator",
    "legal_approver",
    "finance_approver",
    "destructive_action_approver",
  ],
} as const;

export type CommerceRole =
  (typeof allowedRoles)[keyof typeof allowedRoles][number];

export function isNavigationItemActive(
  item: NavigationItem,
  pathname: string,
): boolean {
  const match = item.match ?? item.href;
  const rootDestination = match === "/partner" || match === "/internal";
  return rootDestination
    ? pathname === match
    : pathname === match || pathname.startsWith(`${match}/`);
}

export function roleCanAccess(
  audience: ExperienceAudience,
  role: string,
): boolean {
  return (allowedRoles[audience] as readonly string[]).includes(role);
}
