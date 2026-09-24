import type { AcceptedOrder } from "@clockwork/domain/core";
import {
  demoText,
  type DemoLocalizedText,
} from "@clockwork/testing/demo-localized-text";
import { demoAccountIds } from "@clockwork/testing/personas";

import { formatMoney } from "@/src/features/shared/format";

import { demoUuid } from "./demo-artifact-catalog";
import {
  ago,
  dateRange,
  demoMessage,
  inMonth,
  money,
  onDate,
  onDay,
  percent,
  terabytes,
  type DemoFact,
  type DemoMessage,
} from "./demo-message";
import type { ExperienceAudience, ProjectionChannel } from "./model";

/**
 * The demo's per-account portal records.
 *
 * Two things live here, and both exist because the demo used to be MORE
 * PERMISSIVE than the product.
 *
 * 1. `demoRecordAccounts` names the account that owns each record in the shared
 *    fixture arrays. The persisted projection filters `audience_account_id` and
 *    the row policy repeats the test, so a demo that answered every persona
 *    with every record was showing something the product refuses.
 *
 * 2. `demoAdditionalRecords` is what makes that filter safe to switch on.
 *    Refusing a read is only correct when the reader has their own records to
 *    read; a filter that emptied six of the nine personas' portals would be a
 *    control that blocks legitimate work, which is the worse failure. Every
 *    account that can reach a surface has a record on it, and the demo journeys
 *    each land on a record that exists.
 */

const DIRECT = demoAccountIds.direct;
const REFERRAL = demoAccountIds.referral;
const RESELLER = demoAccountIds.reseller;
const DISTRIBUTOR = demoAccountIds.distributor;
const END_CLIENT = demoAccountIds.endClient;
const UK_END_CLIENT = demoAccountIds.ukEndClient;

const updatedAt = "2026-07-31T15:00:00.000Z";
const MERIDIAN_ORDER_ID = demoUuid("subject:order:ORD-2026-0098");
const MERIDIAN_INVOICE_ID = demoUuid("subject:invoice:INV-2026-0781");
const RENEWAL_REPORT_ID = demoUuid("subject:report_export:RPT-2026-07");
const RENEWAL_REPORT_DOCUMENT_ID = demoUuid(
  "document:report_export:RPT-2026-07",
);

export interface DemoPortalRecord {
  readonly audience: ExperienceAudience;
  readonly channel: ProjectionChannel;
  readonly key: string;
  readonly accountId: string | null;
  /** The domain aggregate, distinct from the materialized projection row. */
  readonly aggregateType?: string;
  readonly aggregateId?: string;
  readonly version: number;
  readonly updatedAt: string;
  readonly data: Readonly<Record<string, unknown>>;
}

/**
 * `audience:channel:recordKey` to the owning account.
 *
 * The partner book splits cleanly along the story the fixtures already tell:
 * the Halcyon and Orchid records are resale (Ember Peak), the Solace records
 * are referral (Northstar Advisory), and the Atlas records are two-tier
 * (Harborline). Nothing was invented to make the split work.
 */
export const demoRecordAccounts: Readonly<Record<string, string>> = {
  "partner:portfolio:EC-0038": RESELLER,
  "partner:portfolio:EC-0041": REFERRAL,
  "partner:portfolio:EC-0047": DISTRIBUTOR,
  "partner:registrations:REG-2026-0081": DISTRIBUTOR,
  "partner:registrations:REG-2026-0074": REFERRAL,
  "partner:registrations:REG-2026-0062": RESELLER,
  "partner:disputes:DSP-2026-0012": RESELLER,
  "partner:disputes:DSP-2026-0008": RESELLER,
  "partner:quotes:PQ-2026-0184-v3": RESELLER,
  "partner:quotes:PQ-2026-0171-v1": DISTRIBUTOR,
  "partner:quotes:PQ-2026-0152-v2": REFERRAL,
  "partner:billing:INV-2026-0781": RESELLER,
  "partner:billing:INV-2026-0712": RESELLER,
  "partner:commissions:STM-2026-Q3": RESELLER,
  "partner:commissions:ACC-2026-0712": REFERRAL,
  "partner:renewals:REN-EC-0038": RESELLER,
  "partner:renewals:REN-EC-0041": REFERRAL,
  "partner:sandboxes:SBX-2026-014": RESELLER,
  "partner:sandboxes:POC-2026-021": DISTRIBUTOR,
  "partner:marketplace:AWS-OFFER-1948": RESELLER,
  "partner:marketplace:AZURE-OFFER-0412": DISTRIBUTOR,
  "partner:brand:BRAND-MERIDIAN": RESELLER,
  "partner:brand:DNS-ATLAS": DISTRIBUTOR,
  "partner:support:SUP-18421": RESELLER,
  "partner:support:SUP-18307": DISTRIBUTOR,
};

/** Every customer fixture record that is not named above belongs here. */
export const DEMO_DEFAULT_CUSTOMER_ACCOUNT = DIRECT;
/** Partner records not named above; the resale book is the larger one. */
export const DEMO_DEFAULT_PARTNER_ACCOUNT = RESELLER;

/**
 * A fixture text field. Product-authored text (status labels, next actions,
 * value labels, date and term lines) is a `DemoMessage` with its facts;
 * text that stands in for what a person typed (titles, descriptions, context
 * lines, team names) is `demoText`; an amount or a date on its own is a fact.
 * Names, identifiers and email addresses stay plain strings. The demo read
 * boundary renders all of it for the reader (`resolveDemoContent`).
 */
type DemoField = string | DemoLocalizedText | DemoMessage | DemoFact;

function commercial(input: {
  kind: string;
  id: string;
  title: DemoField;
  description: DemoField;
  status: string;
  statusLabel: DemoField;
  tone: "neutral" | "success" | "warning" | "danger";
  risk: "low" | "medium" | "high";
  owner: DemoField;
  value: DemoField;
  valueLabel: DemoField;
  dateLabel: DemoField;
  term: DemoField;
  nextAction: DemoField;
  allowedActions?: readonly string[];
  /** Aggregate facts the dashboard orders by (due and expiry instants). */
  authoritative?: Readonly<Record<string, unknown>>;
}): Readonly<Record<string, unknown>> {
  const { authoritative, ...fields } = input;
  const facts = {
    ...(authoritative ?? {}),
    ...(input.kind === "orders" ? { status: input.status } : {}),
  };
  return {
    ...fields,
    ...(Object.keys(facts).length > 0 ? { authoritative: facts } : {}),
    allowedActions: input.allowedActions ?? [],
  };
}

function collection(input: {
  id: string;
  title: DemoField;
  description: DemoField;
  status: "active" | "pending" | "review" | "complete" | "blocked";
  statusLabel: DemoField;
  risk: "low" | "medium" | "high";
  owner: DemoField;
  value: DemoField;
  valueSort: number;
  updatedLabel: DemoField;
  context: readonly { label: DemoField; value: DemoField }[];
}): Readonly<Record<string, unknown>> {
  return { ...input, allowedActions: [] };
}

function partner(input: {
  id: string;
  name: DemoField;
  context: DemoField;
  status: string;
  risk: "low" | "medium" | "high";
  owner: DemoField;
  value: DemoField;
  secondary: DemoField;
}): Readonly<Record<string, unknown>> {
  return { ...input, allowedActions: [] };
}

function record(
  audience: ExperienceAudience,
  channel: ProjectionChannel,
  key: string,
  accountId: string | null,
  data: Readonly<Record<string, unknown>>,
  aggregate?: { readonly type: string; readonly id: string },
): DemoPortalRecord {
  return {
    audience,
    channel,
    key,
    accountId,
    ...(aggregate
      ? { aggregateType: aggregate.type, aggregateId: aggregate.id }
      : {}),
    version: 1,
    updatedAt,
    data,
  };
}

/* --------------------------------------------------------------------------
 * Shared demo-authored text
 *
 * Team names and document titles stand in for what an administrator or a
 * counterparty would have typed, so they are demo text in every language.
 * ----------------------------------------------------------------------- */

const team = {
  serviceOperations: demoText({
    en: "Service operations",
    es: "Operaciones de servicio",
    fr: "Opérations de service",
    de: "Servicebetrieb",
    ja: "サービス運用チーム",
    pt: "Operações do serviço",
    zh: "服务运营团队",
    ar: "فريق عمليات الخدمة",
  }),
  accountsPayable: demoText({
    en: "Accounts payable",
    es: "Cuentas a pagar",
    fr: "Comptabilité fournisseurs",
    de: "Kreditorenbuchhaltung",
    ja: "買掛金担当",
    pt: "Contas a pagar",
    zh: "应付账款团队",
    ar: "فريق الحسابات الدائنة",
  }),
  partnerBilling: demoText({
    en: "Partner billing",
    es: "Facturación de socios",
    fr: "Facturation partenaire",
    de: "Partnerabrechnung",
    ja: "パートナー請求担当",
    pt: "Faturamento do parceiro",
    zh: "合作伙伴账单团队",
    ar: "فريق فوترة الشركاء",
  }),
  partnerFinance: demoText({
    en: "Partner finance",
    es: "Finanzas de socios",
    fr: "Finance partenaire",
    de: "Finanzteam des Partners",
    ja: "パートナー財務担当",
    pt: "Financeiro do parceiro",
    zh: "合作伙伴财务团队",
    ar: "فريق مالية الشركاء",
  }),
  filOneSupport: demoText({
    en: "Fil One support",
    es: "Soporte de Fil One",
    fr: "Support Fil One",
    de: "Support von Fil One",
    ja: "Fil One サポート",
    pt: "Suporte da Fil One",
    zh: "Fil One 支持团队",
    ar: "فريق دعم Fil One",
  }),
  revenueOperations: demoText({
    en: "Revenue operations",
    es: "Operaciones de ingresos",
    fr: "Opérations revenus",
    de: "Revenue Operations",
    ja: "レベニューオペレーション",
    pt: "Operações de receita",
    zh: "收入运营团队",
    ar: "فريق عمليات الإيرادات",
  }),
} as const;

/** The agreement title the Lumen record, the Meridian record and the dashboard show. */
export const demoCloudServiceAgreementTitle = demoText({
  en: "Cloud Service Agreement",
  es: "Acuerdo de servicios en la nube",
  fr: "Accord de services cloud",
  de: "Cloud-Servicevereinbarung",
  ja: "クラウドサービス契約",
  pt: "Acordo de serviços em nuvem",
  zh: "云服务协议",
  ar: "اتفاقية الخدمات السحابية",
});

const lumenFieldArchive = demoText({
  en: "Lumen field archive",
  es: "Archivo de campo de Lumen",
  fr: "Archive terrain Lumen",
  de: "Lumen-Feldarchiv",
  ja: "Lumen フィールドアーカイブ",
  pt: "Arquivo de campo da Lumen",
  zh: "Lumen 现场归档",
  ar: "أرشيف Lumen الميداني",
});

/**
 * The overdue direct invoice's title before and after a sandbox payment.
 * `projection-source` swaps the paid form in when the demo payment completes.
 */
const committedCapacityOverdue = demoText({
  en: "Committed capacity · overdue",
  es: "Capacidad contratada · vencida",
  fr: "Capacité souscrite · en retard",
  de: "Vertraglich zugesagte Kapazität · überfällig",
  ja: "契約容量・期限超過",
  pt: "Capacidade contratada · vencida",
  zh: "承诺容量 · 已逾期",
  ar: "السعة المتعاقد عليها · متأخرة السداد",
});
const committedCapacityPaid = demoText({
  en: "Committed capacity · paid",
  es: "Capacidad contratada · pagada",
  fr: "Capacité souscrite · payée",
  de: "Vertraglich zugesagte Kapazität · bezahlt",
  ja: "契約容量・支払済み",
  pt: "Capacidade contratada · paga",
  zh: "承诺容量 · 已付款",
  ar: "السعة المتعاقد عليها · مدفوعة",
});

/** Record key to the title a completed demo payment gives the invoice. */
export const demoPaidInvoiceTitles: Readonly<
  Record<string, DemoLocalizedText>
> = {
  "invoice-meridian-overdue": committedCapacityPaid,
};

/* --------------------------------------------------------------------------
 * The direct buyer's journey records
 *
 * `demoJourneys` sends Mara Voss to `/quotes/quote-direct-renewal-v2` and Theo
 * Grant to `/billing/invoice-meridian-overdue` and
 * `/billing/invoice-meridian-paid`. Those three routes had no record behind
 * them, so the demo control panel offered three links that landed on "Record
 * unavailable".
 * ----------------------------------------------------------------------- */

const directJourney: readonly DemoPortalRecord[] = [
  record("customer", "quotes", "quote-direct-renewal-v2", DIRECT, {
    ...commercial({
      kind: "quotes",
      id: "quote-direct-renewal-v2",
      title: demoText({
        en: "Annual renewal · committed capacity",
        es: "Renovación anual · capacidad contratada",
        fr: "Renouvellement annuel · capacité souscrite",
        de: "Jährliche Verlängerung · vertraglich zugesagte Kapazität",
        ja: "年次の契約更新・契約容量",
        pt: "Renovação anual · capacidade contratada",
        zh: "年度续约 · 承诺容量",
        ar: "التجديد السنوي · السعة المتعاقد عليها",
      }),
      description: demoText({
        en: "400 TB · US East · 12 months · direct renewal",
        es: "400 TB · EE. UU. Este · 12 meses · renovación directa",
        fr: "400 To · USA Est · 12 mois · renouvellement direct",
        de: "400 TB · USA Ost · 12 Monate · Verlängerung im Direktvertrieb",
        ja: "400 TB・米国東部・12か月・直接契約の更新",
        pt: "400 TB · Leste dos EUA · 12 meses · renovação direta",
        zh: "400 TB · 美国东部 · 12 个月 · 直销续约",
        ar: "400 تيرابايت · شرق الولايات المتحدة · 12 شهرًا · تجديد مباشر",
      }),
      status: "open",
      statusLabel: demoMessage(
        "experience.data.status.quoteIssuedAwaitingAcceptance",
      ),
      tone: "warning",
      risk: "medium",
      owner: "Mara Voss",
      value: money("18480000", "USD"),
      valueLabel: demoMessage("experience.data.label.estimatedAnnualSpend"),
      dateLabel: demoMessage("common.expiresOn", { date: onDay("2026-08-28") }),
      term: demoMessage("experience.data.term.rangeNoticeOpens", {
        range: dateRange("2027-01-01", "2027-12-31"),
        date: onDay("2026-11-01"),
      }),
      nextAction: demoMessage("experience.data.next.acceptBeforeNoticeWindow"),
      allowedActions: ["accept", "expire"],
    }),
    // These are commercial identity, not projection metadata. The row's
    // `version` remains the materialized projection version; the acceptance
    // ceremony and its paper name the quote number and revision carried by
    // the authoritative quote snapshot instead. `expiresAt` is what the
    // dashboard orders obligations by, so it never parses a display label.
    reference: "Q-2026-0312",
    authoritative: { revision: 2, expiresAt: "2026-08-28T23:59:59.000Z" },
  }),
  record(
    "customer",
    "billing",
    "invoice-meridian-overdue",
    DIRECT,
    commercial({
      kind: "billing",
      id: "invoice-meridian-overdue",
      title: committedCapacityOverdue,
      description: demoMessage("experience.data.desc.invoiceAchReturned", {
        invoice: "INV-MER-0042",
      }),
      status: "open",
      statusLabel: demoMessage("experience.data.status.invoiceOverdueRetry"),
      tone: "danger",
      risk: "high",
      owner: "Theo Grant",
      value: money("1540000", "USD"),
      valueLabel: demoMessage("experience.data.label.invoicedNetOfTax"),
      dateLabel: demoMessage("experience.data.date.dueOverdueDays", {
        date: onDay("2026-07-15"),
        count: 16,
      }),
      term: demoMessage("experience.data.term.servicePeriod", {
        range: dateRange("2026-06-01", "2026-06-30"),
      }),
      nextAction: demoMessage(
        "experience.data.next.retryPaymentOrChangeMethod",
      ),
      authoritative: { dueAt: "2026-07-15T23:59:59.000Z" },
    }),
    {
      type: "invoice",
      id: demoUuid("subject:invoice:INV-MER-0042"),
    },
  ),
  record(
    "customer",
    "billing",
    "invoice-meridian-paid",
    DIRECT,
    commercial({
      kind: "billing",
      id: "invoice-meridian-paid",
      title: committedCapacityPaid,
      description: demoMessage("experience.data.desc.receiptAchEnding", {
        receipt: "RCT-MER-0038",
        digits: "1842",
      }),
      status: "paid",
      statusLabel: demoMessage("status.invoice.paid"),
      tone: "success",
      risk: "low",
      owner: "Theo Grant",
      value: money("1540000", "USD"),
      valueLabel: demoMessage("experience.data.label.invoicedNetOfTax"),
      dateLabel: demoMessage("experience.data.date.providerConfirmed", {
        date: onDay("2026-06-05"),
      }),
      term: demoMessage("experience.data.term.servicePeriod", {
        range: dateRange("2026-05-01", "2026-05-31"),
      }),
      nextAction: demoMessage("experience.data.next.downloadReceipt"),
    }),
  ),
];

/* --------------------------------------------------------------------------
 * The referral end client's book (Lumen Field Research)
 *
 * Nora Chen's journey opens `/services`, and every other customer surface in
 * her navigation needs a record of her own now that the account filter is real.
 * ----------------------------------------------------------------------- */

const endClientBook: readonly DemoPortalRecord[] = [
  record(
    "customer",
    "agreements",
    "AGR-LUMEN-0004",
    END_CLIENT,
    commercial({
      kind: "agreements",
      id: "AGR-LUMEN-0004",
      title: demoCloudServiceAgreementTitle,
      description: demoMessage(
        "experience.data.desc.agreementFilOnePaperReferred",
        // i18n-exempt: "Northstar" is the referring partner's name
        { version: "2.0", partner: "Northstar" },
      ),
      status: "active",
      statusLabel: demoMessage("experience.data.status.agreementInForce"),
      tone: "success",
      risk: "low",
      owner: "Nora Chen",
      value: onDate("2027-03-31"),
      valueLabel: demoMessage("experience.data.label.termEnd"),
      dateLabel: demoMessage("common.updatedAt", { time: onDay("2026-07-12") }),
      term: demoMessage("experience.data.term.rangeNoticeOpens", {
        range: dateRange("2026-04-01", "2027-03-31"),
        date: onDay("2027-02-01"),
      }),
      nextAction: demoMessage("experience.data.next.noActionDue"),
    }),
  ),
  record(
    "customer",
    "quotes",
    "Q-LUMEN-0032-v1",
    END_CLIENT,
    commercial({
      kind: "quotes",
      id: "Q-LUMEN-0032-v1",
      title: demoText({
        en: "POC conversion · field telemetry archive",
        es: "Conversión de la POC · archivo de telemetría de campo",
        fr: "Conversion de la POC · archive de télémétrie terrain",
        de: "POC-Umwandlung · Archiv für Feldtelemetrie",
        ja: "PoC の本契約移行・フィールドテレメトリーのアーカイブ",
        pt: "Conversão da POC · arquivo de telemetria de campo",
        zh: "POC 转商用 · 现场遥测归档",
        ar: "تحويل إثبات المفهوم · أرشيف القياس الميداني عن بُعد",
      }),
      description: demoText({
        en: "60 TB · US West · annual · referral sourced",
        es: "60 TB · EE. UU. Oeste · anual · procedente de una recomendación",
        fr: "60 To · USA Ouest · annuel · issu d’un apport d’affaires",
        de: "60 TB · USA West · jährlich · über Empfehlung",
        ja: "60 TB・米国西部・年間・紹介経由",
        pt: "60 TB · Oeste dos EUA · anual · originado por indicação",
        zh: "60 TB · 美国西部 · 年度 · 推荐合作伙伴开拓",
        ar: "60 تيرابايت · غرب الولايات المتحدة · سنوي · عن طريق الإحالة",
      }),
      status: "open",
      statusLabel: demoMessage("experience.data.status.quoteOpen"),
      tone: "warning",
      risk: "medium",
      owner: "Nora Chen",
      value: money("4140000", "USD"),
      valueLabel: demoMessage("experience.data.label.estimatedAnnualSpend"),
      dateLabel: demoMessage("common.expiresOn", { date: onDay("2026-08-12") }),
      term: demoMessage("experience.data.term.monthsFromAcceptance", {
        count: 12,
      }),
      nextAction: demoMessage("experience.data.next.acceptOrRequestRevision"),
      allowedActions: ["accept", "expire"],
      authoritative: { expiresAt: "2026-08-12T23:59:59.000Z" },
    }),
  ),
  record(
    "customer",
    "orders",
    "ORD-LUMEN-0021",
    END_CLIENT,
    commercial({
      kind: "orders",
      id: "ORD-LUMEN-0021",
      title: lumenFieldArchive,
      description: demoText({
        en: "PO-LF-0221 · 45 TB · US West · referral sourced",
        es: "PO-LF-0221 · 45 TB · EE. UU. Oeste · procedente de una recomendación",
        fr: "PO-LF-0221 · 45 To · USA Ouest · issu d’un apport d’affaires",
        de: "PO-LF-0221 · 45 TB · USA West · über Empfehlung",
        ja: "PO-LF-0221・45 TB・米国西部・紹介経由",
        pt: "PO-LF-0221 · 45 TB · Oeste dos EUA · originado por indicação",
        zh: "PO-LF-0221 · 45 TB · 美国西部 · 推荐合作伙伴开拓",
        ar: "PO-LF-0221 · 45 تيرابايت · غرب الولايات المتحدة · عن طريق الإحالة",
      }),
      status: "active",
      statusLabel: demoMessage("status.order.active"),
      tone: "success",
      risk: "low",
      owner: team.serviceOperations,
      value: demoMessage("experience.data.value.perYear", {
        amount: money("3105000", "USD"),
      }),
      valueLabel: demoMessage("experience.data.label.committedAnnualSpend"),
      dateLabel: demoMessage("experience.data.date.started", {
        date: onDay("2026-04-01"),
      }),
      term: demoMessage("experience.data.term.rangeAutoRenews", {
        range: dateRange("2026-04-01", "2027-03-31"),
      }),
      nextAction: demoMessage("experience.data.next.renewalNoticeOpens", {
        date: onDay("2027-02-01"),
      }),
    }),
  ),
  record(
    "customer",
    "services",
    "service-referral-end-client",
    END_CLIENT,
    commercial({
      kind: "services",
      id: "service-referral-end-client",
      title: lumenFieldArchive,
      description: demoText({
        en: "45 TB committed · 28 TB stored · US West",
        es: "45 TB contratados · 28 TB almacenados · EE. UU. Oeste",
        fr: "45 To souscrits · 28 To stockés · USA Ouest",
        de: "45 TB vertraglich zugesagt · 28 TB gespeichert · USA West",
        ja: "契約容量 45 TB・保存量 28 TB・米国西部",
        pt: "45 TB contratados · 28 TB armazenados · Oeste dos EUA",
        zh: "承诺容量 45 TB · 已存储 28 TB · 美国西部",
        ar: "45 تيرابايت متعاقد عليها · 28 تيرابايت مخزّنة · غرب الولايات المتحدة",
      }),
      status: "active",
      statusLabel: demoMessage("experience.data.status.serviceActive"),
      tone: "success",
      risk: "low",
      owner: team.serviceOperations,
      value: demoMessage("experience.data.value.percentUsed", {
        percent: percent(0.62),
      }),
      valueLabel: demoMessage("experience.data.label.capacityUsage"),
      dateLabel: demoMessage("experience.data.date.meteredRelative", {
        relative: ago(12, "minute"),
      }),
      term: demoMessage("experience.data.date.endsOn", {
        date: onDate("2027-03-31"),
      }),
      nextAction: demoMessage("experience.data.next.noActionDue"),
    }),
  ),
  record(
    "customer",
    "pocs",
    "POC-LUMEN-0009",
    END_CLIENT,
    commercial({
      kind: "pocs",
      id: "POC-LUMEN-0009",
      title: demoText({
        en: "Field telemetry restore",
        es: "Restauración de la telemetría de campo",
        fr: "Restauration de la télémétrie terrain",
        de: "Wiederherstellung der Feldtelemetrie",
        ja: "フィールドテレメトリーの復元",
        pt: "Restauração da telemetria de campo",
        zh: "现场遥测数据恢复",
        ar: "استعادة بيانات القياس الميداني عن بُعد",
      }),
      description: demoText({
        en: "8 TB · three of three success tests passed",
        es: "8 TB · superadas las tres pruebas de éxito",
        fr: "8 To · trois critères de réussite validés sur trois",
        de: "8 TB · alle drei Erfolgstests bestanden",
        ja: "8 TB・成功基準テスト 3 件すべてに合格",
        pt: "8 TB · aprovada nos três testes de sucesso",
        zh: "8 TB · 3 项成功测试全部通过",
        ar: "8 تيرابايت · اجتياز اختبارات النجاح الثلاثة كلها",
      }),
      status: "complete",
      statusLabel: demoMessage("experience.data.status.pocComplete"),
      tone: "success",
      risk: "low",
      owner: "Amina Cole",
      value: demoMessage("experience.data.value.readyToConvert"),
      valueLabel: demoMessage("experience.data.label.outcome"),
      dateLabel: demoMessage("experience.data.date.completed", {
        date: onDay("2026-07-20"),
      }),
      term: demoMessage("experience.data.term.evaluationCompleteDataRetained"),
      nextAction: demoMessage("experience.data.next.reviewConversionQuote"),
    }),
  ),
  record(
    "customer",
    "billing",
    "INV-LUMEN-0114",
    END_CLIENT,
    commercial({
      kind: "billing",
      id: "INV-LUMEN-0114",
      title: demoText({
        en: "July field archive",
        es: "Archivo de campo · julio",
        fr: "Archive terrain · juillet",
        de: "Feldarchiv · Juli",
        ja: "フィールドアーカイブ（7月分）",
        pt: "Arquivo de campo · julho",
        zh: "7 月现场归档",
        ar: "الأرشيف الميداني لشهر يوليو",
      }),
      description: demoText({
        en: "Invoice for the Lumen field archive · PO-LF-0221",
        es: "Factura del archivo de campo de Lumen · PO-LF-0221",
        fr: "Facture de l’archive terrain Lumen · PO-LF-0221",
        de: "Rechnung für das Lumen-Feldarchiv · PO-LF-0221",
        ja: "Lumen フィールドアーカイブの請求書・PO-LF-0221",
        pt: "Fatura do arquivo de campo da Lumen · PO-LF-0221",
        zh: "Lumen 现场归档发票 · PO-LF-0221",
        ar: "فاتورة أرشيف Lumen الميداني · PO-LF-0221",
      }),
      status: "open",
      statusLabel: demoMessage("status.invoice.open"),
      tone: "warning",
      risk: "low",
      owner: team.accountsPayable,
      value: money("258750", "USD"),
      valueLabel: demoMessage("experience.data.label.invoicedAmount"),
      dateLabel: demoMessage("common.dueOn", { date: onDay("2026-08-12") }),
      term: demoMessage("experience.data.term.servicePeriod", {
        range: dateRange("2026-07-01", "2026-07-31"),
      }),
      nextAction: demoMessage("experience.data.next.reviewAndPayBy", {
        date: onDay("2026-08-12"),
      }),
      authoritative: { dueAt: "2026-08-12T23:59:59.000Z" },
    }),
  ),
  record(
    "customer",
    "amendments",
    "AMD-LUMEN-0003",
    END_CLIENT,
    collection({
      id: "AMD-LUMEN-0003",
      title: demoText({
        en: "Field archive capacity increase",
        es: "Ampliación de capacidad del archivo de campo",
        fr: "Augmentation de capacité de l’archive terrain",
        de: "Kapazitätserweiterung für das Feldarchiv",
        ja: "フィールドアーカイブの容量追加",
        pt: "Aumento de capacidade do arquivo de campo",
        zh: "现场归档扩容",
        ar: "زيادة سعة الأرشيف الميداني",
      }),
      description: demoText({
        en: "Adds 15 TB to the field archive after the POC conversion.",
        es: "Añade 15 TB al archivo de campo tras la conversión de la POC.",
        fr: "Ajoute 15 To à l’archive terrain après la conversion de la POC.",
        de: "Erweitert das Feldarchiv nach der POC-Umwandlung um 15 TB.",
        ja: "PoC の本契約移行後、フィールドアーカイブに 15 TB を追加します。",
        pt: "Adiciona 15 TB ao arquivo de campo após a conversão da POC.",
        zh: "POC 转商用后，为现场归档增加 15 TB。",
        ar: "يضيف 15 تيرابايت إلى الأرشيف الميداني بعد تحويل إثبات المفهوم.",
      }),
      status: "pending",
      statusLabel: demoMessage("experience.data.status.awaitingCustomer"),
      risk: "low",
      owner: "Nora Chen",
      value: demoMessage("experience.data.value.increasePerYear", {
        amount: money("1035000", "USD"),
      }),
      valueSort: 10350,
      updatedLabel: demoMessage("common.updatedAt", {
        time: onDay("2026-07-29"),
      }),
      context: [
        { label: demoMessage("recordKind.service"), value: lumenFieldArchive },
        {
          label: demoMessage("experience.data.label.effective"),
          value: onDate("2026-09-01"),
        },
      ],
    }),
  ),
  record(
    "customer",
    "users",
    "USR-LUMEN-NORA",
    END_CLIENT,
    collection({
      id: "USR-LUMEN-NORA",
      title: "Nora Chen",
      description: demoText({
        en: "Platform engineer with read access to services and usage.",
        es: "Ingeniera de plataforma con acceso de lectura a servicios y uso.",
        fr: "Ingénieure plateforme avec accès en lecture aux services et à la consommation.",
        de: "Platform Engineer mit Lesezugriff auf Services und Nutzung.",
        ja: "サービスと使用状況の閲覧権限を持つプラットフォームエンジニア。",
        pt: "Engenheira de plataforma com acesso de leitura a serviços e uso.",
        zh: "平台工程师，拥有服务和用量的只读权限。",
        ar: "مهندسة منصات لديها صلاحية قراءة الخدمات والاستخدام.",
      }),
      status: "active",
      statusLabel: demoMessage("status.active"),
      risk: "low",
      owner: "Nora Chen",
      value: demoMessage("role.member"),
      valueSort: 2,
      updatedLabel: demoMessage("experience.data.date.activeToday"),
      context: [
        {
          label: demoMessage("experience.data.label.access"),
          value: demoMessage("experience.data.value.servicesAndUsage"),
        },
        {
          label: demoMessage("experience.data.label.security"),
          value: demoMessage("experience.data.value.mfaVerified"),
        },
      ],
    }),
  ),
  record(
    "customer",
    "procurement",
    "PROC-LUMEN-AP",
    END_CLIENT,
    collection({
      id: "PROC-LUMEN-AP",
      title: demoMessage("experience.data.title.accountsPayableRouting"),
      description: demoText({
        en: "Routes invoices to the verified Lumen billing inbox.",
        es: "Envía las facturas al buzón de facturación verificado de Lumen.",
        fr: "Achemine les factures vers la boîte de facturation vérifiée de Lumen.",
        de: "Leitet Rechnungen an das verifizierte Rechnungspostfach von Lumen weiter.",
        ja: "請求書を Lumen の確認済み請求用メールボックスに送付します。",
        pt: "Encaminha as faturas para a caixa de entrada de faturamento verificada da Lumen.",
        zh: "将发票发送至 Lumen 已验证的账单收件箱。",
        ar: "يوجّه الفواتير إلى صندوق بريد الفوترة المُتحقق منه لدى Lumen.",
      }),
      status: "active",
      statusLabel: demoMessage("experience.data.status.verified"),
      risk: "low",
      owner: "Nora Chen",
      value: "billing@lumen-field.test",
      valueSort: 5,
      updatedLabel: demoMessage("experience.data.date.verified", {
        date: onDay("2026-07-18"),
      }),
      context: [
        {
          label: demoMessage("experience.data.label.invoiceDelivery"),
          value: demoMessage("experience.data.value.emailAndPortal"),
        },
        {
          label: demoMessage("experience.data.label.purchaseOrder"),
          value: "PO-LF-0221",
        },
      ],
    }),
  ),
  record(
    "customer",
    "marketplace",
    "AWS-OFFER-LUMEN-0221",
    END_CLIENT,
    collection({
      id: "AWS-OFFER-LUMEN-0221",
      title: demoText({
        en: "AWS private offer · field archive",
        es: "Oferta privada de AWS · archivo de campo",
        fr: "Offre privée AWS · archive terrain",
        de: "Privates Angebot von AWS · Feldarchiv",
        ja: "AWS プライベートオファー・フィールドアーカイブ",
        pt: "Oferta privada da AWS · arquivo de campo",
        zh: "AWS 私有报价 · 现场归档",
        ar: "عرض AWS الخاص · الأرشيف الميداني",
      }),
      description: demoMessage("experience.data.desc.providerReportsFulfilled"),
      status: "active",
      statusLabel: demoMessage("status.active"),
      risk: "low",
      owner: "Nora Chen",
      value: demoMessage("experience.data.value.perYear", {
        amount: money("3105000", "USD"),
      }),
      valueSort: 31050,
      updatedLabel: demoMessage("experience.data.date.providerSyncRelative", {
        relative: ago(22, "minute"),
      }),
      context: [
        {
          label: demoMessage("experience.data.label.marketplace"),
          value: "AWS Marketplace", // i18n-exempt: the provider's product name
        },
        {
          label: demoMessage("experience.data.label.billing"),
          value: demoMessage("experience.data.value.merchantOfRecord", {
            merchant: "AWS",
          }),
        },
      ],
    }),
  ),
  record(
    "customer",
    "support",
    "SUP-LUMEN-19004",
    END_CLIENT,
    collection({
      id: "SUP-LUMEN-19004",
      title: demoText({
        en: "Restore throughput question",
        es: "Consulta sobre el rendimiento de la restauración",
        fr: "Question sur le débit de restauration",
        de: "Frage zum Wiederherstellungsdurchsatz",
        ja: "復元スループットに関する問い合わせ",
        pt: "Dúvida sobre a taxa de transferência da restauração",
        zh: "关于恢复吞吐量的问题",
        ar: "استفسار عن معدل نقل البيانات أثناء الاستعادة",
      }),
      description: demoText({
        en: "Support is reviewing the observed restore throughput.",
        es: "Soporte está revisando el rendimiento de restauración observado.",
        fr: "Le support examine le débit de restauration constaté.",
        de: "Der Support prüft den beobachteten Wiederherstellungsdurchsatz.",
        ja: "サポートが、観測された復元スループットを確認しています。",
        pt: "O suporte está analisando a taxa de transferência observada na restauração.",
        zh: "支持团队正在核查观测到的恢复吞吐量。",
        ar: "يراجع فريق الدعم معدل نقل البيانات المرصود أثناء الاستعادة.",
      }),
      status: "active",
      statusLabel: demoMessage("status.inProgress"),
      risk: "low",
      owner: "Nora Chen",
      value: demoMessage("experience.data.value.normalPriority"),
      valueSort: 2,
      updatedLabel: demoMessage("experience.data.date.providerUpdateRelative", {
        relative: ago(40, "minute"),
      }),
      context: [
        { label: demoMessage("recordKind.service"), value: lumenFieldArchive },
        {
          label: demoMessage("experience.data.label.source"),
          value: demoMessage("experience.data.value.supportProvider"),
        },
      ],
    }),
  ),
];

/* --------------------------------------------------------------------------
 * Partner records the account filter would otherwise leave empty
 * ----------------------------------------------------------------------- */

const partnerBook: readonly DemoPortalRecord[] = [
  record(
    "partner",
    "quotes",
    "quote-resale-customer-v4",
    RESELLER,
    partner({
      id: "quote-resale-customer-v4",
      name: demoText({
        en: "Aster House customer quotation",
        es: "Presupuesto para el cliente Aster House",
        fr: "Devis client Aster House",
        de: "Kundenangebot für Aster House",
        ja: "Aster House 向け顧客見積書",
        pt: "Cotação para o cliente Aster House",
        zh: "Aster House 客户报价单",
        ar: "عرض سعر للعميل Aster House",
      }),
      context: demoText({
        en: "Resale · EU West · 120 TB · 12 months",
        es: "Reventa · UE Oeste · 120 TB · 12 meses",
        fr: "Revente · UE Ouest · 120 To · 12 mois",
        de: "Wiederverkauf · EU West · 120 TB · 12 Monate",
        ja: "再販・EU 西部・120 TB・12か月",
        pt: "Revenda · Oeste da UE · 120 TB · 12 meses",
        zh: "转售 · 欧盟西部 · 120 TB · 12 个月",
        ar: "إعادة البيع · غرب الاتحاد الأوروبي · 120 تيرابايت · 12 شهرًا",
      }),
      status: "draft",
      risk: "medium",
      owner: "Priya Nair",
      value: demoMessage("experience.data.value.transferAndResale", {
        transfer: money("1725000", "GBP"),
        resale: money("2140000", "GBP"),
      }),
      secondary: demoMessage("experience.data.partner.customerPriceSetBy", {
        partner: "Ember Peak",
        date: onDay("2026-08-14"),
      }),
    }),
  ),
  record(
    "partner",
    "quotes",
    "quote-distributor-exception-v1",
    DISTRIBUTOR,
    partner({
      id: "quote-distributor-exception-v1",
      name: demoText({
        en: "Cobalt Orchard below-floor exception",
        es: "Excepción por debajo del precio mínimo · Cobalt Orchard",
        fr: "Exception sous le prix plancher · Cobalt Orchard",
        de: "Ausnahme unter der Preisuntergrenze · Cobalt Orchard",
        ja: "Cobalt Orchard の下限価格割れの例外",
        pt: "Exceção abaixo do preço mínimo · Cobalt Orchard",
        zh: "Cobalt Orchard 低于底价的例外",
        ar: "استثناء بسعر أقل من الحد الأدنى · Cobalt Orchard",
      }),
      context: demoText({
        en: "Two-tier · EU West · 80 TB · 12 months",
        es: "Dos niveles · UE Oeste · 80 TB · 12 meses",
        fr: "Deux niveaux · UE Ouest · 80 To · 12 mois",
        de: "Zweistufig · EU West · 80 TB · 12 Monate",
        ja: "2 階層販売・EU 西部・80 TB・12か月",
        pt: "Dois níveis · Oeste da UE · 80 TB · 12 meses",
        zh: "两级分销 · 欧盟西部 · 80 TB · 12 个月",
        ar: "على مستويين · غرب الاتحاد الأوروبي · 80 تيرابايت · 12 شهرًا",
      }),
      status: "pending",
      risk: "high",
      owner: "Elias Ward",
      value: demoMessage("experience.data.value.transfer", {
        amount: money("3168000", "EUR"),
      }),
      secondary: demoMessage(
        "experience.data.partner.awaitingFinanceApproval",
        {
          date: onDay("2026-08-18"),
        },
      ),
    }),
  ),
  record(
    "partner",
    "disputes",
    "DSP-2026-0021",
    REFERRAL,
    partner({
      id: "DSP-2026-0021",
      name: demoText({
        en: "Solace attribution claim",
        es: "Reclamación de atribución de Solace",
        fr: "Réclamation d’attribution Solace",
        de: "Zuordnungsanspruch von Solace",
        ja: "Solace のアトリビューション申し立て",
        pt: "Reivindicação de atribuição da Solace",
        zh: "Solace 归属申诉",
        ar: "مطالبة Solace بإسناد الفرصة",
      }),
      context: demoText({
        en: "Registration ownership · referral evidence submitted",
        es: "Titularidad del registro · evidencia de recomendación enviada",
        fr: "Titularité de l’enregistrement · preuves d’apport d’affaires transmises",
        de: "Inhaberschaft der Registrierung · Empfehlungsnachweis eingereicht",
        ja: "登録の帰属・紹介の証跡を提出済み",
        pt: "Titularidade do registro · evidência de indicação enviada",
        zh: "报备归属 · 已提交推荐证据",
        ar: "ملكية التسجيل · قُدِّم دليل الإحالة",
      }),
      status: "open",
      risk: "medium",
      owner: "Mira Patel",
      value: demoMessage("experience.data.value.atRisk", {
        amount: money("2860000", "USD"),
      }),
      secondary: demoMessage("experience.data.date.responseDue", {
        date: onDay("2026-08-06"),
      }),
    }),
  ),
  record(
    "partner",
    "disputes",
    "DSP-2026-0015",
    DISTRIBUTOR,
    partner({
      id: "DSP-2026-0015",
      name: demoText({
        en: "Cobalt Orchard provisioning credit",
        es: "Crédito por aprovisionamiento · Cobalt Orchard",
        fr: "Crédit de service sur le provisionnement · Cobalt Orchard",
        de: "Servicegutschrift für die Bereitstellung · Cobalt Orchard",
        ja: "Cobalt Orchard のプロビジョニングに関するクレジット",
        pt: "Crédito de provisionamento · Cobalt Orchard",
        zh: "Cobalt Orchard 开通服务抵扣金",
        ar: "رصيد تعويض عن التهيئة · Cobalt Orchard",
      }),
      context: demoText({
        en: "Invoice line dispute · provider evidence attached",
        es: "Disputa sobre una línea de factura · evidencia del proveedor adjunta",
        fr: "Litige sur une ligne de facture · preuves du prestataire jointes",
        de: "Streitfall zu einer Rechnungsposition · Nachweis des Anbieters beigefügt",
        ja: "請求明細への異議・プロバイダーの証跡を添付済み",
        pt: "Contestação de item da fatura · evidência do provedor anexada",
        zh: "发票明细争议 · 已附服务商证据",
        ar: "نزاع على بند في الفاتورة · أُرفق دليل المزوّد",
      }),
      status: "pending",
      risk: "medium",
      owner: "Elias Ward",
      value: demoMessage("experience.data.value.disputed", {
        amount: money("198000", "EUR"),
      }),
      secondary: demoMessage("experience.data.partner.filOneReviewing"),
    }),
  ),
  record(
    "partner",
    "marketplace",
    "GCP-OFFER-0087",
    REFERRAL,
    partner({
      id: "GCP-OFFER-0087",
      name: demoText({
        en: "Solace Google Cloud offer",
        es: "Oferta de Google Cloud para Solace",
        fr: "Offre Google Cloud pour Solace",
        de: "Angebot von Google Cloud für Solace",
        ja: "Solace 向け Google Cloud オファー",
        pt: "Oferta do Google Cloud para a Solace",
        zh: "Solace 的 Google Cloud 市场报价",
        ar: "عرض Google Cloud المقدَّم إلى Solace",
      }),
      context: demoText({
        en: "Referral · disbursement pending in the provider feed",
        es: "Recomendación · pago al socio pendiente en los datos del proveedor",
        fr: "Apport d’affaires · versement en attente dans le flux du prestataire",
        de: "Empfehlung · Auszahlung im Datenfeed des Anbieters ausstehend",
        ja: "紹介・プロバイダーのフィード上で支払いが保留中",
        pt: "Indicação · desembolso pendente no feed do provedor",
        zh: "推荐 · 服务商数据中的付款待处理",
        ar: "إحالة · صرف المستحقات قيد الانتظار في بيانات المزوّد",
      }),
      status: "pending",
      risk: "low",
      owner: "Mira Patel",
      value: demoMessage("experience.data.value.buyerPrice", {
        amount: money("2860000", "USD"),
      }),
      secondary: demoMessage("experience.data.value.merchantOfRecord", {
        merchant: "Google", // i18n-exempt: company name
      }),
    }),
  ),
  record(
    "partner",
    "support",
    "SUP-18512",
    REFERRAL,
    partner({
      id: "SUP-18512",
      name: demoText({
        en: "Solace usage export",
        es: "Exportación de uso de Solace",
        fr: "Export de la consommation Solace",
        de: "Nutzungsexport für Solace",
        ja: "Solace の使用状況エクスポート",
        pt: "Exportação de uso da Solace",
        zh: "Solace 用量导出",
        ar: "تصدير بيانات استخدام Solace",
      }),
      context: demoText({
        en: "Referral-visible summary · standard priority",
        es: "Resumen visible para el socio prescriptor · prioridad estándar",
        fr: "Résumé visible par l’apporteur d’affaires · priorité normale",
        de: "Für den Empfehlungspartner sichtbare Zusammenfassung · Standardpriorität",
        ja: "紹介パートナーに表示される概要・標準優先度",
        pt: "Resumo visível ao parceiro de indicação · prioridade padrão",
        zh: "推荐合作伙伴可见的摘要 · 标准优先级",
        ar: "ملخص مرئي لشريك الإحالة · أولوية عادية",
      }),
      status: "active",
      risk: "low",
      owner: team.filOneSupport,
      value: demoMessage("common.updatedRelative", {
        relative: ago(1, "hour"),
      }),
      secondary: demoMessage("experience.data.partner.supportSystemSource"),
    }),
  ),
  record(
    "partner",
    "billing",
    "INV-HL-2026-0714",
    DISTRIBUTOR,
    partner({
      id: "INV-HL-2026-0714",
      name: demoText({
        en: "July consolidated distributor invoice",
        es: "Factura consolidada del distribuidor de julio",
        fr: "Facture distributeur consolidée de juillet",
        de: "Konsolidierte Distributorrechnung Juli",
        ja: "7月分ディストリビューター一括請求書",
        pt: "Fatura consolidada do distribuidor de julho",
        zh: "7 月分销商合并发票",
        ar: "فاتورة الموزّع الموحدة لشهر يوليو",
      }),
      context: demoText({
        en: "4 end clients · SEPA · Harborline is merchant of record",
        es: "4 clientes finales · SEPA · Harborline es el vendedor responsable de la transacción",
        fr: "4 clients finaux · SEPA · Harborline est le vendeur responsable de la transaction",
        de: "4 Endkunden · SEPA · Harborline ist Merchant of Record",
        ja: "エンド顧客 4社・SEPA・販売主体は Harborline",
        pt: "4 clientes finais · SEPA · Harborline é o vendedor responsável pela transação",
        zh: "4 个终端客户 · SEPA · Harborline 为交易责任商户",
        ar: "4 عملاء نهائيين · SEPA · Harborline هي التاجر المسؤول عن المعاملة",
      }),
      status: "pending",
      risk: "medium",
      owner: team.partnerBilling,
      value: demoMessage("experience.data.value.invoiced", {
        amount: money("4822000", "EUR"),
      }),
      secondary: demoMessage("experience.data.partner.dueWebhookTruth", {
        date: onDay("2026-08-20"),
      }),
    }),
  ),
  record(
    "partner",
    "commissions",
    "STM-HL-2026-Q3",
    DISTRIBUTOR,
    partner({
      id: "STM-HL-2026-Q3",
      name: demoText({
        en: "Q3 distributor statement",
        es: "Liquidación del distribuidor del tercer trimestre",
        fr: "Relevé distributeur du T3",
        de: "Distributorabrechnung Q3",
        ja: "第3四半期のディストリビューター明細書",
        pt: "Demonstrativo do distribuidor do 3º trimestre",
        zh: "第三季度分销商结算单",
        ar: "كشف الموزّع للربع الثالث",
      }),
      context: demoText({
        en: "9 collections · 1 credit · no holdback",
        es: "9 cobros · 1 factura rectificativa · sin retención",
        fr: "9 encaissements · 1 crédit · aucune retenue",
        de: "9 Zahlungseingänge · 1 Gutschrift · kein Einbehalt",
        ja: "回収 9 件・クレジットノート 1 件・留保額なし",
        pt: "9 recebimentos · 1 crédito · sem valor retido",
        zh: "9 笔收款 · 1 张贷项通知单 · 无暂扣款",
        ar: "9 عمليات تحصيل · رصيد دائن واحد · لا مبالغ محتجزة",
      }),
      status: "pending",
      risk: "low",
      owner: team.partnerFinance,
      value: demoMessage("experience.data.value.accrued", {
        amount: money("578600", "EUR"),
      }),
      secondary: demoMessage("experience.data.partner.paysAfterCollections"),
    }),
  ),
  record(
    "partner",
    "renewals",
    "REN-EC-0047",
    DISTRIBUTOR,
    partner({
      id: "REN-EC-0047",
      name: "Cobalt Orchard GmbH",
      context: demoMessage("experience.data.partner.twoTierTermEnds", {
        capacity: terabytes(80),
        date: onDay("2026-12-31"),
      }),
      status: "attention",
      risk: "medium",
      owner: "Elias Ward",
      value: demoMessage("experience.data.value.transfer", {
        amount: money("3168000", "EUR"),
      }),
      secondary: demoMessage("experience.data.date.noticeActionDue", {
        date: onDay("2026-10-02"),
      }),
    }),
  ),
];

/* --------------------------------------------------------------------------
 * Internal records
 *
 * Three demo journeys open `/internal/queues/{queue-legal-meridian,
 * queue-price-harborline, queue-provision-cobalt}` and one opens
 * `/internal/accounts/cobalt-orchard`. None of those record keys existed, and
 * the internal `dashboard` channel had no records at all, so the account page
 * and the operator search's Accounts group were both empty.
 * ----------------------------------------------------------------------- */

function internal(
  channel: ProjectionChannel,
  key: string,
  data: Readonly<Record<string, unknown>>,
  aggregate?: { readonly type: string; readonly id: string },
): DemoPortalRecord {
  return record("internal", channel, key, null, data, aggregate);
}

const meridianAccount = "Meridian Archive Labs, Inc.";
/** "Cloud Service Agreement · Meridian", joined the way each language joins labels. */
const meridianAgreementTitle = demoMessage("common.join.labels", {
  first: demoCloudServiceAgreementTitle,
  second: "Meridian", // i18n-exempt: company name
});

const internalBook: readonly DemoPortalRecord[] = [
  internal("queues", "queue-legal-meridian", {
    title: demoText({
      en: "Customer paper review · Meridian",
      es: "Revisión del contrato del cliente · Meridian",
      fr: "Revue du contrat client · Meridian",
      de: "Prüfung des Kundenvertrags · Meridian",
      ja: "顧客契約書の確認・Meridian",
      pt: "Revisão do contrato do cliente · Meridian",
      zh: "客户合同审核 · Meridian",
      ar: "مراجعة عقد العميل · Meridian",
    }),
    reference: "queue-legal-meridian",
    description: demoText({
      en: "Meridian's data processing addendum was superseded while the review was open.",
      es: "El anexo de tratamiento de datos de Meridian se sustituyó mientras la revisión seguía abierta.",
      fr: "L’annexe relative au traitement des données de Meridian a été remplacée alors que la revue était en cours.",
      de: "Der Auftragsverarbeitungsvertrag von Meridian wurde ersetzt, während die Prüfung noch lief.",
      ja: "確認の途中で、Meridian のデータ処理補遺が新しい版に置き換えられました。",
      pt: "O adendo de tratamento de dados da Meridian foi substituído enquanto a revisão estava em andamento.",
      zh: "审核尚未完成时，Meridian 的数据处理附录已被新版本取代。",
      ar: "استُبدل ملحق معالجة البيانات لدى Meridian بينما كانت المراجعة لا تزال مفتوحة.",
    }),
    statusLabel: demoMessage("experience.data.status.staleVersionLegalReview"),
    status: "pending",
    risk: "high",
    owner: "Imani Ross",
    nextAction: demoMessage("experience.data.next.moveReviewToVersion", {
      version: "2",
    }),
    authoritative: {
      queue: "legal_review",
      objectType: "agreement_draft",
      targetAt: "2026-08-03T17:00:00.000Z",
    },
    context: [
      { label: demoMessage("recordKind.account"), value: meridianAccount },
      {
        label: demoMessage("experience.data.label.document"),
        value: demoText({
          en: "Data processing addendum v2",
          es: "Anexo de tratamiento de datos, versión 2",
          fr: "Annexe relative au traitement des données, version 2",
          de: "Auftragsverarbeitungsvertrag, Version 2",
          ja: "データ処理補遺（第 2 版）",
          pt: "Adendo de tratamento de dados, versão 2",
          zh: "数据处理附录 v2",
          ar: "ملحق معالجة البيانات، الإصدار 2",
        }),
      },
    ],
    allowedActions: ["review_exception"],
  }),
  internal("queues", "queue-price-harborline", {
    title: demoText({
      en: "Below-floor pricing decision · Harborline",
      es: "Decisión sobre un precio por debajo del mínimo · Harborline",
      fr: "Décision sur un prix sous le plancher · Harborline",
      de: "Entscheidung über einen Preis unter der Preisuntergrenze · Harborline",
      ja: "下限価格を下回る価格の判断・Harborline",
      pt: "Decisão sobre preço abaixo do mínimo · Harborline",
      zh: "低于底价的定价决定 · Harborline",
      ar: "قرار بشأن سعر أقل من الحد الأدنى · Harborline",
    }),
    reference: "queue-price-harborline",
    description: demoText({
      en: "The two-tier quote for Cobalt Orchard prices 8.4% below the published floor.",
      es: "El presupuesto de dos niveles para Cobalt Orchard queda un 8,4\u00a0% por debajo del precio mínimo publicado.",
      fr: "Le devis à deux niveaux pour Cobalt Orchard est inférieur de 8,4\u202f% au prix plancher publié.",
      de: "Das zweistufige Angebot für Cobalt Orchard liegt 8,4\u00a0% unter der veröffentlichten Preisuntergrenze.",
      ja: "Cobalt Orchard 向けの 2 階層販売の見積もりは、公表済みの下限価格を 8.4% 下回っています。",
      pt: "A cotação em dois níveis para a Cobalt Orchard está 8,4% abaixo do preço mínimo publicado.",
      zh: "Cobalt Orchard 的两级分销报价比公布的底价低 8.4%。",
      ar: "يقل عرض السعر على مستويين المقدَّم إلى Cobalt Orchard بنسبة 8.4% عن الحد الأدنى المنشور للسعر.",
    }),
    statusLabel: demoMessage("experience.data.status.awaitingFinanceDecision"),
    status: "open",
    risk: "high",
    owner: "Mateo Silva",
    nextAction: demoMessage("experience.data.next.compareFloorVariance"),
    authoritative: {
      queue: "price_exception",
      objectType: "quote",
      targetAt: "2026-08-01T16:00:00.000Z",
    },
    context: [
      {
        label: demoMessage("experience.data.label.partner"),
        value: "Harborline Distribution Ltd",
      },
      {
        label: demoMessage("experience.data.label.annualValue"),
        value: money("3168000", "EUR"),
      },
    ],
    allowedActions: ["review_exception"],
  }),
  internal("queues", "queue-provision-cobalt", {
    title: demoText({
      en: "Provisioning recovery · Cobalt Orchard",
      es: "Recuperación del aprovisionamiento · Cobalt Orchard",
      fr: "Reprise du provisionnement · Cobalt Orchard",
      de: "Wiederherstellung der Bereitstellung · Cobalt Orchard",
      ja: "プロビジョニングの復旧・Cobalt Orchard",
      pt: "Recuperação do provisionamento · Cobalt Orchard",
      zh: "开通恢复 · Cobalt Orchard",
      ar: "استعادة التهيئة · Cobalt Orchard",
    }),
    reference: "queue-provision-cobalt",
    description: demoText({
      en: "The EU West provisioning run failed after the provider accepted the order.",
      es: "El aprovisionamiento en la región UE Oeste falló después de que el proveedor aceptara el pedido.",
      fr: "Le provisionnement dans la région UE Ouest a échoué après l’acceptation de la commande par le prestataire.",
      de: "Die Bereitstellung in der Region EU West ist fehlgeschlagen, nachdem der Anbieter den Auftrag angenommen hatte.",
      ja: "プロバイダーが注文を受け付けた後、EU 西部でのプロビジョニングが失敗しました。",
      pt: "O provisionamento na região Oeste da UE falhou depois que o provedor aceitou o pedido.",
      zh: "服务商接受订单后，欧盟西部的开通流程失败。",
      ar: "فشلت عملية التهيئة في غرب الاتحاد الأوروبي بعد أن قبل المزوّد الطلب.",
    }),
    statusLabel: demoMessage("experience.data.status.providerRecoveryQueued"),
    status: "blocked",
    risk: "high",
    owner: "Ada Mercer",
    nextAction: demoMessage("experience.data.next.enterAssistedModeRetry"),
    authoritative: {
      queue: "provisioning_recovery",
      objectType: "order",
      targetAt: "2026-07-31T20:00:00.000Z",
    },
    context: [
      {
        label: demoMessage("experience.data.label.endClient"),
        value: "Cobalt Orchard GmbH",
      },
      {
        label: demoMessage("experience.data.label.region"),
        value: "eu-west-2",
      },
    ],
    allowedActions: ["review_exception"],
  }),
  internal(
    "dashboard",
    "meridian-archive",
    {
      title: meridianAccount,
      name: meridianAccount,
      reference: meridianAccount,
      description: demoText({
        en: "Direct buyer · US · USD · one overdue invoice",
        es: "Comprador directo · US · USD · una factura vencida",
        fr: "Acheteur direct · US · USD · une facture en retard",
        de: "Direktkunde · US · USD · eine überfällige Rechnung",
        ja: "直接購入・US・USD・期限超過の請求書 1 件",
        pt: "Comprador direto · US · USD · uma fatura vencida",
        zh: "直接买方 · US · USD · 1 张逾期发票",
        ar: "مشترٍ مباشر · US · USD · فاتورة واحدة متأخرة السداد",
      }),
      statusLabel: demoMessage(
        "experience.data.status.attentionOverdueInvoice",
      ),
      status: "attention",
      risk: "medium",
      owner: "Ada Mercer",
      nextAction: demoMessage("experience.data.next.confirmAchRetry"),
      context: [
        {
          label: demoMessage("experience.data.label.relationship"),
          value: demoMessage("experience.data.value.relationshipDirect"),
        },
        {
          label: demoMessage("experience.data.label.annualValue"),
          value: money("18480000", "USD"),
        },
      ],
    },
    { type: "account", id: DIRECT },
  ),
  internal(
    "dashboard",
    "cobalt-orchard",
    {
      title: "Cobalt Orchard GmbH",
      name: "Cobalt Orchard GmbH",
      reference: "Cobalt Orchard GmbH",
      description: demoText({
        en: "Distributor end client · DE · EUR · onboarding",
        es: "Cliente final de un distribuidor · DE · EUR · en proceso de alta",
        fr: "Client final d’un distributeur · DE · EUR · intégration en cours",
        de: "Endkunde eines Distributors · DE · EUR · Onboarding läuft",
        ja: "ディストリビューター経由のエンド顧客・DE・EUR・オンボーディング中",
        pt: "Cliente final de distribuidor · DE · EUR · onboarding",
        zh: "分销商的终端客户 · DE · EUR · 入驻中",
        ar: "عميل نهائي لدى موزّع · DE · EUR · قيد الإعداد",
      }),
      statusLabel: demoMessage(
        "experience.data.status.onboardingProvisioningRecovery",
      ),
      status: "pending",
      risk: "high",
      owner: "Ada Mercer",
      nextAction: demoMessage("experience.data.next.verifyActors"),
      context: [
        {
          label: demoMessage("experience.data.label.relationship"),
          value: demoMessage(
            "experience.data.value.relationshipTwoTierEndClient",
          ),
        },
        {
          label: demoMessage("experience.data.label.distributor"),
          value: "Harborline Distribution Ltd",
        },
      ],
    },
    { type: "account", id: UK_END_CLIENT },
  ),
  internal(
    "dashboard",
    "ember-peak",
    {
      title: "Ember Peak Systems Ltd",
      name: "Ember Peak Systems Ltd",
      reference: "Ember Peak Systems Ltd",
      description: demoText({
        en: "Reseller · GB · GBP · agreement notice window opens tomorrow",
        es: "Revendedor · GB · GBP · el plazo de preaviso del acuerdo se abre mañana",
        fr: "Revendeur · GB · GBP · la période de préavis de l’accord s’ouvre demain",
        de: "Reseller · GB · GBP · Kündigungsfrist der Vereinbarung beginnt morgen",
        ja: "リセラー・GB・GBP・契約の通知期間が明日から開始",
        pt: "Revendedor · GB · GBP · o aviso prévio do acordo começa amanhã",
        zh: "经销商 · GB · GBP · 协议通知期明天开始",
        ar: "شريك إعادة البيع · GB · GBP · تبدأ فترة الإشعار الخاصة بالاتفاقية غدًا",
      }),
      statusLabel: demoMessage("experience.data.status.attentionNoticeWindow"),
      status: "attention",
      risk: "medium",
      owner: "Ada Mercer",
      nextAction: demoMessage("experience.data.next.confirmPartnerRenewalPath"),
      context: [
        {
          label: demoMessage("experience.data.label.relationship"),
          value: demoMessage("experience.data.value.relationshipReseller"),
        },
        {
          label: demoMessage("experience.data.label.endClients"),
          value: demoMessage("experience.data.value.namedCount", { count: 2 }),
        },
      ],
    },
    { type: "account", id: RESELLER },
  ),
  internal("agreements", "AGR-2026-0042", {
    title: meridianAgreementTitle,
    name: meridianAgreementTitle,
    description: demoMessage(
      "experience.data.desc.agreementFilOnePaperInForce",
      {
        version: "3.2",
      },
    ),
    statusLabel: demoMessage("experience.data.status.agreementInForce"),
    status: "active",
    risk: "low",
    owner: "Imani Ross",
    nextAction: demoMessage("experience.data.next.noActionDue"),
    context: [
      { label: demoMessage("recordKind.account"), value: meridianAccount },
      {
        label: demoMessage("experience.data.label.termEnd"),
        value: onDate("2026-12-31"),
      },
    ],
  }),
  internal("quotes", "Q-2026-0184-v3", {
    title: demoText({
      en: "Enterprise committed capacity · Meridian",
      es: "Capacidad contratada para empresas · Meridian",
      fr: "Capacité souscrite Entreprise · Meridian",
      de: "Vertraglich zugesagte Kapazität (Enterprise) · Meridian",
      ja: "エンタープライズ向け契約容量・Meridian",
      pt: "Capacidade contratada corporativa · Meridian",
      zh: "企业承诺容量 · Meridian",
      ar: "السعة المتعاقد عليها للمؤسسات · Meridian",
    }),
    name: demoText({
      en: "Enterprise committed capacity · Meridian",
      es: "Capacidad contratada para empresas · Meridian",
      fr: "Capacité souscrite Entreprise · Meridian",
      de: "Vertraglich zugesagte Kapazität (Enterprise) · Meridian",
      ja: "エンタープライズ向け契約容量・Meridian",
      pt: "Capacidade contratada corporativa · Meridian",
      zh: "企业承诺容量 · Meridian",
      ar: "السعة المتعاقد عليها للمؤسسات · Meridian",
    }),
    description: demoText({
      en: "400 TB · US East · annual · direct",
      es: "400 TB · EE. UU. Este · anual · directo",
      fr: "400 To · USA Est · annuel · vente directe",
      de: "400 TB · USA Ost · jährlich · Direktvertrieb",
      ja: "400 TB・米国東部・年間・直接販売",
      pt: "400 TB · Leste dos EUA · anual · venda direta",
      zh: "400 TB · 美国东部 · 年度 · 直销",
      ar: "400 تيرابايت · شرق الولايات المتحدة · سنوي · بيع مباشر",
    }),
    statusLabel: demoMessage("experience.data.status.quoteOpen"),
    status: "open",
    risk: "medium",
    owner: "Mateo Silva",
    nextAction: demoMessage("experience.data.next.monitorAcceptance"),
    context: [
      { label: demoMessage("recordKind.account"), value: meridianAccount },
      {
        label: demoMessage("experience.data.label.annualValue"),
        value: money("18480000", "USD"),
      },
    ],
  }),
  internal(
    "orders",
    "ORD-2026-0098",
    {
      title: demoText({
        en: "Northstar primary archive · Meridian",
        es: "Archivo principal de Northstar · Meridian",
        fr: "Archive principale Northstar · Meridian",
        de: "Northstar-Primärarchiv · Meridian",
        ja: "Northstar プライマリアーカイブ・Meridian",
        pt: "Arquivo principal da Northstar · Meridian",
        zh: "Northstar 主归档 · Meridian",
        ar: "الأرشيف الرئيسي لشركة Northstar · Meridian",
      }),
      name: demoText({
        en: "Northstar primary archive · Meridian",
        es: "Archivo principal de Northstar · Meridian",
        fr: "Archive principale Northstar · Meridian",
        de: "Northstar-Primärarchiv · Meridian",
        ja: "Northstar プライマリアーカイブ・Meridian",
        pt: "Arquivo principal da Northstar · Meridian",
        zh: "Northstar 主归档 · Meridian",
        ar: "الأرشيف الرئيسي لشركة Northstar · Meridian",
      }),
      description: demoText({
        en: "PO-NA-1048 · 500 TB · US East · direct",
        es: "PO-NA-1048 · 500 TB · EE. UU. Este · directo",
        fr: "PO-NA-1048 · 500 To · USA Est · vente directe",
        de: "PO-NA-1048 · 500 TB · USA Ost · Direktvertrieb",
        ja: "PO-NA-1048・500 TB・米国東部・直接販売",
        pt: "PO-NA-1048 · 500 TB · Leste dos EUA · venda direta",
        zh: "PO-NA-1048 · 500 TB · 美国东部 · 直销",
        ar: "PO-NA-1048 · 500 تيرابايت · شرق الولايات المتحدة · بيع مباشر",
      }),
      statusLabel: demoMessage("status.order.active"),
      status: "active",
      risk: "low",
      owner: "Ada Mercer",
      nextAction: demoMessage("experience.data.next.renewalNoticeOpens", {
        date: onDay("2026-11-01"),
      }),
      context: [
        { label: demoMessage("recordKind.account"), value: meridianAccount },
        {
          label: demoMessage("experience.data.label.serviceTerm"),
          value: dateRange("2026-01-01", "2026-12-31"),
        },
      ],
      authoritative: {
        invoicingAccountId: DIRECT,
        sourcing: "direct",
        status: "active",
        serviceStartsOn: "2026-01-01",
        serviceEndsOn: "2026-12-31",
        noticeOn: "2026-11-01",
      },
    },
    { type: "order", id: MERIDIAN_ORDER_ID },
  ),
  internal(
    "collections",
    "INV-2026-0781",
    {
      title: demoText({
        en: "July committed capacity · Meridian",
        es: "Capacidad contratada de julio · Meridian",
        fr: "Capacité souscrite de juillet · Meridian",
        de: "Vertraglich zugesagte Kapazität Juli · Meridian",
        ja: "7月分の契約容量・Meridian",
        pt: "Capacidade contratada de julho · Meridian",
        zh: "7 月承诺容量 · Meridian",
        ar: "السعة المتعاقد عليها لشهر يوليو · Meridian",
      }),
      name: demoText({
        en: "July committed capacity · Meridian",
        es: "Capacidad contratada de julio · Meridian",
        fr: "Capacité souscrite de juillet · Meridian",
        de: "Vertraglich zugesagte Kapazität Juli · Meridian",
        ja: "7月分の契約容量・Meridian",
        pt: "Capacidade contratada de julho · Meridian",
        zh: "7 月承诺容量 · Meridian",
        ar: "السعة المتعاقد عليها لشهر يوليو · Meridian",
      }),
      reference: "INV-2026-0781",
      description: demoMessage("experience.data.desc.openInvoiceSalesTax"),
      statusLabel: demoMessage("experience.data.status.invoiceOpenDue", {
        date: onDay("2026-08-08"),
      }),
      status: "open",
      risk: "medium",
      owner: "Amina Cole",
      dateLabel: demoMessage("common.dueOn", { date: onDate("2026-08-08") }),
      nextAction: demoMessage("experience.data.next.watchPaymentWebhook"),
      context: [
        { label: demoMessage("recordKind.account"), value: meridianAccount },
      ],
      authoritative: {
        orderId: MERIDIAN_ORDER_ID,
        status: "open",
        dueAt: "2026-08-08T23:59:59.000Z",
      },
      allowedActions: ["evaluate_dunning"],
    },
    { type: "invoice", id: MERIDIAN_INVOICE_ID },
  ),
  internal(
    "reports",
    "RPT-2026-07",
    {
      title: demoMessage("experience.data.title.renewalReport", {
        period: inMonth("2026-07"),
      }),
      reference: "RPT-2026-07",
      description: demoMessage("experience.data.desc.reportBasis"),
      status: "complete",
      statusLabel: demoMessage("status.complete"),
      owner: team.revenueOperations,
      authoritative: {
        report: "renewal_churn_exposure",
        documentId: RENEWAL_REPORT_DOCUMENT_ID,
        status: "complete",
      },
      allowedActions: [],
    },
    { type: "report_export", id: RENEWAL_REPORT_ID },
  ),
];

/**
 * The billing rows whose money is the determination engine's answer, not a
 * fixture literal. `projection-source` overlays them on read; nothing here
 * states a tax figure, because a second statement of a tax figure is exactly
 * the drift the shared engine exists to prevent.
 */
export const demoTaxedBillingRecords: readonly string[] = [
  "customer:billing:INV-2026-0781",
  "customer:billing:INV-2026-0712",
  "customer:billing:invoice-meridian-overdue",
  "customer:billing:invoice-meridian-paid",
  "internal:collections:INV-2026-0781",
];

export const demoAdditionalRecords: readonly DemoPortalRecord[] = [
  ...directJourney,
  ...endClientBook,
  ...partnerBook,
  ...internalBook,
];

/**
 * Due and expiry instants for the commercial fixtures of the direct account,
 * which `commercial/model.ts` states only as display labels ("Expires Aug 4").
 *
 * The customer dashboard orders its obligations by these instants. It used to
 * fall back to `Date.parse` on the English label, which V8 happens to read as
 * a date in 2001; a translated label does not parse at all, so the same demo
 * listed its obligations in a different order in every language. The
 * projection source merges these into the rows' authoritative facts.
 */
export const demoCommercialDueDates: Readonly<
  Record<string, Readonly<Record<string, string>>>
> = {
  "quotes:Q-2026-0184-v3": { expiresAt: "2026-08-04T23:59:59.000Z" },
  "billing:INV-2026-0781": { dueAt: "2026-08-08T23:59:59.000Z" },
};

/* --------------------------------------------------------------------------
 * Orders a prospect created during the demo
 *
 * Everything above is seeded. These are not: they are written by the demo's
 * order-acceptance create pass and read back onto the orders channel, so a
 * prospect who completes the ceremony lands on a record that exists, in the
 * ledger they already know, rather than on a confirmation with nothing behind
 * it. A reset drops them with the rest of the demo state.
 * ----------------------------------------------------------------------- */

/** What the create pass recorded. Written by `DemoOrderAcceptance.create`. */
export interface DemoCreatedOrder {
  readonly id: string;
  readonly domainOrder?: AcceptedOrder;
  readonly organizationId?: string;
  readonly provisioning?: {
    operationId: string;
    submittedAt: string;
    actorId: string;
  };
  readonly quoteRecordKey: string;
  readonly accountId: string;
  readonly audienceAccountId: string;
  readonly orderFormDocumentId: string;
  readonly artifactRequestId: string;
  readonly poNumber: string;
  readonly authorityTitle: string;
  readonly signerName: string;
  readonly serviceStartsOn: string;
  readonly serviceEndsOn: string;
  /** The documentary instant the order form states. */
  readonly acceptedAt: string;
  /** The server's own receive instant, which is what `immutableAt` is. */
  readonly immutableAt: string;
  readonly currency: "USD" | "EUR" | "GBP";
  readonly totalMinor: string;
  readonly agreementReference: string;
  readonly quoteReference: string;
}

/**
 * The record key a created order is addressed by.
 *
 * `record-detail` links a created order as `/orders/order-${id}`, which is the
 * link the acceptance surface already offers on success, so the key carries the
 * same prefix. Nothing else in the demo may claim that shape.
 */
export function demoCreatedOrderKey(orderId: string): string {
  return `order-${orderId}`;
}

/**
 * The created order, as the orders channel serves it.
 *
 * Acceptance establishes the commitment, not a provisioned service. Keep the
 * order pending until a provisioning result exists, including after its planned
 * start date. Every figure comes from the accepted record.
 */
export function demoCreatedOrderRecord(
  order: DemoCreatedOrder,
  /** The reader's formatting locale; this record is built on every read. */
  formatting: string,
): DemoPortalRecord {
  return {
    audience: "customer",
    channel: "orders",
    key: demoCreatedOrderKey(order.id),
    accountId: order.audienceAccountId,
    version: 1,
    updatedAt: order.immutableAt,
    data: {
      ...commercial({
        kind: "orders",
        id: demoCreatedOrderKey(order.id),
        title: demoMessage("experience.data.title.createdOrder", {
          po: order.poNumber,
        }),
        description: demoMessage("experience.data.desc.orderAcceptedFrom", {
          quote: order.quoteReference,
        }),
        status: order.provisioning ? "provisioning" : "pending",
        statusLabel: order.provisioning
          ? demoMessage("experience.data.status.orderProvisioningDemoSubmitted")
          : demoMessage(
              "experience.data.status.orderAcceptedAwaitingProvisioning",
            ),
        tone: "warning",
        risk: "low",
        owner: order.signerName,
        value: formatMoney(order.totalMinor, order.currency, formatting),
        valueLabel: demoMessage("experience.data.label.committedSpend"),
        dateLabel: demoMessage("experience.data.date.accepted", {
          date: onDate(order.acceptedAt.slice(0, 10)),
        }),
        term: demoMessage("experience.data.term.rangeGovernedBy", {
          range: dateRange(order.serviceStartsOn, order.serviceEndsOn),
          agreement: order.agreementReference,
        }),
        nextAction: order.provisioning
          ? demoMessage("experience.data.next.demoProvisionerReceived")
          : demoMessage("experience.data.next.serviceStartsQueued", {
              date: onDate(order.serviceStartsOn),
            }),
      }),
      authoritative: {
        status: order.provisioning ? "provisioning" : "accepted",
      },
      // The bound evidence, carried on the record it bound. The seeded rows get
      // theirs from the artifact catalogue's attachment index; this one was not
      // in the catalogue when the process started, so it names its own.
      artifacts: [
        {
          kind: "order_form" as const,
          id: order.artifactRequestId,
          label: demoMessage("experience.data.artifact.orderFormPo", {
            po: order.poNumber,
          }),
          state: "stored" as const,
        },
      ],
    },
  };
}
