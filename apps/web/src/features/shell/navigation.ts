import type { Route } from "next";

import type { Permission } from "@clockwork/contracts";

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
  "owner" | "home" | "document" | "contract" | "library" | "pricing" | "team";

export interface NavigationItem {
  href: Route;
  label: MessageId;
  description?: MessageId;
  keywords?: readonly string[];
  match?: string;
  requiredPermission?: Permission;
  /** Shown to a reader holding at least one of these. */
  anyPermission?: readonly Permission[];
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
    href: "/internal/owner",
    label: "platform.nav.sales.owner",
    description: "platform.nav.sales.owner.description",
    // i18n-exempt: search aliases matched in addition to the translated label; never displayed
    keywords: [
      "owner",
      "console",
      "approvals",
      "notices",
      "security",
      "access",
      "admin",
    ],
    requiredPermission: "staff:manage",
    workspace: "sales",
    icon: "owner",
  },
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
    workspace: "sales",
    icon: "document",
  },
  {
    href: "/internal/contracts",
    label: "platform.nav.internal.contracts",
    // i18n-exempt: search aliases matched in addition to the translated label; never displayed
    keywords: ["agreements", "msa", "renewals", "notice", "contract"],
    requiredPermission: "contract:read",
    workspace: "sales",
    icon: "contract",
  },
  {
    href: "/internal/sales-library",
    label: "platform.nav.internal.salesLibrary",
    // i18n-exempt: search aliases matched in addition to the translated label; never displayed
    keywords: ["deck", "collateral", "case study", "one-pager", "library"],
    requiredPermission: "sales:read",
    workspace: "sales",
    icon: "library",
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
      requiredPermission: "quote:write",
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
      requiredPermission: "billing:read",
    },
    {
      href: "/partner/commissions",
      label: "nav.partner.commissions",
      requiredPermission: "billing:read",
    },
    {
      href: "/partner/renewals",
      label: "nav.partner.renewals",
      requiredPermission: "order:write",
    },
    { href: "/partner/disputes", label: "nav.partner.disputes" },
    { href: "/partner/marketplace", label: "nav.partner.marketplace" },
    {
      href: "/partner/sandboxes",
      label: "nav.partner.sandboxes",
      requiredPermission: "poc:manage",
    },
    {
      href: "/partner/brand",
      label: "nav.partner.brand",
      requiredPermission: "account:write",
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
        href: "/internal/handoffs",
        label: "platform.nav.operations.handoffs",
        // i18n-exempt: search aliases matched in addition to the translated label; never displayed
        keywords: ["handoff", "onboarding", "new customer", "new partner"],
      },
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
        requiredPermission: "operations:write",
      },
      {
        href: "/internal/recovery",
        label: "nav.internal.recovery",
        requiredPermission: "operations:write",
      },
      {
        href: "/internal/webhook-replay",
        label: "nav.internal.webhookReplay",
        requiredPermission: "operations:write",
      },
      {
        href: "/internal/migrations",
        label: "nav.internal.migrations",
        requiredPermission: "migration:execute",
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
        requiredPermission: "agreement:approve",
      },
      {
        href: "/internal/approvals",
        label: "nav.internal.approvals",
        anyPermission: [
          "quote:approve",
          "agreement:approve",
          "destructive:approve",
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
        requiredPermission: "quote:approve",
      },
      {
        href: "/internal/payg-offers",
        label: "nav.internal.paygOffers",
        requiredPermission: "quote:approve",
      },
      {
        href: "/internal/capabilities",
        label: "nav.internal.capabilities",
      },
      {
        href: "/internal/providers",
        label: "nav.internal.providers",
        anyPermission: ["operations:write", "quote:approve"],
      },
      {
        href: "/internal/catalog",
        label: "nav.internal.catalog",
        anyPermission: ["operations:write", "quote:approve"],
      },
      {
        href: "/internal/channel-policy",
        label: "nav.internal.channelPolicy",
        requiredPermission: "quote:approve",
      },
      {
        href: "/internal/gates",
        label: "nav.internal.gates",
        requiredPermission: "operations:write",
      },
      {
        href: "/internal/assisted",
        label: "nav.internal.assisted",
        requiredPermission: "impersonation:assume",
      },
    ]),
  ],
};

export function canAccessNavigationItem(
  item: NavigationItem,
  permissions: readonly Permission[],
): boolean {
  const permitted = (permission: Permission) =>
    permissions.includes(permission);
  if (item.workspace && !permitted(staffWorkspacePermission[item.workspace]))
    return false;
  if (item.anyPermission && !item.anyPermission.some(permitted)) return false;
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

/**
 * Whether a session belongs in an audience's portal: staff hold a workspace
 * permission, partners (channel and referral alike) register deals, and
 * customers hold neither.
 */
export function audienceCanAccess(
  audience: ExperienceAudience,
  permissions: readonly Permission[],
): boolean {
  const staff =
    permissions.includes("operations:read") ||
    permissions.includes("sales:read");
  const partner = permissions.includes("deal:register");
  if (audience === "internal") return staff;
  if (audience === "partner") return partner && !staff;
  return !staff && !partner;
}
