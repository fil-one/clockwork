import type { Currency, Money } from "@clockwork/contracts";

import {
  compareQuantities,
  multiplyMinorByQuantity,
  parseDecimal,
} from "../decimal";

export type CommitType = "period_allowance" | "term_drawdown";
export type PriceBookStatus = "draft" | "active" | "retired";
export type QuoteRoute =
  "direct" | "referral" | "resale" | "distributor" | "marketplace";

/**
 * A rule grants discount authority to the lines it matches. A rule matches when
 * every scope it names equals the line's value and every threshold it names is
 * met, so an empty rule grants its ceiling to every line.
 */
export interface DiscountMatrixRule {
  id: string;
  sku?: string;
  region?: string;
  route?: QuoteRoute;
  partnerTier?: string;
  minTermMonths?: number;
  minQuantity?: string;
  maxDiscountBps: number;
}

/**
 * The standard discount matrix of §9: the authorized discount ceiling for a
 * quote line. The ceiling is the greatest grant among the rules that match the
 * line, or `defaultMaxDiscountBps` when none match. The numbers are signed
 * commercial policy (EXT-COMMERCIAL-01) supplied with the price book; the
 * enforcement below does not depend on them.
 */
export interface DiscountMatrix {
  id: string;
  version: number;
  defaultMaxDiscountBps: number;
  rules: readonly DiscountMatrixRule[];
}

/**
 * The ceiling applied to a price book that carries no matrix. Zero authority
 * means every discount routes to the pricing exception queue until signed
 * policy is loaded, so an unconfigured book can never auto-issue a discount.
 */
export const UNCONFIGURED_DISCOUNT_MATRIX: DiscountMatrix = {
  id: "unconfigured",
  version: 0,
  defaultMaxDiscountBps: 0,
  rules: [],
};

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
  discountMatrix?: DiscountMatrix;
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
    Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ||
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value
  )
    throw new Error(`${label} must be an ISO calendar date`);
}

function assertDiscountBps(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 10_000)
    throw new Error(`${label} must be between 0 and 10000 basis points`);
}

function validateDiscountMatrix(matrix: DiscountMatrix): void {
  if (!matrix.id.trim())
    throw new Error("Discount matrix requires an identifier");
  if (!Number.isInteger(matrix.version) || matrix.version < 0)
    throw new Error("Discount matrix version must be a non-negative integer");
  assertDiscountBps(matrix.defaultMaxDiscountBps, "Discount matrix default");
  const ruleIds = new Set<string>();
  for (const rule of matrix.rules) {
    if (!rule.id.trim())
      throw new Error("Discount matrix rules require an identifier");
    if (ruleIds.has(rule.id))
      throw new Error(`Duplicate discount matrix rule: ${rule.id}`);
    ruleIds.add(rule.id);
    assertDiscountBps(rule.maxDiscountBps, `Discount matrix rule ${rule.id}`);
    if (
      rule.minTermMonths !== undefined &&
      (!Number.isInteger(rule.minTermMonths) || rule.minTermMonths < 1)
    )
      throw new Error(
        `Discount matrix rule ${rule.id} term threshold must be a positive integer`,
      );
    if (rule.minQuantity !== undefined) parseDecimal(rule.minQuantity);
  }
}

/**
 * The authorized discount for one line: the greatest grant among matching
 * rules, never below the matrix default.
 */
export function discountCeilingBps(
  matrix: DiscountMatrix,
  line: {
    sku: string;
    region: string;
    quantity: string;
    termMonths: number;
  },
  channel: { route: QuoteRoute; partnerTier?: string },
): number {
  return matrix.rules.reduce((ceiling, rule) => {
    if (rule.sku !== undefined && rule.sku !== line.sku) return ceiling;
    if (rule.region !== undefined && rule.region !== line.region)
      return ceiling;
    if (rule.route !== undefined && rule.route !== channel.route)
      return ceiling;
    if (
      rule.partnerTier !== undefined &&
      rule.partnerTier !== channel.partnerTier
    )
      return ceiling;
    if (
      rule.minTermMonths !== undefined &&
      line.termMonths < rule.minTermMonths
    )
      return ceiling;
    if (
      rule.minQuantity !== undefined &&
      compareQuantities(line.quantity, rule.minQuantity) < 0
    )
      return ceiling;
    return rule.maxDiscountBps > ceiling ? rule.maxDiscountBps : ceiling;
  }, matrix.defaultMaxDiscountBps);
}

function discountedUnitMinor(baseMinor: bigint, discountBps: number): bigint {
  return discountBps === 0
    ? baseMinor
    : (baseMinor * BigInt(10_000 - discountBps) + 5_000n) / 10_000n;
}

function bookMoney(currency: Currency, minor: bigint): Money {
  return { currency, minor: minor.toString() } as Money;
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
  if (book.discountMatrix) validateDiscountMatrix(book.discountMatrix);
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
      BigInt(rate.overageRate.minor) < 0n ||
      (rate.floorPrice !== undefined && BigInt(rate.floorPrice.minor) < 0n)
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
  discountCeilingBps?: number;
  marginImpact?: Money;
}

/**
 * One guardrail a line broke, with the number the approver decides on:
 * `marginImpact` is the revenue the line gives up against that guardrail over
 * its full term. A line can break both guardrails; its own `marginImpact` is
 * the binding one, so summing breaches would double count.
 */
export interface PricingGuardrailBreach {
  lineId: string;
  sku: string;
  region: string;
  guardrail: "floor" | "discount_matrix";
  reason: string;
  quotedUnitPrice: Money;
  guardrailUnitPrice: Money;
  marginImpact: Money;
}

export interface PriceQuoteInput {
  book: PriceBook;
  lines: readonly QuotePriceRequestLine[];
  route: QuoteRoute;
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
  marginImpact: Money;
  guardrailBreaches: PricingGuardrailBreach[];
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
  const matrix = book.discountMatrix ?? UNCONFIGURED_DISCOUNT_MATRIX;
  const exceptionReasons: string[] = [];
  const guardrailBreaches: PricingGuardrailBreach[] = [];
  const priced = input.lines.map((requested, index): PricedQuoteLine => {
    if (!Number.isInteger(requested.termMonths) || requested.termMonths < 1)
      throw new Error("Term months must be a positive integer");
    const discountBps = requested.discountBps ?? 0;
    assertDiscountBps(discountBps, "Discount");
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
    const transfer =
      (input.route === "resale" || input.route === "distributor") &&
      input.partnerTier
        ? rate.partnerTransferPrices[input.partnerTier]
        : undefined;
    if (
      (input.route === "resale" || input.route === "distributor") &&
      !transfer
    )
      throw new Error(`No transfer price for tier ${input.partnerTier ?? ""}`);
    const baseMinor = BigInt((transfer ?? rate.unitPrice).minor);
    const unitMinor = discountedUnitMinor(baseMinor, discountBps);
    const lineId = requested.lineId ?? `${rate.id}:${index + 1}`;
    const lineMinor = multiplyMinorByQuantity(
      unitMinor,
      requested.quantity,
      BigInt(requested.termMonths),
    );
    // Both guardrails measure the price we set: the direct price on our own
    // routes and the transfer price on partner routes. `partnerResaleTotal` is
    // the partner's own end-client price and is never measured against either.
    const floor = rate.floorPrice;
    const belowFloor = floor !== undefined && unitMinor < BigInt(floor.minor);
    const ceilingBps = discountCeilingBps(
      matrix,
      {
        sku: rate.sku,
        region: rate.region,
        quantity: requested.quantity,
        termMonths: requested.termMonths,
      },
      {
        route: input.route,
        ...(input.partnerTier ? { partnerTier: input.partnerTier } : {}),
      },
    );
    const aboveMatrix = discountBps > ceilingBps;
    const ceilingUnitMinor = discountedUnitMinor(baseMinor, ceilingBps);
    // Revenue given up over the full term against a guardrail price, taken as
    // the difference of the two line totals so it reconciles to the quote.
    const impactAgainst = (guardrailMinor: bigint): bigint =>
      multiplyMinorByQuantity(
        guardrailMinor,
        requested.quantity,
        BigInt(requested.termMonths),
      ) - lineMinor;
    if (floor && belowFloor) {
      const reason = `${rate.sku}/${rate.region} prices below configured floor`;
      exceptionReasons.push(reason);
      guardrailBreaches.push({
        lineId,
        sku: rate.sku,
        region: rate.region,
        guardrail: "floor",
        reason,
        quotedUnitPrice: bookMoney(book.currency, unitMinor),
        guardrailUnitPrice: floor,
        marginImpact: bookMoney(
          book.currency,
          impactAgainst(BigInt(floor.minor)),
        ),
      });
    }
    if (aboveMatrix) {
      const reason = `${rate.sku}/${rate.region} discounts ${discountBps} bps above the ${ceilingBps} bps standard matrix ceiling`;
      exceptionReasons.push(reason);
      guardrailBreaches.push({
        lineId,
        sku: rate.sku,
        region: rate.region,
        guardrail: "discount_matrix",
        reason,
        quotedUnitPrice: bookMoney(book.currency, unitMinor),
        guardrailUnitPrice: bookMoney(book.currency, ceilingUnitMinor),
        marginImpact: bookMoney(book.currency, impactAgainst(ceilingUnitMinor)),
      });
    }
    const floorGuardrailMinor =
      floor && belowFloor ? BigInt(floor.minor) : unitMinor;
    const bindingGuardrailMinor =
      aboveMatrix && ceilingUnitMinor > floorGuardrailMinor
        ? ceilingUnitMinor
        : floorGuardrailMinor;
    return {
      id: lineId,
      rateCardId: rate.id,
      sku: rate.sku,
      region: rate.region,
      unit: rate.unit,
      approvedClaim: rate.approvedClaim,
      quantity: requested.quantity,
      termMonths: requested.termMonths,
      unitPrice: bookMoney(book.currency, unitMinor),
      listUnitPrice: transfer ?? rate.unitPrice,
      ...(rate.floorPrice ? { floorPrice: rate.floorPrice } : {}),
      overageRate: rate.overageRate,
      lineTotal: bookMoney(book.currency, lineMinor),
      discountBps,
      commitType: rate.commitType,
      stripeTaxCode: rate.stripeTaxCode,
      qboIncomeAccount: rate.qboIncomeAccount,
      marginResult:
        belowFloor || aboveMatrix
          ? "exception_required"
          : rate.floorPrice === undefined
            ? "not_configured"
            : "pass",
      discountCeilingBps: ceilingBps,
      marginImpact: bookMoney(
        book.currency,
        bindingGuardrailMinor === unitMinor
          ? 0n
          : impactAgainst(bindingGuardrailMinor),
      ),
    };
  });
  const totalMinor = priced.reduce(
    (sum, line) => sum + BigInt(line.lineTotal.minor),
    0n,
  );
  const marginImpactMinor = priced.reduce(
    (sum, line) => sum + BigInt(line.marginImpact?.minor ?? "0"),
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
    total: bookMoney(book.currency, totalMinor),
    marginResult,
    exceptionReasons,
    marginImpact: bookMoney(book.currency, marginImpactMinor),
    guardrailBreaches,
  };
}
