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
  /** Issued PDFs; the page names each one from its kind. */
  documents?: readonly {
    id: string;
    kind: "partner_transfer_quote" | "partner_resale_quote";
  }[];
  quotePricing?: { transferPrice: string; resalePrice: string };
}

/** An amount the position states, each with its own wording. */
export const partnerMoneyPositionKinds = [
  "collected",
  "proposedResale",
  "estimatedResale",
  "invoiced",
  "paid",
  "atRisk",
  "disputed",
  "accrued",
  "earned",
  "annualCollected",
  "buyerPrice",
] as const;
export type PartnerMoneyPositionKind =
  (typeof partnerMoneyPositionKinds)[number];

/** A position that is a fixed statement rather than a quantity. */
export const partnerLabelPositionKinds = [
  "domainVerified",
  "dnsVerificationRequested",
  "externalGate",
  "normalPriority",
] as const;
export type PartnerLabelPositionKind =
  (typeof partnerLabelPositionKinds)[number];

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
      readonly kind: PartnerMoneyPositionKind;
      readonly currency: SupportedCurrency;
      readonly amountMinor: string;
    }
  /** Share of a capacity cap in use, 0–1. */
  | { readonly kind: "capacityUsed"; readonly ratio: number }
  | {
      readonly kind: "testsPassed";
      readonly passed: number;
      readonly total: number;
    }
  /** A decimal number of terabytes, as the quantity schema stores it. */
  | { readonly kind: "potentialWorkload"; readonly terabytes: string }
  | { readonly kind: "updatedMinutesAgo"; readonly minutes: number }
  | { readonly kind: PartnerLabelPositionKind };

/** Milestones that carry a calendar date (`on`, YYYY-MM-DD) and nothing else. */
export const partnerDatedMilestoneKinds = [
  "renewalDecisionDue",
  "paymentConfirmed",
  "responseDue",
  "expires",
  "acceptedOn",
  "noticeActionDue",
  "noActionUntil",
  "draftExpires",
  "issuedExpires",
] as const;
export type PartnerDatedMilestoneKind =
  (typeof partnerDatedMilestoneKinds)[number];

/** Milestones that are a fixed statement. */
export const partnerLabelMilestoneKinds = [
  "qualificationDueToday",
  "decisionDueToday",
  "protectionCredited",
  "filOneReviewing",
  "pricingReviewRequired",
  "paysAfterCollection",
  "finalReportDueToday",
  "providerIsAcceptanceSource",
  "legalEntityDisclosed",
  "addTxtRecord",
  "addVerificationRecord",
  "supportSystemIsSource",
  "replyInSupportProvider",
  "awaitingChannelDecision",
  "renewalRequested",
  "renewalDeclined",
  "clientRequestedOrder",
  "clientRequestedChanges",
  "clientDeclined",
] as const;
export type PartnerLabelMilestoneKind =
  (typeof partnerLabelMilestoneKinds)[number];

/** The next milestone as facts; `on` is a calendar date (YYYY-MM-DD). */
export type PartnerMilestone =
  | { readonly kind: PartnerDatedMilestoneKind; readonly on: string }
  | { readonly kind: "commissionEligible"; readonly rate: number }
  | {
      readonly kind: "invoiceDue";
      readonly invoice: string;
      readonly currency: SupportedCurrency;
      readonly amountMinor: string;
      readonly on: string;
    }
  | { readonly kind: "evidenceDueInDays"; readonly days: number }
  | { readonly kind: "includedInStatement"; readonly statement: string }
  | { readonly kind: "fulfillmentSynced"; readonly minutes: number }
  | { readonly kind: "supersededBy"; readonly revision: number }
  /** `reason` is what the person who withdrew the quote typed. */
  | { readonly kind: "withdrawn"; readonly reason: string }
  | { readonly kind: "supplyOrderAccepted"; readonly purchaseOrder?: string }
  | { readonly kind: PartnerLabelMilestoneKind };

/**
 * A fixture row as it is stored, before the read boundary turns it into the
 * `PartnerRecord` a page renders.
 *
 * `name`, `context` and `owner` stand in for text a person would have typed,
 * so a fixture carries them in every language with `demoText` (translation
 * policy rule 4). `position` and `milestone` replace the pre-rendered `value`
 * and `secondary` strings; a fixture that still has only the strings renders
 * them as written.
 */
export interface PartnerFixture extends Omit<
  PartnerRecord,
  "name" | "context" | "owner" | "value" | "secondary"
> {
  name: DemoTextField;
  context: DemoTextField;
  owner: DemoTextField;
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
      ja: "2階層の再販・英国南部・14 TB の PoC",
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

/**
 * Team names that own demo records. In production an owner is whatever the
 * partner's own directory calls the person or queue, so these are demo-authored
 * content (rule 4), not product copy.
 */
const owners = {
  partnerBilling: demoText({
    en: "Partner billing",
    es: "Facturación del socio",
    fr: "Facturation partenaire",
    de: "Partnerabrechnung",
    ja: "パートナー請求担当",
    pt: "Faturamento do parceiro",
    zh: "合作伙伴账单组",
    ar: "فريق فوترة الشريك",
  }),
  partnerFinance: demoText({
    en: "Partner finance",
    es: "Finanzas del socio",
    fr: "Finance partenaire",
    de: "Finanzteam des Partners",
    ja: "パートナー経理担当",
    pt: "Financeiro do parceiro",
    zh: "合作伙伴财务组",
    ar: "الفريق المالي للشريك",
  }),
  partnerAdmin: demoText({
    en: "Partner admin",
    es: "Administrador del socio",
    fr: "Administrateur partenaire",
    de: "Partneradministration",
    ja: "パートナー管理者",
    pt: "Administrador do parceiro",
    zh: "合作伙伴管理员",
    ar: "مسؤول الشريك",
  }),
  filOneSupport: demoText({
    en: "Fil One support",
    es: "Soporte de Fil One",
    fr: "Assistance Fil One",
    de: "Support von Fil One",
    ja: "Fil One サポート",
    pt: "Suporte da Fil One",
    zh: "Fil One 支持团队",
    ar: "دعم Fil One",
  }),
} as const;

const registrations: readonly PartnerFixture[] = [
  {
    id: "REG-2026-0081",
    name: demoText({
      en: "Atlas Field Imaging expansion",
      es: "Ampliación de Atlas Field Imaging",
      fr: "Extension d’Atlas Field Imaging",
      de: "Erweiterung Atlas Field Imaging",
      ja: "Atlas Field Imaging の拡張",
      pt: "Expansão da Atlas Field Imaging",
      zh: "Atlas Field Imaging 扩容",
      ar: "توسعة Atlas Field Imaging",
    }),
    context: demoText({
      en: "Two-tier resale · 320 TB · 45-day protection requested",
      es: "Reventa en dos niveles · 320 TB · protección solicitada de 45 días",
      fr: "Revente à deux niveaux · 320 To · protection de 45 jours demandée",
      de: "Zweistufiger Wiederverkauf · 320 TB · 45 Tage Schutz beantragt",
      ja: "2階層の再販・320 TB・45日間の保護を申請",
      pt: "Revenda em dois níveis · 320 TB · proteção de 45 dias solicitada",
      zh: "两级转售 · 320 TB · 申请 45 天保护期",
      ar: "إعادة بيع على مستويين · 320 تيرابايت · طلب حماية لمدة 45 يومًا",
    }),
    status: "pending",
    risk: "medium",
    owner: "Juno Okafor",
    position: {
      kind: "estimatedResale",
      currency: "USD",
      amountMinor: "16200000",
    },
    milestone: { kind: "decisionDueToday" },
  },
  {
    id: "REG-2026-0074",
    name: demoText({
      en: "Solace Public Records archive",
      es: "Archivo de Solace Public Records",
      fr: "Archive de Solace Public Records",
      de: "Archiv Solace Public Records",
      ja: "Solace Public Records のアーカイブ",
      pt: "Arquivo da Solace Public Records",
      zh: "Solace Public Records 归档",
      ar: "أرشيف Solace Public Records",
    }),
    context: demoText({
      en: "Referral · converted to active service",
      es: "Recomendación · convertida en servicio activo",
      fr: "Apport d’affaires · converti en service actif",
      de: "Empfehlung · in einen aktiven Dienst umgewandelt",
      ja: "紹介・稼働中のサービスに移行済み",
      pt: "Indicação · convertida em serviço ativo",
      zh: "推荐 · 已转为运行中的服务",
      ar: "إحالة · تحوّلت إلى خدمة نشطة",
    }),
    status: "accepted",
    risk: "low",
    owner: "Mira Patel",
    position: { kind: "collected", currency: "USD", amountMinor: "2860000" },
    milestone: { kind: "protectionCredited" },
  },
  {
    id: "REG-2026-0062",
    name: "Orchid City Records",
    context: demoText({
      en: "Resale · competing registered claim",
      es: "Reventa · reclamación registrada en conflicto",
      fr: "Revente · demande concurrente enregistrée",
      de: "Wiederverkauf · konkurrierender registrierter Anspruch",
      ja: "再販・競合する登録済みの申請あり",
      pt: "Revenda · reivindicação registrada concorrente",
      zh: "转售 · 存在竞争的已报备主张",
      ar: "إعادة البيع · مطالبة مسجلة منافسة",
    }),
    status: "open",
    risk: "high",
    owner: "Juno Okafor",
    position: {
      kind: "estimatedResale",
      currency: "USD",
      amountMinor: "7420000",
    },
    milestone: { kind: "evidenceDueInDays", days: 3 },
  },
];

const disputes: readonly PartnerFixture[] = [
  {
    id: "DSP-2026-0012",
    name: demoText({
      en: "Orchid City Records claim",
      es: "Reclamación de Orchid City Records",
      fr: "Réclamation d’Orchid City Records",
      de: "Anspruch Orchid City Records",
      ja: "Orchid City Records の申し立て",
      pt: "Reivindicação da Orchid City Records",
      zh: "Orchid City Records 主张",
      ar: "مطالبة Orchid City Records",
    }),
    context: demoText({
      en: "Registration ownership · partner evidence submitted",
      es: "Titularidad del registro · evidencias del socio enviadas",
      fr: "Titularité de l’enregistrement · preuves du partenaire transmises",
      de: "Inhaberschaft der Registrierung · Nachweise des Partners eingereicht",
      ja: "登録の帰属・パートナーの証跡を提出済み",
      pt: "Titularidade do registro · evidências do parceiro enviadas",
      zh: "报备归属 · 已提交合作伙伴证据",
      ar: "ملكية التسجيل · قُدِّمت أدلة الشريك",
    }),
    status: "open",
    risk: "high",
    owner: "Juno Okafor",
    position: { kind: "atRisk", currency: "USD", amountMinor: "7420000" },
    milestone: { kind: "responseDue", on: "2026-08-03" },
  },
  {
    id: "DSP-2026-0008",
    name: demoText({
      en: "Halcyon service credit",
      es: "Crédito de servicio de Halcyon",
      fr: "Crédit de service Halcyon",
      de: "Servicegutschrift für Halcyon",
      ja: "Halcyon のサービスクレジット",
      pt: "Crédito de serviço da Halcyon",
      zh: "Halcyon 服务抵扣",
      ar: "رصيد خدمة Halcyon",
    }),
    context: demoText({
      en: "Invoice line dispute · usage evidence attached",
      es: "Disputa sobre una línea de factura · evidencia de uso adjunta",
      fr: "Litige sur une ligne de facture · preuve d’utilisation jointe",
      de: "Streitfall zu einer Rechnungsposition · Nutzungsnachweis beigefügt",
      ja: "請求書明細への異議・利用状況の証跡を添付",
      pt: "Contestação de item da fatura · evidência de uso anexada",
      zh: "发票明细争议 · 已附用量证据",
      ar: "نزاع على بند في الفاتورة · أُرفق دليل الاستخدام",
    }),
    status: "pending",
    risk: "medium",
    owner: "Mira Patel",
    position: { kind: "disputed", currency: "USD", amountMinor: "312000" },
    milestone: { kind: "filOneReviewing" },
  },
];

const quotes: readonly PartnerFixture[] = [
  {
    id: "PQ-2026-0184-v3",
    name: demoText({
      en: "Halcyon archive expansion",
      es: "Ampliación del archivo de Halcyon",
      fr: "Extension de l’archive Halcyon",
      de: "Erweiterung des Halcyon-Archivs",
      ja: "Halcyon アーカイブの拡張",
      pt: "Expansão do arquivo da Halcyon",
      zh: "Halcyon 归档扩容",
      ar: "توسعة أرشيف Halcyon",
    }),
    context: demoText({
      en: "Resale · US East · 400 TB · 12 months",
      es: "Reventa · EE. UU. Este · 400 TB · 12 meses",
      fr: "Revente · Est des États-Unis · 400 To · 12 mois",
      de: "Wiederverkauf · USA Ost · 400 TB · 12 Monate",
      ja: "再販・米国東部・400 TB・12か月",
      pt: "Revenda · Leste dos EUA · 400 TB · 12 meses",
      zh: "转售 · 美国东部 · 400 TB · 12 个月",
      ar: "إعادة البيع · شرق الولايات المتحدة · 400 تيرابايت · 12 شهرًا",
    }),
    status: "open",
    risk: "medium",
    owner: "Juno Okafor",
    position: {
      kind: "transferAndResale",
      currency: "USD",
      transferMinor: "18480000",
      resaleMinor: "21840000",
    },
    milestone: { kind: "expires", on: "2026-08-06" },
    href: partnerRoute("/partner/quotes/PQ-2026-0184-v3"),
  },
  {
    id: "PQ-2026-0171-v1",
    name: demoText({
      en: "Atlas imaging POC conversion",
      es: "Conversión de la POC de imágenes de Atlas",
      fr: "Conversion de la POC d’imagerie Atlas",
      de: "Umwandlung des Imaging-POC von Atlas",
      ja: "Atlas 画像処理 PoC の本契約化",
      pt: "Conversão da POC de imagens da Atlas",
      zh: "Atlas 影像概念验证转正",
      ar: "تحويل إثبات مفهوم التصوير لدى Atlas",
    }),
    context: demoText({
      en: "Two-tier resale · UK South · 80 TB · 12 months",
      es: "Reventa en dos niveles · Reino Unido Sur · 80 TB · 12 meses",
      fr: "Revente à deux niveaux · Sud du Royaume-Uni · 80 To · 12 mois",
      de: "Zweistufiger Wiederverkauf · UK Süd · 80 TB · 12 Monate",
      ja: "2階層の再販・英国南部・80 TB・12か月",
      pt: "Revenda em dois níveis · Sul do Reino Unido · 80 TB · 12 meses",
      zh: "两级转售 · 英国南部 · 80 TB · 12 个月",
      ar: "إعادة بيع على مستويين · جنوب المملكة المتحدة · 80 تيرابايت · 12 شهرًا",
    }),
    status: "draft",
    risk: "high",
    owner: "Juno Okafor",
    position: {
      kind: "transferAndResale",
      currency: "GBP",
      transferMinor: "3168000",
      resaleMinor: "3840000",
    },
    milestone: { kind: "pricingReviewRequired" },
    href: partnerRoute("/partner/quotes/PQ-2026-0171-v1"),
  },
  {
    id: "PQ-2026-0152-v2",
    name: demoText({
      en: "Solace compliance archive",
      es: "Archivo de cumplimiento de Solace",
      fr: "Archive de conformité Solace",
      de: "Compliance-Archiv von Solace",
      ja: "Solace のコンプライアンス用アーカイブ",
      pt: "Arquivo de conformidade da Solace",
      zh: "Solace 合规归档",
      ar: "أرشيف الامتثال لدى Solace",
    }),
    context: demoText({
      en: "Referral · EU West · 65 TB · 24 months",
      es: "Recomendación · UE Oeste · 65 TB · 24 meses",
      fr: "Apport d’affaires · Ouest de l’UE · 65 To · 24 mois",
      de: "Empfehlung · EU West · 65 TB · 24 Monate",
      ja: "紹介・EU 西部・65 TB・24か月",
      pt: "Indicação · Oeste da UE · 65 TB · 24 meses",
      zh: "推荐 · 欧盟西部 · 65 TB · 24 个月",
      ar: "إحالة · غرب الاتحاد الأوروبي · 65 تيرابايت · 24 شهرًا",
    }),
    status: "accepted",
    risk: "low",
    owner: "Mira Patel",
    position: { kind: "collected", currency: "USD", amountMinor: "2860000" },
    milestone: { kind: "acceptedOn", on: "2026-07-22" },
    href: partnerRoute("/partner/quotes/PQ-2026-0152-v2"),
  },
];

const billing: readonly PartnerFixture[] = [
  {
    id: "INV-2026-0781",
    name: demoText({
      en: "July consolidated partner invoice",
      es: "Factura consolidada del socio de julio",
      fr: "Facture partenaire consolidée de juillet",
      de: "Konsolidierte Partnerrechnung Juli",
      ja: "7月分パートナー一括請求書",
      pt: "Fatura consolidada do parceiro de julho",
      zh: "7 月合作伙伴合并发票",
      ar: "فاتورة الشريك الموحدة لشهر يوليو",
    }),
    context: demoText({
      en: "12 end clients · ACH ending 1842 · Meridian is merchant of record",
      es: "12 clientes finales · ACH terminada en 1842 · Meridian es el vendedor responsable de la transacción",
      fr: "12 clients finaux · ACH se terminant par 1842 · Meridian est le vendeur responsable de la transaction",
      de: "12 Endkunden · ACH endet auf 1842 · Meridian ist Merchant of Record",
      ja: "エンド顧客 12社・末尾 1842 の ACH・販売主体は Meridian",
      pt: "12 clientes finais · ACH com final 1842 · Meridian é o vendedor responsável pela transação",
      zh: "12 个终端客户 · 尾号 1842 的 ACH 账户 · Meridian 为交易责任商户",
      ar: "12 عميلًا نهائيًا · حساب ACH المنتهي بالأرقام 1842 · Meridian هي التاجر المسؤول عن المعاملة",
    }),
    status: "pending",
    risk: "medium",
    owner: owners.partnerBilling,
    position: { kind: "invoiced", currency: "USD", amountMinor: "6248000" },
    milestone: {
      kind: "invoiceDue",
      invoice: "INV-2026-0781",
      currency: "USD",
      amountMinor: "6248000",
      on: "2026-08-15",
    },
  },
  {
    id: "INV-2026-0712",
    name: demoText({
      en: "June consolidated partner invoice",
      es: "Factura consolidada del socio de junio",
      fr: "Facture partenaire consolidée de juin",
      de: "Konsolidierte Partnerrechnung Juni",
      ja: "6月分パートナー一括請求書",
      pt: "Fatura consolidada do parceiro de junho",
      zh: "6 月合作伙伴合并发票",
      ar: "فاتورة الشريك الموحدة لشهر يونيو",
    }),
    context: demoText({
      en: "11 end clients · receipt RCPT-2026-0712",
      es: "11 clientes finales · recibo RCPT-2026-0712",
      fr: "11 clients finaux · reçu RCPT-2026-0712",
      de: "11 Endkunden · Beleg RCPT-2026-0712",
      ja: "エンド顧客 11社・領収書 RCPT-2026-0712",
      pt: "11 clientes finais · recibo RCPT-2026-0712",
      zh: "11 个终端客户 · 收据 RCPT-2026-0712",
      ar: "11 عميلًا نهائيًا · الإيصال RCPT-2026-0712",
    }),
    status: "paid",
    risk: "low",
    owner: owners.partnerBilling,
    position: { kind: "paid", currency: "USD", amountMinor: "5892000" },
    milestone: { kind: "paymentConfirmed", on: "2026-07-03" },
  },
];

const commissions: readonly PartnerFixture[] = [
  {
    id: "STM-2026-Q3",
    name: demoText({
      en: "Q3 commission statement",
      es: "Liquidación de comisiones del tercer trimestre",
      fr: "Relevé de commissions du troisième trimestre",
      de: "Provisionsabrechnung Q3",
      ja: "第3四半期のコミッション明細書",
      pt: "Demonstrativo de comissões do terceiro trimestre",
      zh: "第三季度佣金结算单",
      ar: "كشف عمولات الربع الثالث",
    }),
    context: demoText({
      en: "34 collections · 2 credits · 1 holdback",
      es: "34 cobros · 2 créditos · 1 retención",
      fr: "34 encaissements · 2 crédits · 1 retenue",
      de: "34 Zahlungseingänge · 2 Gutschriften · 1 Einbehalt",
      ja: "回収 34件・クレジット 2件・留保 1件",
      pt: "34 recebimentos · 2 créditos · 1 valor retido",
      zh: "34 笔收款 · 2 笔抵扣 · 1 笔暂扣款",
      ar: "34 عملية تحصيل · رصيدان دائنان · مبلغ محتجز واحد",
    }),
    status: "pending",
    risk: "medium",
    owner: owners.partnerFinance,
    position: { kind: "accrued", currency: "USD", amountMinor: "1842000" },
    milestone: { kind: "paysAfterCollection" },
  },
  {
    id: "ACC-2026-0712",
    name: demoText({
      en: "Solace referral commission",
      es: "Comisión por recomendación de Solace",
      fr: "Commission d’apport d’affaires Solace",
      de: "Empfehlungsprovision Solace",
      ja: "Solace の紹介コミッション",
      pt: "Comissão de indicação da Solace",
      zh: "Solace 推荐佣金",
      ar: "عمولة إحالة Solace",
    }),
    context: demoText({
      en: "10% of net collected revenue · June invoice",
      es: "10\u00a0% de los ingresos netos cobrados · factura de junio",
      fr: "10\u00a0% du chiffre d’affaires net encaissé · facture de juin",
      de: "10\u00a0% des vereinnahmten Nettoumsatzes · Rechnung Juni",
      ja: "回収済み純収益の10%・6月分の請求書",
      pt: "10% da receita líquida recebida · fatura de junho",
      zh: "已收款净收入的 10% · 6 月发票",
      ar: "10% من صافي الإيرادات المحصّلة · فاتورة يونيو",
    }),
    status: "active",
    risk: "low",
    owner: owners.partnerFinance,
    position: { kind: "earned", currency: "USD", amountMinor: "286000" },
    milestone: { kind: "includedInStatement", statement: "STM-2026-Q3" },
  },
];

const renewals: readonly PartnerFixture[] = [
  {
    id: "REN-EC-0038",
    name: "Halcyon Research Cooperative",
    context: demoText({
      en: "Resale · 280 TB · current term ends Dec 31",
      es: "Reventa · 280 TB · la duración actual termina el 31 de diciembre",
      fr: "Revente · 280 To · la durée en cours se termine le 31 décembre",
      de: "Wiederverkauf · 280 TB · aktuelle Laufzeit endet am 31. Dezember",
      ja: "再販・280 TB・現在の契約期間は12月31日まで",
      pt: "Revenda · 280 TB · o prazo atual termina em 31 de dezembro",
      zh: "转售 · 280 TB · 当前期限至 12 月 31 日",
      ar: "إعادة البيع · 280 تيرابايت · تنتهي المدة الحالية في 31 ديسمبر",
    }),
    status: "attention",
    risk: "high",
    owner: "Juno Okafor",
    position: {
      kind: "transferAndResale",
      currency: "USD",
      transferMinor: "9120000",
      resaleMinor: "11200000",
    },
    milestone: { kind: "noticeActionDue", on: "2026-09-02" },
  },
  {
    id: "REN-EC-0041",
    name: "Solace Public Records",
    context: demoText({
      en: "Referral · 65 TB · current term ends Feb 28",
      es: "Recomendación · 65 TB · la duración actual termina el 28 de febrero",
      fr: "Apport d’affaires · 65 To · la durée en cours se termine le 28 février",
      de: "Empfehlung · 65 TB · aktuelle Laufzeit endet am 28. Februar",
      ja: "紹介・65 TB・現在の契約期間は2月28日まで",
      pt: "Indicação · 65 TB · o prazo atual termina em 28 de fevereiro",
      zh: "推荐 · 65 TB · 当前期限至 2 月 28 日",
      ar: "إحالة · 65 تيرابايت · تنتهي المدة الحالية في 28 فبراير",
    }),
    status: "active",
    risk: "low",
    owner: "Mira Patel",
    position: {
      kind: "annualCollected",
      currency: "USD",
      amountMinor: "2860000",
    },
    milestone: { kind: "noActionUntil", on: "2026-12-01" },
  },
];

const sandboxes: readonly PartnerFixture[] = [
  {
    id: "SBX-2026-014",
    name: demoText({
      en: "Meridian presales lab",
      es: "Laboratorio de preventa de Meridian",
      fr: "Laboratoire d’avant-vente Meridian",
      de: "Presales-Labor von Meridian",
      ja: "Meridian のプリセールス環境",
      pt: "Laboratório de pré-venda da Meridian",
      zh: "Meridian 售前实验环境",
      ar: "مختبر ما قبل البيع لدى Meridian",
    }),
    context: demoText({
      en: "US East · 10 TB cap · named keys",
      es: "EE. UU. Este · límite de 10 TB · claves nominativas",
      fr: "Est des États-Unis · plafond de 10 To · clés nominatives",
      de: "USA Ost · Obergrenze 10 TB · personengebundene Schlüssel",
      ja: "米国東部・上限 10 TB・記名キー",
      pt: "Leste dos EUA · limite de 10 TB · chaves nominais",
      zh: "美国东部 · 上限 10 TB · 实名密钥",
      ar: "شرق الولايات المتحدة · حد أقصى 10 تيرابايت · مفاتيح مخصصة بالاسم",
    }),
    status: "active",
    risk: "low",
    owner: "Juno Okafor",
    position: { kind: "capacityUsed", ratio: 0.42 },
    milestone: { kind: "expires", on: "2026-08-31" },
  },
  {
    id: "POC-2026-021",
    name: demoText({
      en: "Atlas imaging qualification",
      es: "Cualificación de imágenes de Atlas",
      fr: "Qualification de l’imagerie Atlas",
      de: "Imaging-Qualifizierung für Atlas",
      ja: "Atlas 画像処理の評価",
      pt: "Qualificação de imagens da Atlas",
      zh: "Atlas 影像资格评估",
      ar: "تأهيل التصوير لدى Atlas",
    }),
    context: demoText({
      en: "UK South · 14 TB cap · four success tests",
      es: "Reino Unido Sur · límite de 14 TB · cuatro pruebas de éxito",
      fr: "Sud du Royaume-Uni · plafond de 14 To · quatre tests de réussite",
      de: "UK Süd · Obergrenze 14 TB · vier Erfolgstests",
      ja: "英国南部・上限 14 TB・成功条件テスト 4件",
      pt: "Sul do Reino Unido · limite de 14 TB · quatro testes de sucesso",
      zh: "英国南部 · 上限 14 TB · 4 项成功测试",
      ar: "جنوب المملكة المتحدة · حد أقصى 14 تيرابايت · أربعة اختبارات نجاح",
    }),
    status: "attention",
    risk: "medium",
    owner: "Mira Patel",
    position: { kind: "testsPassed", passed: 3, total: 4 },
    milestone: { kind: "finalReportDueToday" },
  },
];

const marketplace: readonly PartnerFixture[] = [
  {
    id: "AWS-OFFER-1948",
    name: demoText({
      en: "Halcyon AWS private offer",
      es: "Oferta privada de AWS para Halcyon",
      fr: "Offre privée AWS pour Halcyon",
      de: "Privates AWS-Angebot für Halcyon",
      ja: "Halcyon 向け AWS プライベートオファー",
      pt: "Oferta privada da AWS para a Halcyon",
      zh: "Halcyon 的 AWS 私有报价",
      ar: "عرض خاص على AWS لصالح Halcyon",
    }),
    context: demoText({
      en: "Resale · Fil One seller enrollment · Meridian commercial owner",
      es: "Reventa · alta de vendedor de Fil One · responsable comercial: Meridian",
      fr: "Revente · inscription vendeur de Fil One · responsable commercial\u00a0: Meridian",
      de: "Wiederverkauf · Verkäuferregistrierung von Fil One · kaufmännisch verantwortlich: Meridian",
      ja: "再販・Fil One の販売者登録・商務担当：Meridian",
      pt: "Revenda · cadastro de vendedor da Fil One · responsável comercial: Meridian",
      zh: "转售 · Fil One 卖家注册 · 商务负责方：Meridian",
      ar: "إعادة البيع · تسجيل Fil One بائعًا · المسؤول التجاري: Meridian",
    }),
    status: "active",
    risk: "low",
    owner: "Juno Okafor",
    position: {
      kind: "buyerPrice",
      currency: "USD",
      amountMinor: "11200000",
    },
    milestone: { kind: "fulfillmentSynced", minutes: 18 },
  },
  {
    id: "AZURE-OFFER-0412",
    name: demoText({
      en: "Atlas Azure private offer",
      es: "Oferta privada de Azure para Atlas",
      fr: "Offre privée Azure pour Atlas",
      de: "Privates Azure-Angebot für Atlas",
      ja: "Atlas 向け Azure プライベートオファー",
      pt: "Oferta privada do Azure para a Atlas",
      zh: "Atlas 的 Azure 私有报价",
      ar: "عرض خاص على Azure لصالح Atlas",
    }),
    context: demoText({
      en: "Two-tier preview · buyer has not accepted",
      es: "Vista previa en dos niveles · el comprador no ha aceptado",
      fr: "Aperçu à deux niveaux · l’acheteur n’a pas accepté",
      de: "Zweistufige Vorschau · Käufer hat nicht angenommen",
      ja: "2階層のプレビュー・購入者は承諾していません",
      pt: "Prévia em dois níveis · o comprador não aceitou",
      zh: "两级预览 · 买方未接受",
      ar: "معاينة على مستويين · لم يقبل المشتري العرض",
    }),
    status: "pending",
    risk: "medium",
    owner: "Juno Okafor",
    position: { kind: "buyerPrice", currency: "GBP", amountMinor: "3840000" },
    milestone: { kind: "providerIsAcceptanceSource" },
  },
];

const brand: readonly PartnerFixture[] = [
  {
    id: "BRAND-MERIDIAN",
    name: demoText({
      en: "Meridian resale experience",
      es: "Experiencia de reventa de Meridian",
      fr: "Expérience de revente Meridian",
      de: "Wiederverkaufsauftritt von Meridian",
      ja: "Meridian の再販向け表示",
      pt: "Experiência de revenda da Meridian",
      zh: "Meridian 转售展示",
      ar: "تجربة إعادة البيع لدى Meridian",
    }),
    context: demoText({
      en: "quotes.meridian.example · partner commercial contact",
      es: "quotes.meridian.example · contacto comercial del socio",
      fr: "quotes.meridian.example · contact commercial du partenaire",
      de: "quotes.meridian.example · kaufmännischer Kontakt des Partners",
      ja: "quotes.meridian.example・パートナーの商務窓口",
      pt: "quotes.meridian.example · contato comercial do parceiro",
      zh: "quotes.meridian.example · 合作伙伴商务联系人",
      ar: "quotes.meridian.example · جهة الاتصال التجارية لدى الشريك",
    }),
    status: "active",
    risk: "low",
    owner: owners.partnerAdmin,
    position: { kind: "domainVerified" },
    milestone: { kind: "legalEntityDisclosed" },
  },
  {
    id: "DNS-ATLAS",
    name: demoText({
      en: "Atlas custom quote domain",
      es: "Dominio personalizado de presupuestos de Atlas",
      fr: "Domaine personnalisé des devis Atlas",
      de: "Eigene Angebotsdomain von Atlas",
      ja: "Atlas の見積もり用独自ドメイン",
      pt: "Domínio personalizado de cotações da Atlas",
      zh: "Atlas 报价自定义域名",
      ar: "نطاق مخصص لعروض أسعار Atlas",
    }),
    context: demoText({
      en: "DNS verification delegated to domain administrator",
      es: "Verificación DNS delegada en el administrador del dominio",
      fr: "Vérification DNS déléguée à l’administrateur du domaine",
      de: "DNS-Prüfung an den Domainadministrator delegiert",
      ja: "DNS 検証はドメイン管理者に委任",
      pt: "Verificação de DNS delegada ao administrador do domínio",
      zh: "DNS 验证已委托给域名管理员",
      ar: "فُوِّض التحقق من DNS إلى مسؤول النطاق",
    }),
    status: "blocked",
    risk: "medium",
    owner: owners.partnerAdmin,
    position: { kind: "externalGate" },
    milestone: { kind: "addTxtRecord" },
  },
];

const support: readonly PartnerFixture[] = [
  {
    id: "SUP-18421",
    name: demoText({
      en: "Halcyon restore sample timing",
      es: "Tiempos de la muestra de restauración de Halcyon",
      fr: "Délai de l’échantillon de restauration Halcyon",
      de: "Dauer der Wiederherstellungsprobe für Halcyon",
      ja: "Halcyon の復元サンプルの所要時間",
      pt: "Prazo da amostra de restauração da Halcyon",
      zh: "Halcyon 恢复样本耗时",
      ar: "توقيت عينة الاستعادة لدى Halcyon",
    }),
    context: demoText({
      en: "End-client-visible summary · standard priority",
      es: "Resumen visible para el cliente final · prioridad estándar",
      fr: "Résumé visible par le client final · priorité standard",
      de: "Für den Endkunden sichtbare Zusammenfassung · Standardpriorität",
      ja: "エンド顧客に表示される概要・通常の優先度",
      pt: "Resumo visível para o cliente final · prioridade padrão",
      zh: "终端客户可见的摘要 · 标准优先级",
      ar: "ملخص يراه العميل النهائي · أولوية عادية",
    }),
    status: "active",
    risk: "low",
    owner: owners.filOneSupport,
    position: { kind: "updatedMinutesAgo", minutes: 28 },
    milestone: { kind: "supportSystemIsSource" },
  },
  {
    id: "SUP-18307",
    name: demoText({
      en: "Atlas EU usage export",
      es: "Exportación del uso en la UE de Atlas",
      fr: "Export de l’utilisation UE d’Atlas",
      de: "EU-Nutzungsexport für Atlas",
      ja: "Atlas の EU 利用状況のエクスポート",
      pt: "Exportação do uso na UE da Atlas",
      zh: "Atlas 欧盟用量导出",
      ar: "تصدير بيانات استخدام الاتحاد الأوروبي لدى Atlas",
    }),
    context: demoText({
      en: "Partner-visible only · awaiting end-client details",
      es: "Solo visible para el socio · pendiente de datos del cliente final",
      fr: "Visible uniquement par le partenaire · en attente d’informations du client final",
      de: "Nur für den Partner sichtbar · Angaben des Endkunden ausstehend",
      ja: "パートナーのみに表示・エンド顧客からの詳細待ち",
      pt: "Visível somente para o parceiro · aguardando dados do cliente final",
      zh: "仅合作伙伴可见 · 等待终端客户提供详情",
      ar: "مرئي للشريك فقط · بانتظار تفاصيل العميل النهائي",
    }),
    status: "pending",
    risk: "medium",
    owner: "Juno Okafor",
    position: { kind: "normalPriority" },
    milestone: { kind: "replyInSupportProvider" },
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
