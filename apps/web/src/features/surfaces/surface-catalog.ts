import type { Route } from "next";

import type { Permission } from "@clockwork/contracts";

import {
  agreements,
  endClients,
  gates,
  invoices,
  orders,
  pocs,
  queues,
  quotes,
  marketplaceRecords,
  supportTickets,
  users,
  procurementRecords,
  offboardingRecords,
  registrations,
  commissionRecords,
  sandboxes,
  priceBooks,
  provisioningRecords,
  reportRecords,
  migrationRecords,
  type DemoRecord,
} from "@/src/features/shared/demo-data";
import type { MessageId } from "@/src/i18n/en";

export type SurfaceKey =
  | "dashboard"
  | "agreements"
  | "agreementExecution"
  | "quotes"
  | "quoteBuilder"
  | "orders"
  | "services"
  | "amendments"
  | "pocs"
  | "billing"
  | "account"
  | "users"
  | "procurement"
  | "offboarding"
  | "marketplace"
  | "support"
  | "partner"
  | "portfolio"
  | "registrations"
  | "registrationDisputes"
  | "partnerQuotes"
  | "partnerBilling"
  | "commissions"
  | "partnerRenewals"
  | "sandboxes"
  | "brand"
  | "partnerMarketplace"
  | "partnerSupport"
  | "internal"
  | "search"
  | "assisted"
  | "queues"
  | "approvals"
  | "priceBooks"
  | "agreementAdmin"
  | "provisioning"
  | "collections"
  | "renewals"
  | "reports"
  | "migrations"
  | "gates";

export interface SurfaceStat {
  label: MessageId;
  value: string;
  detail: string;
  tone?: "neutral" | "success" | "warning" | "danger";
}

export interface SurfaceConfig {
  audience: "customer" | "partner" | "internal";
  permission: Permission;
  eyebrow: MessageId;
  title: MessageId;
  description: MessageId;
  records: readonly DemoRecord[];
  stats: readonly SurfaceStat[];
  primaryAction?: MessageId;
  primaryHref?: Route;
  chart?: "usage" | "spend" | "capacity";
  showTerm?: boolean;
  workflow?:
    | "quote"
    | "agreement"
    | "order"
    | "poc"
    | "renewal"
    | "offboarding"
    | "registration"
    | "reports"
    | "payment"
    | "account"
    | "invite"
    | "procurement"
    | "pricebook"
    | "agreementAdmin"
    | "brand"
    | "assisted"
    | "approval"
    | "collections"
    | "admin";
}

const commonStats: readonly SurfaceStat[] = [
  {
    label: "dashboard.activeServices",
    value: "2",
    detail: "620 TB committed",
    tone: "success",
  },
  { label: "dashboard.openQuotes", value: "2", detail: "$216,480 weighted" },
  {
    label: "dashboard.invoiceDue",
    value: "$15,400",
    detail: "Due Aug 15",
    tone: "warning",
  },
  { label: "dashboard.daysToNotice", value: "93", detail: "Opens Nov 1" },
];

const partnerStats: readonly SurfaceStat[] = [
  {
    label: "nav.partner.portfolio",
    value: "18",
    detail: "14 active · 3 POC · 1 offboarding",
    tone: "success",
  },
  {
    label: "nav.partner.renewals",
    value: "4",
    detail: "Action in the next 90 days",
    tone: "warning",
  },
  {
    label: "nav.partner.commissions",
    value: "$18,420",
    detail: "Q3 accrued net",
  },
  { label: "billing.aging", value: "$12,600", detail: "Within credit policy" },
];

const internalStats: readonly SurfaceStat[] = [
  {
    label: "nav.internal.queues",
    value: "17",
    detail: "3 outside first response target",
    tone: "warning",
  },
  {
    label: "nav.internal.renewals",
    value: "$1.42M",
    detail: "180-day contracted exposure",
  },
  {
    label: "internal.provisioning.title",
    value: "2",
    detail: "Both transient and safe to re-drive",
  },
  {
    label: "internal.reports.title",
    value: "0.0%",
    detail: "Latest three-way variance",
    tone: "success",
  },
];

function withCustomer(
  title: MessageId,
  description: MessageId,
  records: readonly DemoRecord[],
  overrides: Partial<SurfaceConfig> = {},
): SurfaceConfig {
  return {
    audience: "customer",
    permission: "account:read",
    eyebrow: "dashboard.eyebrow",
    title,
    description,
    records,
    stats: commonStats,
    ...overrides,
  };
}

function withPartner(
  title: MessageId,
  description: MessageId,
  records: readonly DemoRecord[] = endClients,
  overrides: Partial<SurfaceConfig> = {},
): SurfaceConfig {
  return {
    audience: "partner",
    permission: "partner:portfolio:read",
    eyebrow: "partner.eyebrow",
    title,
    description,
    records,
    stats: partnerStats,
    showTerm: true,
    ...overrides,
  };
}

function withInternal(
  title: MessageId,
  description: MessageId,
  records: readonly DemoRecord[] = queues,
  overrides: Partial<SurfaceConfig> = {},
): SurfaceConfig {
  return {
    audience: "internal",
    permission: "system:operate",
    eyebrow: "internal.eyebrow",
    title,
    description,
    records,
    stats: internalStats,
    ...overrides,
  };
}

export const surfaces: Readonly<Record<SurfaceKey, SurfaceConfig>> = {
  dashboard: withCustomer("dashboard.title", "dashboard.description", orders, {
    chart: "usage",
    showTerm: true,
    primaryAction: "action.createQuote",
    primaryHref: "/quotes/new",
  }),
  agreements: withCustomer(
    "agreements.title",
    "agreements.description",
    agreements,
    {
      permission: "agreement:read",
      eyebrow: "agreements.eyebrow",
      showTerm: true,
      primaryAction: "agreements.execute",
      primaryHref: "/agreements/execute",
    },
  ),
  agreementExecution: withCustomer(
    "agreements.execute",
    "agreements.description",
    agreements,
    {
      permission: "agreement:execute",
      eyebrow: "agreements.eyebrow",
      workflow: "agreement",
    },
  ),
  quotes: withCustomer("quotes.title", "quotes.description", quotes, {
    permission: "quote:read",
    eyebrow: "quotes.eyebrow",
    primaryAction: "action.createQuote",
    primaryHref: "/quotes/new",
  }),
  quoteBuilder: withCustomer(
    "quotes.builder.title",
    "quotes.builder.description",
    quotes,
    {
      permission: "quote:write",
      eyebrow: "quotes.eyebrow",
      workflow: "quote",
    },
  ),
  orders: withCustomer("orders.title", "orders.description", orders, {
    permission: "order:read",
    eyebrow: "orders.eyebrow",
    chart: "capacity",
    showTerm: true,
    workflow: "order",
  }),
  services: withCustomer("orders.title", "orders.description", orders, {
    permission: "order:read",
    eyebrow: "orders.eyebrow",
    chart: "usage",
    showTerm: true,
    workflow: "renewal",
  }),
  amendments: withCustomer("orders.amendment", "orders.description", orders, {
    permission: "order:write",
    eyebrow: "orders.eyebrow",
    showTerm: true,
  }),
  pocs: withCustomer("pocs.title", "pocs.description", pocs, {
    permission: "poc:manage",
    eyebrow: "pocs.eyebrow",
    chart: "capacity",
    workflow: "poc",
  }),
  billing: withCustomer("billing.title", "billing.description", invoices, {
    permission: "billing:read",
    eyebrow: "billing.eyebrow",
    chart: "spend",
    workflow: "payment",
  }),
  account: withCustomer("account.title", "account.description", agreements, {
    eyebrow: "account.eyebrow",
    workflow: "account",
  }),
  users: withCustomer("account.users", "account.description", users, {
    permission: "account:write",
    eyebrow: "account.eyebrow",
    workflow: "invite",
    primaryAction: "action.invite",
    primaryHref: "/account/users",
  }),
  procurement: withCustomer(
    "account.procurement",
    "account.description",
    procurementRecords,
    {
      permission: "account:write",
      eyebrow: "account.eyebrow",
      workflow: "procurement",
    },
  ),
  offboarding: withCustomer(
    "account.offboarding",
    "account.description",
    offboardingRecords,
    {
      permission: "destructive:request",
      eyebrow: "account.eyebrow",
      workflow: "offboarding",
      showTerm: true,
    },
  ),
  marketplace: withCustomer(
    "partner.marketplace.title",
    "partner.marketplace.description",
    marketplaceRecords,
    {
      eyebrow: "account.eyebrow",
    },
  ),
  support: withCustomer(
    "support.title",
    "support.description",
    supportTickets,
    {
      eyebrow: "account.eyebrow",
    },
  ),
  partner: withPartner("partner.title", "partner.description", endClients, {
    chart: "capacity",
  }),
  portfolio: withPartner(
    "partner.portfolio.title",
    "partner.portfolio.description",
    endClients,
    { chart: "usage" },
  ),
  registrations: withPartner(
    "partner.registration.title",
    "partner.registration.description",
    registrations,
    {
      permission: "partner:quote:write",
      workflow: "registration",
    },
  ),
  registrationDisputes: withPartner(
    "partner.registration.title",
    "partner.registration.description",
    registrations,
    { permission: "partner:quote:write" },
  ),
  partnerQuotes: withPartner(
    "partner.quotes.title",
    "partner.quotes.description",
    quotes,
    {
      permission: "partner:quote:write",
      workflow: "quote",
      primaryAction: "action.createQuote",
      primaryHref: "/partner/quotes/new",
    },
  ),
  partnerBilling: withPartner(
    "partner.billing.title",
    "partner.billing.description",
    invoices,
    {
      permission: "billing:read",
      chart: "spend",
      workflow: "payment",
    },
  ),
  commissions: withPartner(
    "partner.commissions.title",
    "partner.commissions.description",
    commissionRecords,
    {
      permission: "billing:read",
      chart: "spend",
    },
  ),
  partnerRenewals: withPartner(
    "partner.renewals.title",
    "partner.renewals.description",
    endClients,
    {
      permission: "order:write",
      workflow: "renewal",
    },
  ),
  sandboxes: withPartner(
    "partner.sandboxes.title",
    "partner.sandboxes.description",
    sandboxes,
    {
      permission: "poc:manage",
      workflow: "poc",
    },
  ),
  brand: withPartner(
    "partner.brand.title",
    "partner.brand.description",
    gates,
    {
      permission: "account:write",
      workflow: "brand",
    },
  ),
  partnerMarketplace: withPartner(
    "partner.marketplace.title",
    "partner.marketplace.description",
    marketplaceRecords,
  ),
  partnerSupport: withPartner(
    "support.title",
    "support.description",
    supportTickets,
  ),
  internal: withInternal("internal.title", "internal.description", queues, {
    chart: "capacity",
  }),
  search: withInternal(
    "internal.search.title",
    "internal.search.description",
    orders,
    { permission: "account:read" },
  ),
  assisted: withInternal(
    "internal.assisted.title",
    "internal.assisted.description",
    endClients,
    { permission: "impersonation:assume", workflow: "assisted" },
  ),
  queues: withInternal(
    "internal.queues.title",
    "internal.queues.description",
    queues,
    { workflow: "approval" },
  ),
  approvals: withInternal(
    "internal.queues.title",
    "internal.queues.description",
    queues,
    { workflow: "approval" },
  ),
  priceBooks: withInternal(
    "internal.priceBooks.title",
    "internal.priceBooks.description",
    priceBooks,
    { permission: "quote:approve", workflow: "pricebook" },
  ),
  agreementAdmin: withInternal(
    "internal.agreements.title",
    "internal.agreements.description",
    agreements,
    { permission: "agreement:approve", workflow: "agreementAdmin" },
  ),
  provisioning: withInternal(
    "internal.provisioning.title",
    "internal.provisioning.description",
    provisioningRecords,
    {},
  ),
  collections: withInternal(
    "internal.collections.title",
    "internal.collections.description",
    invoices,
    { permission: "billing:approve", workflow: "collections" },
  ),
  renewals: withInternal(
    "internal.renewals.title",
    "internal.renewals.description",
    endClients,
    {
      permission: "report:read",
      chart: "spend",
      showTerm: true,
    },
  ),
  reports: withInternal(
    "internal.reports.title",
    "internal.reports.description",
    reportRecords,
    {
      permission: "report:read",
      chart: "capacity",
      workflow: "reports",
    },
  ),
  migrations: withInternal(
    "internal.migrations.title",
    "internal.migrations.description",
    migrationRecords,
    {},
  ),
  gates: withInternal(
    "internal.gates.title",
    "internal.gates.description",
    gates,
  ),
};
