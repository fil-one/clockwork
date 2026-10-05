import type { Route } from "next";

import {
  hasPermission,
  internalRoles,
  roles as commerceRoles,
  type Permission,
  type Role,
} from "@clockwork/contracts";

import type { MessageId } from "@/src/i18n";

export type ExperienceAudience = "customer" | "partner" | "internal";

/**
 * The two staff workspaces. Sellers hold `sales:read` only; operations staff
 * also hold `operations:read`. A destination in a workspace is hidden from a
 * reader without that workspace's permission, whatever else it asks for.
 */
export type StaffWorkspace = "sales" | "operations";

export const staffWorkspacePermission: Readonly<
  Record<StaffWorkspace, Permission>
> = {
  sales: "sales:read",
  operations: "operations:read",
};

/** Rail icons a destination can name; the shell owns the drawings. */
export type NavigationIconName =
  "home" | "document" | "contract" | "library" | "pricing" | "team";

export interface NavigationItem {
  href: Route;
  label: MessageId;
  description?: MessageId;
  keywords?: readonly string[];
  match?: string;
  requiredPermission?: Permission;
  allowedRoles?: readonly Role[];
  providerBackedOnly?: boolean;
  workspace?: StaffWorkspace;
  icon?: NavigationIconName;
}

/**
 * The sales workspace, first in the staff rail and the only group a seller
 * sees. A new sales destination is one entry here: the rail section, the icon
 * and the command palette all read this list.
 */
export const salesNavigation: readonly NavigationItem[] = [
  {
    href: "/internal",
    label: "platform.nav.sales.home",
    description: "platform.nav.sales.home.description",
    // i18n-exempt: search aliases matched in addition to the translated label; never displayed
    keywords: ["home", "my work", "start", "dashboard"],
    workspace: "sales",
    icon: "home",
  },
  {
    href: "/internal/mndas",
    label: "platform.nav.internal.mndas",
    description: "platform.nav.sales.mndas.description",
    // i18n-exempt: search aliases matched in addition to the translated label; never displayed
    keywords: [
      "nda",
      "mnda",
      "non-disclosure",
      "confidentiality",
      "contract",
      "agreement",
      "sign",
    ],
    requiredPermission: "mnda:send",
    providerBackedOnly: true,
    workspace: "sales",
    icon: "document",
  },
  {
    href: "/internal/pricing",
    label: "platform.nav.sales.pricing",
    description: "platform.nav.sales.pricing.description",
    // i18n-exempt: search aliases matched in addition to the translated label; never displayed
    keywords: [
      "pricing",
      "price",
      "calculator",
      "quote",
      "indicative",
      "rate",
      "estimate",
    ],
    workspace: "sales",
    icon: "pricing",
  },
  {
    href: "/internal/team",
    label: "platform.nav.sales.team",
    description: "platform.nav.sales.team.description",
    // i18n-exempt: search aliases matched in addition to the translated label; never displayed
    keywords: ["team", "staff", "invite", "users", "roles", "access", "people"],
    requiredPermission: "staff:manage",
    workspace: "sales",
    icon: "team",
  },
];

function operationsNavigation(
  items: readonly NavigationItem[],
): NavigationItem[] {
  return items.map((item) => ({ ...item, workspace: "operations" }));
}

export const navigation: Readonly<
  Record<ExperienceAudience, readonly NavigationItem[]>
> = {
  customer: [
    { href: "/dashboard", label: "nav.dashboard", keywords: ["home"] },
    {
      href: "/buy",
      label: "nav.buy",
      keywords: ["purchase", "pricing", "capacity"],
      requiredPermission: "quote:write",
    },
    {
      href: "/buy/payg",
      label: "nav.payg",
      // i18n-exempt: search aliases matched in addition to the translated label; never displayed
      keywords: ["trial", "pay as you go", "usage"],
      allowedRoles: ["owner", "admin"],
    },
    {
      href: "/agreements",
      label: "nav.agreements",
      keywords: ["contracts"],
      requiredPermission: "agreement:read",
    },
    {
      href: "/quotes",
      label: "nav.quotes",
      keywords: ["pricing"],
      requiredPermission: "quote:read",
    },
    {
      href: "/orders",
      label: "nav.orders",
      keywords: ["services"],
      requiredPermission: "order:read",
    },
    {
      href: "/services",
      label: "nav.services",
      keywords: ["capacity", "provisioning"],
      requiredPermission: "order:read",
    },
    {
      href: "/pocs",
      label: "nav.pocs",
      // i18n-exempt: search alias matched in addition to the translated label; never displayed
      keywords: ["proof of concept"],
      requiredPermission: "poc:manage",
    },
    {
      href: "/billing",
      label: "nav.billing",
      keywords: ["invoices"],
      requiredPermission: "billing:read",
    },
    {
      href: "/amendments",
      label: "nav.amendments",
      // i18n-exempt: search alias matched in addition to the translated label; never displayed
      keywords: ["change order"],
      requiredPermission: "order:write",
    },
    {
      href: "/marketplace",
      label: "nav.marketplace",
      keywords: ["provider", "offer"],
      requiredPermission: "account:read",
    },
    {
      href: "/support",
      label: "nav.support",
      keywords: ["help", "case"],
      requiredPermission: "account:read",
    },
    {
      href: "/account",
      label: "nav.account",
      keywords: ["users", "settings"],
      requiredPermission: "account:read",
    },
  ],
  partner: [
    { href: "/partner", label: "nav.partner.home" },
    { href: "/partner/portfolio", label: "nav.partner.portfolio" },
    { href: "/partner/registrations", label: "nav.partner.registrations" },
    { href: "/partner/quotes", label: "nav.partner.quotes" },
    { href: "/partner/orders", label: "nav.orders" },
    {
      href: "/partner/billing",
      label: "nav.partner.billing",
      allowedRoles: ["partner_admin"],
    },
    {
      href: "/partner/commissions",
      label: "nav.partner.commissions",
      allowedRoles: ["partner_admin"],
    },
    {
      href: "/partner/renewals",
      label: "nav.partner.renewals",
      allowedRoles: ["partner_admin"],
    },
    { href: "/partner/disputes", label: "nav.partner.disputes" },
    { href: "/partner/marketplace", label: "nav.partner.marketplace" },
    {
      href: "/partner/sandboxes",
      label: "nav.partner.sandboxes",
      allowedRoles: ["partner_admin"],
    },
    {
      href: "/partner/brand",
      label: "nav.partner.brand",
      allowedRoles: ["partner_admin"],
    },
    { href: "/partner/enablement", label: "nav.partner.enablement" },
    { href: "/partner/support", label: "nav.partner.support" },
  ],
  internal: [
    ...salesNavigation,
    ...operationsNavigation([
      {
        href: "/internal/operations",
        label: "platform.nav.operations.health",
        // i18n-exempt: search aliases matched in addition to the translated label; never displayed
        keywords: ["operations", "health", "status", "board"],
      },
      { href: "/internal/search", label: "nav.internal.search" },
      { href: "/internal/queues", label: "nav.internal.queues" },
      {
        href: "/internal/renewals",
        label: "nav.internal.renewals",
        requiredPermission: "report:read",
      },
      {
        href: "/internal/collections",
        label: "nav.internal.collections",
        requiredPermission: "billing:approve",
      },
      {
        href: "/internal/provisioning",
        label: "nav.internal.provisioning",
        allowedRoles: ["internal_operator"],
      },
      {
        href: "/internal/recovery",
        label: "nav.internal.recovery",
        allowedRoles: ["internal_operator"],
      },
      {
        href: "/internal/webhook-replay",
        label: "nav.internal.webhookReplay",
        allowedRoles: ["internal_operator"],
      },
      {
        href: "/internal/migrations",
        label: "nav.internal.migrations",
        allowedRoles: ["internal_operator"],
      },
      {
        href: "/internal/reports",
        label: "nav.internal.reports",
        requiredPermission: "report:read",
      },
      {
        href: "/internal/revenue",
        label: "nav.internal.revenue",
        requiredPermission: "report:read",
      },
      {
        href: "/internal/billing-reconciliation",
        label: "nav.internal.billingReconciliation",
        requiredPermission: "report:read",
      },
      {
        href: "/internal/status",
        label: "nav.internal.status",
        requiredPermission: "system:operate",
      },
      {
        href: "/internal/unhandled-errors",
        label: "nav.internal.unhandledErrors",
        requiredPermission: "system:operate",
      },
      {
        href: "/internal/agreements",
        label: "nav.internal.agreements",
        allowedRoles: ["legal_approver"],
      },
      {
        href: "/internal/approvals",
        label: "nav.internal.approvals",
        allowedRoles: [
          "finance_approver",
          "legal_approver",
          "destructive_action_approver",
        ],
      },
      {
        href: "/internal/price-books",
        label: "nav.internal.priceBooks",
        requiredPermission: "quote:approve",
      },
      {
        href: "/internal/payg-requests",
        label: "nav.internal.paygRequests",
        allowedRoles: ["finance_approver"],
      },
      {
        href: "/internal/payg-offers",
        label: "nav.internal.paygOffers",
        allowedRoles: ["finance_approver"],
      },
      {
        href: "/internal/capabilities",
        label: "nav.internal.capabilities",
        allowedRoles: [
          "internal_operator",
          "finance_approver",
          "legal_approver",
          "destructive_action_approver",
        ],
      },
      {
        href: "/internal/providers",
        label: "nav.internal.providers",
        allowedRoles: ["internal_operator", "finance_approver"],
      },
      {
        href: "/internal/catalog",
        label: "nav.internal.catalog",
        allowedRoles: ["internal_operator", "finance_approver"],
      },
      {
        href: "/internal/channel-policy",
        label: "nav.internal.channelPolicy",
        allowedRoles: ["finance_approver"],
      },
      {
        href: "/internal/gates",
        label: "nav.internal.gates",
        allowedRoles: ["internal_operator"],
      },
      {
        href: "/internal/assisted",
        label: "nav.internal.assisted",
        allowedRoles: ["internal_operator"],
      },
    ]),
  ],
};

export const allowedRoles = {
  customer: ["owner", "admin", "billing", "member"],
  partner: ["partner_admin", "partner_seller"],
  internal: internalRoles,
} as const;

export type CommerceRole =
  (typeof allowedRoles)[keyof typeof allowedRoles][number];

function isCommerceRole(role: string): role is Role {
  return (commerceRoles as readonly string[]).includes(role);
}

export function canAccessNavigationItem(
  item: NavigationItem,
  roles: readonly string[],
): boolean {
  const itemRoles = item.allowedRoles;
  if (
    itemRoles &&
    !roles.some((role) => isCommerceRole(role) && itemRoles.includes(role))
  ) {
    return false;
  }

  const permitted = (permission: Permission) =>
    roles.some(
      (role) => isCommerceRole(role) && hasPermission(role, permission),
    );
  if (item.workspace && !permitted(staffWorkspacePermission[item.workspace]))
    return false;
  return !item.requiredPermission || permitted(item.requiredPermission);
}

export function isNavigationItemActive(
  item: NavigationItem,
  pathname: string,
): boolean {
  const match = item.match ?? item.href;
  const rootDestination =
    match === "/partner" || match === "/internal" || match === "/buy";
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
