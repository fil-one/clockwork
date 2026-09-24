import "server-only";

import type { PriceBookAdministrationRecord } from "@clockwork/db";
import type { PriceBook, RateCard } from "@clockwork/domain/core";
import { MoneySchema } from "@clockwork/contracts";
import {
  demoText,
  demoTextIn,
  type DemoLocalizedText,
} from "@clockwork/testing/demo-localized-text";
import type {
  DemoAdapterState,
  DemoAdapterStateStore,
} from "@clockwork/testing/demo-state";

export const demoPriceBookPrefix = "demo-price-book:";
export const demoPriceBookReceiptPrefix = "demo-price-book-receipt:";

export interface DemoPriceBook extends PriceBookAdministrationRecord {
  readonly rateCards: readonly RateCard[];
  readonly importProvenance?: Readonly<Record<string, unknown>>;
  readonly cloneProvenance?: Readonly<Record<string, unknown>>;
}

const otherFinanceApprover = {
  id: "21000000-0000-4000-8000-000000000010",
  email: "commercial.policy@filone.test",
} as const;

const money = (currency: "GBP" | "USD", minor: string) =>
  MoneySchema.parse({ currency, minor });

/*
 * Fixture text that stands in for what a finance user would have typed: book
 * names, decision reasons and the approved commercial description (policy
 * rule 4). The stored books keep the English, because the domain validates
 * strings and the quote builders of other lanes read `currentDemoPriceBooks`;
 * `localizeDemoPriceBook` swaps a field for the reader's language only while
 * it still holds this fixture text, so a user's own edit is never touched.
 */
const fixtureText = {
  directUsd: demoText({
    en: "Direct commerce USD",
    es: "Venta directa USD",
    fr: "Vente directe USD",
    de: "Direktvertrieb USD",
    ja: "直接販売 USD",
    pt: "Venda direta USD",
    zh: "直销 USD",
    ar: "البيع المباشر USD",
  }),
  partnerGbp: demoText({
    en: "Partner commerce GBP",
    es: "Venta a través de socios GBP",
    fr: "Vente partenaires GBP",
    de: "Partnervertrieb GBP",
    ja: "パートナー販売 GBP",
    pt: "Venda por parceiros GBP",
    zh: "合作伙伴销售 GBP",
    ar: "البيع عبر الشركاء GBP",
  }),
  futureUsd: demoText({
    en: "Future scheduled USD",
    es: "Precios futuros programados USD",
    fr: "Tarifs futurs planifiés USD",
    de: "Geplante künftige Preise USD",
    ja: "将来適用予定 USD",
    pt: "Preços futuros agendados USD",
    zh: "计划中的未来价格 USD",
    ar: "أسعار مستقبلية مجدولة USD",
  }),
  directApproved: demoText({
    en: "Approved fictional demo pricing for direct sales.",
    es: "Precios ficticios de demostración aprobados para la venta directa.",
    fr: "Tarifs fictifs de démonstration approuvés pour la vente directe.",
    de: "Genehmigte fiktive Demo-Preise für den Direktvertrieb.",
    ja: "直接販売向けの架空のデモ価格を承認しました。",
    pt: "Preços fictícios de demonstração aprovados para venda direta.",
    zh: "已批准用于直销的虚构演示价格。",
    ar: "اعتُمدت أسعار افتراضية للعرض التوضيحي في البيع المباشر.",
  }),
  partnerApproved: demoText({
    en: "Approved fictional partner pricing for the demo.",
    es: "Precios ficticios para socios aprobados para la demostración.",
    fr: "Tarifs partenaires fictifs approuvés pour la démonstration.",
    de: "Genehmigte fiktive Partnerpreise für die Demo.",
    ja: "デモ用の架空のパートナー価格を承認しました。",
    pt: "Preços fictícios para parceiros aprovados para a demonstração.",
    zh: "已批准用于演示的虚构合作伙伴价格。",
    ar: "اعتُمدت أسعار افتراضية للشركاء لأغراض العرض التوضيحي.",
  }),
  reviewCompleted: demoText({
    en: "Commercial review completed for fictional demo rates.",
    es: "Revisión comercial completada para tarifas ficticias de demostración.",
    fr: "Examen commercial terminé pour des tarifs fictifs de démonstration.",
    de: "Kaufmännische Prüfung der fiktiven Demo-Preise abgeschlossen.",
    ja: "架空のデモ料金の商務レビューが完了しました。",
    pt: "Revisão comercial concluída para tarifas fictícias de demonstração.",
    zh: "已完成对虚构演示费率的商务审核。",
    ar: "اكتملت المراجعة التجارية لأسعار افتراضية للعرض التوضيحي.",
  }),
  advanceApproval: demoText({
    en: "Fictional advance-approval scenario; no production activation is implied.",
    es: "Escenario ficticio de aprobación anticipada; no implica ninguna activación en producción.",
    fr: "Scénario fictif d’approbation anticipée\u202f; il n’implique aucune activation en production.",
    de: "Fiktives Szenario einer Vorabgenehmigung; eine Aktivierung in der Produktion ist damit nicht verbunden.",
    ja: "架空の事前承認シナリオです。本番環境での有効化を意味するものではありません。",
    pt: "Cenário fictício de aprovação antecipada; não implica nenhuma ativação em produção.",
    zh: "虚构的提前审批场景，并不意味着在生产环境中启用。",
    ar: "سيناريو افتراضي للموافقة المسبقة؛ ولا يعني ذلك أي تفعيل في بيئة الإنتاج.",
  }),
  storageClaim: demoText({
    en: "Fictional immutable storage capacity",
    es: "Capacidad de almacenamiento inmutable ficticia",
    fr: "Capacité de stockage immuable fictive",
    de: "Fiktive unveränderliche Speicherkapazität",
    ja: "架空のイミュータブルストレージ容量",
    pt: "Capacidade fictícia de armazenamento imutável",
    zh: "虚构的不可变存储容量",
    ar: "سعة تخزين افتراضية غير قابلة للتعديل",
  }),
} as const;

const en = (text: DemoLocalizedText) => demoTextIn(text, "en");

const baseDemoPriceBooks: readonly DemoPriceBook[] = [
  {
    id: "66000000-0000-4000-8000-000000000001",
    name: en(fixtureText.directUsd),
    currency: "USD",
    version: 2,
    rowVersion: 4,
    status: "active",
    effectiveFrom: "2026-07-01",
    effectiveTo: null,
    rateCardCount: 2,
    regions: ["us-east-2", "us-west-2"],
    activationRequestedBy: null,
    activationRequestedByEmail: null,
    activationRequestedAt: null,
    lastDecisionAt: "2026-07-01T13:00:00.000Z",
    lastDecisionReason: en(fixtureText.directApproved),
    rateCards: [
      {
        id: "66100000-0000-4000-8000-000000000001",
        sku: "LOCKED-STORAGE-TB",
        region: "us-east-2",
        unit: "TB-month",
        approvedClaim: en(fixtureText.storageClaim),
        unitPrice: money("USD", "15000"),
        floorPrice: money("USD", "10000"),
        overageRate: money("USD", "18000"),
        minimumQuantity: "1",
        trialLimit: "5",
        egressTreatment: "metered",
        commitType: "term_drawdown",
        stripeTaxCode: "txcd_10103000",
        qboIncomeAccount: "4000-Storage",
        partnerTransferPrices: { reseller: money("USD", "12000") },
      },
      {
        id: "66100000-0000-4000-8000-000000000002",
        sku: "LOCKED-STORAGE-TB",
        region: "us-west-2",
        unit: "TB-month",
        approvedClaim: en(fixtureText.storageClaim),
        unitPrice: money("USD", "15500"),
        floorPrice: money("USD", "10500"),
        overageRate: money("USD", "18500"),
        minimumQuantity: "1",
        egressTreatment: "metered",
        commitType: "term_drawdown",
        stripeTaxCode: "txcd_10103000",
        qboIncomeAccount: "4000-Storage",
        partnerTransferPrices: { reseller: money("USD", "12500") },
      },
    ],
  },
  {
    id: "66000000-0000-4000-8000-000000000002",
    name: en(fixtureText.partnerGbp),
    currency: "GBP",
    version: 1,
    rowVersion: 2,
    status: "active",
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    rateCardCount: 1,
    regions: ["uk-south"],
    activationRequestedBy: null,
    activationRequestedByEmail: null,
    activationRequestedAt: null,
    lastDecisionAt: "2026-01-01T10:00:00.000Z",
    lastDecisionReason: en(fixtureText.partnerApproved),
    rateCards: [
      {
        id: "66100000-0000-4000-8000-000000000003",
        sku: "LOCKED-STORAGE-TB",
        region: "uk-south",
        unit: "TB-month",
        approvedClaim: en(fixtureText.storageClaim),
        unitPrice: money("GBP", "14000"),
        floorPrice: money("GBP", "9500"),
        overageRate: money("GBP", "17000"),
        minimumQuantity: "1",
        egressTreatment: "metered",
        commitType: "term_drawdown",
        stripeTaxCode: "txcd_10103000",
        qboIncomeAccount: "4000-Storage",
        partnerTransferPrices: {
          reseller: money("GBP", "11000"),
          distributor: money("GBP", "10200"),
        },
      },
    ],
  },
  {
    id: "66000000-0000-4000-8000-000000000003",
    name: en(fixtureText.directUsd),
    currency: "USD",
    version: 3,
    rowVersion: 2,
    status: "draft",
    effectiveFrom: "2026-07-01",
    effectiveTo: null,
    rateCardCount: 1,
    regions: ["us-east-2"],
    activationRequestedBy: otherFinanceApprover.id,
    activationRequestedByEmail: otherFinanceApprover.email,
    activationRequestedAt: "2026-07-30T14:00:00.000Z",
    lastDecisionAt: "2026-07-30T14:00:00.000Z",
    lastDecisionReason: en(fixtureText.reviewCompleted),
    rateCards: [
      {
        id: "66100000-0000-4000-8000-000000000004",
        sku: "LOCKED-STORAGE-TB",
        region: "us-east-2",
        unit: "TB-month",
        approvedClaim: en(fixtureText.storageClaim),
        unitPrice: money("USD", "14800"),
        floorPrice: money("USD", "10200"),
        overageRate: money("USD", "17800"),
        minimumQuantity: "1",
        egressTreatment: "metered",
        commitType: "term_drawdown",
        stripeTaxCode: "txcd_10103000",
        qboIncomeAccount: "4000-Storage",
        partnerTransferPrices: { reseller: money("USD", "11800") },
      },
    ],
  },
] as const;

const futureSource = baseDemoPriceBooks.find((book) => book.status === "draft");
// i18n-exempt: module-load invariant on the code fixture itself; never reaches a reader
if (!futureSource) throw new Error("Missing fictional price-book proposal");
export const canonicalDemoPriceBooks: readonly DemoPriceBook[] = [
  ...baseDemoPriceBooks,
  {
    ...structuredClone(futureSource),
    id: "66000000-0000-4000-8000-000000000004",
    name: en(fixtureText.futureUsd),
    version: 9000,
    effectiveFrom: "2099-01-01",
    effectiveTo: "2099-12-31",
    lastDecisionReason: en(fixtureText.advanceApproval),
    rateCards: futureSource.rateCards.map((rate, index) => ({
      ...structuredClone(rate),
      id: `66100000-0000-4000-8000-${String(100 + index).padStart(12, "0")}`,
    })),
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isDemoPriceBook(value: unknown): value is DemoPriceBook {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.currency === "string" &&
    Number.isSafeInteger(value.version) &&
    Number.isSafeInteger(value.rowVersion) &&
    ["draft", "active", "retired"].includes(String(value.status)) &&
    typeof value.effectiveFrom === "string" &&
    (value.effectiveTo === null || typeof value.effectiveTo === "string") &&
    Array.isArray(value.rateCards) &&
    Array.isArray(value.regions)
  );
}

export function currentDemoPriceBooks(
  state: DemoAdapterState,
): DemoPriceBook[] {
  const byId = new Map(
    canonicalDemoPriceBooks.map((book) => [book.id, structuredClone(book)]),
  );
  for (const [key, override] of Object.entries(state.projectionOverrides)) {
    if (!key.startsWith(demoPriceBookPrefix)) continue;
    if (!isDemoPriceBook(override.data))
      // i18n-exempt: the loader catches this and shows the translated "unavailable" state
      throw new Error("Demo price-book state is invalid");
    byId.set(override.data.id, structuredClone(override.data));
  }
  return [...byId.values()].sort(
    (left, right) =>
      left.currency.localeCompare(right.currency) ||
      right.version - left.version ||
      left.id.localeCompare(right.id),
  );
}

export function storeDemoPriceBooks(
  state: DemoAdapterState,
  books: readonly DemoPriceBook[],
  updatedAt: string,
): DemoAdapterState {
  const overrides = { ...state.projectionOverrides };
  for (const book of books)
    overrides[`${demoPriceBookPrefix}${book.id}`] = {
      version: book.rowVersion,
      updatedAt,
      data: structuredClone(book) as unknown as Readonly<
        Record<string, unknown>
      >,
    };
  return {
    ...state,
    revision: state.revision + 1,
    projectionOverrides: overrides,
  };
}

export function administrationRecord(
  book: DemoPriceBook,
): PriceBookAdministrationRecord {
  return {
    id: book.id,
    ...(book.activationSchedule
      ? { activationSchedule: book.activationSchedule }
      : {}),
    name: book.name,
    currency: book.currency,
    version: book.version,
    rowVersion: book.rowVersion,
    status: book.status,
    effectiveFrom: book.effectiveFrom,
    effectiveTo: book.effectiveTo,
    rateCardCount: book.rateCardCount,
    rateCards: book.rateCards,
    ...(book.discountMatrix ? { discountMatrix: book.discountMatrix } : {}),
    regions: book.regions,
    activationRequestedBy: book.activationRequestedBy,
    activationRequestedByEmail: book.activationRequestedByEmail,
    activationRequestedAt: book.activationRequestedAt,
    lastDecisionAt: book.lastDecisionAt,
    lastDecisionReason: book.lastDecisionReason,
  };
}

export function domainPriceBook(book: DemoPriceBook): PriceBook {
  return {
    id: book.id,
    name: book.name,
    version: book.version,
    currency: book.currency as PriceBook["currency"],
    effectiveFrom: book.effectiveFrom,
    ...(book.effectiveTo ? { effectiveTo: book.effectiveTo } : {}),
    status: book.status,
    rateCards: book.rateCards,
    ...(book.discountMatrix ? { discountMatrix: book.discountMatrix } : {}),
  };
}

const fixtureNames = [
  fixtureText.directUsd,
  fixtureText.partnerGbp,
  fixtureText.futureUsd,
];
const fixtureReasons = [
  fixtureText.directApproved,
  fixtureText.partnerApproved,
  fixtureText.reviewCompleted,
  fixtureText.advanceApproval,
];
const fixtureClaims = [fixtureText.storageClaim];

function localizedFixture<T extends string | null>(
  value: T,
  texts: readonly DemoLocalizedText[],
  locale: string,
): T | string {
  if (value === null) return value;
  const text = texts.find((candidate) => en(candidate) === value);
  return text ? demoTextIn(text, locale) : value;
}

/**
 * The demo read boundary for price books: fixture-authored names, decision
 * reasons and commercial descriptions in the reader's language. Everything
 * else -- identifiers, amounts, dates, and anything a user typed -- is
 * returned as stored.
 */
export function localizeDemoPriceBook<T extends PriceBookAdministrationRecord>(
  book: T,
  locale: string,
): T {
  return {
    ...book,
    name: localizedFixture(book.name, fixtureNames, locale),
    lastDecisionReason: localizedFixture(
      book.lastDecisionReason,
      fixtureReasons,
      locale,
    ),
    ...(book.rateCards
      ? {
          rateCards: book.rateCards.map((rate) => ({
            ...rate,
            approvedClaim: localizedFixture(
              rate.approvedClaim,
              fixtureClaims,
              locale,
            ),
          })),
        }
      : {}),
  };
}

export async function readDemoPriceBookRecords(
  store: DemoAdapterStateStore,
  locale: string,
): Promise<PriceBookAdministrationRecord[]> {
  return currentDemoPriceBooks(await store.read()).map((book) =>
    localizeDemoPriceBook(administrationRecord(book), locale),
  );
}
