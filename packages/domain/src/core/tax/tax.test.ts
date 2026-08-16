import type {
  Money,
  TaxDeterminationRequest,
  TaxRegistration,
} from "@clockwork/contracts";
import { ids, MoneySchema } from "@clockwork/contracts";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { determineTax, TaxDeterminationError, taxOnNet } from "./engine";
import { parseTaxRuleBook, type TaxRuleBook } from "./rule-book";

/**
 * The rule book under test is DATA, exactly as it is in production. Not one
 * rate, country, carve-out or notation below is expressed as a branch in the
 * engine: change a number here and the engine's answer changes, which is the
 * property the owner authorised this work on.
 */
const ruleBook: TaxRuleBook = parseTaxRuleBook({
  id: "test-book",
  version: 7,
  effectiveFrom: "2000-01-01",
  unions: [
    {
      id: "eu-vat",
      reverseCharge: [
        { supplyType: "service", available: true, legalBasis: "Art 196" },
        {
          supplyType: "digital_service",
          available: true,
          legalBasis: "Art 196",
        },
        { supplyType: "goods", available: false, legalBasis: "Art 138" },
      ],
    },
  ],
  territories: [
    {
      id: "ES",
      country: "ES",
      unionId: "eu-vat",
      rounding: "line",
      exportOfServices: {
        treatment: "out_of_scope",
        rateKind: "none",
        legalBasis: "Art 44",
      },
      effectiveFrom: "1993-01-01",
    },
    {
      id: "ES-CN",
      country: "ES",
      regions: ["CN"],
      postalPrefixes: ["35", "38"],
      rounding: "line",
      exportOfServices: {
        treatment: "out_of_scope",
        rateKind: "none",
        legalBasis: "Canary Islands sit outside the EU VAT territory",
      },
      effectiveFrom: "1993-01-01",
    },
    {
      id: "DE",
      country: "DE",
      unionId: "eu-vat",
      rounding: "line",
      exportOfServices: {
        treatment: "out_of_scope",
        rateKind: "none",
        legalBasis: "Art 44",
      },
      effectiveFrom: "1993-01-01",
    },
    {
      id: "GB",
      country: "GB",
      unionId: "eu-vat",
      rounding: "line",
      exportOfServices: {
        treatment: "out_of_scope",
        rateKind: "none",
        legalBasis: "Art 44",
      },
      effectiveFrom: "1993-01-01",
      effectiveTo: "2020-12-31",
    },
    {
      id: "GB",
      country: "GB",
      rounding: "line",
      exportOfServices: {
        treatment: "zero_rated",
        rateKind: "zero",
        legalBasis: "VATA 1994 Sch 8",
      },
      effectiveFrom: "2021-01-01",
    },
    {
      id: "US",
      country: "US",
      sourcing: "destination",
      rounding: "invoice",
      exportOfServices: {
        treatment: "out_of_scope",
        rateKind: "none",
        legalBasis: "No US sales tax reaches a supply delivered abroad",
      },
      effectiveFrom: "1900-01-01",
    },
  ],
  jurisdictions: [
    {
      id: "ES",
      territoryId: "ES",
      level: "country",
      sequence: 1,
      effectiveFrom: "1993-01-01",
    },
    {
      id: "ES-CN",
      territoryId: "ES-CN",
      level: "country",
      sequence: 1,
      effectiveFrom: "1993-01-01",
    },
    {
      id: "DE",
      territoryId: "DE",
      level: "country",
      sequence: 1,
      effectiveFrom: "1993-01-01",
    },
    {
      id: "GB",
      territoryId: "GB",
      level: "country",
      sequence: 1,
      effectiveFrom: "1993-01-01",
    },
    {
      id: "US-WA",
      territoryId: "US",
      level: "state",
      sequence: 1,
      regions: ["WA"],
      effectiveFrom: "1935-05-01",
    },
    {
      id: "US-WA-KING",
      territoryId: "US",
      level: "county",
      sequence: 2,
      postalPrefixes: ["980", "981"],
      effectiveFrom: "1970-01-01",
    },
    {
      id: "US-WA-SEATTLE",
      territoryId: "US",
      level: "city",
      sequence: 3,
      postalPrefixes: ["981"],
      effectiveFrom: "1970-01-01",
    },
    {
      id: "US-WA-RTA",
      territoryId: "US",
      level: "district",
      sequence: 4,
      postalPrefixes: ["981"],
      effectiveFrom: "1997-01-01",
    },
  ],
  rates: [
    {
      jurisdictionId: "ES",
      taxCode: "*",
      rateKind: "standard",
      ratePpm: 180_000,
      treatment: "standard",
      legalBasis: "Ley 37/1992",
      effectiveFrom: "1995-01-01",
      effectiveTo: "2012-08-31",
    },
    {
      jurisdictionId: "ES",
      taxCode: "*",
      rateKind: "standard",
      ratePpm: 210_000,
      treatment: "standard",
      legalBasis: "Ley 37/1992",
      effectiveFrom: "2012-09-01",
    },
    {
      jurisdictionId: "ES-CN",
      taxCode: "*",
      rateKind: "standard",
      ratePpm: 70_000,
      treatment: "standard",
      legalBasis: "IGIC",
      effectiveFrom: "1993-01-01",
    },
    {
      jurisdictionId: "DE",
      taxCode: "*",
      rateKind: "standard",
      ratePpm: 190_000,
      treatment: "standard",
      legalBasis: "UStG 12(1)",
      effectiveFrom: "2007-01-01",
    },
    {
      jurisdictionId: "DE",
      taxCode: "txcd_untaxed",
      rateKind: "none",
      ratePpm: 0,
      treatment: "out_of_scope",
      legalBasis: "Not a taxable supply here",
      effectiveFrom: "2007-01-01",
    },
    {
      jurisdictionId: "GB",
      taxCode: "*",
      rateKind: "standard",
      ratePpm: 200_000,
      treatment: "standard",
      legalBasis: "VATA 1994 s2",
      effectiveFrom: "2011-01-04",
    },
    {
      jurisdictionId: "US-WA",
      taxCode: "*",
      rateKind: "standard",
      ratePpm: 65_000,
      treatment: "standard",
      legalBasis: "RCW 82.08.020",
      effectiveFrom: "1983-07-01",
    },
    {
      jurisdictionId: "US-WA-KING",
      taxCode: "*",
      rateKind: "standard",
      ratePpm: 12_000,
      treatment: "standard",
      legalBasis: "King County",
      effectiveFrom: "2020-01-01",
    },
    {
      jurisdictionId: "US-WA-SEATTLE",
      taxCode: "*",
      rateKind: "standard",
      ratePpm: 21_500,
      treatment: "standard",
      legalBasis: "Seattle",
      effectiveFrom: "2020-01-01",
    },
    {
      jurisdictionId: "US-WA-RTA",
      taxCode: "*",
      rateKind: "standard",
      ratePpm: 14_000,
      treatment: "standard",
      legalBasis: "RTA district",
      effectiveFrom: "1997-01-01",
    },
  ],
  schemes: [
    {
      id: "eu-vat",
      scope: "territory",
      territories: ["ES", "DE", "GB"],
      admitsReverseCharge: true,
      maxValidationAgeDays: 90,
    },
    {
      id: "eu-oss",
      scope: "union",
      unionId: "eu-vat",
      admitsReverseCharge: false,
    },
    {
      id: "us-sales-tax",
      scope: "territory",
      territories: ["US"],
      admitsReverseCharge: false,
    },
    {
      id: "es-igic",
      scope: "territory",
      territories: ["ES-CN"],
      admitsReverseCharge: false,
    },
  ],
  notations: [
    {
      treatment: "reverse_charge",
      unionId: "eu-vat",
      text: "Reverse charge: VAT to be accounted for by the recipient",
    },
    { treatment: "out_of_scope", text: "Outside the scope of VAT" },
    { treatment: "exempt", text: "Exempt supply; no input tax recovery" },
    {
      treatment: "not_registered",
      text: "No tax charged: no registration held here",
    },
  ],
  thresholds: [
    {
      jurisdictionId: "US-WA",
      currency: "USD",
      amountMinor: "10000000",
      periodMonths: 12,
      basis: "RCW 82.08.052",
    },
  ],
});

const accountId = ids.account.parse("10000000-0000-4000-8000-000000000001");

const usd = (minor: string): Money =>
  MoneySchema.parse({ currency: "USD", minor });
const eur = (minor: string): Money =>
  MoneySchema.parse({ currency: "EUR", minor });

const validEuVat = (
  jurisdiction: string,
  verifiedAt: string,
): TaxRegistration => ({
  jurisdiction,
  scheme: "eu-vat",
  number: `${jurisdiction}123456789`,
  verifiedAt,
  evidenceReference: `vies:${jurisdiction}:1`,
});

function request(
  overrides: Partial<TaxDeterminationRequest> & {
    supplier?: Partial<TaxDeterminationRequest["supplier"]>;
    customer?: Partial<TaxDeterminationRequest["customer"]>;
  } = {},
): TaxDeterminationRequest {
  const { supplier, customer, ...rest } = overrides;
  return {
    supplier: {
      legalEntityId: "entity-us",
      establishedCountry: "US",
      registrations: [],
      ...supplier,
    },
    customer: {
      accountId,
      country: "US",
      address: { country: "US", region: "WA", postalCode: "98101" },
      status: "consumer",
      registrations: [],
      exemptionCertificates: [],
      ...customer,
    },
    lines: [
      {
        lineId: "line-1",
        taxCode: "txcd_10103101",
        supplyType: "digital_service",
        netAmount: usd("100000"),
      },
    ],
    taxPointDate: "2026-03-01",
    documentType: "invoice",
    ...rest,
  };
}

const determine = (input: TaxDeterminationRequest) =>
  determineTax({ determinationId: "det-1", request: input, ruleBook });

describe("place of supply", () => {
  it("charges a domestic supply at the supplier's own rate", () => {
    const result = determine(
      request({
        supplier: {
          legalEntityId: "entity-es",
          establishedCountry: "ES",
          registrations: [validEuVat("ES", "2026-02-01")],
        },
        customer: {
          accountId,
          country: "ES",
          address: { country: "ES", postalCode: "28001" },
          status: "consumer",
          registrations: [],
          exemptionCertificates: [],
        },
        lines: [
          {
            lineId: "line-1",
            taxCode: "txcd_10103101",
            supplyType: "service",
            netAmount: eur("100000"),
          },
        ],
      }),
    );
    expect(result.placeOfSupply).toEqual(["ES"]);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatchObject({
      jurisdiction: "ES",
      treatment: "standard",
      ratePpm: 210_000,
      rateKind: "standard",
      taxMinor: "21000",
      ruleBookId: "test-book",
      ruleBookVersion: 7,
    });
    expect(result.confidence).toBe("determined");
  });

  it("reverse charges a cross-border business supply inside a union", () => {
    const result = determine(
      request({
        supplier: {
          legalEntityId: "entity-es",
          establishedCountry: "ES",
          registrations: [validEuVat("ES", "2026-02-01")],
        },
        customer: {
          accountId,
          country: "DE",
          address: { country: "DE", postalCode: "10115" },
          status: "business",
          registrations: [validEuVat("DE", "2026-02-15")],
          exemptionCertificates: [],
        },
        lines: [
          {
            lineId: "line-1",
            taxCode: "txcd_10103101",
            supplyType: "service",
            netAmount: eur("100000"),
          },
        ],
      }),
    );
    expect(result.lines[0]).toMatchObject({
      jurisdiction: "DE",
      treatment: "reverse_charge",
      taxMinor: "0",
      notation: "Reverse charge: VAT to be accounted for by the recipient",
    });
    expect(result.customerRegistration?.number).toBe("DE123456789");
    expect(result.totals.taxMinor).toBe("0");
  });

  it("supplies a consumer's digital service where the consumer is, and a general service where the supplier is", () => {
    const base = {
      supplier: {
        legalEntityId: "entity-es",
        establishedCountry: "ES",
        registrations: [
          validEuVat("ES", "2026-02-01"),
          {
            jurisdiction: "eu-vat",
            scheme: "eu-oss",
            number: "EU826010755",
            verifiedAt: "2026-01-01",
            evidenceReference: "oss:1",
          },
        ],
      },
      customer: {
        accountId,
        country: "DE",
        address: { country: "DE", postalCode: "10115" },
        status: "consumer" as const,
        registrations: [],
        exemptionCertificates: [],
      },
    };
    const digital = determine(
      request({
        ...base,
        lines: [
          {
            lineId: "line-1",
            taxCode: "txcd_10103101",
            supplyType: "digital_service",
            netAmount: eur("100000"),
          },
        ],
      }),
    );
    expect(digital.lines[0]).toMatchObject({
      jurisdiction: "DE",
      ratePpm: 190_000,
      taxMinor: "19000",
    });

    const general = determine(
      request({
        ...base,
        lines: [
          {
            lineId: "line-1",
            taxCode: "txcd_10103101",
            supplyType: "service",
            netAmount: eur("100000"),
          },
        ],
      }),
    );
    expect(general.lines[0]).toMatchObject({
      jurisdiction: "ES",
      ratePpm: 210_000,
      taxMinor: "21000",
    });
  });

  it("treats a supply leaving the union as the supplier territory's export rule states", () => {
    const result = determine(
      request({
        supplier: {
          legalEntityId: "entity-es",
          establishedCountry: "ES",
          registrations: [validEuVat("ES", "2026-02-01")],
        },
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
            lineId: "line-1",
            taxCode: "txcd_10103101",
            supplyType: "service",
            netAmount: eur("100000"),
          },
        ],
      }),
    );
    // The US has no reverse charge because no union admits one for it, and no
    // string "US" appears in the engine to say so.
    expect(result.lines[0]).toMatchObject({
      jurisdiction: "US",
      treatment: "out_of_scope",
      taxMinor: "0",
      notation: "Outside the scope of VAT",
    });
  });

  it("reads union membership at the tax point, so Brexit is two answers from one book", () => {
    const gbBusiness = (taxPointDate: string) =>
      determine(
        request({
          supplier: {
            legalEntityId: "entity-es",
            establishedCountry: "ES",
            registrations: [validEuVat("ES", "2019-11-01")],
          },
          customer: {
            accountId,
            country: "GB",
            address: { country: "GB", postalCode: "EC1A 1BB" },
            status: "business",
            registrations: [
              {
                jurisdiction: "GB",
                scheme: "eu-vat",
                number: "GB123456789",
                verifiedAt: taxPointDate,
                evidenceReference: "vies:GB:1",
              },
            ],
            exemptionCertificates: [],
          },
          lines: [
            {
              lineId: "line-1",
              taxCode: "txcd_10103101",
              supplyType: "service",
              netAmount: eur("100000"),
            },
          ],
          taxPointDate,
        }),
      );
    expect(gbBusiness("2019-12-01").lines[0]?.treatment).toBe("reverse_charge");
    expect(gbBusiness("2021-06-01").lines[0]?.treatment).toBe("out_of_scope");
  });

  it("routes a carve-out inside a member state out of the union", () => {
    const result = determine(
      request({
        supplier: {
          legalEntityId: "entity-es",
          establishedCountry: "ES",
          registrations: [validEuVat("ES", "2026-02-01")],
        },
        customer: {
          accountId,
          country: "ES",
          address: { country: "ES", region: "CN", postalCode: "35001" },
          status: "business",
          registrations: [],
          exemptionCertificates: [],
        },
        lines: [
          {
            lineId: "line-1",
            taxCode: "txcd_10103101",
            supplyType: "service",
            netAmount: eur("100000"),
          },
        ],
      }),
    );
    expect(result.placeOfSupply).toEqual(["ES-CN"]);
    expect(result.lines[0]?.treatment).toBe("out_of_scope");
  });
});

describe("registrations", () => {
  it("makes a business customer a consumer when the registration was never validated", () => {
    const result = determine(
      request({
        supplier: {
          legalEntityId: "entity-es",
          establishedCountry: "ES",
          // Registered for the one-stop shop, so the downgrade to consumer is
          // the only thing that moves the answer.
          registrations: [
            validEuVat("ES", "2026-02-01"),
            {
              jurisdiction: "eu-vat",
              scheme: "eu-oss",
              number: "EU826010755",
              verifiedAt: "2026-01-01",
              evidenceReference: "oss:1",
            },
          ],
        },
        customer: {
          accountId,
          country: "DE",
          address: { country: "DE", postalCode: "10115" },
          status: "business",
          registrations: [
            { jurisdiction: "DE", scheme: "eu-vat", number: "DE123456789" },
          ],
          exemptionCertificates: [],
        },
        lines: [
          {
            lineId: "line-1",
            taxCode: "txcd_10103101",
            supplyType: "digital_service",
            netAmount: eur("100000"),
          },
        ],
      }),
    );
    expect(result.lines[0]?.treatment).toBe("standard");
    expect(result.lines[0]?.taxMinor).toBe("19000");
    expect(result.confidence).toBe("review_required");
    expect(result.reviewReasons).toContain(
      "customer_registration_never_validated_treated_as_consumer",
    );
    expect(result.customerRegistration).toBeUndefined();
  });

  it("counts a consumer supply into a jurisdiction the supplier has not registered in", () => {
    // The same downgraded supply without a one-stop-shop registration. Nothing
    // is charged, and the row is the evidence that a threshold may have been
    // crossed — the number that has to be countable.
    const result = determine(
      request({
        supplier: {
          legalEntityId: "entity-es",
          establishedCountry: "ES",
          registrations: [validEuVat("ES", "2026-02-01")],
        },
        customer: {
          accountId,
          country: "DE",
          address: { country: "DE", postalCode: "10115" },
          status: "consumer",
          registrations: [],
          exemptionCertificates: [],
        },
        lines: [
          {
            lineId: "line-1",
            taxCode: "txcd_10103101",
            supplyType: "digital_service",
            netAmount: eur("100000"),
          },
        ],
      }),
    );
    expect(result.lines[0]).toMatchObject({
      jurisdiction: "DE",
      treatment: "not_registered",
      taxMinor: "0",
    });
    expect(result.totals.byTreatment).toEqual([
      { treatment: "not_registered", netMinor: "100000", taxMinor: "0" },
    ]);
  });

  it("makes a business customer a consumer when the validation has gone stale", () => {
    const result = determine(
      request({
        supplier: {
          legalEntityId: "entity-es",
          establishedCountry: "ES",
          registrations: [validEuVat("ES", "2026-02-01")],
        },
        customer: {
          accountId,
          country: "DE",
          address: { country: "DE", postalCode: "10115" },
          status: "business",
          // Validated well over the scheme's 90-day window before the supply.
          registrations: [validEuVat("DE", "2025-01-01")],
          exemptionCertificates: [],
        },
        lines: [
          {
            lineId: "line-1",
            taxCode: "txcd_10103101",
            supplyType: "service",
            netAmount: eur("100000"),
          },
        ],
      }),
    );
    expect(result.lines[0]?.treatment).toBe("standard");
    expect(result.reviewReasons).toContain(
      "customer_registration_validation_stale_treated_as_consumer",
    );
  });

  it("makes an expired registration a consumer even when it was validated yesterday", () => {
    const result = determine(
      request({
        supplier: {
          legalEntityId: "entity-es",
          establishedCountry: "ES",
          registrations: [validEuVat("ES", "2026-02-01")],
        },
        customer: {
          accountId,
          country: "DE",
          address: { country: "DE", postalCode: "10115" },
          status: "business",
          registrations: [
            { ...validEuVat("DE", "2026-02-28"), expiresAt: "2026-02-28" },
          ],
          exemptionCertificates: [],
        },
        lines: [
          {
            lineId: "line-1",
            taxCode: "txcd_10103101",
            supplyType: "service",
            netAmount: eur("100000"),
          },
        ],
      }),
    );
    expect(result.lines[0]?.treatment).toBe("standard");
    expect(result.reviewReasons).toContain(
      "customer_registration_expired_treated_as_consumer",
    );
  });

  it("refuses to reverse charge on a scheme that does not admit one", () => {
    const result = determine(
      request({
        supplier: {
          legalEntityId: "entity-es",
          establishedCountry: "ES",
          registrations: [validEuVat("ES", "2026-02-01")],
        },
        customer: {
          accountId,
          country: "DE",
          address: { country: "DE", postalCode: "10115" },
          status: "business",
          registrations: [
            {
              jurisdiction: "eu-vat",
              scheme: "eu-oss",
              number: "EU826010755",
              verifiedAt: "2026-02-20",
              evidenceReference: "oss:1",
            },
          ],
          exemptionCertificates: [],
        },
        lines: [
          {
            lineId: "line-1",
            taxCode: "txcd_10103101",
            supplyType: "service",
            netAmount: eur("100000"),
          },
        ],
      }),
    );
    expect(result.reviewReasons).toContain(
      "customer_registration_scheme_not_reverse_chargeable_treated_as_consumer",
    );
    expect(result.lines[0]?.treatment).toBe("standard");
  });

  it("flags a validated registration that has no retained evidence", () => {
    const result = determine(
      request({
        supplier: {
          legalEntityId: "entity-es",
          establishedCountry: "ES",
          registrations: [validEuVat("ES", "2026-02-01")],
        },
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
            },
          ],
          exemptionCertificates: [],
        },
        lines: [
          {
            lineId: "line-1",
            taxCode: "txcd_10103101",
            supplyType: "service",
            netAmount: eur("100000"),
          },
        ],
      }),
    );
    expect(result.lines[0]?.treatment).toBe("reverse_charge");
    expect(result.reviewReasons).toContain(
      "customer_registration_evidence_missing",
    );
  });
});

describe("US sales tax", () => {
  it("stacks every taxing authority the address reaches", () => {
    const result = determine(
      request({
        supplier: {
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
        },
      }),
    );
    expect(result.lines.map((line) => line.jurisdiction)).toEqual([
      "US-WA",
      "US-WA-KING",
      "US-WA-SEATTLE",
      "US-WA-RTA",
    ]);
    expect(result.lines.map((line) => line.taxMinor)).toEqual([
      "6500",
      "1200",
      "2150",
      "1400",
    ]);
    expect(result.totals.taxMinor).toBe("11250");
    expect(result.totals.netMinor).toBe("100000");
    expect(result.totals.grossMinor).toBe("111250");
  });

  it("charges nothing where the seller is not registered, and says so countably", () => {
    const result = determine(request());
    // One row per taxing jurisdiction that would have charged, because a
    // threshold is keyed by jurisdiction: a single row labelled US cannot tell
    // a Washington nexus breach from a California one.
    expect(result.lines.map((line) => line.jurisdiction)).toEqual([
      "US-WA",
      "US-WA-KING",
      "US-WA-SEATTLE",
      "US-WA-RTA",
    ]);
    for (const line of result.lines)
      expect(line).toMatchObject({
        treatment: "not_registered",
        ratePpm: 0,
        taxMinor: "0",
      });
    expect(result.totals.byTreatment).toEqual([
      { treatment: "not_registered", netMinor: "100000", taxMinor: "0" },
    ]);
  });

  it("puts each jurisdiction's own threshold and statute on its own row", () => {
    const result = determine(request());
    // The Washington statute belongs on the Washington row and nowhere else.
    expect(result.lines[0]).toMatchObject({
      jurisdiction: "US-WA",
      legalBasis: "RCW 82.08.052",
      notation:
        "No tax charged: no registration held here (threshold 10000000 USD per 12 months)",
    });
    for (const line of result.lines.slice(1)) {
      expect(line.legalBasis).toBe("supplier holds no registration here");
      expect(line.notation).toBe("No tax charged: no registration held here");
    }
    // The threshold watch groups by jurisdiction, so the breach is attributable.
    const byJurisdiction = new Map(
      result.lines
        .filter((line) => line.treatment === "not_registered")
        .map((line) => [line.jurisdiction, BigInt(line.taxableMinor)]),
    );
    expect(byJurisdiction.get("US-WA")).toBe(100_000n);
  });

  it("states the threshold once when the book carries no not_registered wording", () => {
    const silent = parseTaxRuleBook({
      ...ruleBook,
      notations: ruleBook.notations.filter(
        (notation) => notation.treatment !== "not_registered",
      ),
    });
    const result = determineTax({
      determinationId: "det-1",
      request: request(),
      ruleBook: silent,
    });
    expect(result.lines[0]?.notation).toBe(
      "No registration held; threshold 10000000 USD per 12 months",
    );
    expect(result.lines[1]?.notation).toBe("");
  });
});

describe("totals split by treatment", () => {
  const registeredUsSupplier = {
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

  /** A book whose Seattle city row does not tax this supply, so one line's
   * jurisdictions disagree with each other. */
  const splitStack: TaxRuleBook = parseTaxRuleBook({
    ...ruleBook,
    rates: ruleBook.rates.map((rate) =>
      rate.jurisdictionId === "US-WA-SEATTLE"
        ? {
            ...rate,
            rateKind: "none",
            ratePpm: 0,
            treatment: "out_of_scope",
            legalBasis: "Seattle does not tax this supply",
          }
        : rate,
    ),
  });

  const splitDetermine = (nets: readonly string[]) =>
    determineTax({
      determinationId: "det-1",
      ruleBook: splitStack,
      request: request({
        supplier: registeredUsSupplier,
        lines: nets.map((net, index) => ({
          lineId: `line-${index + 1}`,
          taxCode: "txcd_10103101",
          supplyType: "digital_service" as const,
          netAmount: usd(net),
        })),
      }),
    });

  it("apportions a split stack's net instead of counting it under both treatments", () => {
    const result = splitDetermine(["100000"]);
    expect(
      result.lines.map((line) => [line.jurisdiction, line.taxMinor]),
    ).toEqual([
      ["US-WA", "6500"],
      ["US-WA-KING", "1200"],
      ["US-WA-SEATTLE", "0"],
      ["US-WA-RTA", "1400"],
    ]);
    expect(result.totals.netMinor).toBe("100000");
    expect(result.totals.taxMinor).toBe("9100");
    // Three of the four authorities charged, one did not: 75000 of the line's
    // net is standard and 25000 is out of scope. The buckets sum to 100000,
    // not to the 200000 counting the whole line under each treatment gave.
    expect(result.totals.byTreatment).toEqual([
      { treatment: "standard", netMinor: "75000", taxMinor: "9100" },
      { treatment: "out_of_scope", netMinor: "25000", taxMinor: "0" },
    ]);
  });

  /**
   * A supplier registered on both sides of the Atlantic. A digital service to a
   * Washington consumer is charged by four US authorities; a general service to
   * the same consumer leaves the Spanish regime under Spain's export rule as a
   * single row. So one document's lines produce DIFFERENT numbers of rows,
   * which is the case the apportionment's cursor — it walks `lines` in order,
   * assuming `applyRounding` emitted exactly one result line per resolved row —
   * would desynchronise on if the two ever disagreed.
   */
  const twoSidedSupplier = {
    legalEntityId: "entity-es",
    establishedCountry: "ES",
    registrations: [
      validEuVat("ES", "2026-02-01"),
      {
        jurisdiction: "US",
        scheme: "us-sales-tax",
        number: "WA-601-123-456",
        verifiedAt: "2026-01-01",
        evidenceReference: "dor:1",
      },
    ],
  };

  type MixedLine = { net: number; supplyType: "digital_service" | "service" };

  const mixedDetermine = (lines: readonly MixedLine[]) =>
    determine(
      request({
        supplier: twoSidedSupplier,
        customer: {
          accountId,
          country: "US",
          address: { country: "US", region: "WA", postalCode: "98101" },
          status: "consumer",
          registrations: [],
          exemptionCertificates: [],
        },
        lines: lines.map((entry, index) => ({
          lineId: `line-${index + 1}`,
          taxCode: "txcd_10103101",
          supplyType: entry.supplyType,
          netAmount: usd(String(entry.net)),
        })),
      }),
    );

  it("splits a document whose lines land in different numbers of jurisdictions", () => {
    const result = mixedDetermine([
      { net: 100_000, supplyType: "digital_service" },
      { net: 100_000, supplyType: "service" },
    ]);
    expect(
      result.lines.map((line) => [
        line.lineId,
        line.jurisdiction,
        line.treatment,
        line.taxMinor,
      ]),
    ).toEqual([
      ["line-1", "US-WA", "standard", "6500"],
      ["line-1", "US-WA-KING", "standard", "1200"],
      ["line-1", "US-WA-SEATTLE", "standard", "2150"],
      ["line-1", "US-WA-RTA", "standard", "1400"],
      ["line-2", "US", "out_of_scope", "0"],
    ]);
    // Line 1 is taxed in four places and line 2 in none, so the whole of line
    // 1's net is standard and the whole of line 2's is out of scope: the four
    // quarters of 100000 recombine exactly, and the buckets still sum to the
    // document's 200000.
    expect(result.totals).toMatchObject({
      netMinor: "200000",
      taxMinor: "11250",
      grossMinor: "211250",
      byTreatment: [
        { treatment: "standard", netMinor: "100000", taxMinor: "11250" },
        { treatment: "out_of_scope", netMinor: "100000", taxMinor: "0" },
      ],
    });
  });

  it("reconciles the treatment buckets with the document totals", () => {
    /** Row counts seen per line, to prove the mixed shape was really generated. */
    const rowCounts = new Set<number>();
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            net: fc.integer({ min: -5_000_000, max: 5_000_000 }),
            supplyType: fc.constantFrom(
              "digital_service" as const,
              "service" as const,
            ),
          }),
          { minLength: 1, maxLength: 6 },
        ),
        (entries) => {
          const nets = entries.map((entry) => entry.net);
          const mixed = mixedDetermine(entries);
          // A line's rows are contiguous and its count depends on where the
          // supply landed, so a document here really does hold lines of
          // differing row counts rather than being uniform by construction.
          for (const entry of entries.map((value, index) => ({
            ...value,
            lineId: `line-${index + 1}`,
          }))) {
            const rows = mixed.lines.filter(
              (line) => line.lineId === entry.lineId,
            );
            expect(rows).toHaveLength(
              entry.supplyType === "digital_service" ? 4 : 1,
            );
            rowCounts.add(rows.length);
          }
          for (const result of [
            splitDetermine(nets.map(String)),
            determine(
              request({
                supplier: registeredUsSupplier,
                lines: nets.map((net, index) => ({
                  lineId: `line-${index + 1}`,
                  taxCode: "txcd_10103101",
                  supplyType: "digital_service" as const,
                  netAmount: usd(String(net)),
                })),
              }),
            ),
            // The unregistered supplier: every row is not_registered, so the
            // bucket must hold the whole document net and stay countable.
            determine(
              request({
                lines: nets.map((net, index) => ({
                  lineId: `line-${index + 1}`,
                  taxCode: "txcd_10103101",
                  supplyType: "digital_service" as const,
                  netAmount: usd(String(net)),
                })),
              }),
            ),
            mixed,
          ]) {
            const buckets = result.totals.byTreatment;
            expect(
              buckets.reduce((sum, entry) => sum + BigInt(entry.netMinor), 0n),
            ).toBe(BigInt(result.totals.netMinor));
            expect(
              buckets.reduce((sum, entry) => sum + BigInt(entry.taxMinor), 0n),
            ).toBe(BigInt(result.totals.taxMinor));
            expect(new Set(buckets.map((entry) => entry.treatment)).size).toBe(
              buckets.length,
            );
            expect(
              result.lines.reduce(
                (sum, line) => sum + BigInt(line.taxMinor),
                0n,
              ),
            ).toBe(BigInt(result.totals.taxMinor));
          }
        },
      ),
      {
        // Seeded so the mixed-row-count document is generated on every run and
        // not left to the shrinker's luck.
        examples: [
          [
            [
              { net: 100_000, supplyType: "digital_service" as const },
              { net: 33_333, supplyType: "service" as const },
              { net: -7, supplyType: "digital_service" as const },
            ],
          ],
        ],
      },
    );
    expect([...rowCounts].sort((left, right) => left - right)).toEqual([1, 4]);
  });
});

describe("rates, codes and taxability", () => {
  it("reads the rate effective at the tax point, not the newest one", () => {
    const spanishDomestic = (taxPointDate: string) =>
      determine(
        request({
          supplier: {
            legalEntityId: "entity-es",
            establishedCountry: "ES",
            registrations: [validEuVat("ES", taxPointDate)],
          },
          customer: {
            accountId,
            country: "ES",
            address: { country: "ES", postalCode: "28001" },
            status: "consumer",
            registrations: [],
            exemptionCertificates: [],
          },
          lines: [
            {
              lineId: "line-1",
              taxCode: "txcd_10103101",
              supplyType: "service",
              netAmount: eur("100000"),
            },
          ],
          taxPointDate,
        }),
      );
    expect(spanishDomestic("2012-06-01").lines[0]?.ratePpm).toBe(180_000);
    expect(spanishDomestic("2013-01-01").lines[0]?.ratePpm).toBe(210_000);
  });

  it("honours a code the jurisdiction does not tax at all", () => {
    const result = determine(
      request({
        supplier: {
          legalEntityId: "entity-de",
          establishedCountry: "DE",
          registrations: [validEuVat("DE", "2026-02-01")],
        },
        customer: {
          accountId,
          country: "DE",
          address: { country: "DE", postalCode: "10115" },
          status: "consumer",
          registrations: [],
          exemptionCertificates: [],
        },
        lines: [
          {
            lineId: "line-1",
            taxCode: "txcd_untaxed",
            supplyType: "service",
            netAmount: eur("100000"),
          },
        ],
      }),
    );
    expect(result.lines[0]).toMatchObject({
      treatment: "out_of_scope",
      ratePpm: 0,
      taxMinor: "0",
    });
  });

  it("exempts a customer holding a live certificate and charges one whose certificate has lapsed", () => {
    const withCertificate = (validUntil: string) =>
      determine(
        request({
          supplier: {
            legalEntityId: "entity-de",
            establishedCountry: "DE",
            registrations: [validEuVat("DE", "2026-02-01")],
          },
          customer: {
            accountId,
            country: "DE",
            address: { country: "DE", postalCode: "10115" },
            status: "consumer",
            registrations: [],
            exemptionCertificates: [
              {
                jurisdiction: "DE",
                certificateId: "cert-1",
                validFrom: "2025-01-01",
                validUntil,
                reason: "charitable body",
              },
            ],
          },
          lines: [
            {
              lineId: "line-1",
              taxCode: "txcd_10103101",
              supplyType: "service",
              netAmount: eur("100000"),
            },
          ],
        }),
      );
    const live = withCertificate("2026-12-31");
    expect(live.lines[0]).toMatchObject({
      treatment: "exempt",
      taxMinor: "0",
      legalBasis: "charitable body",
    });

    const lapsed = withCertificate("2026-01-31");
    expect(lapsed.lines[0]?.treatment).toBe("standard");
    expect(lapsed.lines[0]?.taxMinor).toBe("19000");
    expect(lapsed.reviewReasons).toContain(
      "customer_exemption_certificate_expired",
    );
  });
});

describe("exemption certificates", () => {
  const registeredUsSupplier = {
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

  const certificate = (jurisdiction: string, validUntil = "2027-01-01") => ({
    jurisdiction,
    certificateId: `cert-${jurisdiction}`,
    validFrom: "2025-01-01",
    validUntil,
    reason: `resale certificate ${jurisdiction}`,
  });

  const holding = (
    certificates: TaxDeterminationRequest["customer"]["exemptionCertificates"],
    book: TaxRuleBook = ruleBook,
  ) =>
    determineTax({
      determinationId: "det-1",
      ruleBook: book,
      request: request({
        supplier: registeredUsSupplier,
        customer: {
          accountId,
          country: "US",
          address: { country: "US", region: "WA", postalCode: "98101" },
          status: "consumer",
          registrations: [],
          exemptionCertificates: certificates,
        },
      }),
    });

  const jurisdictionIds = new Set(
    ruleBook.jurisdictions.map((rule) => rule.id),
  );

  it("finds a certificate issued for a taxing jurisdiction, which is the form a real certificate takes", () => {
    // "US-WA" is a real taxing authority and a real certificate names it.
    // Matching the territory id alone could never find it, so a customer
    // holding a live Washington exemption was charged in full: 11250 against a
    // 100000 supply, in the customer's disfavour, on a document that looked
    // ordinary.
    const result = holding([certificate("US-WA")]);
    expect(
      result.lines.map((line) => [line.jurisdiction, line.treatment]),
    ).toEqual([
      ["US-WA", "exempt"],
      ["US-WA-KING", "standard"],
      ["US-WA-SEATTLE", "standard"],
      ["US-WA-RTA", "standard"],
    ]);
    // Washington's 6500 is gone; the county, city and district still charge,
    // because a certificate issued by the state exempts the state.
    expect(result.lines.map((line) => line.taxMinor)).toEqual([
      "0",
      "1200",
      "2150",
      "1400",
    ]);
    expect(result.totals.taxMinor).toBe("4750");
    expect(result.totals.grossMinor).toBe("104750");
    expect(result.lines[0]?.legalBasis).toBe("resale certificate US-WA");
    // One of four authorities exempted, so a quarter of the line's net sits
    // under `exempt` and the rest under `standard`, and the two sum to the
    // document.
    expect(result.totals.byTreatment).toEqual([
      { treatment: "exempt", netMinor: "25000", taxMinor: "0" },
      { treatment: "standard", netMinor: "75000", taxMinor: "4750" },
    ]);
  });

  it("reads a territory-level certificate as covering every authority the address reaches", () => {
    const result = holding([certificate("US")]);
    // Four rows, one per authority, not a single row labelled with the
    // territory. "US" is not a member of the book's jurisdictions at all, so a
    // row naming it was a row no threshold or exemption watch could group.
    expect(result.lines.map((line) => line.jurisdiction)).toEqual([
      "US-WA",
      "US-WA-KING",
      "US-WA-SEATTLE",
      "US-WA-RTA",
    ]);
    for (const line of result.lines) {
      expect(line.treatment).toBe("exempt");
      expect(line.taxMinor).toBe("0");
      expect(jurisdictionIds.has(line.jurisdiction)).toBe(true);
    }
    expect(jurisdictionIds.has("US")).toBe(false);
    expect(result.totals.taxMinor).toBe("0");
    expect(result.totals.grossMinor).toBe("100000");
    expect(result.totals.byTreatment).toEqual([
      { treatment: "exempt", netMinor: "100000", taxMinor: "0" },
    ]);
  });

  it("charges every authority when the certificate has lapsed, and raises the reason once", () => {
    const result = holding([certificate("US-WA", "2026-01-31")]);
    for (const line of result.lines) expect(line.treatment).toBe("standard");
    expect(result.totals.taxMinor).toBe("11250");
    expect(
      result.reviewReasons.filter(
        (reason) => reason === "customer_exemption_certificate_expired",
      ),
    ).toEqual(["customer_exemption_certificate_expired"]);
  });

  it("ignores a certificate issued by an authority the address does not reach", () => {
    // A Spanish certificate does not exempt a Washington supply, and neither
    // does a certificate for a Washington authority the address misses.
    const result = holding([certificate("ES")]);
    expect(result.totals.taxMinor).toBe("11250");
    expect(result.reviewReasons).not.toContain(
      "customer_exemption_certificate_expired",
    );
  });

  it("prefers a live certificate over a lapsed one covering the same authority", () => {
    const result = holding([
      certificate("US-WA", "2026-01-31"),
      certificate("US"),
    ]);
    for (const line of result.lines) expect(line.treatment).toBe("exempt");
    expect(result.reviewReasons).not.toContain(
      "customer_exemption_certificate_expired",
    );
  });

  it("still answers where the book names no authority, and refuses where nothing is exempt either", () => {
    // The same deliberate fallback the `not_registered` branch makes: the
    // territory id is the only id the book has given us.
    const unmapped: TaxRuleBook = parseTaxRuleBook({
      ...ruleBook,
      jurisdictions: ruleBook.jurisdictions.filter(
        (jurisdiction) => jurisdiction.territoryId !== "US",
      ),
    });
    const exempt = holding([certificate("US")], unmapped);
    expect(exempt.lines).toHaveLength(1);
    expect(exempt.lines[0]).toMatchObject({
      jurisdiction: "US",
      treatment: "exempt",
      taxMinor: "0",
    });
    expect(() => holding([], unmapped)).toThrow(
      /TAX_JURISDICTION_UNKNOWN|no taxing jurisdiction/,
    );
  });
});

describe("refusals", () => {
  it("refuses rather than defaulting to zero when no rate has been stated", () => {
    expect(() =>
      determine(
        request({
          supplier: {
            legalEntityId: "entity-de",
            establishedCountry: "DE",
            registrations: [validEuVat("DE", "2026-02-01")],
          },
          customer: {
            accountId,
            country: "DE",
            address: { country: "DE", postalCode: "10115" },
            status: "consumer",
            registrations: [],
            exemptionCertificates: [],
          },
          lines: [
            {
              lineId: "line-1",
              taxCode: "txcd_10103101",
              supplyType: "goods",
              netAmount: eur("100000"),
            },
          ],
          taxPointDate: "2001-01-01",
        }),
      ),
    ).toThrow(TaxDeterminationError);
  });

  it("refuses a territory the rule book has never heard of", () => {
    expect(() =>
      determine(
        request({
          customer: {
            accountId,
            country: "JP",
            address: { country: "JP" },
            status: "consumer",
            registrations: [],
            exemptionCertificates: [],
          },
        }),
      ),
    ).toThrow(/TAX_TERRITORY_UNKNOWN|no territory/i);
  });

  it("refuses a credit determined under a book its charge was not pinned to", () => {
    expect(() =>
      determine(
        request({
          documentType: "credit_note",
          reversalOf: {
            invoiceId: ids.invoice.parse(
              "90000000-0000-4000-8000-000000000001",
            ),
            pinnedRuleBookIds: ["book-of-2019"],
          },
        }),
      ),
    ).toThrow(/TAX_RULE_BOOK_PIN_MISMATCH|pins/);
  });

  it("refuses a document spanning currencies and one with no lines", () => {
    expect(() =>
      determine(
        request({
          lines: [
            {
              lineId: "line-1",
              taxCode: "txcd_10103101",
              supplyType: "service",
              netAmount: usd("1000"),
            },
            {
              lineId: "line-2",
              taxCode: "txcd_10103101",
              supplyType: "service",
              netAmount: eur("1000"),
            },
          ],
        }),
      ),
    ).toThrow(/currencies/);
    expect(() => determine(request({ lines: [] }))).toThrow(
      /at least one line/,
    );
  });

  it("flags an address that contradicts the country on the account", () => {
    const result = determine(
      request({
        customer: {
          accountId,
          country: "DE",
          address: { country: "US", region: "WA", postalCode: "98101" },
          status: "consumer",
          registrations: [],
          exemptionCertificates: [],
        },
      }),
    );
    expect(result.reviewReasons).toContain(
      "customer_country_conflicts_with_address",
    );
  });
});

describe("rounding", () => {
  const registeredUsSupplier = {
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

  it("rounds half away from zero in both directions", () => {
    // 5 minor units at 10% is exactly a half unit: away from zero, not toward.
    expect(taxOnNet(5n, 100_000)).toBe(1n);
    expect(taxOnNet(-5n, 100_000)).toBe(-1n);
  });

  it("pins the convention at the half-unit boundary, in both signs", () => {
    // Half away from zero and truncation agree everywhere EXCEPT on an exact
    // half, and both are sign-symmetric, so only cases that land on the half
    // discriminate between them. For an even divisor m of a million, a rate of
    // 1000000/m ppm on a net of m*k + m/2 is exactly k + 1/2 units of tax.
    const halves = fc
      .tuple(
        fc.constantFrom(
          2,
          4,
          8,
          10,
          16,
          20,
          32,
          40,
          50,
          64,
          100,
          200,
          250,
          500,
          1_000,
          2_000,
          10_000,
          100_000,
          1_000_000,
        ),
        fc.integer({ min: 0, max: 100_000 }),
      )
      .map(([m, whole]) => ({
        ratePpm: 1_000_000 / m,
        // Exactly `whole` and a half minor units of tax.
        netMinor: BigInt(m) * BigInt(whole) + BigInt(m / 2),
        whole: BigInt(whole),
      }));

    fc.assert(
      fc.property(halves, ({ ratePpm, netMinor, whole }) => {
        const magnitude = (value: bigint) => (value < 0n ? -value : value);
        // Both signs are checked on every run, so neither direction can hide
        // behind the other when a counterexample shrinks.
        for (const sign of [1n, -1n]) {
          const net = sign * netMinor;
          const actual = taxOnNet(net, ratePpm);
          // whole + 1/2 taken AWAY from zero is whole + 1, with the net's sign.
          // Truncation would answer `whole` here, in either sign.
          expect(actual).toBe(sign * (whole + 1n));
          // The same claim stated as a direction rather than a value: the
          // answer is one whole minor unit further from zero than truncating
          // the identical product would leave it.
          const truncated = (net * BigInt(ratePpm)) / 1_000_000n;
          expect(magnitude(actual)).toBe(magnitude(truncated) + 1n);
          expect(magnitude(actual)).toBeGreaterThan(magnitude(truncated));
          expect(actual > 0n).toBe(net > 0n);
        }
      }),
    );
  });

  it("keeps a per-invoice group's lines summing to the group's own rounded total", () => {
    const nets = ["3333", "3333", "3334"];
    const result = determine(
      request({
        supplier: registeredUsSupplier,
        lines: nets.map((net, index) => ({
          lineId: `line-${index + 1}`,
          taxCode: "txcd_10103101",
          supplyType: "digital_service" as const,
          netAmount: usd(net),
        })),
      }),
    );
    const stateRows = result.lines.filter(
      (line) => line.jurisdiction === "US-WA",
    );
    expect(stateRows).toHaveLength(3);
    const summed = stateRows.reduce(
      (total, line) => total + BigInt(line.taxMinor),
      0n,
    );
    expect(summed).toBe(taxOnNet(10_000n, 65_000));
    expect(result.rounding).toBe("invoice");
  });

  it("rounds each line on its own where the territory says line", () => {
    const result = determine(
      request({
        supplier: {
          legalEntityId: "entity-es",
          establishedCountry: "ES",
          registrations: [validEuVat("ES", "2026-02-01")],
        },
        customer: {
          accountId,
          country: "ES",
          address: { country: "ES", postalCode: "28001" },
          status: "consumer",
          registrations: [],
          exemptionCertificates: [],
        },
        lines: [
          {
            lineId: "line-1",
            taxCode: "txcd_10103101",
            supplyType: "service",
            netAmount: eur("105"),
          },
          {
            lineId: "line-2",
            taxCode: "txcd_10103101",
            supplyType: "service",
            netAmount: eur("105"),
          },
        ],
      }),
    );
    expect(result.rounding).toBe("line");
    // 105 * 21% = 22.05 -> 22 per line, so 44, not the 44 an invoice-level
    // rounding of 210 * 21% = 44.1 would also give: the point is that each line
    // is rounded on its own and the two are stated separately.
    expect(result.lines.map((line) => line.taxMinor)).toEqual(["22", "22"]);
    expect(result.totals.taxMinor).toBe("44");
  });
});

describe("engine properties", () => {
  const registeredUsSupplier = {
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
  const netArbitrary = fc.array(
    fc.integer({ min: -5_000_000, max: 5_000_000 }),
    { minLength: 1, maxLength: 8 },
  );

  it("never loses or invents a minor unit across lines", () => {
    fc.assert(
      fc.property(netArbitrary, (nets) => {
        const result = determine(
          request({
            supplier: registeredUsSupplier,
            lines: nets.map((net, index) => ({
              lineId: `line-${index + 1}`,
              taxCode: "txcd_10103101",
              supplyType: "digital_service" as const,
              netAmount: usd(String(net)),
            })),
          }),
        );
        const summed = result.lines.reduce(
          (total, line) => total + BigInt(line.taxMinor),
          0n,
        );
        expect(BigInt(result.totals.taxMinor)).toBe(summed);
        expect(BigInt(result.totals.grossMinor)).toBe(
          BigInt(result.totals.netMinor) + summed,
        );
        // Per-invoice rounding: each jurisdiction's rows sum to that
        // jurisdiction's own rounded total on the whole document.
        const total = nets.reduce((sum, net) => sum + BigInt(net), 0n);
        for (const jurisdiction of new Set(
          result.lines.map((line) => line.jurisdiction),
        )) {
          const rows = result.lines.filter(
            (line) => line.jurisdiction === jurisdiction,
          );
          const ratePpm = rows[0]?.ratePpm ?? 0;
          expect(
            rows.reduce((sum, line) => sum + BigInt(line.taxMinor), 0n),
          ).toBe(taxOnNet(total, ratePpm));
        }
      }),
    );
  });

  it("makes a credit the exact negative of the charge it reverses", () => {
    fc.assert(
      fc.property(netArbitrary, (nets) => {
        const lines = (sign: bigint) =>
          nets.map((net, index) => ({
            lineId: `line-${index + 1}`,
            taxCode: "txcd_10103101",
            supplyType: "digital_service" as const,
            netAmount: usd(String(sign * BigInt(net))),
          }));
        const charge = determine(
          request({ supplier: registeredUsSupplier, lines: lines(1n) }),
        );
        const credit = determine(
          request({
            supplier: registeredUsSupplier,
            lines: lines(-1n),
            documentType: "credit_note",
          }),
        );
        expect(credit.lines).toHaveLength(charge.lines.length);
        credit.lines.forEach((line, index) => {
          expect(BigInt(line.taxMinor)).toBe(
            -BigInt(charge.lines[index]?.taxMinor ?? "0"),
          );
          expect(line.jurisdiction).toBe(charge.lines[index]?.jurisdiction);
          expect(line.treatment).toBe(charge.lines[index]?.treatment);
        });
        expect(BigInt(credit.totals.taxMinor)).toBe(
          -BigInt(charge.totals.taxMinor),
        );
      }),
    );
  });

  it("always yields zero tax and a notation on a reverse charge", () => {
    fc.assert(
      fc.property(netArbitrary, (nets) => {
        const result = determine(
          request({
            supplier: {
              legalEntityId: "entity-es",
              establishedCountry: "ES",
              registrations: [validEuVat("ES", "2026-02-01")],
            },
            customer: {
              accountId,
              country: "DE",
              address: { country: "DE", postalCode: "10115" },
              status: "business",
              registrations: [validEuVat("DE", "2026-02-15")],
              exemptionCertificates: [],
            },
            lines: nets.map((net, index) => ({
              lineId: `line-${index + 1}`,
              taxCode: "txcd_10103101",
              supplyType: "service" as const,
              netAmount: eur(String(net)),
            })),
          }),
        );
        expect(result.totals.taxMinor).toBe("0");
        for (const line of result.lines) {
          expect(line.treatment).toBe("reverse_charge");
          expect(line.taxMinor).toBe("0");
          expect(line.notation.length).toBeGreaterThan(0);
        }
      }),
    );
  });

  it("downgrades a business to a consumer whenever the registration is not live at the tax point", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 3_650 }),
        fc.integer({ min: 1_000, max: 1_000_000 }),
        (staleDays, net) => {
          const verifiedAt = new Date(
            Date.parse("2026-03-01T00:00:00.000Z") - staleDays * 86_400_000,
          )
            .toISOString()
            .slice(0, 10);
          const result = determine(
            request({
              supplier: {
                legalEntityId: "entity-es",
                establishedCountry: "ES",
                registrations: [validEuVat("ES", "2026-02-01")],
              },
              customer: {
                accountId,
                country: "DE",
                address: { country: "DE", postalCode: "10115" },
                status: "business",
                registrations: [validEuVat("DE", verifiedAt)],
                exemptionCertificates: [],
              },
              lines: [
                {
                  lineId: "line-1",
                  taxCode: "txcd_10103101",
                  supplyType: "service",
                  netAmount: eur(String(net)),
                },
              ],
            }),
          );
          const stale = staleDays > 90;
          expect(result.lines[0]?.treatment).toBe(
            stale ? "standard" : "reverse_charge",
          );
          expect(BigInt(result.totals.taxMinor) === 0n).toBe(!stale);
          if (stale)
            expect(result.reviewReasons).toContain(
              "customer_registration_validation_stale_treated_as_consumer",
            );
        },
      ),
    );
  });
});

describe("a book composed from per-jurisdiction books", () => {
  /**
   * The shape a persisted rule book actually has: rates keyed by kind, each row
   * pinned to the book it was published in, and what a kind means stated once
   * for the whole book.
   */
  const composed = (overrides: Record<string, unknown> = {}): TaxRuleBook =>
    parseTaxRuleBook({
      ...ruleBook,
      id: "composed",
      version: 1,
      rateKindTreatments: { standard: "standard", untaxed: "out_of_scope" },
      rates: [
        {
          jurisdictionId: "DE",
          taxCode: "*",
          rateKind: "standard",
          ratePpm: 190_000,
          legalBasis: "UStG 12(1)",
          notation: "USt 19%",
          ruleBookId: "de-book",
          ruleBookVersion: 4,
          effectiveFrom: "2007-01-01",
        },
      ],
      ...overrides,
    });

  const germanDomestic = (book: TaxRuleBook, taxCode = "txcd_10103101") =>
    determineTax({
      determinationId: "det-1",
      ruleBook: book,
      request: request({
        supplier: {
          legalEntityId: "entity-de",
          establishedCountry: "DE",
          registrations: [validEuVat("DE", "2026-02-01")],
        },
        customer: {
          accountId,
          country: "DE",
          address: { country: "DE", postalCode: "10115" },
          status: "consumer",
          registrations: [],
          exemptionCertificates: [],
        },
        lines: [
          {
            lineId: "line-1",
            taxCode,
            supplyType: "service",
            netAmount: eur("100000"),
          },
        ],
      }),
    });

  it("pins each answer to the book that published its rate, not to the composition", () => {
    const result = germanDomestic(composed());
    expect(result.lines[0]).toMatchObject({
      ruleBookId: "de-book",
      ruleBookVersion: 4,
      treatment: "standard",
      taxMinor: "19000",
      notation: "USt 19%",
    });
  });

  it("reads what a rate kind means from the book rather than inferring it", () => {
    const result = germanDomestic(
      composed({
        rates: [
          {
            jurisdictionId: "DE",
            taxCode: "*",
            rateKind: "untaxed",
            ratePpm: 0,
            legalBasis: "Not taxed here",
            effectiveFrom: "2007-01-01",
          },
        ],
      }),
    );
    expect(result.lines[0]).toMatchObject({
      treatment: "out_of_scope",
      taxMinor: "0",
    });
  });

  it("refuses a rate kind nobody has given a meaning", () => {
    expect(() =>
      germanDomestic(
        composed({
          rates: [
            {
              jurisdictionId: "DE",
              taxCode: "*",
              rateKind: "mystery",
              ratePpm: 50_000,
              legalBasis: "?",
              effectiveFrom: "2007-01-01",
            },
          ],
        }),
      ),
    ).toThrow(/TAX_RATE_KIND_UNMAPPED|does not say what rate kind/);
  });
});
