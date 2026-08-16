import type { TaxDeterminationRequest } from "@clockwork/contracts";
import { ids, MoneySchema } from "@clockwork/contracts";
import type { TaxRuleBook } from "@clockwork/domain/core";
import { parseTaxRuleBook } from "@clockwork/domain/core";
import { describe, expect, it } from "vitest";
import type { ZodType } from "zod";

import { FakeProviderKernel } from "../../fakes/scenario";
import { FakeTaxAdapter } from "../../fakes/providers";
import type { ProviderJsonTransport } from "../../provider-transport";
import { HttpTaxDeterminationAdapter } from "./http-determination-adapter";
import {
  determinationIdFor,
  RuleBookTaxDeterminationAdapter,
} from "./rule-book-adapter";
import { seedTaxRuleBook } from "./seed-rule-book";

const accountId = ids.account.parse("10000000-0000-4000-8000-000000000001");

const money = (currency: "USD" | "EUR", minor: string) =>
  MoneySchema.parse({ currency, minor });

const usSupplier = {
  legalEntityId: "entity-us",
  establishedCountry: "US",
  registrations: [
    {
      jurisdiction: "US",
      scheme: "us-sales-tax",
      number: "WA-601-123-456",
      verifiedAt: "2026-01-01",
      evidenceReference: "dor:1",
    },
  ],
};

const esSupplier = {
  legalEntityId: "entity-es",
  establishedCountry: "ES",
  registrations: [
    {
      jurisdiction: "ES",
      scheme: "eu-vat",
      number: "ESA12345674",
      verifiedAt: "2026-02-01",
      evidenceReference: "vies:ES:1",
    },
  ],
};

function usDomestic(): TaxDeterminationRequest {
  return {
    supplier: usSupplier,
    customer: {
      accountId,
      country: "US",
      address: { country: "US", region: "WA", postalCode: "98101" },
      status: "business",
      registrations: [],
      exemptionCertificates: [],
    },
    lines: [
      {
        lineId: "81000000-0000-4000-8000-000000000001",
        taxCode: "txcd_demo",
        supplyType: "digital_service",
        netAmount: money("USD", "100000"),
      },
    ],
    taxPointDate: "2026-03-01",
    documentType: "invoice",
  };
}

function euCrossBorder(): TaxDeterminationRequest {
  return {
    supplier: esSupplier,
    customer: {
      accountId,
      country: "DE",
      address: { country: "DE", postalCode: "10115" },
      status: "business",
      registrations: [
        {
          jurisdiction: "DE",
          scheme: "eu-vat",
          number: "DE123456789",
          verifiedAt: "2026-02-20",
          evidenceReference: "vies:DE:1",
        },
      ],
      exemptionCertificates: [],
    },
    lines: [
      {
        lineId: "81000000-0000-4000-8000-000000000002",
        taxCode: "txcd_demo",
        supplyType: "service",
        netAmount: money("EUR", "100000"),
      },
    ],
    taxPointDate: "2026-03-01",
    documentType: "invoice",
  };
}

describe("the seeded rule book", () => {
  it("parses, so an amendment that breaks its shape fails loudly", () => {
    const book = seedTaxRuleBook();
    expect(book.id).toBe("seed-2026-01");
    expect(book.territories.length).toBeGreaterThan(0);
    expect(book.rates.every((rate) => rate.ratePpm >= 0)).toBe(true);
  });

  it("stacks the four US authorities an address reaches", async () => {
    const adapter = new RuleBookTaxDeterminationAdapter(seedTaxRuleBook());
    const result = await adapter.determine(usDomestic());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.lines.map((line) => line.jurisdiction)).toEqual([
      "US-WA",
      "US-WA-KING",
      "US-WA-SEATTLE",
      "US-WA-RTA",
    ]);
    expect(result.value.totals.taxMinor).toBe("11250");
    expect(result.value.rounding).toBe("invoice");
  });

  it("reverse charges an EU cross-border business supply with the union's notation", async () => {
    const adapter = new RuleBookTaxDeterminationAdapter(seedTaxRuleBook());
    const result = await adapter.determine(euCrossBorder());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.lines[0]).toMatchObject({
      jurisdiction: "DE",
      treatment: "reverse_charge",
      taxMinor: "0",
    });
    expect(result.value.lines[0]?.notation).toContain("Reverse charge");
    expect(result.value.confidence).toBe("determined");
  });
});

describe("rule-book determination adapter", () => {
  it("answers with a determination id that is stable for the same document", async () => {
    const adapter = new RuleBookTaxDeterminationAdapter(seedTaxRuleBook());
    const first = await adapter.determine(usDomestic());
    const second = await adapter.determine(usDomestic());
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value.determinationId).toBe(second.value.determinationId);
    expect(first.value.determinationId).toBe(
      determinationIdFor(usDomestic(), seedTaxRuleBook()),
    );
    const other = await adapter.determine({
      ...usDomestic(),
      taxPointDate: "2026-04-01",
    });
    expect(other.ok).toBe(true);
    if (!other.ok) return;
    expect(other.value.determinationId).not.toBe(first.value.determinationId);
  });

  it("credits under the book the charge was pinned to, not the current one", async () => {
    const current = seedTaxRuleBook();
    const historic: TaxRuleBook = parseTaxRuleBook({
      ...current,
      id: "seed-2019",
      version: 1,
      effectiveFrom: "2019-01-01",
      effectiveTo: "2025-12-31",
      rates: current.rates.map((rate) =>
        rate.jurisdictionId === "US-WA" && rate.taxCode === "*"
          ? { ...rate, ratePpm: 50_000 }
          : rate,
      ),
    });
    const adapter = new RuleBookTaxDeterminationAdapter([current, historic]);
    const credit = await adapter.determine({
      ...usDomestic(),
      documentType: "credit_note",
      lines: usDomestic().lines.map((line) => ({
        ...line,
        netAmount: money("USD", "-100000"),
      })),
      reversalOf: {
        invoiceId: ids.invoice.parse("90000000-0000-4000-8000-000000000001"),
        pinnedRuleBookIds: ["seed-2019"],
      },
    });
    expect(credit.ok).toBe(true);
    if (!credit.ok) return;
    expect(credit.value.lines[0]).toMatchObject({
      ruleBookId: "seed-2019",
      jurisdiction: "US-WA",
      ratePpm: 50_000,
      taxMinor: "-5000",
    });
  });

  it("refuses when no book covers the tax point, and when the engine cannot answer", async () => {
    const adapter = new RuleBookTaxDeterminationAdapter(seedTaxRuleBook());
    const early = await adapter.determine({
      ...usDomestic(),
      taxPointDate: "2019-01-01",
    });
    expect(early).toMatchObject({
      ok: false,
      kind: "permanent",
      code: "TAX_RULE_BOOK_NOT_EFFECTIVE",
    });
    const unknown = await adapter.determine({
      ...usDomestic(),
      customer: {
        ...usDomestic().customer,
        country: "JP",
        address: { country: "JP" },
      },
    });
    expect(unknown).toMatchObject({
      ok: false,
      kind: "permanent",
      code: "TAX_TERRITORY_UNKNOWN",
    });
  });

  it("validates an identifier against the register's published format and keeps the proof", async () => {
    const adapter = new RuleBookTaxDeterminationAdapter(seedTaxRuleBook());
    const valid = await adapter.validateTaxId({
      country: "ES",
      value: "ESA1234567 4",
      checkedAt: "2026-03-01T09:00:00.000Z",
    });
    expect(valid).toMatchObject({
      ok: true,
      value: {
        valid: true,
        normalized: "ESA12345674",
        reverseChargeEligible: true,
        scheme: "eu-vat",
        verifiedAt: "2026-03-01T09:00:00.000Z",
      },
    });
    if (valid.ok)
      expect(valid.value.evidenceReference).toContain("seed-2026-01");

    const rubbish = await adapter.validateTaxId({
      country: "ES",
      value: "not-a-number",
      checkedAt: "2026-03-01T09:00:00.000Z",
    });
    expect(rubbish).toMatchObject({
      ok: true,
      value: { valid: false, reverseChargeEligible: false },
    });
  });
});

describe("the fake tax provider", () => {
  it("runs the same engine the production adapter runs", async () => {
    const kernel = new FakeProviderKernel();
    const fake = new FakeTaxAdapter(kernel);
    const direct = await new RuleBookTaxDeterminationAdapter(
      seedTaxRuleBook(),
    ).determine(euCrossBorder());
    const viaFake = await fake.determine(euCrossBorder());
    expect(viaFake).toEqual(direct);
    expect(kernel.calls.map((call) => call.operation)).toEqual([
      "tax.determine",
    ]);
  });

  it("still fails the way the kernel is told to fail", async () => {
    const kernel = new FakeProviderKernel();
    kernel.enqueue("tax.determine", {
      outcome: "transient_failure",
      code: "TAX_PROVIDER_UNAVAILABLE",
    });
    const fake = new FakeTaxAdapter(kernel);
    const result = await fake.determine(usDomestic());
    expect(result).toMatchObject({ ok: false, kind: "transient" });
  });

  it("determines against rule books it is seeded with", async () => {
    const seeded = parseTaxRuleBook({
      ...seedTaxRuleBook(),
      id: "house-book",
      version: 2,
      rates: seedTaxRuleBook().rates.map((rate) =>
        rate.jurisdictionId === "US-WA" && rate.taxCode === "*"
          ? { ...rate, ratePpm: 100_000 }
          : rate,
      ),
    });
    const fake = new FakeTaxAdapter(new FakeProviderKernel(), {}, seeded);
    const result = await fake.determine(usDomestic());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.lines[0]).toMatchObject({
      ruleBookId: "house-book",
      ratePpm: 100_000,
      taxMinor: "10000",
    });
  });

  it("keeps the deprecated calculate answering as it did, credits included", async () => {
    const fake = new FakeTaxAdapter(new FakeProviderKernel(), {
      rateBasisPoints: { txcd_demo: 2_000 },
    });
    const charge = await fake.calculate({
      accountId,
      jurisdiction: "US",
      lines: [{ taxCode: "txcd_demo", amount: money("USD", "105") }],
    });
    const credit = await fake.calculate({
      accountId,
      jurisdiction: "US",
      lines: [{ taxCode: "txcd_demo", amount: money("USD", "-105") }],
    });
    expect(charge).toMatchObject({
      ok: true,
      value: { treatment: "standard", tax: { minor: "21" } },
    });
    // Half away from zero: the credit mirrors the charge rather than drifting.
    expect(credit).toMatchObject({
      ok: true,
      value: { treatment: "standard", tax: { minor: "-21" } },
    });
  });

  it("answers the legacy identifier shape without inventing a validation date", async () => {
    const fake = new FakeTaxAdapter(new FakeProviderKernel(), {
      reverseChargeIdentifierPrefixes: ["GB"],
    });
    const legacy = await fake.validateTaxId({
      country: "GB",
      value: "GB123456789",
    });
    expect(legacy).toMatchObject({
      ok: true,
      value: { valid: true, reverseChargeEligible: true },
    });
    if (legacy.ok) expect(legacy.value).not.toHaveProperty("verifiedAt");

    const dated = await fake.validateTaxId({
      country: "GB",
      value: "GB123456789",
      checkedAt: "2026-03-01T09:00:00.000Z",
    });
    expect(dated).toMatchObject({
      ok: true,
      value: {
        valid: true,
        reverseChargeEligible: true,
        verifiedAt: "2026-03-01T09:00:00.000Z",
      },
    });
  });
});

class QueuedTransport implements ProviderJsonTransport {
  public readonly calls: { operation: string; path: string }[] = [];
  public constructor(private readonly responses: unknown[]) {}
  public request<T>(input: {
    operation: string;
    path: string;
    body: Readonly<Record<string, unknown>>;
    response: ZodType<T>;
    idempotencyKey?: string;
  }): Promise<T> {
    this.calls.push({ operation: input.operation, path: input.path });
    return Promise.resolve(input.response.parse(this.responses.shift()));
  }
}

/**
 * A provider answer in the per-line, per-jurisdiction shape Stripe Tax and
 * Avalara both return.
 */
const providerAnswer = (
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> => ({
  determinationId: "calc_123",
  placeOfSupply: ["US-WA"],
  confidence: "determined",
  reviewReasons: [],
  rounding: "invoice",
  lines: [
    {
      lineId: "81000000-0000-4000-8000-000000000001",
      jurisdiction: "US-WA",
      treatment: "standard",
      taxCode: "txcd_demo",
      ruleBookId: "stripe-2026-03",
      ruleBookVersion: 1,
      ratePpm: 65_000,
      rateKind: "standard",
      taxableMinor: "100000",
      taxMinor: "6500",
      legalBasis: "RCW 82.08.020",
      notation: "",
    },
  ],
  totals: {
    currency: "USD",
    netMinor: "100000",
    taxMinor: "6500",
    grossMinor: "106500",
    byTreatment: [
      { treatment: "standard", netMinor: "100000", taxMinor: "6500" },
    ],
  },
  ...overrides,
});

describe("http determination adapter", () => {
  it("accepts a well-formed per-jurisdiction answer", async () => {
    const transport = new QueuedTransport([providerAnswer()]);
    const result = await new HttpTaxDeterminationAdapter(transport).determine(
      usDomestic(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.lines[0]?.jurisdiction).toBe("US-WA");
    expect(transport.calls[0]?.path).toBe("/v1/tax/calculations");
  });

  it("refuses an amount charged against a supply that is billed net", async () => {
    const answer = providerAnswer();
    const lines = answer.lines as Record<string, unknown>[];
    const line = lines[0] as Record<string, unknown>;
    const transport = new QueuedTransport([
      {
        ...answer,
        lines: [{ ...line, treatment: "reverse_charge" }],
      },
    ]);
    const result = await new HttpTaxDeterminationAdapter(transport).determine(
      usDomestic(),
    );
    expect(result).toMatchObject({
      ok: false,
      kind: "permanent",
      code: "TAX_DETERMINATION_TREATMENT_INCONSISTENT",
    });
  });

  it("refuses an answer whose lines do not sum to its own total", async () => {
    const answer = providerAnswer();
    const totals = answer.totals as Record<string, unknown>;
    const transport = new QueuedTransport([
      { ...answer, totals: { ...totals, taxMinor: "7000" } },
    ]);
    const result = await new HttpTaxDeterminationAdapter(transport).determine(
      usDomestic(),
    );
    expect(result).toMatchObject({
      ok: false,
      code: "TAX_DETERMINATION_TOTALS_INCONSISTENT",
    });
  });

  /**
   * The arithmetic refusals, one trust boundary out.
   *
   * The engine was repaired so it could not return treatment buckets summing to
   * twice the document. A third-party provider can return exactly that shape,
   * and until now the adapter checked only that the line tax summed to the tax
   * total and accepted the rest. Each of these is refused with its own code, and
   * none is repaired: a provider disagreeing with us about a document total is a
   * fact an operator has to see, and recomputing it here would hide a provider
   * defect behind our arithmetic.
   */
  const refuses = async (
    overrides: Record<string, unknown>,
    code: string,
  ): Promise<void> => {
    const transport = new QueuedTransport([providerAnswer(overrides)]);
    const result = await new HttpTaxDeterminationAdapter(transport).determine(
      usDomestic(),
    );
    expect(result).toMatchObject({ ok: false, kind: "permanent", code });
  };

  const totalsWith = (overrides: Record<string, unknown>) => ({
    ...(providerAnswer().totals as Record<string, unknown>),
    ...overrides,
  });

  it("refuses treatment buckets that do not sum to the document they split", async () => {
    // The engine's old shape: the whole of a 100000 line counted once under
    // each of two treatments, for buckets totalling 200000.
    await refuses(
      {
        totals: totalsWith({
          byTreatment: [
            { treatment: "standard", netMinor: "100000", taxMinor: "6500" },
            { treatment: "out_of_scope", netMinor: "100000", taxMinor: "0" },
          ],
        }),
      },
      "TAX_DETERMINATION_TREATMENT_TOTALS_INCONSISTENT",
    );
    // The same defect in the tax column rather than the net column.
    await refuses(
      {
        totals: totalsWith({
          byTreatment: [
            { treatment: "standard", netMinor: "75000", taxMinor: "6500" },
            { treatment: "out_of_scope", netMinor: "25000", taxMinor: "6500" },
          ],
        }),
      },
      "TAX_DETERMINATION_TREATMENT_TOTALS_INCONSISTENT",
    );
  });

  it("refuses two buckets for one treatment, because then neither is the answer for it", async () => {
    await refuses(
      {
        totals: totalsWith({
          byTreatment: [
            { treatment: "standard", netMinor: "40000", taxMinor: "6500" },
            { treatment: "standard", netMinor: "60000", taxMinor: "0" },
          ],
        }),
      },
      "TAX_DETERMINATION_TREATMENT_BUCKET_DUPLICATED",
    );
  });

  it("refuses a gross that is not the answer's own net plus its own tax", async () => {
    await refuses(
      { totals: totalsWith({ grossMinor: "100000" }) },
      "TAX_DETERMINATION_GROSS_INCONSISTENT",
    );
  });

  it("refuses an answer determined against a net other than the one it was sent", async () => {
    await refuses(
      {
        totals: totalsWith({
          netMinor: "90000",
          grossMinor: "96500",
          byTreatment: [
            { treatment: "standard", netMinor: "90000", taxMinor: "6500" },
          ],
        }),
      },
      "TAX_DETERMINATION_NET_MISMATCH",
    );
  });

  it("refuses a document that spans currencies, which has no net to compare against", async () => {
    const transport = new QueuedTransport([providerAnswer()]);
    const document = usDomestic();
    const result = await new HttpTaxDeterminationAdapter(transport).determine({
      ...document,
      lines: [
        ...document.lines,
        {
          lineId: "81000000-0000-4000-8000-000000000002",
          taxCode: "txcd_demo",
          supplyType: "service",
          netAmount: money("EUR", "1000"),
        },
      ],
    });
    expect(result).toMatchObject({
      ok: false,
      kind: "permanent",
      code: "TAX_DETERMINATION_CURRENCY_MIXED",
    });
  });

  it("accepts a provider that publishes no treatment split at all", async () => {
    // A provider that states no buckets asserts nothing about the split, and
    // refusing it would block a legitimate answer rather than catch a wrong one.
    const answer = providerAnswer();
    const totals = answer.totals as Record<string, unknown>;
    const withoutBuckets = Object.fromEntries(
      Object.entries(totals).filter(([key]) => key !== "byTreatment"),
    );
    const transport = new QueuedTransport([
      { ...answer, totals: withoutBuckets },
    ]);
    const result = await new HttpTaxDeterminationAdapter(transport).determine(
      usDomestic(),
    );
    expect(result.ok).toBe(true);
  });

  it("refuses an answer about a line nobody asked about", async () => {
    const answer = providerAnswer();
    const lines = answer.lines as Record<string, unknown>[];
    const line = lines[0] as Record<string, unknown>;
    const transport = new QueuedTransport([
      { ...answer, lines: [{ ...line, lineId: "some-other-line" }] },
    ]);
    const result = await new HttpTaxDeterminationAdapter(transport).determine(
      usDomestic(),
    );
    expect(result).toMatchObject({
      ok: false,
      code: "TAX_DETERMINATION_LINE_UNKNOWN",
    });
  });

  it("refuses an invalid identifier reported as reverse-charge eligible", async () => {
    const transport = new QueuedTransport([
      {
        valid: false,
        normalized: "ESA12345674",
        reverseChargeEligible: true,
        verifiedAt: "2026-03-01T09:00:00.000Z",
        evidenceReference: "vies:1",
      },
    ]);
    const result = await new HttpTaxDeterminationAdapter(
      transport,
    ).validateTaxId({
      country: "ES",
      value: "ESA12345674",
      checkedAt: "2026-03-01T09:00:00.000Z",
    });
    expect(result).toMatchObject({
      ok: false,
      code: "TAX_IDENTIFIER_RESPONSE_INCONSISTENT",
    });
  });
});
