import type { Currency, Money } from "@clockwork/contracts";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  acceptOrder,
  accrueCommission,
  activatePriceBook,
  addQuantities,
  assertRecoverableOffboardingSourceStatus,
  compareQuantities,
  creditAmount,
  createQuoteDraft,
  decideCommitmentOverage,
  dunningDecision,
  findAccountDedupeSignals,
  formatDecimal,
  issueQuote,
  merchantOfRecord,
  multiplyMinorByQuantity,
  partnerCreditDecision,
  partnerPerformance,
  parseDecimal,
  priceQuote,
  prorateMoney,
  projectStripeTruth,
  reconcileCommitmentToSource,
  threeWayTieOut,
  validatePartnerHierarchy,
} from ".";
import type {
  AccountCommercialRecord,
  CommitmentContract,
  DiscountMatrix,
  LedgerUsageEvent,
  PriceBook,
} from ".";

const money = (minor: bigint, currency: Currency = "USD") =>
  ({ currency, minor: minor.toString() }) as Money;

const account = (
  overrides: Partial<AccountCommercialRecord> = {},
): AccountCommercialRecord => ({
  id: "account-1",
  legalName: "Example LLC",
  country: "US",
  domain: "example.test",
  roles: ["direct_client"],
  taxIds: [],
  contacts: [
    {
      name: "A. Buyer",
      email: "buyer@example.test",
      roles: ["billing", "accounts_payable"],
    },
  ],
  currency: "USD",
  paymentTerms: { kind: "auto_charge" },
  procurement: {
    poRequired: false,
    invoiceDeliveryEmail: "ap@example.test",
    supplierPortalStatus: "not_required",
    certificates: [],
    furnishedDocuments: [],
  },
  rowVersion: 1,
  ...overrides,
});

const book = (floorMinor = 80n): PriceBook => ({
  id: "book-1",
  name: "USD 2026",
  version: 1,
  currency: "USD",
  effectiveFrom: "2026-01-01",
  status: "active",
  rateCards: [
    {
      id: "rate-1",
      sku: "storage",
      region: "us-east",
      unit: "TB-month",
      approvedClaim: "Object storage capacity",
      unitPrice: money(100n),
      floorPrice: money(floorMinor),
      overageRate: money(12n),
      minimumQuantity: "1",
      egressTreatment: "metered",
      commitType: "period_allowance",
      stripeTaxCode: "txcd_10103101",
      qboIncomeAccount: "Storage Revenue",
      partnerTransferPrices: { gold: money(85n) },
    },
  ],
});

const matrix = (overrides: Partial<DiscountMatrix> = {}): DiscountMatrix => ({
  id: "matrix-1",
  version: 1,
  defaultMaxDiscountBps: 1_000,
  rules: [],
  ...overrides,
});

const line = (overrides: { discountBps?: number } = {}) => ({
  sku: "storage",
  region: "us-east",
  quantity: "10",
  termMonths: 12,
  ...overrides,
});

describe("core commercial domain", () => {
  it("produces strong one-entity dedupe signals without silently merging", () => {
    const candidate = account({
      id: "existing",
      taxIds: [
        {
          jurisdiction: "US",
          type: "ein",
          value: "12-3456789",
          validation: "valid",
        },
      ],
    });
    expect(
      findAccountDedupeSignals(
        {
          legalName: "Example, Incorporated",
          country: "US",
          domain: "www.example.test",
          taxIds: [
            {
              jurisdiction: "US",
              type: "ein",
              value: "123456789",
              validation: "valid",
            },
          ],
        },
        [candidate],
      ),
    ).toEqual([
      expect.objectContaining({
        candidateId: "existing",
        confidence: "exact_tax_id",
      }),
    ]);
  });

  it("activates one effective price book per currency with audit records", () => {
    const old = book();
    const draft = {
      ...book(),
      id: "book-2",
      version: 2,
      status: "draft" as const,
    };
    const result = activatePriceBook({
      candidate: draft,
      allBooks: [old, draft],
      actorId: "finance-user",
      occurredAt: "2026-07-31T16:00:00Z",
    });
    expect(
      result.books.filter((candidate) => candidate.status === "active"),
    ).toHaveLength(1);
    expect(result.audits.map((audit) => audit.action)).toEqual([
      "retired",
      "activated",
    ]);
  });

  it("enforces floors only on our direct or transfer price, not resale price", () => {
    const direct = priceQuote({
      book: book(),
      route: "direct",
      quotedAt: "2026-07-31T16:00:00Z",
      lines: [
        {
          sku: "storage",
          region: "us-east",
          quantity: "10",
          termMonths: 12,
          discountBps: 2500,
        },
      ],
    });
    expect(direct.marginResult).toBe("exception_required");
    const resale = priceQuote({
      book: book(),
      route: "resale",
      partnerTier: "gold",
      partnerResaleTotal: money(1n),
      quotedAt: "2026-07-31T16:00:00Z",
      lines: [
        { sku: "storage", region: "us-east", quantity: "10", termMonths: 12 },
      ],
    });
    expect(resale.marginResult).toBe("pass");
  });

  it("issues a quote inside the standard discount matrix with no review", () => {
    const priced = priceQuote({
      book: { ...book(), discountMatrix: matrix() },
      route: "direct",
      quotedAt: "2026-07-31T16:00:00Z",
      lines: [line({ discountBps: 1_000 })],
    });
    expect(priced.marginResult).toBe("pass");
    expect(priced.exceptionReasons).toEqual([]);
    expect(priced.guardrailBreaches).toEqual([]);
    expect(priced.marginImpact).toEqual(money(0n));
    expect(priced.lines[0]?.unitPrice).toEqual(money(90n));
    expect(priced.lines[0]?.discountCeilingBps).toBe(1_000);
  });

  it("routes an above-matrix discount to the exception queue with its margin impact", () => {
    const priced = priceQuote({
      book: { ...book(), discountMatrix: matrix() },
      route: "direct",
      quotedAt: "2026-07-31T16:00:00Z",
      lines: [line({ discountBps: 1_500 })],
    });
    expect(priced.marginResult).toBe("exception_required");
    expect(priced.exceptionReasons).toEqual([
      "storage/us-east discounts 1500 bps above the 1000 bps standard matrix ceiling",
    ]);
    // The 85 quoted unit price clears the 80 floor, so only the matrix binds:
    // (90 authorized - 85 quoted) x 10 units x 12 months.
    expect(priced.marginImpact).toEqual(money(600n));
    expect(priced.guardrailBreaches).toEqual([
      expect.objectContaining({
        guardrail: "discount_matrix",
        quotedUnitPrice: money(85n),
        guardrailUnitPrice: money(90n),
        marginImpact: money(600n),
      }),
    ]);
  });

  it("authorizes no discount until a signed matrix is loaded", () => {
    const priced = priceQuote({
      book: book(),
      route: "direct",
      quotedAt: "2026-07-31T16:00:00Z",
      lines: [line({ discountBps: 100 })],
    });
    expect(priced.marginResult).toBe("exception_required");
    expect(priced.lines[0]?.discountCeilingBps).toBe(0);
    expect(priced.marginImpact).toEqual(money(120n));
  });

  it("grants the deepest matrix band the line qualifies for", () => {
    const banded = matrix({
      defaultMaxDiscountBps: 1_000,
      rules: [
        {
          id: "long-term-volume",
          minTermMonths: 24,
          minQuantity: "50",
          maxDiscountBps: 2_000,
        },
      ],
    });
    const qualified = priceQuote({
      book: { ...book(), discountMatrix: banded },
      route: "direct",
      quotedAt: "2026-07-31T16:00:00Z",
      lines: [
        {
          sku: "storage",
          region: "us-east",
          quantity: "50",
          termMonths: 24,
          discountBps: 2_000,
        },
      ],
    });
    expect(qualified.marginResult).toBe("pass");
    expect(qualified.lines[0]?.discountCeilingBps).toBe(2_000);
    const shortTerm = priceQuote({
      book: { ...book(), discountMatrix: banded },
      route: "direct",
      quotedAt: "2026-07-31T16:00:00Z",
      lines: [
        {
          sku: "storage",
          region: "us-east",
          quantity: "50",
          termMonths: 12,
          discountBps: 2_000,
        },
      ],
    });
    expect(shortTerm.marginResult).toBe("exception_required");
    expect(shortTerm.lines[0]?.discountCeilingBps).toBe(1_000);
  });

  it("computes the margin impact of a price below the SKU floor", () => {
    const priced = priceQuote({
      book: {
        ...book(),
        discountMatrix: matrix({ defaultMaxDiscountBps: 2_500 }),
      },
      route: "direct",
      quotedAt: "2026-07-31T16:00:00Z",
      lines: [line({ discountBps: 2_500 })],
    });
    expect(priced.marginResult).toBe("exception_required");
    expect(priced.exceptionReasons).toEqual([
      "storage/us-east prices below configured floor",
    ]);
    // (80 floor - 75 quoted) x 10 units x 12 months.
    expect(priced.marginImpact).toEqual(money(600n));
    expect(priced.guardrailBreaches).toEqual([
      expect.objectContaining({
        guardrail: "floor",
        quotedUnitPrice: money(75n),
        guardrailUnitPrice: money(80n),
        marginImpact: money(600n),
      }),
    ]);
  });

  it("charges a line breaking both guardrails only the binding impact", () => {
    const priced = priceQuote({
      book: { ...book(), discountMatrix: matrix() },
      route: "direct",
      quotedAt: "2026-07-31T16:00:00Z",
      lines: [line({ discountBps: 3_000 })],
    });
    expect(priced.exceptionReasons).toHaveLength(2);
    // The 90 matrix ceiling binds above the 80 floor: (90 - 70) x 10 x 12.
    expect(priced.marginImpact).toEqual(money(2_400n));
    expect(
      priced.guardrailBreaches.map((breach) => breach.marginImpact),
    ).toEqual([money(1_200n), money(2_400n)]);
  });

  it("never measures a partner's own resale price against either guardrail", () => {
    const resale = priceQuote({
      book: { ...book(), discountMatrix: matrix({ defaultMaxDiscountBps: 0 }) },
      route: "resale",
      partnerTier: "gold",
      partnerResaleTotal: money(1n),
      quotedAt: "2026-07-31T16:00:00Z",
      lines: [line()],
    });
    expect(resale.marginResult).toBe("pass");
    expect(resale.exceptionReasons).toEqual([]);
    expect(resale.guardrailBreaches).toEqual([]);
    expect(resale.marginImpact).toEqual(money(0n));
    expect(resale.lines[0]?.unitPrice).toEqual(money(85n));
    const discountedTransfer = priceQuote({
      book: { ...book(), discountMatrix: matrix() },
      route: "resale",
      partnerTier: "gold",
      partnerResaleTotal: money(1n),
      quotedAt: "2026-07-31T16:00:00Z",
      lines: [line({ discountBps: 1_000 })],
    });
    expect(discountedTransfer.marginResult).toBe("exception_required");
    expect(discountedTransfer.exceptionReasons).toEqual([
      "storage/us-east prices below configured floor",
    ]);
    // The transfer price we set is guardrailed: (80 floor - 77 quoted) x 10 x 12.
    expect(discountedTransfer.marginImpact).toEqual(money(360n));
  });

  it("rejects a discount matrix outside the basis-point range", () => {
    expect(() =>
      priceQuote({
        book: {
          ...book(),
          discountMatrix: matrix({ defaultMaxDiscountBps: 10_001 }),
        },
        route: "direct",
        quotedAt: "2026-07-31T16:00:00Z",
        lines: [line()],
      }),
    ).toThrow(/Discount matrix default/);
  });

  it("isolates merchant-of-record rules", () => {
    expect(merchantOfRecord("direct")).toBe("fil_one");
    expect(merchantOfRecord("referral")).toBe("fil_one");
    expect(merchantOfRecord("resale")).toBe("partner");
    expect(merchantOfRecord("marketplace")).toBe("marketplace");
  });

  it("binds authority, PO, immutable quote, agreement version, and order-line snapshots", () => {
    const priced = priceQuote({
      book: book(),
      route: "direct",
      quotedAt: "2026-07-31T16:00:00Z",
      lines: [
        {
          lineId: "quote-line-1",
          sku: "storage",
          region: "us-east",
          quantity: "10",
          termMonths: 12,
        },
      ],
    });
    const draft = createQuoteDraft({
      id: "quote-1",
      seriesId: "series-1",
      accountId: "account-1",
      priceBook: { id: "book-1", version: 1 },
      route: "direct",
      lines: priced.lines,
      total: priced.total,
      marginResult: priced.marginResult,
      exceptionReasons: priced.exceptionReasons,
      expiresAt: "2026-08-31T16:00:00Z",
      createdBy: "buyer",
      createdAt: "2026-07-31T16:00:00Z",
    });
    const issued = issueQuote(draft, {
      issuedAt: "2026-07-31T16:05:00Z",
      renderedDocumentId: "document-quote",
    });
    const buyer = account({
      paymentTerms: { kind: "net", days: 30, creditApproved: true },
      procurement: {
        poRequired: true,
        apContactEmail: "ap@example.test",
        invoiceDeliveryEmail: "ap@example.test",
        supplierPortalStatus: "complete",
        certificates: [],
        furnishedDocuments: [],
      },
    });
    const base = {
      orderId: "order-1",
      quote: issued,
      agreement: {
        id: "agreement-1",
        accountId: buyer.id,
        version: 7,
        status: "active" as const,
        effectiveOn: "2026-01-01",
      },
      buyer,
      signerUserId: "buyer",
      authorityTitle: "Chief Financial Officer",
      authorityAttested: true,
      serviceStartsOn: "2026-08-01",
      serviceEndsOn: "2027-08-01",
      acceptedAt: "2026-07-31T17:00:00Z",
      orderFormDocumentId: "document-order",
      orderLineIds: ["order-line-1"],
    };
    expect(() => acceptOrder(base)).toThrow(/purchase_order_number/);
    const accepted = acceptOrder({ ...base, poNumber: "PO-2026-100" });
    expect(accepted).toMatchObject({
      agreementVersion: 7,
      authorityAttested: true,
      poNumber: "PO-2026-100",
      invoicingAccountId: buyer.id,
      provisioningKey: "order:order-1:v1:provision",
    });
    expect(accepted.lines[0]).toMatchObject({
      quoteLineId: "quote-line-1",
      sku: "storage",
      quantity: "10",
      overageRate: money(12n),
    });
  });

  it("pins buyer and partner agreements and rejects forged resale counterparties", () => {
    const priced = priceQuote({
      book: book(),
      route: "resale",
      partnerTier: "gold",
      partnerResaleTotal: money(1_200n),
      quotedAt: "2026-07-31T16:00:00Z",
      lines: [
        {
          lineId: "resale-quote-line-1",
          sku: "storage",
          region: "us-east",
          quantity: "10",
          termMonths: 12,
        },
      ],
    });
    const issued = issueQuote(
      createQuoteDraft({
        id: "resale-quote-1",
        seriesId: "resale-series-1",
        accountId: "end-client-1",
        endClientAccountId: "end-client-1",
        partnerAccountId: "partner-1",
        priceBook: { id: "book-1", version: 1 },
        route: "resale",
        lines: priced.lines,
        total: priced.total,
        partnerResaleTotal: money(1_200n),
        marginResult: priced.marginResult,
        exceptionReasons: priced.exceptionReasons,
        expiresAt: "2026-08-31T16:00:00Z",
        createdBy: "partner-buyer",
        createdAt: "2026-07-31T16:00:00Z",
      }),
      {
        issuedAt: "2026-07-31T16:05:00Z",
        renderedDocumentId: "end-client-resale-document",
        partnerDocumentId: "partner-transfer-document",
      },
    );
    const buyer = account({
      id: "end-client-1",
      roles: ["end_client"],
    });
    const partner = account({
      id: "partner-1",
      roles: ["partner"],
      partner: {
        agreementType: "resale",
        creditLimit: money(100_000n),
      },
    });
    const command = {
      orderId: "resale-order-1",
      quote: issued,
      agreement: {
        id: "buyer-agreement-9",
        accountId: buyer.id,
        version: 9,
        status: "active" as const,
        effectiveOn: "2026-01-01",
      },
      partnerAgreement: {
        id: "partner-agreement-4",
        accountId: partner.id,
        version: 4,
        status: "active" as const,
        effectiveOn: "2026-01-01",
        partnerAgreementType: "resale" as const,
      },
      buyer,
      partner,
      signerUserId: "partner-buyer",
      authorityTitle: "Partner Commercial Officer",
      authorityAttested: true,
      serviceStartsOn: "2026-08-01",
      serviceEndsOn: "2027-08-01",
      acceptedAt: "2026-07-31T17:00:00Z",
      orderFormDocumentId: "resale-order-document",
      orderLineIds: ["resale-order-line-1"],
    };

    expect(acceptOrder(command)).toMatchObject({
      agreementId: "partner-agreement-4",
      agreementVersion: 4,
      buyerAgreementId: "buyer-agreement-9",
      buyerAgreementVersion: 9,
      partnerAgreementId: "partner-agreement-4",
      partnerAgreementVersion: 4,
      accountId: "end-client-1",
      invoicingAccountId: "partner-1",
      partnerAccountId: "partner-1",
      merchantOfRecord: "partner",
    });
    expect(() =>
      acceptOrder({
        ...command,
        partner: { ...partner, id: "attacker-partner" },
      }),
    ).toThrow("Partner order must bind the quote partner account");
    expect(() =>
      acceptOrder({
        ...command,
        agreement: { ...command.agreement, accountId: "other-client" },
      }),
    ).toThrow("Buyer agreement belongs to another commercial party");
    expect(() =>
      acceptOrder({
        ...command,
        partnerAgreement: {
          ...command.partnerAgreement,
          partnerAgreementType: "referral",
        },
      }),
    ).toThrow("Quote route conflicts with governing partner agreement");
  });

  it("allows offboarding only from recoverable order source states", () => {
    for (const status of ["accepted", "provisioning", "active", "amended"])
      expect(() =>
        assertRecoverableOffboardingSourceStatus(status),
      ).not.toThrow();
    for (const status of ["submitted", "completed", "cancelled", "terminated"])
      expect(() => assertRecoverableOffboardingSourceStatus(status)).toThrow(
        "ORDER_NOT_ELIGIBLE_FOR_OFFBOARDING",
      );
  });

  it("blocks only new partner service when aggregate exposure exceeds credit", () => {
    const decision = partnerCreditDecision({
      currency: "USD",
      creditLimitMinor: 10_000n,
      openInvoiceMinor: 8_000n,
      uninvoicedProvisionedMinor: 1_500n,
      proposedNewServiceMinor: 1_000n,
    });
    expect(decision.allowNewService).toBe(false);
    expect(decision.affectRunningServices).toBe(false);
    expect(decision.projectedExposure.minor).toBe("10500");
  });

  it("rejects a partner hierarchy deeper than distributor-reseller", () => {
    const distributor = account({
      id: "distributor",
      roles: ["partner"],
      partner: { agreementType: "resale", creditLimit: money(1000n) },
    });
    const reseller = account({
      id: "reseller",
      roles: ["partner"],
      partner: {
        agreementType: "resale",
        creditLimit: money(1000n),
        parentPartnerId: distributor.id,
      },
    });
    const sub = account({
      id: "sub",
      roles: ["partner"],
      partner: {
        agreementType: "resale",
        creditLimit: money(1000n),
        parentPartnerId: reseller.id,
      },
    });
    expect(() =>
      validatePartnerHierarchy([distributor, reseller, sub]),
    ).toThrow(/two tiers/);
  });
});

describe("money and proration properties", () => {
  it("round-trips arbitrary 18-place quantities", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 30n), max: 10n ** 30n }),
        (value) => {
          expect(parseDecimal(formatDecimal(value), true)).toBe(value);
        },
      ),
    );
  });

  it("quantity addition is exact and commutative", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 24n }),
        fc.bigInt({ min: 0n, max: 10n ** 24n }),
        (left, right) => {
          const a = formatDecimal(left);
          const b = formatDecimal(right);
          expect(addQuantities(a, b)).toBe(addQuantities(b, a));
          expect(
            compareQuantities(addQuantities(a, b), formatDecimal(left + right)),
          ).toBe(0);
        },
      ),
    );
  });

  it("minor-unit multiplication differs from exact rational by at most half a unit", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 12n }),
        fc.bigInt({ min: 0n, max: 10n ** 18n }),
        (minor, scaled) => {
          const rounded = multiplyMinorByQuantity(minor, formatDecimal(scaled));
          const residual = rounded * 10n ** 18n - minor * scaled;
          expect(residual < 0n ? -residual : residual).toBeLessThanOrEqual(
            5n * 10n ** 17n,
          );
        },
      ),
    );
  });

  it("daily proration is bounded and deterministic", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 12n }),
        fc.integer({ min: 0, max: 365 }),
        (minor, day) => {
          const effective = new Date(Date.UTC(2026, 0, 1 + day))
            .toISOString()
            .slice(0, 10);
          const result = prorateMoney({
            amount: money(minor),
            method: "daily",
            effectiveOn: effective,
            periodStartsOn: "2026-01-01",
            periodEndsOn: "2027-01-01",
          });
          expect(BigInt(result.minor)).toBeGreaterThanOrEqual(0n);
          expect(BigInt(result.minor)).toBeLessThanOrEqual(minor);
        },
      ),
    );
  });

  it("does not allow credits beyond invoice remaining value", () => {
    expect(() =>
      creditAmount({
        invoiceRemaining: money(100n),
        requested: money(51n),
        alreadyRefundedOrCredited: money(50n),
      }),
    ).toThrow(/exceeds/);
    expect(() =>
      creditAmount({
        invoiceRemaining: money(100n, "USD"),
        requested: money(1n, "EUR"),
        alreadyRefundedOrCredited: money(0n, "USD"),
      }),
    ).toThrow(/currencies/);
  });

  it("chases the remainder and stops once nothing is owed", () => {
    const aged = {
      policy: {
        kind: "net_terms" as const,
        days: 30,
        collectionsOwnerId: "u1",
      },
      dueAt: "2026-06-01T00:00:00.000Z",
      now: "2026-07-15T00:00:00.000Z",
      firstThresholdDays: 7,
      secondThresholdDays: 30,
      retentionLiabilityRule: "custom" as const,
    };
    expect(dunningDecision(aged).actions).toEqual([
      "notify_collections_owner",
      "pause_new_orders",
      "pause_poc_conversions",
      "human_suspension_review",
      "write_suspension_only",
    ]);
    expect(
      dunningDecision({ ...aged, outstanding: money(4_000n) }).actions,
    ).toEqual(dunningDecision(aged).actions);
    const settled = dunningDecision({ ...aged, outstanding: money(0n) });
    expect(settled.actions).toEqual([]);
    expect(settled.agingDays).toBe(44);
    expect(settled.collectionsOwnerId).toBe("u1");
  });
});

describe("commitment ledger authority", () => {
  const contract: CommitmentContract = {
    ledgerId: "ledger-1",
    orderId: "order-1",
    orderLineId: "line-1",
    commitType: "period_allowance",
    timeZone: "America/New_York",
    periods: [
      {
        id: "2026-07",
        startsAt: "2026-07-01T00:00:00-04:00",
        endsAt: "2026-08-01T00:00:00-04:00",
        allowance: "100",
        partial: false,
      },
      {
        id: "2026-08",
        startsAt: "2026-08-01T00:00:00-04:00",
        endsAt: "2026-09-01T00:00:00-04:00",
        allowance: "100",
        partial: false,
      },
    ],
    contractedOverageRate: money(25n),
    allowanceAdjustments: [],
  };

  const event = (overrides: Partial<LedgerUsageEvent>): LedgerUsageEvent => ({
    id: "usage-1",
    externalEventId: "source-1",
    measuredAt: "2026-07-31T23:59:59-04:00",
    recordedAt: "2026-08-03T00:00:00Z",
    quantity: "125",
    source: "orchestrator",
    kind: "usage",
    ...overrides,
  });

  it("assigns boundary and late usage by measured time and emits priced overage", () => {
    const decision = decideCommitmentOverage(contract, [
      event({}),
      event({
        id: "usage-2",
        externalEventId: "source-2",
        measuredAt: "2026-08-01T00:00:00-04:00",
        recordedAt: "2026-08-01T04:00:01Z",
        quantity: "10",
      }),
    ]);
    expect(decision.authority).toBe("commitment_ledger");
    expect(decision.periods.map((period) => period.consumed)).toEqual([
      "125",
      "10",
    ]);
    expect(decision.totalOverage).toBe("25");
    expect(decision.entries[0]).toMatchObject({
      periodId: "2026-07",
      late: true,
    });
    expect(decision.overageAmount.minor).toBe("625");
  });

  it("replays corrections and duplicate/out-of-order source delivery safely", () => {
    const usage = event({});
    const correction = event({
      id: "correction-1",
      externalEventId: "source-correction-1",
      quantity: "-30",
      kind: "correction",
      correctionOf: usage.id,
      measuredAt: usage.measuredAt,
    });
    const decision = decideCommitmentOverage(contract, [
      correction,
      usage,
      usage,
    ]);
    expect(decision.totalConsumed).toBe("95");
    expect(decision.totalOverage).toBe("0");
    expect(decision.entries[1]?.overageDelta).toBe("-25");
    expect(decision.duplicateExternalEventIds).toEqual(["source-1"]);
    expect(
      reconcileCommitmentToSource(decision, [
        { externalEventId: "source-1", quantity: "125" },
        { externalEventId: "source-correction-1", quantity: "-30" },
      ]).matched,
    ).toBe(true);
  });

  it("satisfies overage=max(usage-allowance,0) for arbitrary usage", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 1000n * 10n ** 18n }), (scaled) => {
        const quantity = formatDecimal(scaled);
        const decision = decideCommitmentOverage(contract, [
          event({ quantity }),
        ]);
        const expected =
          scaled > 100n * 10n ** 18n ? scaled - 100n * 10n ** 18n : 0n;
        expect(parseDecimal(decision.totalOverage)).toBe(expected);
      }),
    );
  });

  it("draws a term commitment down once across amendments and renewal boundaries", () => {
    const term: CommitmentContract = {
      ...contract,
      ledgerId: "term-ledger",
      commitType: "term_drawdown",
      periods: [
        {
          id: "term-2026",
          startsAt: "2026-01-15T00:00:00-05:00",
          endsAt: "2027-01-15T00:00:00-05:00",
          allowance: "1000",
          partial: true,
        },
      ],
      allowanceAdjustments: [
        {
          id: "upgrade-1",
          effectiveAt: "2026-07-15T00:00:00-04:00",
          quantityDelta: "200",
          reason: "amendment",
        },
      ],
    };
    const decision = decideCommitmentOverage(term, [
      event({
        id: "term-usage-1",
        externalEventId: "term-source-1",
        measuredAt: "2026-02-01T00:00:00-05:00",
        recordedAt: "2026-02-01T01:00:00-05:00",
        quantity: "900",
      }),
      event({
        id: "term-usage-2",
        externalEventId: "term-source-2",
        measuredAt: "2026-12-01T00:00:00-05:00",
        recordedAt: "2026-12-01T01:00:00-05:00",
        quantity: "350",
      }),
    ]);
    expect(decision.periods[0]).toMatchObject({
      allowance: "1200",
      consumed: "1250",
      overage: "50",
    });
    expect(decision.totalOverage).toBe("50");
    const renewed = {
      ...term,
      ledgerId: "term-ledger-renewal",
      periods: [
        {
          id: "term-2027",
          startsAt: "2027-01-15T00:00:00-05:00",
          endsAt: "2028-01-15T00:00:00-05:00",
          allowance: "1000",
          partial: false,
        },
      ],
      allowanceAdjustments: [],
    } satisfies CommitmentContract;
    expect(decideCommitmentOverage(renewed, []).totalConsumed).toBe("0");
  });
});

describe("commissions, webhook projection, and exports", () => {
  it("nets clawbacks symmetrically against collected-revenue commission", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10n ** 12n }), (amount) => {
        const positive = accrueCommission({
          event: {
            id: "payment",
            invoiceId: "invoice",
            partnerAccountId: "partner",
            occurredAt: "2026-07-31T16:00:00Z",
            type: "payment",
            amount: money(amount),
          },
          agreementType: "referral",
          rateBps: 1250,
          holdbackBps: 1000,
        });
        const clawback = accrueCommission({
          event: {
            id: "refund",
            invoiceId: "invoice",
            partnerAccountId: "partner",
            occurredAt: "2026-07-31T16:00:00Z",
            type: "refund",
            amount: money(amount),
          },
          agreementType: "referral",
          rateBps: 1250,
          holdbackBps: 1000,
        });
        expect(
          BigInt(positive.payable.minor) + BigInt(clawback.payable.minor),
        ).toBe(0n);
      }),
    );
  });

  it("compensates an exact credit-note clawback after signed voiding", () => {
    const clawback = accrueCommission({
      event: {
        id: "credit-note",
        invoiceId: "invoice",
        partnerAccountId: "partner",
        occurredAt: "2026-07-31T16:00:00Z",
        type: "credit_note",
        amount: money(60_000n),
      },
      agreementType: "referral",
      rateBps: 1200,
      holdbackBps: 1000,
    });
    const reversal = accrueCommission({
      event: {
        id: "credit-note",
        invoiceId: "invoice",
        partnerAccountId: "partner",
        occurredAt: "2026-07-31T17:00:00Z",
        type: "credit_note_void",
        amount: money(60_000n),
      },
      agreementType: "referral",
      rateBps: 1200,
      holdbackBps: 1000,
    });
    expect(
      BigInt(clawback.payable.minor) + BigInt(reversal.payable.minor),
    ).toBe(0n);
    expect(reversal.kind).toBe("accrual");
  });

  it("deduplicates and refuses to regress Stripe truth on old delivery", () => {
    const latest = {
      id: "evt-2",
      type: "invoice.paid",
      created: 2,
      objectId: "in-1",
      status: "paid",
    };
    const old = {
      id: "evt-1",
      type: "invoice.open",
      created: 1,
      objectId: "in-1",
      status: "open",
    };
    const result = projectStripeTruth([latest, old, latest]);
    expect(result.projections["in-1"]?.status).toBe("paid");
    expect(result.duplicates).toEqual(["evt-2"]);
    expect(result.ignoredOutOfOrder).toEqual(["evt-1"]);
  });

  // CSV formula safety is asserted over the bytes callers actually receive:
  // the HTTP download in packages/api/src/routes/core/core.integration.test.ts
  // and the workflow export in packages/workflows/src/core/csv.test.ts.

  it("labels partner margin modeled until every source cost is realized", () => {
    const performance = partnerPerformance([
      {
        partnerAccountId: "partner",
        agreementType: "resale",
        registrationId: "registration",
        converted: true,
        endClientAccountId: "end-client",
        booked: money(1000n),
        renewed: false,
        eligibleForRenewal: false,
        revenueMinor: "1000",
      },
    ]);
    expect(performance[0]?.marginLabel).toBe("modeled");
  });

  it("requires zero variance for a three-way tie-out", () => {
    expect(
      threeWayTieOut({
        currency: "USD",
        platformMinor: 10_000n,
        stripeMinor: 10_000n,
        qboMinor: 9_999n,
      }),
    ).toMatchObject({ tied: false, qboVarianceMinor: "1" });
  });
});

it("uses list price for direct and referral even when partner tier metadata is present", () => {
  for (const route of ["direct", "referral"] as const) {
    const priced = priceQuote({
      book: book(),
      route,
      partnerTier: "gold",
      quotedAt: "2026-07-31T16:00:00Z",
      lines: [
        { sku: "storage", region: "us-east", quantity: "10", termMonths: 12 },
      ],
    });
    const expected = priceQuote({
      book: book(),
      route,
      quotedAt: "2026-07-31T16:00:00Z",
      lines: [
        { sku: "storage", region: "us-east", quantity: "10", termMonths: 12 },
      ],
    });
    expect(priced.total).toEqual(expected.total);
  }
});

it("rejects impossible calendar dates instead of rolling them into the next month", () => {
  expect(() =>
    priceQuote({
      book: { ...book(), effectiveFrom: "2026-02-30" },
      route: "direct",
      quotedAt: "2026-07-31T16:00:00Z",
      lines: [
        { sku: "storage", region: "us-east", quantity: "10", termMonths: 12 },
      ],
    }),
  ).toThrow("ISO calendar date");
});
