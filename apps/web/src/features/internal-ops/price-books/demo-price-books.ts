import "server-only";

import type { PriceBookAdministrationRecord } from "@clockwork/db";
import type { PriceBook, RateCard } from "@clockwork/domain/core";
import { MoneySchema } from "@clockwork/contracts";
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

export const canonicalDemoPriceBooks: readonly DemoPriceBook[] = [
  {
    id: "66000000-0000-4000-8000-000000000001",
    name: "Direct commerce USD",
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
    lastDecisionReason: "Approved fictional demo pricing for the 2026.2 path.",
    rateCards: [
      {
        id: "66100000-0000-4000-8000-000000000001",
        sku: "LOCKED-STORAGE-TB",
        region: "us-east-2",
        unit: "TB-month",
        approvedClaim: "Fictional immutable storage capacity",
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
        approvedClaim: "Fictional immutable storage capacity",
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
    name: "Partner commerce GBP",
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
    lastDecisionReason: "Approved fictional partner pricing for the demo.",
    rateCards: [
      {
        id: "66100000-0000-4000-8000-000000000003",
        sku: "LOCKED-STORAGE-TB",
        region: "uk-south",
        unit: "TB-month",
        approvedClaim: "Fictional immutable storage capacity",
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
    name: "Direct commerce USD",
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
    lastDecisionReason: "Commercial review completed for fictional demo rates.",
    rateCards: [
      {
        id: "66100000-0000-4000-8000-000000000004",
        sku: "LOCKED-STORAGE-TB",
        region: "us-east-2",
        unit: "TB-month",
        approvedClaim: "Fictional immutable storage capacity",
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

export async function readDemoPriceBookRecords(
  store: DemoAdapterStateStore,
): Promise<PriceBookAdministrationRecord[]> {
  return currentDemoPriceBooks(await store.read()).map(administrationRecord);
}
