import type { Route } from "next";

import type { PartnerRole } from "./partner-data";
import { currentPartnerRole } from "./partner-rules";

export type EnablementAudience = "client_safe" | "partner_internal";

export interface EnablementItem {
  id: string;
  title: string;
  description: string;
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
    title: "Trust and operating controls",
    description:
      "Share the public explanation of security, retention, and operating controls.",
    href: "/trust",
    audience: "client_safe",
    allowedRoles: bothPartnerRoles,
  },
  {
    id: "developers",
    title: "Developer reference",
    description:
      "Share the public API and integration contract when a client needs technical detail.",
    href: "/developers",
    audience: "client_safe",
    allowedRoles: bothPartnerRoles,
  },
  {
    id: "demo",
    title: "Guided demo",
    description:
      "Share the guided product entry point; deployed access controls still apply.",
    href: "/demo",
    audience: "client_safe",
    allowedRoles: bothPartnerRoles,
  },
  {
    id: "portfolio",
    title: "Review end clients",
    description:
      "Open the named-account portfolio visible to your partner desk.",
    href: "/partner/portfolio",
    audience: "partner_internal",
    allowedRoles: bothPartnerRoles,
  },
  {
    id: "registrations",
    title: "Register an opportunity",
    description: "Create or review protection for a named end client.",
    href: "/partner/registrations",
    audience: "partner_internal",
    allowedRoles: bothPartnerRoles,
  },
  {
    id: "quotes",
    title: "Review partner quotes",
    description: "Open quotes already scoped to this partner account.",
    href: "/partner/quotes",
    audience: "partner_internal",
    allowedRoles: bothPartnerRoles,
  },
  {
    id: "quote-new",
    title: "Start a partner quote",
    description:
      "Open the agreement-bound quote path; referral agreements hand the quote back to Fil One.",
    href: "/partner/quotes/new",
    audience: "partner_internal",
    allowedRoles: bothPartnerRoles,
  },
  {
    id: "marketplace",
    title: "Review marketplace work",
    description: "Open marketplace records available to the partner desk.",
    href: "/partner/marketplace",
    audience: "partner_internal",
    allowedRoles: bothPartnerRoles,
  },
  {
    id: "disputes",
    title: "Review disputes",
    description: "Open the partner dispute register and its recorded state.",
    href: "/partner/disputes",
    audience: "partner_internal",
    allowedRoles: bothPartnerRoles,
  },
  {
    id: "support",
    title: "Open partner support",
    description: "Use the partner support path for account-specific follow-up.",
    href: "/partner/support",
    audience: "partner_internal",
    allowedRoles: bothPartnerRoles,
  },
  {
    id: "billing",
    title: "Review consolidated billing",
    description: "Open partner-account invoice and settlement records.",
    href: "/partner/billing",
    audience: "partner_internal",
    allowedRoles: ["partner_admin"],
  },
  {
    id: "commissions",
    title: "Review commissions",
    description: "Open accrued commission and settlement records.",
    href: "/partner/commissions",
    audience: "partner_internal",
    allowedRoles: ["partner_admin"],
  },
  {
    id: "renewals",
    title: "Review renewal work",
    description: "Open renewal requests and their commercial boundaries.",
    href: "/partner/renewals",
    audience: "partner_internal",
    allowedRoles: ["partner_admin"],
  },
  {
    id: "sandboxes",
    title: "Manage sandboxes and POCs",
    description: "Open partner-admin evaluation and proof-of-concept work.",
    href: "/partner/sandboxes",
    audience: "partner_internal",
    allowedRoles: ["partner_admin"],
  },
  {
    id: "brand",
    title: "Manage brand and domains",
    description: "Open partner-admin brand and verified-domain settings.",
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
