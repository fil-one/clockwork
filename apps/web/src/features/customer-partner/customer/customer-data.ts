import type { Permission } from "@clockwork/contracts";
import {
  demoText,
  type DemoTextField,
} from "@clockwork/testing/demo-localized-text";

import type { MessageId } from "@/src/i18n";

import type {
  CollectionContextField,
  CollectionContextValue,
  CustomerCollectionRecord,
} from "./collection-state";

export type CustomerCollectionKey =
  "amendments" | "users" | "procurement" | "marketplace" | "support";

/** Collection chrome is message IDs; the component renders each with `t`. */
export interface CustomerCollectionChrome {
  key: CustomerCollectionKey;
  eyebrow: MessageId;
  title: MessageId;
  description: MessageId;
  rule: MessageId;
  searchPlaceholder: MessageId;
  permission: Permission;
  path: string;
  recordLabel: MessageId;
  valueLabel: MessageId;
  ownerLabel: MessageId;
  providerNote?: MessageId;
}

export interface CustomerCollectionConfig extends CustomerCollectionChrome {
  records: readonly CustomerCollectionRecord[];
}

type FixtureContextValue =
  | Exclude<CollectionContextValue, { kind: "text" }>
  | { readonly kind: "text"; readonly text: DemoTextField };

/**
 * A fixture row as it is stored, before the demo read boundary resolves it.
 *
 * Titles, descriptions and free-text context stand in for what a person would
 * have typed, so they carry every language with `demoText` (translation policy
 * rule 4). Everything the product itself writes -- the status chip, the value
 * column, the "updated" line, the context labels -- is a fact the page states
 * with a message. Names and references are plain strings, never translated.
 */
export interface CustomerCollectionFixture extends Omit<
  CustomerCollectionRecord,
  "title" | "description" | "context"
> {
  title: DemoTextField;
  description: DemoTextField;
  context: readonly {
    readonly field: CollectionContextField;
    readonly value: FixtureContextValue;
  }[];
}

const madridReplica = {
  kind: "text",
  text: demoText({
    en: "Madrid compliance replica",
    es: "Réplica de cumplimiento de Madrid",
    fr: "Réplique de conformité de Madrid",
    de: "Compliance-Replikat Madrid",
    ja: "マドリードのコンプライアンスレプリカ",
    pt: "Réplica de conformidade de Madri",
    zh: "马德里合规副本",
    ar: "النسخة المتماثلة للامتثال في مدريد",
  }),
} as const;

const primaryArchive = {
  kind: "text",
  text: demoText({
    en: "Northstar primary archive",
    es: "Archivo principal de Northstar",
    fr: "Archive principale Northstar",
    de: "Northstar-Primärarchiv",
    ja: "Northstar プライマリアーカイブ",
    pt: "Arquivo principal da Northstar",
    zh: "Northstar 主归档",
    ar: "الأرشيف الرئيسي لشركة Northstar",
  }),
} as const;

const mfaVerified = { kind: "state", state: "mfaVerified" } as const;
const supportProvider = { kind: "state", state: "supportProvider" } as const;

function literal(text: string) {
  return { kind: "literal", text } as const;
}

function date(on: string) {
  return { kind: "date", on } as const;
}

const amendmentRecords: readonly CustomerCollectionFixture[] = [
  {
    id: "AMD-2026-0028",
    title: demoText({
      en: "Madrid replica capacity increase",
      es: "Ampliación de capacidad de la réplica de Madrid",
      fr: "Augmentation de capacité de la réplique de Madrid",
      de: "Kapazitätserweiterung für das Madrid-Replikat",
      ja: "マドリードのレプリカの容量追加",
      pt: "Aumento de capacidade da réplica de Madri",
      zh: "马德里副本扩容",
      ar: "زيادة سعة النسخة المتماثلة في مدريد",
    }),
    description: demoText({
      en: "Adds 40 TB to the compliance replica after acceptance.",
      es: "Añade 40 TB a la réplica de cumplimiento tras la aceptación.",
      fr: "Ajoute 40 To à la réplique de conformité après acceptation.",
      de: "Erweitert das Compliance-Replikat nach der Annahme um 40 TB.",
      ja: "承諾後、コンプライアンスレプリカに 40 TB を追加します。",
      pt: "Adiciona 40 TB à réplica de conformidade após o aceite.",
      zh: "接受后为合规副本增加 40 TB。",
      ar: "يضيف 40 تيرابايت إلى النسخة المتماثلة للامتثال بعد القبول.",
    }),
    status: "review",
    statusLabel: { detail: "inReview" },
    risk: "medium",
    owner: "Maya Chen",
    value: { kind: "increasePerYear", currency: "USD", amountMinor: "1056000" },
    valueSort: 10560,
    updatedAt: "2026-07-31T14:42:00Z",
    updatedLabel: { update: "updated" },
    href: "/orders/ORD-2026-0112",
    context: [
      { field: "service", value: madridReplica },
      { field: "effective", value: date("2026-08-15") },
    ],
  },
  {
    id: "AMD-2026-0024",
    title: demoText({
      en: "Primary archive purchase-order update",
      es: "Actualización de la orden de compra del archivo principal",
      fr: "Mise à jour du bon de commande de l’archive principale",
      de: "Aktualisierung der Bestellung für das Primärarchiv",
      ja: "プライマリアーカイブの発注書の更新",
      pt: "Atualização da ordem de compra do arquivo principal",
      zh: "主归档采购订单更新",
      ar: "تحديث أمر الشراء للأرشيف الرئيسي",
    }),
    description: demoText({
      en: "Replaces the customer PO; commitment is unchanged.",
      es: "Sustituye la orden de compra del cliente; el compromiso no cambia.",
      fr: "Remplace le bon de commande du client\u202f; l’engagement reste inchangé.",
      de: "Ersetzt die Bestellung des Kunden; die Verpflichtung bleibt unverändert.",
      ja: "顧客の発注書を差し替えます。コミットメントに変更はありません。",
      pt: "Substitui a ordem de compra do cliente; o compromisso não muda.",
      zh: "替换客户的采购订单；承诺不变。",
      ar: "يحل محل أمر الشراء الخاص بالعميل، ويبقى الالتزام دون تغيير.",
    }),
    status: "pending",
    statusLabel: { detail: "awaitingCustomer" },
    risk: "low",
    owner: "Elias Romero",
    value: { kind: "noSpendChange" },
    valueSort: 0,
    updatedAt: "2026-07-30T18:12:00Z",
    updatedLabel: { update: "updated" },
    href: "/orders/ORD-2026-0098",
    context: [
      { field: "service", value: primaryArchive },
      {
        field: "needed",
        value: {
          kind: "text",
          text: demoText({
            en: "Replacement PO",
            es: "Orden de compra sustitutiva",
            fr: "Bon de commande de remplacement",
            de: "Ersatzbestellung",
            ja: "差し替え用の発注書",
            pt: "Ordem de compra substituta",
            zh: "替换采购订单",
            ar: "أمر شراء بديل",
          }),
        },
      },
    ],
  },
  {
    id: "AMD-2026-0019",
    title: demoText({
      en: "Support-response schedule",
      es: "Plan de tiempos de respuesta de soporte",
      fr: "Délais de réponse du support",
      de: "Reaktionszeiten im Support",
      ja: "サポートの応答時間",
      pt: "Prazos de resposta do suporte",
      zh: "支持响应时间表",
      ar: "جدول الاستجابة للدعم",
    }),
    description: demoText({
      en: "Adds the enhanced response schedule to both services.",
      es: "Añade el plan de respuesta ampliado a ambos servicios.",
      fr: "Ajoute les délais de réponse renforcés aux deux services.",
      de: "Ergänzt beide Services um die erweiterten Reaktionszeiten.",
      ja: "両方のサービスに拡張応答時間を追加します。",
      pt: "Adiciona os prazos de resposta ampliados aos dois serviços.",
      zh: "为两项服务增加增强响应时间表。",
      ar: "يضيف جدول الاستجابة المحسّن إلى الخدمتين.",
    }),
    status: "active",
    statusLabel: { detail: "effective" },
    risk: "low",
    owner: "Maya Chen",
    value: { kind: "perYear", currency: "USD", amountMinor: "360000" },
    valueSort: 3600,
    updatedAt: "2026-07-25T11:20:00Z",
    updatedLabel: { update: "updated" },
    href: "/orders/ORD-2026-0098",
    context: [
      { field: "services", value: { kind: "activeServices", count: 2 } },
      { field: "effective", value: date("2026-07-25") },
    ],
  },
  {
    id: "AMD-2026-0014",
    title: demoText({
      en: "EU data-residency clarification",
      es: "Aclaración sobre la residencia de datos en la UE",
      fr: "Précision sur la résidence des données dans l’UE",
      de: "Klarstellung zur Datenresidenz in der EU",
      ja: "EU のデータ所在地の明確化",
      pt: "Esclarecimento sobre residência de dados na UE",
      zh: "欧盟数据驻留说明",
      ar: "توضيح إقامة البيانات في الاتحاد الأوروبي",
    }),
    description: demoText({
      en: "Clarifies permitted processing regions without price impact.",
      es: "Precisa las regiones de tratamiento permitidas, sin efecto en el precio.",
      fr: "Précise les régions de traitement autorisées, sans incidence sur le prix.",
      de: "Präzisiert die zulässigen Verarbeitungsregionen, ohne Auswirkung auf den Preis.",
      ja: "許可される処理リージョンを明確にします。価格への影響はありません。",
      pt: "Esclarece as regiões de processamento permitidas, sem impacto no preço.",
      zh: "明确允许的处理区域，不影响价格。",
      ar: "يوضح مناطق المعالجة المسموح بها دون أثر على السعر.",
    }),
    status: "complete",
    statusLabel: { detail: "completed" },
    risk: "low",
    owner: "Maya Chen",
    value: { kind: "noSpendChange" },
    valueSort: 0,
    updatedAt: "2026-07-18T09:00:00Z",
    updatedLabel: { update: "updated" },
    href: "/orders/ORD-2026-0112",
    context: [
      {
        field: "agreement",
        value: literal("Cloud Service Agreement v3.2"),
      },
      {
        field: "evidence",
        value: {
          kind: "text",
          text: demoText({
            en: "Signed addendum",
            es: "Adenda firmada",
            fr: "Avenant signé",
            de: "Unterzeichneter Nachtrag",
            ja: "署名済みの追加条項",
            pt: "Adendo assinado",
            zh: "已签署的补充协议",
            ar: "ملحق موقّع",
          }),
        },
      },
    ],
  },
  {
    id: "AMD-2026-0007",
    title: demoText({
      en: "Early-start request",
      es: "Solicitud de inicio anticipado",
      fr: "Demande de démarrage anticipé",
      de: "Antrag auf vorgezogenen Start",
      ja: "早期開始の依頼",
      pt: "Solicitação de início antecipado",
      zh: "提前开始申请",
      ar: "طلب البدء المبكر",
    }),
    description: demoText({
      en: "Request closed after the original service date was retained.",
      es: "Solicitud cerrada al mantenerse la fecha de servicio original.",
      fr: "Demande close, la date de service initiale ayant été maintenue.",
      de: "Antrag geschlossen, da das ursprüngliche Servicedatum beibehalten wurde.",
      ja: "当初のサービス開始日が維持されたため、依頼をクローズしました。",
      pt: "Solicitação encerrada após a manutenção da data de serviço original.",
      zh: "因保留原服务日期，申请已关闭。",
      ar: "أُغلق الطلب بعد الإبقاء على تاريخ الخدمة الأصلي.",
    }),
    status: "blocked",
    statusLabel: { detail: "closedNotAccepted" },
    risk: "medium",
    owner: "Amina Cole",
    value: { kind: "noCommitment" },
    valueSort: 0,
    updatedAt: "2026-07-07T16:00:00Z",
    updatedLabel: { update: "updated" },
    href: "/orders/ORD-2026-0112",
    context: [
      {
        field: "reason",
        value: {
          kind: "text",
          text: demoText({
            en: "Purchase order not available",
            es: "Orden de compra no disponible",
            fr: "Bon de commande non disponible",
            de: "Bestellung nicht verfügbar",
            ja: "発注書がありません",
            pt: "Ordem de compra indisponível",
            zh: "采购订单不可用",
            ar: "أمر الشراء غير متوفر",
          }),
        },
      },
      { field: "serviceStart", value: date("2026-07-15") },
    ],
  },
];

const userRecords: readonly CustomerCollectionFixture[] = [
  {
    id: "USR-MAYA",
    title: "Maya Chen",
    description: demoText({
      en: "Account owner with all customer commerce approvals.",
      es: "Propietaria de la cuenta, con todas las aprobaciones comerciales del cliente.",
      fr: "Propriétaire du compte, avec toutes les approbations commerciales côté client.",
      de: "Kontoinhaberin mit allen kaufmännischen Genehmigungen auf Kundenseite.",
      ja: "顧客側の商取引承認をすべて行えるアカウント所有者。",
      pt: "Proprietária da conta, com todas as aprovações comerciais do cliente.",
      zh: "账户所有者，拥有客户侧全部商务审批权限。",
      ar: "مالكة الحساب، ولها جميع صلاحيات الموافقة التجارية لدى العميل.",
    }),
    status: "active",
    statusLabel: { detail: "active" },
    risk: "low",
    owner: "Maya Chen",
    value: { kind: "role", role: "owner" },
    valueSort: 5,
    updatedAt: "2026-07-31T15:22:00Z",
    updatedLabel: { update: "lastActive" },
    context: [
      {
        field: "access",
        value: { kind: "state", state: "allWorkflows" },
      },
      { field: "security", value: mfaVerified },
    ],
  },
  {
    id: "USR-ELIAS",
    title: "Elias Romero",
    description: demoText({
      en: "Billing contact for invoices, payments, and tax records.",
      es: "Contacto de facturación para facturas, pagos y documentación fiscal.",
      fr: "Contact de facturation pour les factures, les paiements et les documents fiscaux.",
      de: "Rechnungskontakt für Rechnungen, Zahlungen und Steuerunterlagen.",
      ja: "請求書、支払い、税務記録を担当する請求担当者。",
      pt: "Contato de faturamento para faturas, pagamentos e registros fiscais.",
      zh: "负责发票、付款和税务记录的账单联系人。",
      ar: "جهة اتصال الفوترة للفواتير والمدفوعات والسجلات الضريبية.",
    }),
    status: "active",
    statusLabel: { detail: "active" },
    risk: "low",
    owner: "Maya Chen",
    value: { kind: "role", role: "billing" },
    valueSort: 4,
    updatedAt: "2026-07-31T12:14:00Z",
    updatedLabel: { update: "lastActive" },
    context: [
      {
        field: "approvalLimit",
        value: { kind: "money", currency: "USD", amountMinor: "5000000" },
      },
      { field: "security", value: mfaVerified },
    ],
  },
  {
    id: "USR-NORA",
    title: "Nora Dlamini",
    description: demoText({
      en: "Member with read access to agreements and services.",
      es: "Miembro con acceso de lectura a acuerdos y servicios.",
      fr: "Membre disposant d’un accès en lecture aux accords et aux services.",
      de: "Mitglied mit Lesezugriff auf Vereinbarungen und Services.",
      ja: "契約とサービスの閲覧権限を持つメンバー。",
      pt: "Membro com acesso de leitura a acordos e serviços.",
      zh: "可只读访问协议和服务的成员。",
      ar: "عضو لديه صلاحية قراءة الاتفاقيات والخدمات.",
    }),
    status: "active",
    statusLabel: { detail: "active" },
    risk: "low",
    owner: "Maya Chen",
    value: { kind: "role", role: "member" },
    valueSort: 2,
    updatedAt: "2026-07-29T08:10:00Z",
    updatedLabel: { update: "lastActive" },
    context: [
      {
        field: "access",
        value: { kind: "state", state: "viewCommercialRecords" },
      },
      { field: "security", value: mfaVerified },
    ],
  },
  {
    id: "INV-JUNO",
    title: "Juno Okafor",
    description: demoText({
      en: "Invited as an account administrator and legal approver.",
      es: "Invitación enviada para administrar la cuenta y aprobar en el ámbito legal.",
      fr: "Invitation envoyée pour les rôles d’administrateur du compte et d’approbateur juridique.",
      de: "Eingeladen als Administrator des Kontos und genehmigende Person (Recht).",
      ja: "アカウント管理者および法務承認者として招待済み。",
      pt: "Convidada como administradora da conta e aprovadora jurídica.",
      zh: "已邀请担任账户管理员和法务审批人。",
      ar: "دُعي بصفة مشرف على الحساب وموافِق قانوني.",
    }),
    status: "pending",
    statusLabel: { detail: "invitationPending" },
    risk: "medium",
    owner: "Maya Chen",
    value: { kind: "role", role: "admin" },
    valueSort: 3,
    updatedAt: "2026-07-28T13:40:00Z",
    updatedLabel: { update: "invited" },
    context: [
      { field: "expires", value: date("2026-08-06") },
      {
        field: "security",
        value: { kind: "state", state: "mfaNotEnrolled" },
      },
    ],
  },
  {
    id: "USR-PRIYA",
    title: "Priya Shah",
    description: demoText({
      en: "Former procurement member retained in audit evidence.",
      es: "Antigua integrante del equipo de compras; se conserva en la evidencia de auditoría.",
      fr: "Ancienne membre des achats, conservée dans les preuves d’audit.",
      de: "Ehemaliges Mitglied des Einkaufs, in den Audit-Nachweisen aufbewahrt.",
      ja: "監査証跡に記録が保持されている、調達担当の元メンバー。",
      pt: "Ex-integrante da equipe de compras, mantida nas evidências de auditoria.",
      zh: "前采购成员，记录保留在审计证据中。",
      ar: "عضوة سابقة في فريق المشتريات، ويُحتفظ بسجلها ضمن أدلة التدقيق.",
    }),
    status: "complete",
    statusLabel: { detail: "accessRemoved" },
    risk: "low",
    owner: "Maya Chen",
    value: { kind: "role", role: "formerMember" },
    valueSort: 1,
    updatedAt: "2026-07-02T17:00:00Z",
    updatedLabel: { update: "removed" },
    context: [
      {
        field: "access",
        value: { kind: "state", state: "noCurrentAccess" },
      },
      {
        field: "evidence",
        value: { kind: "state", state: "removalRecorded" },
      },
    ],
  },
];

const procurementRecords: readonly CustomerCollectionFixture[] = [
  {
    id: "PROC-AP",
    title: demoText({
      en: "Accounts payable routing",
      es: "Envío a cuentas a pagar",
      fr: "Acheminement vers la comptabilité fournisseurs",
      de: "Weiterleitung an die Kreditorenbuchhaltung",
      ja: "買掛金担当への送付",
      pt: "Encaminhamento para contas a pagar",
      zh: "应付账款投递",
      ar: "توجيه الفواتير إلى الحسابات الدائنة",
    }),
    description: demoText({
      en: "Routes invoices and credits to the verified billing inbox.",
      es: "Envía facturas y facturas rectificativas al buzón de facturación verificado.",
      fr: "Achemine les factures et les avoirs vers la boîte de facturation vérifiée.",
      de: "Leitet Rechnungen und Gutschriften an das verifizierte Rechnungspostfach weiter.",
      ja: "請求書とクレジットノートを確認済みの請求用メールボックスに送付します。",
      pt: "Encaminha faturas e notas de crédito para a caixa de entrada de faturamento verificada.",
      zh: "将发票和贷项通知单发送至已验证的账单邮箱。",
      ar: "يوجّه الفواتير والإشعارات الدائنة إلى صندوق بريد الفوترة المُتحقق منه.",
    }),
    status: "active",
    statusLabel: { detail: "verified" },
    risk: "low",
    owner: "Elias Romero",
    value: "ap@northstar.example",
    valueSort: 5,
    updatedAt: "2026-07-31T10:10:00Z",
    updatedLabel: { update: "verified" },
    context: [
      {
        field: "invoiceDelivery",
        value: { kind: "state", state: "emailAndPortal" },
      },
      {
        field: "creditDelivery",
        value: { kind: "state", state: "email" },
      },
    ],
  },
  {
    id: "PROC-COUPA",
    title: demoText({
      en: "Coupa supplier onboarding",
      es: "Alta de proveedores en Coupa",
      fr: "Référencement fournisseur dans Coupa",
      de: "Lieferantenaufnahme in Coupa",
      ja: "Coupa での仕入先登録",
      pt: "Cadastro de fornecedores no Coupa",
      zh: "Coupa 供应商准入",
      ar: "تسجيل الموردين في Coupa",
    }),
    description: demoText({
      en: "Customer supplier setup is waiting on its bank check.",
      es: "El alta como proveedor en el sistema del cliente está pendiente de la verificación bancaria.",
      fr: "Le référencement fournisseur chez le client attend la vérification bancaire.",
      de: "Die Lieferantenanlage beim Kunden wartet auf die Bankprüfung.",
      ja: "顧客側の仕入先登録は銀行口座の確認待ちです。",
      pt: "O cadastro de fornecedor no cliente aguarda a verificação bancária.",
      zh: "客户侧供应商设置正在等待银行核验。",
      ar: "إعداد المورّد لدى العميل بانتظار التحقق المصرفي.",
    }),
    status: "pending",
    statusLabel: { detail: "awaitingBankCheck" },
    risk: "medium",
    owner: "Elias Romero",
    value: { kind: "dueOn", on: "2026-08-12" },
    valueSort: 12,
    updatedAt: "2026-07-30T09:15:00Z",
    updatedLabel: { update: "updated" },
    context: [
      { field: "system", value: literal("Coupa") },
      {
        field: "nextStep",
        value: {
          kind: "text",
          text: demoText({
            en: "Customer bank verification",
            es: "Verificación bancaria del cliente",
            fr: "Vérification bancaire par le client",
            de: "Bankprüfung durch den Kunden",
            ja: "顧客による銀行口座の確認",
            pt: "Verificação bancária do cliente",
            zh: "客户银行核验",
            ar: "التحقق المصرفي للعميل",
          }),
        },
      },
    ],
  },
  {
    id: "TAX-US-019",
    title: demoText({
      en: "US resale exemption",
      es: "Exención por reventa en EE. UU.",
      fr: "Exonération pour revente aux États-Unis",
      de: "Befreiung für Wiederverkauf (US)",
      ja: "米国の再販免税",
      pt: "Isenção de revenda nos EUA",
      zh: "美国转售免税",
      ar: "إعفاء إعادة البيع في الولايات المتحدة",
    }),
    description: demoText({
      en: "New York sales-tax exemption evidence on file.",
      es: "Consta el justificante de exención del impuesto sobre las ventas de Nueva York.",
      fr: "Justificatif d’exonération de la taxe sur les ventes de l’État de New York enregistré.",
      de: "Nachweis der Befreiung von der Verkaufssteuer (US) in New York liegt vor.",
      ja: "ニューヨーク州の売上税免除の証憑を登録済みです。",
      pt: "Comprovante de isenção do imposto sobre vendas de Nova York registrado.",
      zh: "已存档纽约州销售税免税凭证。",
      ar: "مستند الإعفاء من ضريبة المبيعات في نيويورك محفوظ في السجل.",
    }),
    status: "active",
    statusLabel: { detail: "current" },
    risk: "low",
    owner: "Elias Romero",
    value: { kind: "expiresOn", on: "2027-03-31" },
    valueSort: 20270331,
    updatedAt: "2026-07-21T13:00:00Z",
    updatedLabel: { update: "updated" },
    context: [
      {
        field: "jurisdiction",
        value: {
          kind: "text",
          text: demoText({
            en: "New York",
            es: "Nueva York",
            fr: "État de New York",
            de: "New York",
            ja: "ニューヨーク州",
            pt: "Nova York",
            zh: "纽约州",
            ar: "نيويورك",
          }),
        },
      },
      {
        field: "document",
        value: {
          kind: "text",
          text: demoText({
            en: "Exemption certificate",
            es: "Certificado de exención",
            fr: "Certificat d’exonération",
            de: "Befreiungsbescheinigung",
            ja: "免税証明書",
            pt: "Certificado de isenção",
            zh: "免税证明",
            ar: "شهادة إعفاء",
          }),
        },
      },
    ],
  },
  {
    id: "PO-NA-1081",
    title: demoText({
      en: "Madrid replica purchase order",
      es: "Orden de compra de la réplica de Madrid",
      fr: "Bon de commande de la réplique de Madrid",
      de: "Bestellung für das Madrid-Replikat",
      ja: "マドリードのレプリカの発注書",
      pt: "Ordem de compra da réplica de Madri",
      zh: "马德里副本采购订单",
      ar: "أمر شراء النسخة المتماثلة في مدريد",
    }),
    description: demoText({
      en: "Purchase order accepted for the EU compliance service.",
      es: "Orden de compra aceptada para el servicio de cumplimiento en la UE.",
      fr: "Bon de commande accepté pour le service de conformité dans l’UE.",
      de: "Bestellung für den EU-Compliance-Service angenommen.",
      ja: "EU コンプライアンスサービスの発注書を承諾しました。",
      pt: "Ordem de compra aceita para o serviço de conformidade na UE.",
      zh: "欧盟合规服务的采购订单已接受。",
      ar: "قُبل أمر الشراء لخدمة الامتثال في الاتحاد الأوروبي.",
    }),
    status: "complete",
    statusLabel: { detail: "accepted" },
    risk: "low",
    owner: "Elias Romero",
    value: { kind: "perYear", currency: "USD", amountMinor: "3168000" },
    valueSort: 31680,
    updatedAt: "2026-07-15T12:00:00Z",
    updatedLabel: { update: "accepted" },
    context: [
      { field: "service", value: madridReplica },
      { field: "order", value: literal("ORD-2026-0112") },
    ],
  },
  {
    id: "PROC-W9",
    title: demoText({
      en: "Supplier tax form",
      es: "Formulario fiscal del proveedor",
      fr: "Formulaire fiscal fournisseur",
      de: "Steuerformular des Lieferanten",
      ja: "仕入先の税務書類",
      pt: "Formulário fiscal do fornecedor",
      zh: "供应商税务表格",
      ar: "النموذج الضريبي للمورّد",
    }),
    description: demoText({
      en: "Current supplier tax documentation available for download.",
      es: "Documentación fiscal vigente del proveedor, disponible para descargar.",
      fr: "Documents fiscaux fournisseur à jour, disponibles au téléchargement.",
      de: "Aktuelle Steuerunterlagen des Lieferanten zum Herunterladen verfügbar.",
      ja: "最新の仕入先税務書類をダウンロードできます。",
      pt: "Documentação fiscal atual do fornecedor disponível para download.",
      zh: "可下载供应商当前的税务文件。",
      ar: "المستندات الضريبية الحالية للمورّد متاحة للتنزيل.",
    }),
    status: "active",
    statusLabel: { detail: "current" },
    risk: "low",
    owner: "Elias Romero",
    value: { kind: "taxFormYear", year: 2026 },
    valueSort: 2026,
    updatedAt: "2026-06-18T10:00:00Z",
    updatedLabel: { update: "updated" },
    context: [
      { field: "entity", value: literal("Fil One, Inc.") },
      {
        field: "classification",
        value: {
          kind: "text",
          text: demoText({
            en: "Corporation",
            es: "Sociedad mercantil",
            fr: "Société de capitaux",
            de: "Kapitalgesellschaft",
            ja: "法人",
            pt: "Sociedade empresária",
            zh: "公司",
            ar: "شركة",
          }),
        },
      },
    ],
  },
];

const marketplaceRecords: readonly CustomerCollectionFixture[] = [
  {
    id: "AWS-OFFER-1948",
    title: demoText({
      en: "AWS private offer · primary archive",
      es: "Oferta privada de AWS · archivo principal",
      fr: "Offre privée AWS · archive principale",
      de: "Privates Angebot von AWS · Primärarchiv",
      ja: "AWS プライベートオファー・プライマリアーカイブ",
      pt: "Oferta privada da AWS · arquivo principal",
      zh: "AWS 私有报价 · 主归档",
      ar: "عرض AWS الخاص · الأرشيف الرئيسي",
    }),
    description: demoText({
      en: "Provider reports that the accepted offer is fulfilled.",
      es: "El proveedor informa de que la oferta aceptada se ha completado.",
      fr: "Le prestataire indique que l’offre acceptée est exécutée.",
      de: "Laut Anbieter ist das angenommene Angebot abgewickelt.",
      ja: "承諾済みのオファーは履行済みとプロバイダーから報告されています。",
      pt: "O provedor informa que a oferta aceita foi atendida.",
      zh: "服务商报告已接受的报价已履约。",
      ar: "يفيد المزوّد بأن العرض المقبول قد نُفّذ.",
    }),
    status: "active",
    statusLabel: { detail: "active" },
    risk: "low",
    owner: "Elias Romero",
    value: { kind: "perYear", currency: "USD", amountMinor: "18480000" },
    valueSort: 184800,
    updatedAt: "2026-07-31T15:42:00Z",
    updatedLabel: { update: "providerSync" },
    context: [
      { field: "marketplace", value: literal("AWS Marketplace") },
      {
        field: "billing",
        value: { kind: "merchantOfRecord", provider: "AWS" },
      },
    ],
  },
  {
    id: "AZURE-OFFER-0412",
    title: demoText({
      en: "Azure offer · UK expansion",
      es: "Oferta de Azure · ampliación en el Reino Unido",
      fr: "Offre Azure · extension au Royaume-Uni",
      de: "Angebot von Azure · UK-Erweiterung",
      ja: "Azure オファー・英国での拡張",
      pt: "Oferta do Azure · expansão no Reino Unido",
      zh: "Azure 报价 · 英国扩展",
      ar: "عرض Azure · التوسع في المملكة المتحدة",
    }),
    description: demoText({
      en: "The offer is available in the buyer account but not accepted.",
      es: "La oferta está disponible en la cuenta del comprador, pero no se ha aceptado.",
      fr: "L’offre est disponible dans le compte acheteur mais n’a pas été acceptée.",
      de: "Das Angebot liegt im Käuferkonto vor, ist aber nicht angenommen.",
      ja: "オファーは購入者アカウントで利用できますが、承諾されていません。",
      pt: "A oferta está disponível na conta do comprador, mas não foi aceita.",
      zh: "该报价已在买方账户中提供，但未被接受。",
      ar: "العرض متاح في حساب المشتري لكنه لم يُقبل.",
    }),
    status: "pending",
    statusLabel: { detail: "buyerAcceptanceNeeded" },
    risk: "medium",
    owner: "Maya Chen",
    value: { kind: "perYear", currency: "GBP", amountMinor: "7299000" },
    valueSort: 72990,
    updatedAt: "2026-07-30T16:30:00Z",
    updatedLabel: { update: "providerSync" },
    context: [
      { field: "marketplace", value: literal("Azure Marketplace") },
      { field: "expires", value: date("2026-08-04") },
    ],
  },
  {
    id: "GCP-OFFER-0087",
    title: demoText({
      en: "Google Cloud offer · Madrid replica",
      es: "Oferta de Google Cloud · réplica de Madrid",
      fr: "Offre Google Cloud · réplique de Madrid",
      de: "Angebot von Google Cloud · Madrid-Replikat",
      ja: "Google Cloud オファー・マドリードのレプリカ",
      pt: "Oferta do Google Cloud · réplica de Madri",
      zh: "Google Cloud 报价 · 马德里副本",
      ar: "عرض Google Cloud · النسخة المتماثلة في مدريد",
    }),
    description: demoText({
      en: "Disbursement is pending in the read-only provider feed.",
      es: "El desembolso figura como pendiente en los datos de solo lectura del proveedor.",
      fr: "Le versement est en attente dans le flux en lecture seule du prestataire.",
      de: "Die Auszahlung ist im schreibgeschützten Anbieter-Feed als ausstehend gemeldet.",
      ja: "読み取り専用のプロバイダーフィードでは、支払いが保留中です。",
      pt: "O desembolso está pendente no feed somente leitura do provedor.",
      zh: "只读服务商数据源显示付款待处理。",
      ar: "صرف المستحقات قيد الانتظار في بيانات المزوّد المتاحة للقراءة فقط.",
    }),
    status: "review",
    statusLabel: { detail: "disbursementPending" },
    risk: "low",
    owner: "Elias Romero",
    value: { kind: "perYear", currency: "EUR", amountMinor: "3168000" },
    valueSort: 31680,
    updatedAt: "2026-07-29T20:00:00Z",
    updatedLabel: { update: "providerSync" },
    context: [
      { field: "marketplace", value: literal("Google Cloud Marketplace") },
      {
        field: "billing",
        // i18n-exempt: provider's company name
        value: { kind: "merchantOfRecord", provider: "Google" },
      },
    ],
  },
  {
    id: "AWS-OFFER-1764",
    title: demoText({
      en: "AWS private offer · recovery sandbox",
      es: "Oferta privada de AWS · entorno de pruebas de recuperación",
      fr: "Offre privée AWS · environnement de test de reprise",
      de: "Privates Angebot von AWS · Testumgebung für Wiederherstellung",
      ja: "AWS プライベートオファー・復旧用サンドボックス",
      pt: "Oferta privada da AWS · ambiente de testes de recuperação",
      zh: "AWS 私有报价 · 恢复沙盒",
      ar: "عرض AWS الخاص · بيئة اختبار الاستعادة",
    }),
    description: demoText({
      en: "Expired offer retained as commercial audit evidence.",
      es: "Oferta caducada conservada como evidencia de auditoría comercial.",
      fr: "Offre expirée conservée comme preuve d’audit commercial.",
      de: "Abgelaufenes Angebot, als kaufmännischer Audit-Nachweis aufbewahrt.",
      ja: "期限切れのオファー。商取引の監査証跡として保持しています。",
      pt: "Oferta expirada mantida como evidência de auditoria comercial.",
      zh: "已过期的报价，作为商务审计证据保留。",
      ar: "عرض منتهي الصلاحية محفوظ كدليل تدقيق تجاري.",
    }),
    status: "complete",
    statusLabel: { detail: "expired" },
    risk: "low",
    owner: "Maya Chen",
    value: { kind: "estimated", currency: "USD", amountMinor: "420000" },
    valueSort: 4200,
    updatedAt: "2026-07-09T12:00:00Z",
    updatedLabel: { update: "expired" },
    context: [
      { field: "marketplace", value: literal("AWS Marketplace") },
      { field: "commitment", value: { kind: "state", state: "none" } },
    ],
  },
];

const supportRecords: readonly CustomerCollectionFixture[] = [
  {
    id: "SUP-18421",
    title: demoText({
      en: "Restore sample timing",
      es: "Tiempos de restauración de una muestra",
      fr: "Délai de restauration d’un échantillon",
      de: "Dauer der Wiederherstellung einer Stichprobe",
      ja: "サンプル復元の所要時間",
      pt: "Tempo de restauração da amostra",
      zh: "样本恢复耗时",
      ar: "توقيت استعادة العينة",
    }),
    description: demoText({
      en: "Support is reviewing the latest sample recovery timings.",
      es: "Soporte está revisando los últimos tiempos de recuperación de la muestra.",
      fr: "Le support examine les derniers délais de restauration de l’échantillon.",
      de: "Der Support prüft die aktuellen Wiederherstellungszeiten der Stichprobe.",
      ja: "サポートが最新のサンプル復旧時間を確認しています。",
      pt: "O suporte está analisando os tempos de recuperação mais recentes da amostra.",
      zh: "支持团队正在核查最新的样本恢复耗时。",
      ar: "يراجع فريق الدعم أحدث أوقات استعادة العينة.",
    }),
    status: "active",
    statusLabel: { detail: "inProgress" },
    risk: "low",
    owner: "Nora Dlamini",
    value: { kind: "priority", priority: "normal" },
    valueSort: 2,
    updatedAt: "2026-07-31T15:32:00Z",
    updatedLabel: { update: "providerUpdate" },
    context: [
      { field: "service", value: primaryArchive },
      { field: "source", value: supportProvider },
    ],
  },
  {
    id: "SUP-18307",
    title: demoText({
      en: "EU usage export",
      es: "Exportación del uso en la UE",
      fr: "Export de la consommation UE",
      de: "Export der EU-Nutzung",
      ja: "EU の使用量のエクスポート",
      pt: "Exportação de uso na UE",
      zh: "欧盟用量导出",
      ar: "تصدير الاستخدام في الاتحاد الأوروبي",
    }),
    description: demoText({
      en: "Support needs the requested export time range from the customer.",
      es: "Soporte necesita que el cliente indique el intervalo de fechas de la exportación.",
      fr: "Le support attend du client la période souhaitée pour l’export.",
      de: "Der Support benötigt vom Kunden den gewünschten Zeitraum für den Export.",
      ja: "サポートは、エクスポート対象期間を顧客から受け取る必要があります。",
      pt: "O suporte precisa que o cliente informe o período da exportação.",
      zh: "支持团队需要客户提供导出的时间范围。",
      ar: "يحتاج فريق الدعم إلى أن يحدد العميل الفترة الزمنية المطلوبة للتصدير.",
    }),
    status: "pending",
    statusLabel: { detail: "awaitingCustomer" },
    risk: "low",
    owner: "Nora Dlamini",
    value: { kind: "priority", priority: "normal" },
    valueSort: 2,
    updatedAt: "2026-07-30T14:15:00Z",
    updatedLabel: { update: "providerUpdate" },
    context: [
      { field: "service", value: madridReplica },
      {
        field: "nextStep",
        value: {
          kind: "text",
          text: demoText({
            en: "Confirm export range",
            es: "Confirmar el intervalo de exportación",
            fr: "Confirmer la période d’export",
            de: "Exportzeitraum bestätigen",
            ja: "エクスポート期間の確認",
            pt: "Confirmar o período de exportação",
            zh: "确认导出范围",
            ar: "تأكيد فترة التصدير",
          }),
        },
      },
    ],
  },
  {
    id: "SUP-18288",
    title: demoText({
      en: "Marketplace invoice reference",
      es: "Referencia de factura de Marketplace",
      fr: "Référence de facture Marketplace",
      de: "Rechnungsreferenz aus dem Marketplace",
      ja: "マーケットプレイスの請求書参照番号",
      pt: "Referência de fatura do marketplace",
      zh: "云市场发票编号",
      ar: "مرجع فاتورة السوق الإلكتروني",
    }),
    description: demoText({
      en: "AWS invoice reference was reconciled with the service order.",
      es: "La referencia de la factura de AWS se ha conciliado con el pedido del servicio.",
      fr: "La référence de facture AWS a été rapprochée de la commande de service.",
      de: "Die AWS-Rechnungsreferenz wurde mit dem Serviceauftrag abgestimmt.",
      ja: "AWS の請求書参照番号をサービスの注文と照合しました。",
      pt: "A referência da fatura da AWS foi conciliada com o pedido de serviço.",
      zh: "AWS 发票编号已与服务订单完成对账。",
      ar: "تمت مطابقة مرجع فاتورة AWS مع طلب الخدمة.",
    }),
    status: "complete",
    statusLabel: { detail: "resolved" },
    risk: "low",
    owner: "Elias Romero",
    value: { kind: "resolved" },
    valueSort: 1,
    updatedAt: "2026-07-27T09:35:00Z",
    updatedLabel: { update: "resolved" },
    context: [
      { field: "invoice", value: literal("INV-2026-0781") },
      { field: "source", value: supportProvider },
    ],
  },
  {
    id: "SUP-18159",
    title: demoText({
      en: "Provisioning status clarification",
      es: "Aclaración del estado del aprovisionamiento",
      fr: "Précision sur l’état du provisionnement",
      de: "Klärung des Bereitstellungsstatus",
      ja: "プロビジョニング状況の確認",
      pt: "Esclarecimento sobre o status do provisionamento",
      zh: "开通状态说明",
      ar: "توضيح حالة التهيئة",
    }),
    description: demoText({
      en: "Provider escalation completed; provisioning remains in progress.",
      es: "Escalado con el proveedor completado; el aprovisionamiento sigue en curso.",
      fr: "Escalade auprès du prestataire terminée\u202f; le provisionnement est toujours en cours.",
      de: "Eskalation beim Anbieter abgeschlossen; die Bereitstellung läuft weiter.",
      ja: "プロバイダーへのエスカレーションは完了しました。プロビジョニングは引き続き進行中です。",
      pt: "Escalonamento com o provedor concluído; o provisionamento continua em andamento.",
      zh: "服务商升级处理已完成；开通仍在进行中。",
      ar: "اكتمل التصعيد لدى المزوّد، ولا تزال التهيئة جارية.",
    }),
    status: "complete",
    statusLabel: { detail: "resolved" },
    risk: "medium",
    owner: "Maya Chen",
    value: { kind: "priority", priority: "high" },
    valueSort: 3,
    updatedAt: "2026-07-22T18:00:00Z",
    updatedLabel: { update: "resolved" },
    context: [
      { field: "order", value: literal("ORD-2026-0112") },
      {
        field: "evidence",
        value: {
          kind: "text",
          text: demoText({
            en: "Provider response attached",
            es: "Respuesta del proveedor adjunta",
            fr: "Réponse du prestataire jointe",
            de: "Antwort des Anbieters angehängt",
            ja: "プロバイダーの回答を添付済み",
            pt: "Resposta do provedor anexada",
            zh: "已附服务商回复",
            ar: "رد المزوّد مرفق",
          }),
        },
      },
    ],
  },
];

export const customerCollections: Readonly<
  Record<
    CustomerCollectionKey,
    CustomerCollectionChrome & {
      records: readonly CustomerCollectionFixture[];
    }
  >
> = {
  amendments: {
    key: "amendments",
    eyebrow: "customer.collection.amendments.eyebrow",
    title: "customer.collection.amendments.title",
    description: "customer.collection.amendments.description",
    searchPlaceholder: "customer.collection.amendments.search",
    rule: "customer.collection.amendments.rule",
    permission: "order:write",
    path: "/amendments",
    recordLabel: "recordKind.amendment",
    valueLabel: "customer.collection.amendments.valueLabel",
    ownerLabel: "common.owner",
    records: amendmentRecords,
  },
  users: {
    key: "users",
    eyebrow: "customer.collection.users.eyebrow",
    title: "customer.collection.users.title",
    description: "customer.collection.users.description",
    searchPlaceholder: "customer.collection.users.search",
    rule: "customer.collection.users.rule",
    permission: "account:write",
    path: "/account/users",
    recordLabel: "customer.collection.users.recordLabel",
    valueLabel: "customer.collection.users.valueLabel",
    ownerLabel: "customer.collection.users.ownerLabel",
    records: userRecords,
  },
  procurement: {
    key: "procurement",
    eyebrow: "customer.collection.procurement.eyebrow",
    title: "customer.collection.procurement.title",
    description: "customer.collection.procurement.description",
    searchPlaceholder: "customer.collection.procurement.search",
    rule: "customer.collection.procurement.rule",
    permission: "account:write",
    path: "/account/procurement",
    recordLabel: "customer.collection.procurement.recordLabel",
    valueLabel: "customer.collection.procurement.valueLabel",
    ownerLabel: "common.owner",
    records: procurementRecords,
  },
  marketplace: {
    key: "marketplace",
    eyebrow: "customer.collection.marketplace.eyebrow",
    title: "customer.collection.marketplace.title",
    description: "customer.collection.marketplace.description",
    searchPlaceholder: "customer.collection.marketplace.search",
    rule: "customer.collection.marketplace.rule",
    permission: "account:read",
    path: "/marketplace",
    recordLabel: "customer.collection.marketplace.recordLabel",
    valueLabel: "customer.collection.marketplace.valueLabel",
    ownerLabel: "customer.collection.marketplace.ownerLabel",
    providerNote: "customer.collection.marketplace.providerNote",
    records: marketplaceRecords,
  },
  support: {
    key: "support",
    eyebrow: "customer.collection.support.eyebrow",
    title: "customer.collection.support.title",
    description: "customer.collection.support.description",
    searchPlaceholder: "customer.collection.support.search",
    rule: "customer.collection.support.rule",
    permission: "account:read",
    path: "/support",
    recordLabel: "customer.collection.support.recordLabel",
    valueLabel: "customer.collection.support.valueLabel",
    ownerLabel: "customer.collection.support.ownerLabel",
    providerNote: "customer.collection.support.providerNote",
    records: supportRecords,
  },
};
