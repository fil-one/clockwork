import type { Route } from "next";

import {
  demoText,
  type DemoTextField,
} from "@clockwork/testing/demo-localized-text";

import type { SupportedCurrency } from "@/src/features/shared/format";
import type { MessageId } from "@/src/i18n";

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
  orderId?: string;
  clientResponse?: { decision: string; name: string; note: string; at: string };
  quoteCommand?: { quoteId: string; accountId: string; version: number };
  documents?: readonly {
    id: string;
    kind: "partner_transfer_quote" | "partner_resale_quote";
    label: string;
  }[];
  quotePricing?: { transferPrice: string; resalePrice: string };
}

/**
 * A commercial position as facts. The read boundary formats the amounts in the
 * reader's locale and places them in a message; nothing here is pre-rendered.
 */
export type PartnerPosition =
  | {
      readonly kind: "transferAndResale";
      readonly currency: SupportedCurrency;
      readonly transferMinor: string;
      readonly resaleMinor: string;
    }
  | {
      readonly kind: "collected" | "proposedResale";
      readonly currency: SupportedCurrency;
      readonly amountMinor: string;
    };

/** The next milestone as facts; `on` is a calendar date (YYYY-MM-DD). */
export type PartnerMilestone =
  | { readonly kind: "renewalDecisionDue"; readonly on: string }
  | { readonly kind: "commissionEligible"; readonly rate: number }
  | { readonly kind: "qualificationDueToday" };

/**
 * A fixture row as it is stored, before the read boundary turns it into the
 * `PartnerRecord` a page renders.
 *
 * `context` stands in for text a person would have typed, so a fixture may
 * carry it in every language with `demoText` (translation policy rule 4).
 * `position` and `milestone` replace the pre-rendered `value` and `secondary`
 * strings; a fixture that still has only the strings renders them as written.
 */
export interface PartnerFixture extends Omit<
  PartnerRecord,
  "context" | "value" | "secondary"
> {
  context: DemoTextField;
  value?: string;
  secondary?: string;
  position?: PartnerPosition;
  milestone?: PartnerMilestone;
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

/** Collection chrome is message IDs; the component renders each with `t`. */
export interface PartnerSurfaceConfig<Row = PartnerRecord> {
  eyebrow: MessageId;
  title: MessageId;
  description: MessageId;
  rule: MessageId;
  /** A plural message taking `{count}`: "{count} end clients". */
  count: MessageId;
  searchPlaceholder: MessageId;
  columns: readonly [MessageId, MessageId, MessageId];
  records: readonly Row[];
  roles: readonly PartnerRole[];
  primaryAction?: {
    label: MessageId;
    href: Route;
    roles: readonly PartnerRole[];
  };
  gate?: MessageId;
  amountColumn?: number;
}

function partnerRoute(href: string): Route {
  return href as Route;
}

const portfolio: readonly PartnerFixture[] = [
  {
    id: "EC-0038",
    name: "Halcyon Research Cooperative",
    context: demoText({
      en: "Resale · US East · 280 TB committed",
      es: "Reventa · EE. UU. Este · 280 TB contratados",
      fr: "Revente · Est des États-Unis · 280 To souscrits",
      de: "Wiederverkauf · USA Ost · 280 TB vertraglich zugesagt",
      ja: "再販・米国東部・契約容量 280 TB",
      pt: "Revenda · Leste dos EUA · 280 TB contratados",
      zh: "转售 · 美国东部 · 承诺容量 280 TB",
      ar: "إعادة البيع · شرق الولايات المتحدة · 280 تيرابايت متعاقد عليها",
    }),
    status: "attention",
    risk: "medium",
    owner: "Juno Okafor",
    position: {
      kind: "transferAndResale",
      currency: "USD",
      transferMinor: "9120000",
      resaleMinor: "11200000",
    },
    milestone: { kind: "renewalDecisionDue", on: "2026-09-02" },
    href: partnerRoute("/partner/portfolio/EC-0038"),
  },
  {
    id: "EC-0041",
    name: "Solace Public Records",
    context: demoText({
      en: "Referral · EU West · 65 TB committed",
      es: "Recomendación · UE Oeste · 65 TB contratados",
      fr: "Apport d’affaires · Ouest de l’UE · 65 To souscrits",
      de: "Empfehlung · EU West · 65 TB vertraglich zugesagt",
      ja: "紹介・EU 西部・契約容量 65 TB",
      pt: "Indicação · Oeste da UE · 65 TB contratados",
      zh: "推荐 · 欧盟西部 · 承诺容量 65 TB",
      ar: "إحالة · غرب الاتحاد الأوروبي · 65 تيرابايت متعاقد عليها",
    }),
    status: "active",
    risk: "low",
    owner: "Mira Patel",
    position: { kind: "collected", currency: "USD", amountMinor: "2860000" },
    milestone: { kind: "commissionEligible", rate: 0.1 },
    href: partnerRoute("/partner/portfolio/EC-0041"),
  },
  {
    id: "EC-0047",
    name: "Atlas Field Imaging",
    context: demoText({
      en: "Two-tier resale · UK South · 14 TB POC",
      es: "Reventa en dos niveles · Reino Unido Sur · POC de 14 TB",
      fr: "Revente à deux niveaux · Sud du Royaume-Uni · POC de 14 To",
      de: "Zweistufiger Wiederverkauf · UK Süd · POC mit 14 TB",
      ja: "2 階層の再販・英国南部・14 TB の PoC",
      pt: "Revenda em dois níveis · Sul do Reino Unido · POC de 14 TB",
      zh: "两级转售 · 英国南部 · 14 TB 概念验证",
      ar: "إعادة بيع على مستويين · جنوب المملكة المتحدة · إثبات مفهوم بسعة 14 تيرابايت",
    }),
    status: "pending",
    risk: "high",
    owner: "Juno Okafor",
    position: {
      kind: "proposedResale",
      currency: "USD",
      amountMinor: "840000",
    },
    milestone: { kind: "qualificationDueToday" },
    href: partnerRoute("/partner/portfolio/EC-0047"),
  },
];

const registrations: readonly PartnerFixture[] = [
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

const disputes: readonly PartnerFixture[] = [
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

const quotes: readonly PartnerFixture[] = [
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

const billing: readonly PartnerFixture[] = [
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

const commissions: readonly PartnerFixture[] = [
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

const renewals: readonly PartnerFixture[] = [
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

const sandboxes: readonly PartnerFixture[] = [
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

const marketplace: readonly PartnerFixture[] = [
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

const brand: readonly PartnerFixture[] = [
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

const support: readonly PartnerFixture[] = [
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
  Record<PartnerSurfaceKey, PartnerSurfaceConfig<PartnerFixture>>
> = {
  portfolio: {
    eyebrow: "partner.surface.portfolio.eyebrow",
    title: "partner.surface.portfolio.title",
    description: "partner.surface.portfolio.description",
    rule: "partner.surface.portfolio.rule",
    count: "partner.surface.portfolio.count",
    searchPlaceholder: "partner.surface.portfolio.search",
    columns: [
      "partner.surface.portfolio.column0",
      "partner.surface.portfolio.column1",
      "partner.surface.portfolio.column2",
    ],
    records: portfolio,
    roles: both,
  },
  registrations: {
    eyebrow: "partner.surface.registrations.eyebrow",
    title: "partner.surface.registrations.title",
    description: "partner.surface.registrations.description",
    rule: "partner.surface.registrations.rule",
    count: "partner.surface.registrations.count",
    searchPlaceholder: "partner.surface.registrations.search",
    columns: [
      "partner.surface.registrations.column0",
      "partner.surface.registrations.column1",
      "partner.surface.registrations.column2",
    ],
    records: registrations,
    roles: both,
    gate: "partner.surface.registrations.gate",
  },
  disputes: {
    eyebrow: "partner.surface.disputes.eyebrow",
    title: "partner.surface.disputes.title",
    description: "partner.surface.disputes.description",
    rule: "partner.surface.disputes.rule",
    count: "partner.surface.disputes.count",
    searchPlaceholder: "partner.surface.disputes.search",
    columns: [
      "partner.surface.disputes.column0",
      "partner.surface.disputes.column1",
      "partner.surface.disputes.column2",
    ],
    records: disputes,
    roles: both,
    gate: "partner.surface.disputes.gate",
  },
  quotes: {
    eyebrow: "partner.surface.quotes.eyebrow",
    title: "partner.surface.quotes.title",
    description: "partner.surface.quotes.description",
    rule: "partner.surface.quotes.rule",
    count: "partner.surface.quotes.count",
    searchPlaceholder: "partner.surface.quotes.search",
    columns: [
      "partner.surface.quotes.column0",
      "partner.surface.quotes.column1",
      "partner.surface.quotes.column2",
    ],
    records: quotes,
    roles: both,
    primaryAction: {
      label: "partner.surface.quotes.primaryAction",
      href: "/partner/quotes/new",
      roles: both,
    },
  },
  billing: {
    eyebrow: "partner.surface.billing.eyebrow",
    title: "partner.surface.billing.title",
    description: "partner.surface.billing.description",
    rule: "partner.surface.billing.rule",
    count: "partner.surface.billing.count",
    searchPlaceholder: "partner.surface.billing.search",
    columns: [
      "partner.surface.billing.column0",
      "partner.surface.billing.column1",
      "partner.surface.billing.column2",
    ],
    records: billing,
    roles: admin,
    amountColumn: 3,
  },
  commissions: {
    eyebrow: "partner.surface.commissions.eyebrow",
    title: "partner.surface.commissions.title",
    description: "partner.surface.commissions.description",
    rule: "partner.surface.commissions.rule",
    count: "partner.surface.commissions.count",
    searchPlaceholder: "partner.surface.commissions.search",
    columns: [
      "partner.surface.commissions.column0",
      "partner.surface.commissions.column1",
      "partner.surface.commissions.column2",
    ],
    records: commissions,
    roles: admin,
    amountColumn: 3,
  },
  renewals: {
    eyebrow: "partner.surface.renewals.eyebrow",
    title: "partner.surface.renewals.title",
    description: "partner.surface.renewals.description",
    rule: "partner.surface.renewals.rule",
    count: "partner.surface.renewals.count",
    searchPlaceholder: "partner.surface.renewals.search",
    columns: [
      "partner.surface.renewals.column0",
      "partner.surface.renewals.column1",
      "partner.surface.renewals.column2",
    ],
    records: renewals,
    roles: admin,
  },
  sandboxes: {
    eyebrow: "partner.surface.sandboxes.eyebrow",
    title: "partner.surface.sandboxes.title",
    description: "partner.surface.sandboxes.description",
    rule: "partner.surface.sandboxes.rule",
    count: "partner.surface.sandboxes.count",
    searchPlaceholder: "partner.surface.sandboxes.search",
    columns: [
      "partner.surface.sandboxes.column0",
      "partner.surface.sandboxes.column1",
      "partner.surface.sandboxes.column2",
    ],
    records: sandboxes,
    roles: admin,
  },
  marketplace: {
    eyebrow: "partner.surface.marketplace.eyebrow",
    title: "partner.surface.marketplace.title",
    description: "partner.surface.marketplace.description",
    rule: "partner.surface.marketplace.rule",
    count: "partner.surface.marketplace.count",
    searchPlaceholder: "partner.surface.marketplace.search",
    columns: [
      "partner.surface.marketplace.column0",
      "partner.surface.marketplace.column1",
      "partner.surface.marketplace.column2",
    ],
    records: marketplace,
    roles: both,
    gate: "partner.surface.marketplace.gate",
  },
  brand: {
    eyebrow: "partner.surface.brand.eyebrow",
    title: "partner.surface.brand.title",
    description: "partner.surface.brand.description",
    rule: "partner.surface.brand.rule",
    count: "partner.surface.brand.count",
    searchPlaceholder: "partner.surface.brand.search",
    columns: [
      "partner.surface.brand.column0",
      "partner.surface.brand.column1",
      "partner.surface.brand.column2",
    ],
    records: brand,
    roles: admin,
    gate: "partner.surface.brand.gate",
  },
  support: {
    eyebrow: "partner.surface.support.eyebrow",
    title: "partner.surface.support.title",
    description: "partner.surface.support.description",
    rule: "partner.surface.support.rule",
    count: "partner.surface.support.count",
    searchPlaceholder: "partner.surface.support.search",
    columns: [
      "partner.surface.support.column0",
      "partner.surface.support.column1",
      "partner.surface.support.column2",
    ],
    records: support,
    roles: both,
    gate: "partner.surface.support.gate",
  },
};

export const partnerIds = {
  account: "22222222-2222-4222-8222-222222222222",
  endClient: "33333333-3333-4333-8333-333333333333",
  priceBook: "44444444-4444-4444-8444-444444444444",
} as const;
