import type { Route } from "next";

export type PartnerRole = "partner_admin" | "partner_seller";
export type PartnerRisk = "low" | "medium" | "high";
export type PartnerStatus =
  | "active"
  | "attention"
  | "draft"
  | "open"
  | "accepted"
  | "canceled"
  | "pending"
  | "paid"
  | "blocked"
  | "complete";

export interface PartnerRecord {
  id: string;
  name: string;
  context: string;
  status: PartnerStatus;
  risk: PartnerRisk;
  owner: string;
  value: string;
  secondary: string;
  href?: Route;
  recordVersion?: number;
  projectionId?: string;
  recordKey?: string;
  allowedActions?: readonly string[];
}

export type PartnerSurfaceKey =
  | "portfolio"
  | "registrations"
  | "disputes"
  | "quotes"
  | "billing"
  | "commissions"
  | "renewals"
  | "sandboxes"
  | "marketplace"
  | "brand"
  | "support";

export interface PartnerSurfaceConfig {
  eyebrow: string;
  title: string;
  description: string;
  noun: string;
  columns: readonly [string, string, string];
  records: readonly PartnerRecord[];
  roles: readonly PartnerRole[];
  primaryAction?: { label: string; href: Route; roles: readonly PartnerRole[] };
  gate?: string;
}

function partnerRoute(href: string): Route {
  return href as Route;
}

const portfolio: readonly PartnerRecord[] = [
  {
    id: "EC-0038",
    name: "Halcyon Research Cooperative",
    context: "Resale · US East · 280 TB committed",
    status: "attention",
    risk: "medium",
    owner: "Juno Okafor",
    value: "$91,200 transfer / $112,000 resale",
    secondary: "Renewal decision due Sep 2",
    href: partnerRoute("/partner/portfolio/EC-0038"),
  },
  {
    id: "EC-0041",
    name: "Solace Public Records",
    context: "Referral · EU West · 65 TB committed",
    status: "active",
    risk: "low",
    owner: "Mira Patel",
    value: "$28,600 collected",
    secondary: "10% commission eligible",
    href: partnerRoute("/partner/portfolio/EC-0041"),
  },
  {
    id: "EC-0047",
    name: "Atlas Field Imaging",
    context: "Two-tier resale · UK South · 14 TB POC",
    status: "pending",
    risk: "high",
    owner: "Juno Okafor",
    value: "$8,400 proposed resale",
    secondary: "Qualification due today",
    href: partnerRoute("/partner/portfolio/EC-0047"),
  },
];

const registrations: readonly PartnerRecord[] = [
  {
    id: "REG-2026-0081",
    name: "Atlas Field Imaging expansion",
    context: "Two-tier resale · 320 TB · 45-day protection requested",
    status: "pending",
    risk: "medium",
    owner: "Juno Okafor",
    value: "$162,000 estimated resale",
    secondary: "Decision due today",
  },
  {
    id: "REG-2026-0074",
    name: "Solace Public Records archive",
    context: "Referral · converted to active service",
    status: "accepted",
    risk: "low",
    owner: "Mira Patel",
    value: "$28,600 collected",
    secondary: "Protection credited",
  },
  {
    id: "REG-2026-0062",
    name: "Orchid City Records",
    context: "Resale · competing registered claim",
    status: "open",
    risk: "high",
    owner: "Juno Okafor",
    value: "$74,200 estimated resale",
    secondary: "Evidence due in 3 days",
  },
];

const disputes: readonly PartnerRecord[] = [
  {
    id: "DSP-2026-0012",
    name: "Orchid City Records claim",
    context: "Registration ownership · partner evidence submitted",
    status: "open",
    risk: "high",
    owner: "Juno Okafor",
    value: "$74,200 at risk",
    secondary: "Response due Aug 3",
  },
  {
    id: "DSP-2026-0008",
    name: "Halcyon service credit",
    context: "Invoice line dispute · usage evidence attached",
    status: "pending",
    risk: "medium",
    owner: "Mira Patel",
    value: "$3,120 disputed",
    secondary: "Fil One reviewing",
  },
];

const quotes: readonly PartnerRecord[] = [
  {
    id: "PQ-2026-0184-v3",
    name: "Halcyon archive expansion",
    context: "Resale · US East · 400 TB · 12 months",
    status: "open",
    risk: "medium",
    owner: "Juno Okafor",
    value: "$184,800 transfer / $218,400 resale",
    secondary: "Expires Aug 6",
    href: partnerRoute("/partner/quotes/PQ-2026-0184-v3"),
  },
  {
    id: "PQ-2026-0171-v1",
    name: "Atlas imaging POC conversion",
    context: "Two-tier resale · UK South · 80 TB · 12 months",
    status: "draft",
    risk: "high",
    owner: "Juno Okafor",
    value: "£31,680 transfer / £38,400 resale",
    secondary: "Pricing review required",
    href: partnerRoute("/partner/quotes/PQ-2026-0171-v1"),
  },
  {
    id: "PQ-2026-0152-v2",
    name: "Solace compliance archive",
    context: "Referral · EU West · 65 TB · 24 months",
    status: "accepted",
    risk: "low",
    owner: "Mira Patel",
    value: "$28,600 collected",
    secondary: "Accepted Jul 22",
    href: partnerRoute("/partner/quotes/PQ-2026-0152-v2"),
  },
];

const billing: readonly PartnerRecord[] = [
  {
    id: "INV-2026-0781",
    name: "July consolidated partner invoice",
    context:
      "12 end clients · ACH ending 1842 · Meridian is merchant of record",
    status: "pending",
    risk: "medium",
    owner: "Partner billing",
    value: "$62,480 invoiced",
    secondary: "Due Aug 15 · webhook payment truth",
  },
  {
    id: "INV-2026-0712",
    name: "June consolidated partner invoice",
    context: "11 end clients · receipt RCPT-2026-0712",
    status: "paid",
    risk: "low",
    owner: "Partner billing",
    value: "$58,920 paid",
    secondary: "Provider confirmed Jul 3",
  },
];

const commissions: readonly PartnerRecord[] = [
  {
    id: "STM-2026-Q3",
    name: "Q3 commission statement",
    context: "34 collections · 2 credits · 1 holdback",
    status: "pending",
    risk: "medium",
    owner: "Partner finance",
    value: "$18,420 accrued",
    secondary: "Pays after collection truth settles",
  },
  {
    id: "ACC-2026-0712",
    name: "Solace referral commission",
    context: "10% of net collected revenue · June invoice",
    status: "active",
    risk: "low",
    owner: "Partner finance",
    value: "$2,860 earned",
    secondary: "Included in Q3 statement",
  },
];

const renewals: readonly PartnerRecord[] = [
  {
    id: "REN-EC-0038",
    name: "Halcyon Research Cooperative",
    context: "Resale · 280 TB · current term ends Dec 31",
    status: "attention",
    risk: "high",
    owner: "Juno Okafor",
    value: "$91,200 transfer / $112,000 resale",
    secondary: "Notice action due Sep 2",
  },
  {
    id: "REN-EC-0041",
    name: "Solace Public Records",
    context: "Referral · 65 TB · current term ends Feb 28",
    status: "active",
    risk: "low",
    owner: "Mira Patel",
    value: "$28,600 annual collected",
    secondary: "No action until Dec 1",
  },
];

const sandboxes: readonly PartnerRecord[] = [
  {
    id: "SBX-2026-014",
    name: "Meridian presales lab",
    context: "US East · 10 TB cap · named keys",
    status: "active",
    risk: "low",
    owner: "Juno Okafor",
    value: "42% capacity used",
    secondary: "Expires Aug 31",
  },
  {
    id: "POC-2026-021",
    name: "Atlas imaging qualification",
    context: "UK South · 14 TB cap · four success tests",
    status: "attention",
    risk: "medium",
    owner: "Mira Patel",
    value: "3 of 4 tests passed",
    secondary: "Final report due today",
  },
];

const marketplace: readonly PartnerRecord[] = [
  {
    id: "AWS-OFFER-1948",
    name: "Halcyon AWS private offer",
    context: "Resale · Fil One seller enrollment · Meridian commercial owner",
    status: "active",
    risk: "low",
    owner: "Juno Okafor",
    value: "$112,000 buyer price",
    secondary: "Fulfillment synchronized 18 min ago",
  },
  {
    id: "AZURE-OFFER-0412",
    name: "Atlas Azure private offer",
    context: "Two-tier preview · buyer has not accepted",
    status: "pending",
    risk: "medium",
    owner: "Juno Okafor",
    value: "£38,400 buyer price",
    secondary: "Provider is source of acceptance",
  },
];

const brand: readonly PartnerRecord[] = [
  {
    id: "BRAND-MERIDIAN",
    name: "Meridian resale experience",
    context: "quotes.meridian.example · partner commercial contact",
    status: "active",
    risk: "low",
    owner: "Partner admin",
    value: "Domain verified",
    secondary: "Fil One legal entity remains disclosed",
  },
  {
    id: "DNS-ATLAS",
    name: "Atlas custom quote domain",
    context: "DNS verification delegated to domain administrator",
    status: "blocked",
    risk: "medium",
    owner: "Partner admin",
    value: "External gate",
    secondary: "Add the displayed TXT record at your DNS provider",
  },
];

const support: readonly PartnerRecord[] = [
  {
    id: "SUP-18421",
    name: "Halcyon restore sample timing",
    context: "End-client-visible summary · standard priority",
    status: "active",
    risk: "low",
    owner: "Fil One support",
    value: "Updated 28 min ago",
    secondary: "Support system is source",
  },
  {
    id: "SUP-18307",
    name: "Atlas EU usage export",
    context: "Partner-visible only · awaiting end-client details",
    status: "pending",
    risk: "medium",
    owner: "Juno Okafor",
    value: "Normal priority",
    secondary: "Reply in support provider",
  },
];

const both = ["partner_admin", "partner_seller"] as const;
const admin = ["partner_admin"] as const;

export const partnerSurfaces: Readonly<
  Record<PartnerSurfaceKey, PartnerSurfaceConfig>
> = {
  portfolio: {
    eyebrow: "Portfolio",
    title: "End-client portfolio",
    description:
      "Commercial context, service position, and risk for every named end client.",
    noun: "end clients",
    columns: ["End client", "Commercial position", "Next milestone"],
    records: portfolio,
    roles: both,
  },
  registrations: {
    eyebrow: "Pipeline protection",
    title: "Deal registrations",
    description:
      "Register named opportunities and track protection without exposing raw account identifiers.",
    noun: "registrations",
    columns: ["Opportunity", "Commercial value", "Decision"],
    records: registrations,
    roles: both,
    gate: "Registration decisions are made by Fil One channel operations; partner roles can submit evidence and monitor the decision.",
  },
  disputes: {
    eyebrow: "Evidence and resolution",
    title: "Registration and billing disputes",
    description:
      "Track disputed claims, evidence deadlines, and the authority responsible for a decision.",
    noun: "disputes",
    columns: ["Dispute", "Exposure", "Deadline"],
    records: disputes,
    roles: both,
    gate: "Final dispute decisions are external to the partner desk and remain with Fil One operations or the billing provider.",
  },
  quotes: {
    eyebrow: "Resale commercial workflow",
    title: "Partner & resale quotes",
    description:
      "Keep transfer economics private while issuing a clear partner-controlled resale price.",
    noun: "quotes",
    columns: ["Quote", "Price boundary", "Expiry"],
    records: quotes,
    roles: both,
    primaryAction: {
      label: "Create resale quote",
      href: "/partner/quotes/new",
      roles: both,
    },
  },
  billing: {
    eyebrow: "Invoice and payment truth",
    title: "Consolidated billing",
    description:
      "Reconcile partner invoices by end client; payment status remains provider-webhook derived.",
    noun: "invoices",
    columns: ["Invoice", "Invoice truth", "Payment truth"],
    records: billing,
    roles: admin,
  },
  commissions: {
    eyebrow: "Collected-revenue basis",
    title: "Commissions and statements",
    description:
      "See accruals, credits, holdbacks, and payouts without confusing estimates with collected revenue.",
    noun: "commission entries",
    columns: ["Statement", "Collected basis", "Settlement"],
    records: commissions,
    roles: admin,
  },
  renewals: {
    eyebrow: "Protected commercial change",
    title: "Partner renewals",
    description:
      "Review the transfer and resale commitment before requesting a renewal change.",
    noun: "renewals",
    columns: ["End client", "Renewal economics", "Notice clock"],
    records: renewals,
    roles: admin,
  },
  sandboxes: {
    eyebrow: "Presales environments",
    title: "Sandboxes and POCs",
    description:
      "Track capacity caps, success tests, named access, and expiry before commercial conversion.",
    noun: "sandboxes and POCs",
    columns: ["Environment", "Progress", "Expiry"],
    records: sandboxes,
    roles: admin,
  },
  marketplace: {
    eyebrow: "Provider fulfillment",
    title: "Marketplace offers",
    description:
      "Follow offer and fulfillment state while preserving each provider as the acceptance source.",
    noun: "marketplace offers",
    columns: ["Offer", "Buyer price", "Provider state"],
    records: marketplace,
    roles: both,
    gate: "Offer acceptance and payout actions occur in the marketplace provider; Fil One shows synchronized provider truth.",
  },
  brand: {
    eyebrow: "Partner presentation",
    title: "Brand and custom domains",
    description:
      "Manage partner-facing presentation while keeping legal and merchant boundaries explicit.",
    noun: "brand settings",
    columns: ["Experience", "Verification", "Boundary"],
    records: brand,
    roles: admin,
    gate: "DNS changes happen at your provider. Fil One verifies the record but does not navigate or submit changes on your behalf.",
  },
  support: {
    eyebrow: "Partner-visible cases",
    title: "Support",
    description:
      "Follow end-client support work with source-system freshness and visibility boundaries.",
    noun: "support cases",
    columns: ["Case", "Freshness", "Source"],
    records: support,
    roles: both,
    gate: "Replies and attachments are handled in the support provider; this page is a safe read-only handoff.",
  },
};

export const partnerIds = {
  account: "22222222-2222-4222-8222-222222222222",
  endClient: "33333333-3333-4333-8333-333333333333",
  priceBook: "44444444-4444-4444-8444-444444444444",
} as const;
