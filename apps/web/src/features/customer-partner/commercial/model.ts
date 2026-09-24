import type { Route } from "next";

import {
  demoText,
  resolveDemoText,
  type DemoTextField,
} from "@clockwork/testing/demo-localized-text";

import type { MessageId } from "@/src/i18n";

import { projectionCompat } from "./projection-compat";
import { readCommercialFacts, type CommercialFacts } from "./record-facts";

export const collectionKinds = [
  "agreements",
  "quotes",
  "orders",
  "services",
  "pocs",
  "billing",
] as const;

export type CollectionKind = (typeof collectionKinds)[number];
export type CommercialRisk = "low" | "medium" | "high";
export type CommercialTone = "neutral" | "success" | "warning" | "danger";

export const orderLifecycleStatuses = [
  "submitted",
  "accepted",
  "provisioning",
  "active",
  "amended",
  "completed",
  "cancelled",
  "terminated",
] as const;
export type OrderLifecycleStatus = (typeof orderLifecycleStatuses)[number];

export function isOrderLifecycleStatus(
  value: unknown,
): value is OrderLifecycleStatus {
  return (
    typeof value === "string" &&
    (orderLifecycleStatuses as readonly string[]).includes(value)
  );
}

export interface CommercialRecord {
  id: string;
  kind: CollectionKind;
  title: string;
  description: string;
  status: string;
  statusLabel: string;
  tone: CommercialTone;
  risk: CommercialRisk;
  owner: string;
  value: string;
  valueLabel: string;
  updatedAt: string;
  dateLabel: string;
  href: string;
  term: string;
  nextAction: string;
  nextActionHref?: string;
  /** Customer-facing agreement version or quote revision, never a row lock. */
  version?: string;
  /** Customer-facing reference when it differs from the projection record key. */
  reference?: string;
  /** Projection concurrency evidence, rendered only under Technical details. */
  projectionVersion?: number;
  projectionId?: string;
  aggregateId?: string;
  allowedActions?: readonly string[];
  /** Present only for orders whose authoritative payload carries a known state. */
  orderLifecycleStatus?: OrderLifecycleStatus | null;
  /** Orders the value column when the value is a formatted string. */
  valueSort?: number;
  /**
   * The record's display facts. When present, every surface renders the
   * display strings above from these, in the reader's language
   * (`record-presentation.ts`); when absent the strings are shown as written.
   */
  facts?: CommercialFacts;
}

/** Collection chrome is message IDs; the page renders each with `t`. */
export interface CollectionDefinition {
  kind: CollectionKind;
  eyebrow: MessageId;
  title: MessageId;
  description: MessageId;
  rule: MessageId;
  searchPlaceholder: MessageId;
  primaryAction?: { label: MessageId; href: Route };
}

export const collectionDefinitions: Record<
  CollectionKind,
  CollectionDefinition
> = {
  agreements: {
    kind: "agreements",
    eyebrow: "customer.commercial.collection.agreements.eyebrow",
    title: "customer.commercial.collection.agreements.title",
    description: "customer.commercial.collection.agreements.description",
    rule: "customer.commercial.collection.agreements.rule",
    searchPlaceholder: "customer.commercial.collection.agreements.search",
    primaryAction: {
      label: "customer.commercial.collection.agreements.primary",
      href: "/agreements/execute",
    },
  },
  quotes: {
    kind: "quotes",
    eyebrow: "customer.commercial.collection.quotes.eyebrow",
    title: "customer.commercial.collection.quotes.title",
    description: "customer.commercial.collection.quotes.description",
    rule: "customer.commercial.collection.quotes.rule",
    searchPlaceholder: "customer.commercial.collection.quotes.search",
    primaryAction: {
      label: "customer.commercial.collection.quotes.primary",
      href: "/quotes/new",
    },
  },
  orders: {
    kind: "orders",
    eyebrow: "customer.commercial.collection.orders.eyebrow",
    title: "customer.commercial.collection.orders.title",
    description: "customer.commercial.collection.orders.description",
    rule: "customer.commercial.collection.orders.rule",
    searchPlaceholder: "customer.commercial.collection.orders.search",
    primaryAction: {
      label: "customer.commercial.collection.orders.primary",
      href: "/orders/accept",
    },
  },
  services: {
    kind: "services",
    eyebrow: "customer.commercial.collection.services.eyebrow",
    title: "customer.commercial.collection.services.title",
    description: "customer.commercial.collection.services.description",
    rule: "customer.commercial.collection.services.rule",
    searchPlaceholder: "customer.commercial.collection.services.search",
  },
  pocs: {
    kind: "pocs",
    eyebrow: "customer.commercial.collection.pocs.eyebrow",
    title: "customer.commercial.collection.pocs.title",
    description: "customer.commercial.collection.pocs.description",
    rule: "customer.commercial.collection.pocs.rule",
    searchPlaceholder: "customer.commercial.collection.pocs.search",
  },
  billing: {
    kind: "billing",
    eyebrow: "customer.commercial.collection.billing.eyebrow",
    title: "customer.commercial.collection.billing.title",
    description: "customer.commercial.collection.billing.description",
    rule: "customer.commercial.collection.billing.rule",
    searchPlaceholder: "customer.commercial.collection.billing.search",
  },
};

/** Facts as a fixture writes them: the context line in every language. */
export type CommercialFixtureFacts = Omit<CommercialFacts, "description"> & {
  readonly description?: DemoTextField;
};

/**
 * A demo commercial record as it is stored, before the demo read boundary
 * resolves its demo-authored text for one reader.
 *
 * Record titles and team names stand in for text a person would type, so they
 * are `demoText` (translation policy rule 4); people's names are not. Agreement
 * titles are the names of the legal documents themselves, whose language is
 * the account's (rule 5), so they stay as the document states them.
 * Everything the product itself says about the record is in `facts`.
 */
export interface CommercialFixture {
  id: string;
  kind: CollectionKind;
  title: DemoTextField;
  status: string;
  tone: CommercialTone;
  risk: CommercialRisk;
  owner: DemoTextField;
  updatedAt: string;
  href: string;
  version?: string;
  facts: CommercialFixtureFacts;
}

const legalTeam = demoText({
  en: "Legal team",
  es: "Equipo jurídico",
  fr: "Équipe juridique",
  de: "Rechtsabteilung",
  ja: "法務チーム",
  pt: "Equipe jurídica",
  zh: "法务团队",
  ar: "الفريق القانوني",
});
const serviceOperations = demoText({
  en: "Service operations",
  es: "Operaciones de servicio",
  fr: "Opérations du service",
  de: "Servicebetrieb",
  ja: "サービス運用チーム",
  pt: "Operações do serviço",
  zh: "服务运营团队",
  ar: "فريق عمليات الخدمة",
});
const accountsPayable = demoText({
  en: "Accounts payable",
  es: "Cuentas a pagar",
  fr: "Comptabilité fournisseurs",
  de: "Kreditorenbuchhaltung",
  ja: "買掛金担当",
  pt: "Contas a pagar",
  zh: "应付账款团队",
  ar: "فريق الحسابات الدائنة",
});
const northstarPrimaryArchive = demoText({
  en: "Northstar primary archive",
  es: "Archivo principal de Northstar",
  fr: "Archive principale Northstar",
  de: "Northstar-Primärarchiv",
  ja: "Northstar のプライマリーアーカイブ",
  pt: "Arquivo principal da Northstar",
  zh: "Northstar 主归档",
  ar: "الأرشيف الرئيسي لشركة Northstar",
});
const madridComplianceReplica = demoText({
  en: "Madrid compliance replica",
  es: "Réplica de cumplimiento en Madrid",
  fr: "Réplique de conformité de Madrid",
  de: "Compliance-Replikat Madrid",
  ja: "マドリードのコンプライアンス用レプリカ",
  pt: "Réplica de conformidade de Madri",
  zh: "马德里合规副本",
  ar: "النسخة المتماثلة للامتثال في مدريد",
});

const fixtures: readonly CommercialFixture[] = [
  {
    id: "AGR-2026-0042",
    kind: "agreements",
    title: "Cloud Service Agreement", // i18n-exempt: legal document title, in the account's contract language (policy rule 5)
    status: "active",
    tone: "success",
    risk: "low",
    owner: "Maya Chen",
    updatedAt: "2026-07-30T15:40:00Z",
    href: "/agreements/AGR-2026-0042",
    version: "3.2",
    facts: {
      status: "active",
      description: demoText({
        en: "Fil One paper · signed",
        es: "Contrato de Fil One · firmado",
        fr: "Modèle Fil One · signé",
        de: "Vorlage von Fil One · unterzeichnet",
        ja: "Fil One のひな形・署名済み",
        pt: "Modelo da Fil One · assinado",
        zh: "Fil One 范本 · 已签署",
        ar: "نموذج Fil One · موقّع",
      }),
      value: { kind: "date", on: "2026-12-31" },
      valueLabel: "termEnd",
      timing: { kind: "updated", on: "2026-07-30" },
      term: {
        kind: "period",
        start: "2026-01-01",
        end: "2026-12-31",
        noticeOn: "2026-11-01",
      },
      next: { kind: "noActionDue" },
    },
  },
  {
    id: "AGR-2026-0061",
    kind: "agreements",
    title: "Customer security addendum", // i18n-exempt: legal document title of the customer's own paper (policy rule 5)
    status: "review",
    tone: "warning",
    risk: "high",
    owner: legalTeam,
    updatedAt: "2026-07-31T12:10:00Z",
    href: "/agreements/AGR-2026-0061",
    version: "1.4",
    facts: {
      status: "review",
      description: demoText({
        en: "Customer paper · four key terms in legal review",
        es: "Contrato del cliente · cuatro cláusulas clave en revisión jurídica",
        fr: "Contrat du client · quatre clauses clés en revue juridique",
        de: "Vertragspapier des Kunden · vier Kernklauseln in rechtlicher Prüfung",
        ja: "顧客側の契約書・主要条項4件を法務確認中",
        pt: "Contrato do cliente · quatro cláusulas principais em revisão jurídica",
        zh: "客户合同文本 · 4 项关键条款正在法务审核",
        ar: "عقد العميل · أربعة بنود رئيسية قيد المراجعة القانونية",
      }),
      value: { kind: "date", on: "2026-08-05" },
      valueLabel: "responseDue",
      timing: { kind: "updated", on: "2026-07-31" },
      term: { kind: "pendingExecution" },
      next: { kind: "reviewNegotiatedTerms" },
    },
  },
  {
    id: "AGR-2026-0017",
    kind: "agreements",
    title: "Data Processing Addendum", // i18n-exempt: legal document title, in the account's contract language (policy rule 5)
    status: "active",
    tone: "success",
    risk: "low",
    owner: "Maya Chen",
    updatedAt: "2026-07-28T09:00:00Z",
    href: "/agreements/AGR-2026-0017",
    version: "2.1",
    facts: {
      status: "active",
      description: demoText({
        en: "EU variant · attached to the governing agreement",
        es: "Variante UE · vinculada al acuerdo aplicable",
        fr: "Variante UE · rattachée à l’accord applicable",
        de: "EU-Variante · Anhang zur maßgeblichen Vereinbarung",
        ja: "EU 版・適用契約に付属",
        pt: "Variante UE · vinculada ao acordo aplicável",
        zh: "欧盟版本 · 附属于适用协议",
        ar: "نسخة الاتحاد الأوروبي · ملحقة بالاتفاقية الحاكمة",
      }),
      value: { kind: "date", on: "2027-06-30" },
      valueLabel: "termEnd",
      timing: { kind: "updated", on: "2026-07-28" },
      term: { kind: "coterminous", agreement: "Cloud Service Agreement" }, // i18n-exempt: legal document title (policy rule 5)
      next: { kind: "noActionDue" },
    },
  },
  {
    id: "Q-2026-0184-v3",
    kind: "quotes",
    title: demoText({
      en: "Enterprise committed capacity",
      es: "Capacidad contratada empresarial",
      fr: "Capacité souscrite Entreprise",
      de: "Vertraglich zugesagte Kapazität (Enterprise)",
      ja: "エンタープライズ向け契約容量",
      pt: "Capacidade contratada corporativa",
      zh: "企业承诺容量",
      ar: "سعة متعاقد عليها للمؤسسات",
    }),
    status: "open",
    tone: "warning",
    risk: "medium",
    owner: "Maya Chen",
    updatedAt: "2026-07-31T13:20:00Z",
    href: "/quotes/Q-2026-0184-v3",
    version: "3",
    facts: {
      status: "open",
      description: demoText({
        en: "400 TB · US East · annual · direct",
        es: "400 TB · EE. UU. Este · anual · venta directa",
        fr: "400 To · Est des États-Unis · annuel · vente directe",
        de: "400 TB · USA Ost · jährlich · Direktvertrieb",
        ja: "400 TB・米国東部・年間・直接販売",
        pt: "400 TB · Leste dos EUA · anual · venda direta",
        zh: "400 TB · 美国东部 · 年度 · 直销",
        ar: "400 تيرابايت · شرق الولايات المتحدة · سنوي · بيع مباشر",
      }),
      value: { kind: "money", currency: "USD", amountMinor: "18480000" },
      valueLabel: "estimatedAnnualSpend",
      timing: { kind: "expires", on: "2026-08-04" },
      term: { kind: "quote", months: 12, expiresOn: "2026-08-04" },
      next: { kind: "acceptOrCancelBeforeExpiry" },
    },
  },
  {
    id: "Q-2026-0171-v1",
    kind: "quotes",
    title: demoText({
      en: "Annual business expansion",
      es: "Ampliación anual del negocio",
      fr: "Extension annuelle de l’activité",
      de: "Jährliche Geschäftserweiterung",
      ja: "年間の事業拡大",
      pt: "Expansão anual do negócio",
      zh: "年度业务扩展",
      ar: "التوسع السنوي للأعمال",
    }),
    status: "draft",
    tone: "neutral",
    risk: "low",
    owner: "Jordan Lee",
    updatedAt: "2026-07-29T10:30:00Z",
    href: "/quotes/Q-2026-0171-v1",
    version: "1",
    facts: {
      status: "draft",
      description: demoText({
        en: "80 TB · EU West · monthly commit · direct",
        es: "80 TB · UE Oeste · compromiso mensual · venta directa",
        fr: "80 To · Ouest de l’UE · engagement mensuel · vente directe",
        de: "80 TB · EU West · monatliche Zusage · Direktvertrieb",
        ja: "80 TB・EU 西部・月間コミット・直接販売",
        pt: "80 TB · Oeste da UE · compromisso mensal · venda direta",
        zh: "80 TB · 欧盟西部 · 按月承诺 · 直销",
        ar: "80 تيرابايت · غرب الاتحاد الأوروبي · التزام شهري · بيع مباشر",
      }),
      value: { kind: "money", currency: "EUR", amountMinor: "3168000" },
      valueLabel: "estimatedAnnualSpend",
      timing: { kind: "updated", on: "2026-07-29" },
      term: { kind: "quote", months: 12 },
      next: { kind: "finishAndIssueQuote" },
    },
  },
  {
    id: "Q-2026-0165-v2",
    kind: "quotes",
    title: demoText({
      en: "Compliance replica renewal",
      es: "Renovación de la réplica de cumplimiento",
      fr: "Renouvellement de la réplique de conformité",
      de: "Verlängerung des Compliance-Replikats",
      ja: "コンプライアンス用レプリカの契約更新",
      pt: "Renovação da réplica de conformidade",
      zh: "合规副本续约",
      ar: "تجديد النسخة المتماثلة للامتثال",
    }),
    status: "accepted",
    tone: "success",
    risk: "low",
    owner: "Maya Chen",
    updatedAt: "2026-07-25T14:00:00Z",
    href: "/quotes/Q-2026-0165-v2",
    version: "2",
    facts: {
      status: "accepted",
      description: demoText({
        en: "120 TB · UK South · annual · direct",
        es: "120 TB · Reino Unido Sur · anual · venta directa",
        fr: "120 To · Sud du Royaume-Uni · annuel · vente directe",
        de: "120 TB · UK Süd · jährlich · Direktvertrieb",
        ja: "120 TB・英国南部・年間・直接販売",
        pt: "120 TB · Sul do Reino Unido · anual · venda direta",
        zh: "120 TB · 英国南部 · 年度 · 直销",
        ar: "120 تيرابايت · جنوب المملكة المتحدة · سنوي · بيع مباشر",
      }),
      value: { kind: "money", currency: "USD", amountMinor: "5544000" },
      valueLabel: "acceptedEstimatedSpend",
      timing: { kind: "accepted", on: "2026-07-25" },
      term: { kind: "quote", months: 12, acceptedOn: "2026-07-25" },
      next: { kind: "reviewAndAcceptOrder" },
    },
  },
  {
    id: "Q-2026-0140-v1",
    kind: "quotes",
    title: demoText({
      en: "Short-term migration buffer",
      es: "Reserva temporal para migración",
      fr: "Capacité tampon de migration à court terme",
      de: "Kurzfristiger Migrationspuffer",
      ja: "短期の移行用バッファー",
      pt: "Reserva temporária para migração",
      zh: "短期迁移缓冲容量",
      ar: "سعة احتياطية مؤقتة للترحيل",
    }),
    status: "canceled",
    tone: "neutral",
    risk: "low",
    owner: "Maya Chen",
    updatedAt: "2026-07-18T11:00:00Z",
    href: "/quotes/Q-2026-0140-v1",
    version: "1",
    facts: {
      status: "canceled",
      description: demoText({
        en: "40 TB · US East · three months · direct",
        es: "40 TB · EE. UU. Este · tres meses · venta directa",
        fr: "40 To · Est des États-Unis · trois mois · vente directe",
        de: "40 TB · USA Ost · drei Monate · Direktvertrieb",
        ja: "40 TB・米国東部・3か月・直接販売",
        pt: "40 TB · Leste dos EUA · três meses · venda direta",
        zh: "40 TB · 美国东部 · 三个月 · 直销",
        ar: "40 تيرابايت · شرق الولايات المتحدة · ثلاثة أشهر · بيع مباشر",
      }),
      value: { kind: "money", currency: "USD", amountMinor: "462000" },
      valueLabel: "canceledEstimate",
      timing: { kind: "canceled", on: "2026-07-18" },
      term: { kind: "canceledBeforeAcceptance" },
      next: { kind: "noActionsAvailable" },
    },
  },
  {
    id: "ORD-2026-0098",
    kind: "orders",
    title: northstarPrimaryArchive,
    status: "active",
    tone: "success",
    risk: "low",
    owner: serviceOperations,
    updatedAt: "2026-07-31T14:10:00Z",
    href: "/orders/ORD-2026-0098",
    facts: {
      status: "active",
      description: demoText({
        en: "500 TB · US East · direct",
        es: "500 TB · EE. UU. Este · venta directa",
        fr: "500 To · Est des États-Unis · vente directe",
        de: "500 TB · USA Ost · Direktvertrieb",
        ja: "500 TB・米国東部・直接販売",
        pt: "500 TB · Leste dos EUA · venda direta",
        zh: "500 TB · 美国东部 · 直销",
        ar: "500 تيرابايت · شرق الولايات المتحدة · بيع مباشر",
      }),
      purchaseOrder: "PO-NA-1048",
      value: { kind: "money", currency: "USD", amountMinor: "18480000" },
      valueLabel: "committedAnnualSpend",
      timing: { kind: "started", on: "2026-01-01" },
      term: {
        kind: "period",
        start: "2026-01-01",
        end: "2026-12-31",
        autoRenews: true,
      },
      next: { kind: "renewalNoticeOpens", on: "2026-11-01" },
    },
  },
  {
    id: "ORD-2026-0112",
    kind: "orders",
    title: madridComplianceReplica,
    status: "provisioning",
    tone: "warning",
    risk: "medium",
    owner: serviceOperations,
    updatedAt: "2026-07-31T14:00:00Z",
    href: "/orders/ORD-2026-0112",
    facts: {
      status: "provisioning",
      description: demoText({
        en: "120 TB · EU West · direct",
        es: "120 TB · UE Oeste · venta directa",
        fr: "120 To · Ouest de l’UE · vente directe",
        de: "120 TB · EU West · Direktvertrieb",
        ja: "120 TB・EU 西部・直接販売",
        pt: "120 TB · Oeste da UE · venda direta",
        zh: "120 TB · 欧盟西部 · 直销",
        ar: "120 تيرابايت · غرب الاتحاد الأوروبي · بيع مباشر",
      }),
      purchaseOrder: "PO-NA-1081",
      value: { kind: "money", currency: "USD", amountMinor: "5544000" },
      valueLabel: "committedAnnualSpend",
      timing: { kind: "starts", on: "2026-08-01" },
      term: { kind: "period", start: "2026-08-01", end: "2027-07-31" },
      next: { kind: "completeProvisioningChecklist" },
    },
  },
  {
    id: "SVC-PRIMARY-01",
    kind: "services",
    title: northstarPrimaryArchive,
    status: "active",
    tone: "success",
    risk: "low",
    owner: serviceOperations,
    updatedAt: "2026-07-31T15:42:00Z",
    href: "/orders/ORD-2026-0098",
    facts: {
      status: "active",
      description: demoText({
        en: "500 TB committed · 311 TB stored · US East",
        es: "500 TB contratados · 311 TB almacenados · EE. UU. Este",
        fr: "500 To souscrits · 311 To stockés · Est des États-Unis",
        de: "500 TB vertraglich zugesagt · 311 TB gespeichert · USA Ost",
        ja: "契約容量 500 TB・保存済み 311 TB・米国東部",
        pt: "500 TB contratados · 311 TB armazenados · Leste dos EUA",
        zh: "承诺容量 500 TB · 已存储 311 TB · 美国东部",
        ar: "500 تيرابايت متعاقد عليها · 311 تيرابايت مخزّنة · شرق الولايات المتحدة",
      }),
      value: { kind: "capacityUsed", ratio: 0.62 },
      valueLabel: "capacityUsage",
      timing: { kind: "metered", on: "2026-07-31" },
      term: { kind: "endsOn", on: "2026-12-31" },
      next: { kind: "noActionDue" },
    },
  },
  {
    id: "SVC-REPLICA-02",
    kind: "services",
    title: madridComplianceReplica,
    status: "provisioning",
    tone: "warning",
    risk: "medium",
    owner: serviceOperations,
    updatedAt: "2026-07-31T14:00:00Z",
    href: "/orders/ORD-2026-0112",
    facts: {
      status: "provisioning",
      description: demoText({
        en: "120 TB committed · provisioning at 78% · EU West",
        es: "120 TB contratados · aprovisionamiento al 78\u00a0% · UE Oeste",
        fr: "120 To souscrits · provisionnement à 78\u202f% · Ouest de l’UE",
        de: "120 TB vertraglich zugesagt · Bereitstellung zu 78\u00a0% · EU West",
        ja: "契約容量 120 TB・プロビジョニング 78%・EU 西部",
        pt: "120 TB contratados · provisionamento em 78% · Oeste da UE",
        zh: "承诺容量 120 TB · 开通进度 78% · 欧盟西部",
        ar: "120 تيرابايت متعاقد عليها · اكتملت التهيئة بنسبة 78% · غرب الاتحاد الأوروبي",
      }),
      value: { kind: "provisioningReady", ratio: 0.78 },
      valueLabel: "provisioning",
      timing: { kind: "updated", on: "2026-07-31" },
      term: { kind: "startsOn", on: "2026-08-01" },
      next: { kind: "confirmEncryptionKeyHandoff" },
    },
  },
  {
    id: "POC-2026-0031",
    kind: "pocs",
    title: demoText({
      en: "Telemetry archive recovery",
      es: "Recuperación del archivo de telemetría",
      fr: "Restauration de l’archive de télémétrie",
      de: "Wiederherstellung des Telemetriearchivs",
      ja: "テレメトリーアーカイブの復旧",
      pt: "Recuperação do arquivo de telemetria",
      zh: "遥测归档恢复",
      ar: "استعادة أرشيف القياس عن بُعد",
    }),
    status: "active",
    tone: "success",
    risk: "medium",
    owner: "Amina Cole",
    updatedAt: "2026-07-31T11:20:00Z",
    href: "/pocs/POC-2026-0031",
    facts: {
      status: "active",
      description: demoText({
        en: "20 TB cap · confidential data permitted",
        es: "Límite de 20 TB · se admiten datos confidenciales",
        fr: "Plafond de 20 To · données confidentielles autorisées",
        de: "Obergrenze 20 TB · vertrauliche Daten zulässig",
        ja: "上限 20 TB・機密データ可",
        pt: "Limite de 20 TB · dados confidenciais permitidos",
        zh: "上限 20 TB · 允许机密数据",
        ar: "الحد الأقصى 20 تيرابايت · يُسمح بالبيانات السرية",
      }),
      value: { kind: "daysLeft", days: 7 },
      valueLabel: "timeRemaining",
      timing: { kind: "expires", on: "2026-08-07" },
      term: { kind: "pocExpires", on: "2026-08-07" },
      next: { kind: "completeRestoreValidation" },
    },
  },
  {
    id: "POC-2026-0024",
    kind: "pocs",
    title: demoText({
      en: "Immutable legal records",
      es: "Registros jurídicos inmutables",
      fr: "Documents juridiques immuables",
      de: "Unveränderliche Rechtsdokumente",
      ja: "改ざん不可の法務記録",
      pt: "Registros jurídicos imutáveis",
      zh: "不可篡改的法律记录",
      ar: "سجلات قانونية غير قابلة للتعديل",
    }),
    status: "complete",
    tone: "success",
    risk: "low",
    owner: "Amina Cole",
    updatedAt: "2026-07-27T15:00:00Z",
    href: "/pocs/POC-2026-0024",
    facts: {
      status: "complete",
      description: demoText({
        en: "12 TB · four of four success tests passed",
        es: "12 TB · superadas las cuatro pruebas de éxito",
        fr: "12 To · quatre critères de réussite validés sur quatre",
        de: "12 TB · vier von vier Erfolgstests bestanden",
        ja: "12 TB・成功基準テスト4件中4件に合格",
        pt: "12 TB · quatro de quatro testes de sucesso aprovados",
        zh: "12 TB · 4 项成功标准测试全部通过",
        ar: "12 تيرابايت · اجتياز أربعة من أربعة اختبارات نجاح",
      }),
      value: { kind: "readyToConvert" },
      valueLabel: "outcome",
      timing: { kind: "completed", on: "2026-07-27" },
      term: { kind: "evaluationComplete" },
      next: { kind: "reviewPaidConversion" },
    },
  },
  {
    id: "INV-2026-0781",
    kind: "billing",
    title: demoText({
      en: "July committed capacity",
      es: "Capacidad contratada de julio",
      fr: "Capacité souscrite de juillet",
      de: "Vertraglich zugesagte Kapazität Juli",
      ja: "7月分の契約容量",
      pt: "Capacidade contratada de julho",
      zh: "7 月承诺容量",
      ar: "السعة المتعاقد عليها لشهر يوليو",
    }),
    status: "open",
    tone: "warning",
    risk: "medium",
    owner: accountsPayable,
    updatedAt: "2026-07-31T08:00:00Z",
    href: "/billing/INV-2026-0781",
    facts: {
      status: "open",
      description: demoText({
        en: "Invoice for Northstar primary archive",
        es: "Factura del archivo principal de Northstar",
        fr: "Facture de l’archive principale Northstar",
        de: "Rechnung für das Northstar-Primärarchiv",
        ja: "Northstar のプライマリーアーカイブの請求書",
        pt: "Fatura do arquivo principal da Northstar",
        zh: "Northstar 主归档发票",
        ar: "فاتورة الأرشيف الرئيسي لشركة Northstar",
      }),
      purchaseOrder: "PO-NA-1048",
      value: { kind: "money", currency: "USD", amountMinor: "1540000" },
      valueLabel: "invoicedAmount",
      timing: { kind: "due", on: "2026-08-08" },
      term: { kind: "servicePeriod", start: "2026-07-01", end: "2026-07-31" },
      next: { kind: "reviewAndPayBy", on: "2026-08-08" },
    },
  },
  {
    id: "INV-2026-0712",
    kind: "billing",
    title: demoText({
      en: "June committed capacity",
      es: "Capacidad contratada de junio",
      fr: "Capacité souscrite de juin",
      de: "Vertraglich zugesagte Kapazität Juni",
      ja: "6月分の契約容量",
      pt: "Capacidade contratada de junho",
      zh: "6 月承诺容量",
      ar: "السعة المتعاقد عليها لشهر يونيو",
    }),
    status: "paid",
    tone: "success",
    risk: "low",
    owner: accountsPayable,
    updatedAt: "2026-07-03T16:25:00Z",
    href: "/billing/INV-2026-0712",
    facts: {
      status: "paid",
      receipt: { reference: "RCPT-2026-0712", last4: "1842" },
      value: { kind: "money", currency: "USD", amountMinor: "1540000" },
      valueLabel: "invoicedAmount",
      timing: { kind: "providerConfirmed", on: "2026-07-03" },
      term: { kind: "servicePeriod", start: "2026-06-01", end: "2026-06-30" },
      next: { kind: "noActionDue" },
    },
  },
];

/**
 * The demo commercial records, in the shape the projection channels carry.
 *
 * Each record carries its facts beside the English display strings that
 * projection consumers which do not read facts still require
 * (`projection-compat.ts`). The commercial surfaces render the facts.
 */
export const commercialRecords = fixtures.map((fixture) => ({
  ...fixture,
  ...(projectionCompat[fixture.id] ?? {}),
}));

/**
 * The fixtures as one reader's `CommercialRecord`s: demo-authored text
 * resolved and facts attached, the way the demo read boundary and the portal
 * loader would hand them to a surface. Used by tests and stories.
 */
export function recordsFor(
  kind: CollectionKind,
  locale: string,
): readonly CommercialRecord[] {
  return commercialRecords
    .filter((record) => record.kind === kind)
    .map((record) => {
      const resolved = resolveDemoText(record, locale);
      const facts = readCommercialFacts(resolved.facts);
      return {
        ...resolved,
        ...(facts ? { facts } : {}),
      } as CommercialRecord;
    });
}

export function recordById(
  id: string,
  locale: string,
): CommercialRecord | undefined {
  const record = commercialRecords.find((candidate) => candidate.id === id);
  return record
    ? recordsFor(record.kind, locale).find((r) => r.id === id)
    : undefined;
}
