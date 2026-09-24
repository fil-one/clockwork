import {
  demoText,
  type DemoLocalizedText,
} from "@clockwork/testing/demo-localized-text";

/**
 * The one checked-in dataset left on the internal lifecycle surfaces.
 *
 * Renewals, collections, provisioning and reports used to be served from
 * constants in this file. They are read from their projection channels now, so
 * those constants are gone rather than left available for a surface to fall
 * back onto.
 *
 * Migration matching has no channel, no read model and no candidate table:
 * `lifecycle_migration_runs` and `lifecycle_migration_matches` record decisions
 * already taken, and nothing persists the pending candidates the surface exists
 * to resolve. These records are kept as declared examples of that decision, and
 * `/internal/migrations` says on the page that they are examples.
 *
 * Names, references, domains and country codes are facts and stay as written.
 * The source-system name and the matching evidence stand in for text a legacy
 * system or an analyst would have supplied, so they are demo-authored text in
 * every interface language (translation policy rule 4); the relationship of a
 * candidate is a closed set the surface words itself.
 */

/** How a candidate account relates to Fil One, as the account records it. */
export type CandidateRelationship =
  "directBuyer" | "subsidiary" | "distributor";

export interface MigrationCandidate {
  id: string;
  name: string;
  /** ISO 3166 code of the entity's country, shown as the code. */
  country: string;
  relationship: CandidateRelationship;
  /** The verified domain on the account. */
  domain: string;
  confidence: number;
}

export interface MigrationRecord {
  id: string;
  sourceName: string;
  sourceSystem: DemoLocalizedText;
  legalEntity: string;
  externalReference: string;
  candidates: readonly MigrationCandidate[];
  evidence: DemoLocalizedText;
}

export const illustrativeMigrations: readonly MigrationRecord[] = [
  {
    id: "MIG-EXAMPLE-016",
    sourceName: "Northstar Archive",
    sourceSystem: demoText({
      en: "Legacy billing (US)",
      es: "Facturación heredada (EE. UU.)",
      fr: "Ancienne facturation (États-Unis)",
      de: "Altes Abrechnungssystem (USA)",
      ja: "旧請求システム（米国）",
      pt: "Faturamento legado (EUA)",
      zh: "旧计费系统（美国）",
      ar: "نظام الفوترة القديم (الولايات المتحدة)",
    }),
    legalEntity: "Northstar Archive Labs, Inc.",
    externalReference: "legacy-customer-1048",
    candidates: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Northstar Archive Labs",
        country: "US",
        relationship: "directBuyer",
        domain: "northstar.example",
        confidence: 96,
      },
      {
        id: "4ef7bc88-805b-4aac-842c-21a3b5243c69",
        name: "Northstar Archive Labs UK",
        country: "UK",
        relationship: "subsidiary",
        domain: "northstar.co.uk",
        confidence: 72,
      },
    ],
    evidence: demoText({
      en: "The tax name matches the US entity; the legacy email domain is shared by both candidates.",
      es: "El nombre fiscal coincide con el de la entidad de EE. UU.; el dominio de correo heredado es común a ambos candidatos.",
      fr: "La dénomination fiscale correspond à celle de l’entité américaine\u202f; le domaine de messagerie hérité est commun aux deux candidats.",
      de: "Die steuerliche Firmierung stimmt mit der US-Gesellschaft überein; die alte E-Mail-Domain nutzen beide Kandidaten.",
      ja: "税務上の名称は米国法人と一致します。旧メールドメインは両方の候補に共通です。",
      pt: "A razão social corresponde à da entidade dos EUA; o domínio de e-mail legado é compartilhado pelos dois candidatos.",
      zh: "税务名称与美国实体一致；旧电子邮件域名由两个候选账户共用。",
      ar: "يطابق الاسم الضريبي اسمَ الكيان الأمريكي، ونطاق البريد الإلكتروني القديم مشترك بين المرشحَين.",
    }),
  },
  {
    id: "MIG-EXAMPLE-021",
    sourceName: "Solace Public Records",
    sourceSystem: demoText({
      en: "Partner ledger",
      es: "Registro de socios",
      fr: "Registre des partenaires",
      de: "Partnerregister",
      ja: "パートナー台帳",
      pt: "Registro de parceiros",
      zh: "合作伙伴台账",
      ar: "سجل الشركاء",
    }),
    legalEntity: "Solace Public Records Authority",
    externalReference: "partner-ledger-0041",
    candidates: [
      {
        id: "0af8d9dd-3790-45a2-8f86-c66fa8c18a04",
        name: "Solace Public Records",
        country: "US",
        relationship: "distributor",
        domain: "solace.example.gov",
        confidence: 99,
      },
    ],
    evidence: demoText({
      en: "The legal name, tax suffix and invoice domain agree.",
      es: "La denominación legal, el sufijo fiscal y el dominio de facturación coinciden.",
      fr: "La dénomination légale, le suffixe fiscal et le domaine de facturation concordent.",
      de: "Firmierung, Steuersuffix und Rechnungsdomain stimmen überein.",
      ja: "法人名、税務サフィックス、請求書ドメインが一致しています。",
      pt: "A razão social, o sufixo fiscal e o domínio de faturamento coincidem.",
      zh: "法定名称、税务后缀和发票域名一致。",
      ar: "يتطابق الاسم القانوني واللاحقة الضريبية ونطاق الفواتير.",
    }),
  },
  {
    id: "MIG-EXAMPLE-024",
    sourceName: "Orion Geological Survey",
    sourceSystem: demoText({
      en: "Legacy CRM (EU)",
      es: "CRM heredado (UE)",
      fr: "Ancien CRM (UE)",
      de: "Altes CRM (EU)",
      ja: "旧 CRM（EU）",
      pt: "CRM legado (UE)",
      zh: "旧 CRM（欧盟）",
      ar: "نظام CRM القديم (الاتحاد الأوروبي)",
    }),
    legalEntity: "Orion Geological Survey GmbH",
    externalReference: "crm-eu-8821",
    candidates: [],
    evidence: demoText({
      en: "No current account shares the legal name, tax suffix or verified domain.",
      es: "Ninguna cuenta actual comparte la denominación legal, el sufijo fiscal ni el dominio verificado.",
      fr: "Aucun compte actuel ne partage la dénomination légale, le suffixe fiscal ou le domaine vérifié.",
      de: "Kein bestehendes Konto stimmt in Firmierung, Steuersuffix oder verifizierter Domain überein.",
      ja: "法人名、税務サフィックス、検証済みドメインのいずれも一致する既存アカウントはありません。",
      pt: "Nenhuma conta atual tem a mesma razão social, o mesmo sufixo fiscal ou o mesmo domínio verificado.",
      zh: "没有现有账户与其法定名称、税务后缀或已验证域名相同。",
      ar: "لا يوجد حساب حالي يشترك معه في الاسم القانوني أو اللاحقة الضريبية أو النطاق المُتحقَّق منه.",
    }),
  },
] as const;
