import type { Currency, Money } from "@clockwork/contracts";

import {
  compareQuantities,
  multiplyMinorByQuantity,
  parseDecimal,
} from "../decimal";

export type CommitType = "period_allowance" | "term_drawdown";
export type PriceBookStatus = "draft" | "active" | "retired";

export interface RateCard {
  id: string;
  sku: string;
  region: string;
  unit: string;
  approvedClaim: string;
  unitPrice: Money;
  floorPrice?: Money;
  overageRate: Money;
  minimumQuantity: string;
  trialLimit?: string;
  egressTreatment: string;
  commitType: CommitType;
  stripeTaxCode: string;
  qboIncomeAccount: string;
  partnerTransferPrices: Readonly<Record<string, Money>>;
}

export interface PriceBook {
  id: string;
  name: string;
  version: number;
  currency: Currency;
  effectiveFrom: string;
  effectiveTo?: string;
  status: PriceBookStatus;
  rateCards: readonly RateCard[];
}

export interface PricingAdminAudit {
  action: "activated" | "retired";
  priceBookId: string;
  version: number;
  actorId: string;
  occurredAt: string;
  beforeStatus: PriceBookStatus;
  afterStatus: PriceBookStatus;
}

function assertLocalDate(value: string, label: string): void {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  )
    throw new Error(`${label} must be an ISO calendar date`);
}

export function validatePriceBook(book: PriceBook): PriceBook {
  assertLocalDate(book.effectiveFrom, "effectiveFrom");
  if (book.effectiveTo) {
    assertLocalDate(book.effectiveTo, "effectiveTo");
    if (book.effectiveTo < book.effectiveFrom)
      throw new Error("Price book effectiveTo precedes effectiveFrom");
  }
  if (!Number.isInteger(book.version) || book.version < 1)
    throw new Error("Price book version must be positive");
  if (book.rateCards.length === 0)
    throw new Error("Price book requires at least one rate card");
  const keys = new Set<string>();
  for (const rate of book.rateCards) {
    const key = `${rate.sku}:${rate.region}`;
    if (keys.has(key)) throw new Error(`Duplicate SKU/region rate: ${key}`);
    keys.add(key);
    if (!rate.sku.trim() || !rate.region.trim() || !rate.stripeTaxCode.trim())
      throw new Error("Rate cards require SKU, region, and Stripe tax code");
    if (
      rate.unitPrice.currency !== book.currency ||
      rate.overageRate.currency !== book.currency ||
      (rate.floorPrice && rate.floorPrice.currency !== book.currency)
    )
      throw new Error(
        "Every rate card money value must use the price book currency",
      );
    if (
      BigInt(rate.unitPrice.minor) < 0n ||
      BigInt(rate.overageRate.minor) < 0n
    )
      throw new Error("Prices cannot be negative");
    parseDecimal(rate.minimumQuantity);
    if (rate.trialLimit) parseDecimal(rate.trialLimit);
    for (const transfer of Object.values(rate.partnerTransferPrices)) {
      if (transfer.currency !== book.currency || BigInt(transfer.minor) < 0n)
        throw new Error(
          "Partner transfer prices must be non-negative in book currency",
        );
    }
  }
  return book;
}

export function activatePriceBook(input: {
  candidate: PriceBook;
  allBooks: readonly PriceBook[];
  actorId: string;
  occurredAt: string;
}): { books: PriceBook[]; audits: PricingAdminAudit[] } {
  validatePriceBook(input.candidate);
  if (input.candidate.status !== "draft")
    throw new Error("Only a draft price book can be activated");
  const sameVersion = input.allBooks.find(
    (book) =>
      book.currency === input.candidate.currency &&
      book.version === input.candidate.version &&
      book.id !== input.candidate.id,
  );
  if (sameVersion)
    throw new Error("Price book currency/version already exists");
  const occurredOn = input.occurredAt.slice(0, 10);
  if (input.candidate.effectiveFrom > occurredOn)
    throw new Error("A price book cannot activate before its effective date");
  const audits: PricingAdminAudit[] = [];
  const books = input.allBooks.map((book) => {
    if (book.currency !== input.candidate.currency || book.status !== "active")
      return book;
    audits.push({
      action: "retired",
      priceBookId: book.id,
      version: book.version,
      actorId: input.actorId,
      occurredAt: input.occurredAt,
      beforeStatus: "active",
      afterStatus: "retired",
    });
    return { ...book, status: "retired" as const, effectiveTo: occurredOn };
  });
  const activated = { ...input.candidate, status: "active" as const };
  const candidateIndex = books.findIndex(
    (book) => book.id === input.candidate.id,
  );
  if (candidateIndex >= 0) books[candidateIndex] = activated;
  else books.push(activated);
  audits.push({
    action: "activated",
    priceBookId: activated.id,
    version: activated.version,
    actorId: input.actorId,
    occurredAt: input.occurredAt,
    beforeStatus: "draft",
    afterStatus: "active",
  });
  return { books, audits };
}

export interface QuotePriceRequestLine {
  lineId?: string;
  sku: string;
  region: string;
  quantity: string;
  termMonths: number;
  discountBps?: number;
}

export interface PricedQuoteLine {
  id: string;
  rateCardId: string;
  sku: string;
  region: string;
  unit: string;
  approvedClaim: string;
  quantity: string;
  termMonths: number;
  unitPrice: Money;
  listUnitPrice: Money;
  floorPrice?: Money;
  overageRate: Money;
  lineTotal: Money;
  discountBps: number;
  commitType: CommitType;
  stripeTaxCode: string;
  qboIncomeAccount: string;
  marginResult: "not_configured" | "pass" | "exception_required";
}

export interface PriceQuoteInput {
  book: PriceBook;
  lines: readonly QuotePriceRequestLine[];
  route: "direct" | "referral" | "resale" | "distributor" | "marketplace";
  partnerTier?: string;
  partnerResaleTotal?: Money;
  quotedAt: string;
}

export function priceQuote(input: PriceQuoteInput): {
  currency: Currency;
  lines: PricedQuoteLine[];
  total: Money;
  marginResult: "not_configured" | "pass" | "exception_required";
  exceptionReasons: string[];
} {
  const book = validatePriceBook(input.book);
  const quotedOn = input.quotedAt.slice(0, 10);
  if (
    book.status !== "active" ||
    quotedOn < book.effectiveFrom ||
    (book.effectiveTo && quotedOn > book.effectiveTo)
  )
    throw new Error("Price book is not active for the quote date");
  if (input.lines.length === 0)
    throw new Error("A quote requires at least one line");
  if (input.route === "resale" || input.route === "distributor") {
    if (!input.partnerTier)
      throw new Error("Partner transfer tier is required for resale pricing");
    if (
      input.partnerResaleTotal?.currency !== undefined &&
      input.partnerResaleTotal.currency !== book.currency
    )
      throw new Error(
        "Partner-controlled resale price must use quote currency",
      );
  } else if (input.partnerResaleTotal) {
    throw new Error(
      "Partner resale price is valid only on resale/distributor quotes",
    );
  }
  const exceptionReasons: string[] = [];
  const priced = input.lines.map((requested, index): PricedQuoteLine => {
    if (!Number.isInteger(requested.termMonths) || requested.termMonths < 1)
      throw new Error("Term months must be a positive integer");
    const discountBps = requested.discountBps ?? 0;
    if (
      !Number.isInteger(discountBps) ||
      discountBps < 0 ||
      discountBps > 10_000
    )
      throw new Error("Discount must be between 0 and 10000 basis points");
    const rate = book.rateCards.find(
      (candidate) =>
        candidate.sku === requested.sku &&
        candidate.region === requested.region,
    );
    if (!rate)
      throw new Error(
        `No active rate for ${requested.sku}/${requested.region}`,
      );
    if (compareQuantities(requested.quantity, rate.minimumQuantity) < 0)
      throw new Error(`${requested.sku} quantity is below its minimum`);
    const transfer = input.partnerTier
      ? rate.partnerTransferPrices[input.partnerTier]
      : undefined;
    if (
      (input.route === "resale" || input.route === "distributor") &&
      !transfer
    )
      throw new Error(`No transfer price for tier ${input.partnerTier ?? ""}`);
    const baseMinor = BigInt((transfer ?? rate.unitPrice).minor);
    const unitMinor =
      discountBps === 0
        ? baseMinor
        : (baseMinor * BigInt(10_000 - discountBps) + 5_000n) / 10_000n;
    const belowFloor =
      rate.floorPrice !== undefined &&
      unitMinor < BigInt(rate.floorPrice.minor);
    if (belowFloor)
      exceptionReasons.push(
        `${rate.sku}/${rate.region} prices below configured floor`,
      );
    const lineMinor = multiplyMinorByQuantity(
      unitMinor,
      requested.quantity,
      BigInt(requested.termMonths),
    );
    return {
      id: requested.lineId ?? `${rate.id}:${index + 1}`,
      rateCardId: rate.id,
      sku: rate.sku,
      region: rate.region,
      unit: rate.unit,
      approvedClaim: rate.approvedClaim,
      quantity: requested.quantity,
      termMonths: requested.termMonths,
      unitPrice: {
        currency: book.currency,
        minor: unitMinor.toString(),
      } as Money,
      listUnitPrice: transfer ?? rate.unitPrice,
      ...(rate.floorPrice ? { floorPrice: rate.floorPrice } : {}),
      overageRate: rate.overageRate,
      lineTotal: {
        currency: book.currency,
        minor: lineMinor.toString(),
      } as Money,
      discountBps,
      commitType: rate.commitType,
      stripeTaxCode: rate.stripeTaxCode,
      qboIncomeAccount: rate.qboIncomeAccount,
      marginResult:
        rate.floorPrice === undefined
          ? "not_configured"
          : belowFloor
            ? "exception_required"
            : "pass",
    };
  });
  const totalMinor = priced.reduce(
    (sum, line) => sum + BigInt(line.lineTotal.minor),
    0n,
  );
  const marginResult = priced.some(
    (line) => line.marginResult === "exception_required",
  )
    ? "exception_required"
    : priced.every((line) => line.marginResult === "not_configured")
      ? "not_configured"
      : "pass";
  return {
    currency: book.currency,
    lines: priced,
    total: { currency: book.currency, minor: totalMinor.toString() } as Money,
    marginResult,
    exceptionReasons,
  };
}
