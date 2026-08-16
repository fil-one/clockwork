import type {
  Currency,
  MinorUnit,
  TaxDeterminationRequest,
  TaxDeterminationRequestLine,
  TaxDeterminationResult,
  TaxDeterminationResultLine,
  TaxRegistration,
  TaxRoundingConvention,
  TaxTreatment,
} from "@clockwork/contracts";
import { MinorUnitSchema } from "@clockwork/contracts";

import { divideRound } from "../decimal";
import {
  daysBetween,
  notationFor,
  rateFor,
  registrationCovers,
  reverseChargeRule,
  schemeFor,
  taxDay,
  taxingJurisdictions,
  territoryFor,
  thresholdFor,
  unionFor,
  type DomesticTaxTreatment,
  type TaxJurisdictionRule,
  type TaxPlace,
  type TaxRateRule,
  type TaxRegistrationThresholdRule,
  type TaxRuleBook,
  type TaxTerritoryRule,
} from "./rule-book";

/**
 * A determination that cannot be made. Refusing is the correct answer when the
 * rule book has not been told something: a provider failure has always been a
 * refusal on this path rather than a zero, and a missing rate row is the same
 * kind of silence. The codes are stable so a caller can tell "nobody has stated
 * a rate for this" apart from "you sent me two currencies".
 */
export class TaxDeterminationError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "TaxDeterminationError";
  }
}

export interface TaxDeterminationEngineInput {
  /** Supplied by the caller: the engine reads no clock and no generator. */
  determinationId: string;
  request: TaxDeterminationRequest;
  ruleBook: TaxRuleBook;
}

interface ResolvedLine {
  line: TaxDeterminationRequestLine;
  /** The territory the supply takes place in. */
  place: TaxTerritoryRule;
  /** One row per taxing authority, before rounding is applied. */
  rows: readonly {
    /**
     * What this field names, stated once because the branches below are not
     * uniform and the inconsistency is deliberate.
     *
     * Where an authority ruled on the supply — it charged, it exempted the
     * customer, or it would have charged had the supplier been registered —
     * the row names THAT AUTHORITY, one row each: `US-WA`, `US-WA-KING`. Those
     * three branches are the ones whose rows are counted per jurisdiction
     * (against a rate, a certificate, a registration threshold), so a row that
     * named the territory instead would be uncountable.
     *
     * Where no authority of ours ruled at all — a reverse charge, or a supply
     * that left the regime under the supplier territory's export rule — the row
     * names the TERRITORY the supply landed in. Resolving the customer's taxing
     * authorities there would invent rows for four US authorities on a supply
     * whose only statute is the supplier's export rule, and attribute a Spanish
     * article to a Seattle city council. The territory is the true subject of
     * those rows: the place of supply, with nothing charged and nobody to
     * attribute it to.
     */
    jurisdictionId: string;
    treatment: TaxTreatment;
    rateKind: string;
    ratePpm: number;
    legalBasis: string;
    notation: string;
    /** The book that published this row, which need not be the whole book. */
    ruleBookId: string;
    ruleBookVersion: number;
  }[];
}

/**
 * What a rate row's kind means. Stated on the row, or mapped from the kind by
 * the book. A kind nobody has mapped is a refusal, not a guess: inferring
 * "exempt" from a zero rate would put an unrecoverable input tax on a supply
 * that was only zero-rated.
 */
function rateTreatment(
  ruleBook: TaxRuleBook,
  rate: TaxRateRule,
): DomesticTaxTreatment {
  const treatment =
    rate.treatment ?? ruleBook.rateKindTreatments[rate.rateKind];
  if (!treatment)
    throw new TaxDeterminationError(
      "TAX_RATE_KIND_UNMAPPED",
      `The rule book does not say what rate kind ${rate.rateKind} means in ${rate.jurisdictionId}`,
    );
  return treatment;
}

const minor = (value: bigint): MinorUnit =>
  MinorUnitSchema.parse(value.toString());

/**
 * Half away from zero, in parts per million. `divideRound`'s `half_up` mode
 * rounds the magnitude and reapplies the sign, so a credit line's tax is the
 * exact mirror of the charge it reverses instead of drifting toward zero.
 */
export function taxOnNet(netMinor: bigint, ratePpm: number): bigint {
  return divideRound(netMinor * BigInt(ratePpm), 1_000_000n, "half_up");
}

function registrationValidity(
  ruleBook: TaxRuleBook,
  registration: TaxRegistration,
  day: string,
): { usable: boolean; reason?: string } {
  const scheme = schemeFor(ruleBook, registration.scheme);
  if (!scheme) return { usable: false, reason: "registration_scheme_unknown" };
  if (registration.verifiedAt === undefined)
    return { usable: false, reason: "registration_never_validated" };
  const verifiedDay = taxDay(registration.verifiedAt);
  if (
    registration.expiresAt !== undefined &&
    taxDay(registration.expiresAt) < day
  )
    return { usable: false, reason: "registration_expired" };
  if (
    scheme.maxValidationAgeDays !== undefined &&
    daysBetween(verifiedDay, day) > scheme.maxValidationAgeDays
  )
    return { usable: false, reason: "registration_validation_stale" };
  return { usable: true };
}

function supplierRegistrationFor(
  ruleBook: TaxRuleBook,
  request: TaxDeterminationRequest,
  territory: TaxTerritoryRule,
  day: string,
): TaxRegistration | undefined {
  return request.supplier.registrations.find((registration) => {
    const scheme = schemeFor(ruleBook, registration.scheme);
    if (!scheme) return false;
    if (!registrationCovers(scheme, registration.jurisdiction, territory))
      return false;
    return registrationValidity(ruleBook, registration, day).usable;
  });
}

type TaxExemptionCertificate =
  TaxDeterminationRequest["customer"]["exemptionCertificates"][number];

/**
 * The exemption certificates that reach a set of rule-book ids, and whether one
 * that reached them has lapsed.
 *
 * A certificate is matched at EITHER level the rule book names: the territory
 * (`US`) or a taxing jurisdiction inside it (`US-WA`). Matching the territory
 * alone — which is what this did — can never find the form a real certificate
 * actually takes, because a Washington reseller permit is issued by Washington
 * and carries Washington's id. An unfound certificate does not fail loudly: it
 * charges a customer who is entitled not to be charged, in the customer's
 * disfavour, and looks like an ordinary taxed invoice.
 *
 * Neither level is a literal here. The caller passes the ids the rule book
 * produced for this address, so a book that names its authorities differently
 * matches its own certificates without an edit to this file.
 */
function exemptionCertificatesFor(
  request: TaxDeterminationRequest,
  ids: readonly string[],
  day: string,
): { certificate?: TaxExemptionCertificate; expired: boolean } {
  const held = request.customer.exemptionCertificates.filter((certificate) =>
    ids.includes(certificate.jurisdiction),
  );
  const valid = held.find(
    (certificate) =>
      (certificate.validFrom === undefined ||
        taxDay(certificate.validFrom) <= day) &&
      (certificate.validUntil === undefined ||
        taxDay(certificate.validUntil) >= day),
  );
  if (valid) return { certificate: valid, expired: false };
  return { expired: held.length > 0 };
}

/**
 * The most load-bearing stable rule in the set: reverse charge requires a
 * validated customer registration, and an unvalidated or expired one makes the
 * customer a consumer. Downgrading changes who owes the tax, so it is always
 * worth a human's eye — every downgrade raises a review reason.
 */
function effectiveCustomerStatus(
  ruleBook: TaxRuleBook,
  request: TaxDeterminationRequest,
  customerTerritory: TaxTerritoryRule,
  day: string,
  reviewReasons: string[],
): { status: "business" | "consumer"; registration?: TaxRegistration } {
  if (request.customer.status !== "business") return { status: "consumer" };
  let downgrade = "customer_registration_absent";
  for (const registration of request.customer.registrations) {
    const scheme = schemeFor(ruleBook, registration.scheme);
    if (!scheme) continue;
    if (
      !registrationCovers(scheme, registration.jurisdiction, customerTerritory)
    )
      continue;
    if (!scheme.admitsReverseCharge) {
      downgrade = "customer_registration_scheme_not_reverse_chargeable";
      continue;
    }
    const validity = registrationValidity(ruleBook, registration, day);
    if (!validity.usable) {
      downgrade = `customer_${validity.reason ?? "registration_invalid"}`;
      continue;
    }
    if (registration.evidenceReference === undefined)
      reviewReasons.push("customer_registration_evidence_missing");
    if (
      registration.verifiedAt !== undefined &&
      taxDay(registration.verifiedAt) > day
    )
      reviewReasons.push("customer_registration_verified_after_tax_point");
    return { status: "business", registration };
  }
  reviewReasons.push(`${downgrade}_treated_as_consumer`);
  return { status: "consumer" };
}

/** The address that selects the taxing authorities inside a territory. */
function sourcingPlace(
  territory: TaxTerritoryRule,
  supplierPlace: TaxPlace,
  customerPlace: TaxPlace,
): TaxPlace {
  return territory.sourcing === "origin" ? supplierPlace : customerPlace;
}

/**
 * The wording a `not_registered` row carries.
 *
 * The book's own notation is the sentence; the threshold is a parenthetical
 * added to it. When the book states no notation the threshold becomes the
 * sentence instead of being appended to itself — the two used to be composed
 * independently, which shipped "threshold X per 12 months (threshold X per 12
 * months)" onto an invoice.
 */
function notRegisteredNotation(
  bookNotation: string | undefined,
  threshold: TaxRegistrationThresholdRule | undefined,
): string {
  const thresholdText =
    threshold &&
    `threshold ${threshold.amountMinor} ${threshold.currency} per ${threshold.periodMonths} months`;
  if (bookNotation === undefined || bookNotation === "")
    return thresholdText ? `No registration held; ${thresholdText}` : "";
  return thresholdText ? `${bookNotation} (${thresholdText})` : bookNotation;
}

function chargingRows(
  ruleBook: TaxRuleBook,
  request: TaxDeterminationRequest,
  line: TaxDeterminationRequestLine,
  territory: TaxTerritoryRule,
  place: TaxPlace,
  day: string,
  reviewReasons: string[],
  supplierRegistrations: Map<string, TaxRegistration | undefined>,
): ResolvedLine["rows"] {
  const registration = supplierRegistrations.get(territory.id);
  if (!registration) {
    // One row per taxing jurisdiction that WOULD have charged, not one row for
    // the territory. Thresholds are keyed by jurisdiction (US-WA, US-CA), so a
    // single territory-level row cannot say which registration a run of
    // untaxed supplies has put over the line, and it would carry one
    // jurisdiction's statute on a label naming the whole territory.
    const bookNotation = notationFor(ruleBook, "not_registered", territory);
    const row = (jurisdictionId: string) => {
      const threshold = thresholdFor(ruleBook, jurisdictionId);
      return {
        jurisdictionId,
        treatment: "not_registered" as const,
        rateKind: "none",
        ratePpm: 0,
        ruleBookId: ruleBook.id,
        ruleBookVersion: ruleBook.version,
        legalBasis: threshold?.basis ?? "supplier holds no registration here",
        notation: notRegisteredNotation(bookNotation, threshold),
      };
    };
    const jurisdictions = taxingJurisdictions(ruleBook, territory, place, day);
    // A territory whose taxing authorities the book has not stated still has to
    // count: losing the row entirely would lose the breach it evidences.
    if (jurisdictions.length === 0) return [row(territory.id)];
    return jurisdictions.map((jurisdiction) => row(jurisdiction.id));
  }

  /**
   * An exemption is attributed per taxing jurisdiction, exactly as a charge and
   * a non-registration are. A single row labelled with the territory named an
   * id that is not a member of `ruleBook.jurisdictions` at all — a US address
   * produced one line for "US" where the charging path for the same address
   * produces four — so any exemption or threshold watch grouping by
   * jurisdiction saw a jurisdiction that does not exist.
   *
   * What a TERRITORY-level certificate means when the address reaches four
   * authorities: it exempts all four. The certificate names the territory, so
   * it claims the whole of it, and reading it as covering none is the failure
   * this branch already had. What a JURISDICTION-level certificate means: it
   * exempts that authority and no other, and the rest of the stack charges
   * normally. The engine does not infer that a state certificate carries the
   * county, city and district with it — whether it does is a jurisdiction fact,
   * and a book that means it says so by issuing the certificate at territory
   * level. That is why the two levels are matched but not conflated.
   */
  const exemptRow = (
    jurisdictionId: string,
    certificate: TaxExemptionCertificate,
  ) => ({
    jurisdictionId,
    treatment: "exempt" as const,
    rateKind: "none",
    ratePpm: 0,
    ruleBookId: ruleBook.id,
    ruleBookVersion: ruleBook.version,
    legalBasis:
      certificate.reason ??
      `exemption certificate ${certificate.certificateId}`,
    notation: notationFor(ruleBook, "exempt", territory) ?? "",
  });

  const jurisdictions = taxingJurisdictions(ruleBook, territory, place, day);
  if (jurisdictions.length === 0) {
    // No authority to attribute to. A territory-level certificate still answers
    // — the same deliberate fallback the `not_registered` branch makes, for the
    // same reason: the territory id is the only id the book has given us, and
    // dropping the row would lose the exemption the customer holds.
    const territoryExemption = exemptionCertificatesFor(
      request,
      [territory.id],
      day,
    );
    if (territoryExemption.expired)
      reviewReasons.push("customer_exemption_certificate_expired");
    if (territoryExemption.certificate)
      return [exemptRow(territory.id, territoryExemption.certificate)];
    throw new TaxDeterminationError(
      "TAX_JURISDICTION_UNKNOWN",
      `The rule book names no taxing jurisdiction in ${territory.id} for the address supplied`,
    );
  }
  const rows = jurisdictions.flatMap((jurisdiction: TaxJurisdictionRule) => {
    const exemption = exemptionCertificatesFor(
      request,
      [territory.id, jurisdiction.id],
      day,
    );
    if (exemption.expired)
      reviewReasons.push("customer_exemption_certificate_expired");
    if (exemption.certificate)
      return [exemptRow(jurisdiction.id, exemption.certificate)];
    const rate = rateFor(
      ruleBook,
      jurisdiction.id,
      line.taxCode,
      line.supplyType,
      day,
    );
    if (!rate) return [];
    const treatment = rateTreatment(ruleBook, rate);
    return [
      {
        jurisdictionId: jurisdiction.id,
        treatment,
        rateKind: rate.rateKind,
        ratePpm: treatment === "standard" ? rate.ratePpm : 0,
        legalBasis: rate.legalBasis,
        notation:
          rate.notation ?? notationFor(ruleBook, treatment, territory) ?? "",
        ruleBookId: rate.ruleBookId ?? ruleBook.id,
        ruleBookVersion: rate.ruleBookVersion ?? ruleBook.version,
      },
    ];
  });
  if (rows.length === 0)
    throw new TaxDeterminationError(
      "TAX_RATE_MISSING",
      `The rule book states no rate for ${line.taxCode} in ${territory.id}; a determination is refused rather than defaulted to zero`,
    );
  return rows;
}

function resolveLine(
  ruleBook: TaxRuleBook,
  request: TaxDeterminationRequest,
  line: TaxDeterminationRequestLine,
  context: {
    day: string;
    supplierTerritory: TaxTerritoryRule;
    customerTerritory: TaxTerritoryRule;
    supplierPlace: TaxPlace;
    customerPlace: TaxPlace;
    status: "business" | "consumer";
    reviewReasons: string[];
    supplierRegistrations: Map<string, TaxRegistration | undefined>;
  },
): ResolvedLine {
  const {
    day,
    supplierTerritory,
    customerTerritory,
    supplierPlace,
    customerPlace,
    status,
    reviewReasons,
    supplierRegistrations,
  } = context;

  const charge = (territory: TaxTerritoryRule): ResolvedLine => ({
    line,
    place: territory,
    rows: chargingRows(
      ruleBook,
      request,
      line,
      territory,
      sourcingPlace(territory, supplierPlace, customerPlace),
      day,
      reviewReasons,
      supplierRegistrations,
    ),
  });

  // Domestic supply: supplier and customer in the same territory, at the
  // supplier's own rates.
  if (supplierTerritory.id === customerTerritory.id)
    return charge(supplierTerritory);

  const supplierUnion = unionFor(ruleBook, supplierTerritory);
  const sameUnion =
    supplierTerritory.unionId !== undefined &&
    supplierTerritory.unionId === customerTerritory.unionId;

  if (sameUnion && line.supplyType !== "goods") {
    const rule = reverseChargeRule(supplierUnion, line.supplyType);
    // B2B cross-border services inside a union reverse charge to the
    // customer's jurisdiction. Stable since 2010.
    if (status === "business" && rule?.available === true) {
      const supplierHome = supplierRegistrations.get(supplierTerritory.id);
      if (!supplierHome) {
        reviewReasons.push("supplier_not_registered_in_establishment");
        return {
          line,
          place: customerTerritory,
          rows: [
            {
              // The territory, not a taxing authority — and unlike the other
              // `not_registered` rows this one is NOT the evidence of a
              // threshold breach here: the registration the supplier is missing
              // is in its OWN establishment territory, not in the customer's.
              // Attributing it to the customer's authorities would put a
              // Spanish registration failure on a German ledger.
              jurisdictionId: customerTerritory.id,
              treatment: "not_registered",
              rateKind: "none",
              ratePpm: 0,
              legalBasis: rule.legalBasis,
              notation: "",
              ruleBookId: ruleBook.id,
              ruleBookVersion: ruleBook.version,
            },
          ],
        };
      }
      const notation = notationFor(
        ruleBook,
        "reverse_charge",
        customerTerritory,
      );
      if (notation === undefined)
        reviewReasons.push("reverse_charge_notation_missing");
      return {
        line,
        place: customerTerritory,
        rows: [
          {
            // The territory, not a taxing authority: nothing is charged here
            // and the tax is assessed by the customer under their own regime.
            // See `ResolvedLine["rows"].jurisdictionId`.
            jurisdictionId: customerTerritory.id,
            treatment: "reverse_charge",
            rateKind: "none",
            ratePpm: 0,
            legalBasis: rule.legalBasis,
            notation: notation ?? "",
            ruleBookId: ruleBook.id,
            ruleBookVersion: ruleBook.version,
          },
        ],
      };
    }
    // A consumer's digital service is supplied where the consumer is. Stable
    // since 2015. Any other service to a consumer stays with the supplier.
    return charge(
      line.supplyType === "digital_service"
        ? customerTerritory
        : supplierTerritory,
    );
  }

  // Outside the supplier's union. A digital service still follows the consumer;
  // everything else leaves the regime, and what leaving means — out of scope or
  // zero-rated — is the supplier territory's rule, not a constant.
  if (line.supplyType === "digital_service" && status === "consumer")
    return charge(customerTerritory);

  if (line.supplyType === "goods")
    reviewReasons.push("cross_border_goods_require_review");

  const exportRule = supplierTerritory.exportOfServices;
  return {
    line,
    place: customerTerritory,
    rows: [
      {
        // The territory, not a taxing authority: the statute on this row is the
        // SUPPLIER territory's export rule, and no authority in the customer's
        // territory has ruled on the supply at all.
        // See `ResolvedLine["rows"].jurisdictionId`.
        jurisdictionId: customerTerritory.id,
        treatment: exportRule.treatment,
        rateKind: exportRule.rateKind,
        ratePpm: 0,
        ruleBookId: ruleBook.id,
        ruleBookVersion: ruleBook.version,
        legalBasis: exportRule.legalBasis,
        notation:
          notationFor(ruleBook, exportRule.treatment, supplierTerritory) ?? "",
      },
    ],
  };
}

/**
 * Determines tax for one document.
 *
 * Pure: no database, no provider, no clock. The tax point is an input, the rule
 * book is an input, and the same call from a repository and from a demo with no
 * database returns the same answer. That is not a stylistic preference — it is
 * the only way the demo shows real tax behaviour without a second
 * implementation to drift against.
 */
export function determineTax(
  input: TaxDeterminationEngineInput,
): TaxDeterminationResult {
  const { request, ruleBook } = input;
  if (request.lines.length === 0)
    throw new TaxDeterminationError(
      "TAX_REQUEST_EMPTY",
      "A determination needs at least one line",
    );
  const currencies = new Set(
    request.lines.map((line) => line.netAmount.currency),
  );
  if (currencies.size > 1)
    throw new TaxDeterminationError(
      "TAX_CURRENCY_MIXED",
      "A determination cannot span currencies",
    );
  const currency = request.lines[0]?.netAmount.currency as Currency;
  const day = taxDay(request.taxPointDate);

  // A credit must be determined under the book its charge was determined
  // under. Crediting last year's supply at this year's rate is a wrong number
  // that reconciles perfectly against nothing.
  if (
    request.reversalOf &&
    !request.reversalOf.pinnedRuleBookIds.includes(ruleBook.id)
  )
    throw new TaxDeterminationError(
      "TAX_RULE_BOOK_PIN_MISMATCH",
      `Reversal of ${request.reversalOf.invoiceId} pins ${request.reversalOf.pinnedRuleBookIds.join(", ") || "no rule book"}, not ${ruleBook.id}`,
    );

  const reviewReasons: string[] = [];
  const supplierPlace: TaxPlace = {
    country: request.supplier.establishedCountry,
  };
  const customerPlace: TaxPlace = {
    country: request.customer.address.country,
    ...(request.customer.address.region !== undefined
      ? { region: request.customer.address.region }
      : {}),
    ...(request.customer.address.postalCode !== undefined
      ? { postalCode: request.customer.address.postalCode }
      : {}),
  };
  if (
    request.customer.country.trim().toUpperCase() !==
    request.customer.address.country.trim().toUpperCase()
  )
    reviewReasons.push("customer_country_conflicts_with_address");

  const supplierTerritory = territoryFor(ruleBook, supplierPlace, day);
  if (!supplierTerritory)
    throw new TaxDeterminationError(
      "TAX_TERRITORY_UNKNOWN",
      `The rule book describes no territory for supplier country ${request.supplier.establishedCountry} on ${day}`,
    );
  const customerTerritory = territoryFor(ruleBook, customerPlace, day);
  if (!customerTerritory)
    throw new TaxDeterminationError(
      "TAX_TERRITORY_UNKNOWN",
      `The rule book describes no territory for customer country ${request.customer.address.country} on ${day}`,
    );

  const customer = effectiveCustomerStatus(
    ruleBook,
    request,
    customerTerritory,
    day,
    reviewReasons,
  );

  const supplierRegistrations = new Map<string, TaxRegistration | undefined>();
  for (const territory of [supplierTerritory, customerTerritory])
    supplierRegistrations.set(
      territory.id,
      supplierRegistrationFor(ruleBook, request, territory, day),
    );

  const resolved = request.lines.map((line) =>
    resolveLine(ruleBook, request, line, {
      day,
      supplierTerritory,
      customerTerritory,
      supplierPlace,
      customerPlace,
      status: customer.status,
      reviewReasons,
      supplierRegistrations,
    }),
  );

  const conventions = new Set(resolved.map((entry) => entry.place.rounding));
  if (conventions.size > 1) reviewReasons.push("mixed_rounding_conventions");
  const rounding: TaxRoundingConvention =
    resolved[0]?.place.rounding ?? ("line" as const);

  const lines = applyRounding(resolved);

  const netTotal = request.lines.reduce(
    (total, line) => total + BigInt(line.netAmount.minor),
    0n,
  );
  const taxTotal = lines.reduce(
    (total, line) => total + BigInt(line.taxMinor),
    0n,
  );

  /*
   * Net and tax split by treatment.
   *
   * A line's jurisdictions can disagree: a Seattle supply whose city row is out
   * of scope while the state, county and district rows are standard touches two
   * treatments at once. A bucket therefore holds the SHARE of a line's net that
   * fell under that treatment, apportioned equally across the taxing
   * authorities that ruled on the line, and not the line's whole net once per
   * treatment — the old shape returned 100000 under `standard` and 100000 under
   * `out_of_scope` against a document net of 100000, and a bucket total that
   * can exceed the document is not the countable number the field exists to be.
   *
   * The apportionment is cumulative, so the shares sum to the line's net
   * exactly and the buckets reconcile to the document totals: no minor unit is
   * invented and none is lost.
   */
  const treatments = new Map<TaxTreatment, { net: bigint; tax: bigint }>();
  let cursor = 0;
  for (const resolvedLine of resolved) {
    const netMinor = BigInt(resolvedLine.line.netAmount.minor);
    const rowCount = BigInt(resolvedLine.rows.length);
    let apportioned = 0n;
    resolvedLine.rows.forEach((row, index) => {
      const cumulative = divideRound(
        netMinor * BigInt(index + 1),
        rowCount,
        "half_up",
      );
      const share = cumulative - apportioned;
      apportioned = cumulative;
      // `applyRounding` emits exactly one result line per resolved row, in this
      // order, so the tax on this row is the line the cursor is standing on.
      const resultLine = lines[cursor];
      cursor += 1;
      const entry = treatments.get(row.treatment) ?? { net: 0n, tax: 0n };
      entry.net += share;
      entry.tax += BigInt(resultLine?.taxMinor ?? "0");
      treatments.set(row.treatment, entry);
    });
  }

  const placeOfSupply = [...new Set(resolved.map((entry) => entry.place.id))];

  return {
    determinationId: input.determinationId,
    placeOfSupply,
    confidence: reviewReasons.length === 0 ? "determined" : "review_required",
    reviewReasons: [...new Set(reviewReasons)],
    ...(supplierRegistrations.get(supplierTerritory.id)
      ? {
          supplierRegistration: supplierRegistrations.get(
            supplierTerritory.id,
          ) as TaxRegistration,
        }
      : {}),
    ...(customer.registration
      ? { customerRegistration: customer.registration }
      : {}),
    rounding,
    lines,
    totals: {
      currency,
      netMinor: minor(netTotal),
      taxMinor: minor(taxTotal),
      grossMinor: minor(netTotal + taxTotal),
      byTreatment: [...treatments.entries()].map(([treatment, entry]) => ({
        treatment,
        netMinor: minor(entry.net),
        taxMinor: minor(entry.tax),
      })),
    },
  };
}

/**
 * Applies the rate and the territory's rounding convention.
 *
 * Per-line rounding rounds each row on its own. Per-invoice rounding rounds the
 * group's running total and takes each row's tax as the difference between
 * successive rounded totals, so the rows always sum to the rounded group total
 * exactly: no minor unit is invented and none is lost. Both are half away from
 * zero, which is what makes a credit the exact negative of its charge.
 */
function applyRounding(
  resolved: readonly ResolvedLine[],
): readonly TaxDeterminationResultLine[] {
  const runningNet = new Map<string, bigint>();
  const runningTax = new Map<string, bigint>();
  const lines: TaxDeterminationResultLine[] = [];
  for (const entry of resolved) {
    const netMinor = BigInt(entry.line.netAmount.minor);
    for (const row of entry.rows) {
      const groupKey = `${row.jurisdictionId}|${row.treatment}|${row.ratePpm}`;
      let taxMinor: bigint;
      if (row.ratePpm === 0 || row.treatment !== "standard") taxMinor = 0n;
      else if (entry.place.rounding === "line")
        taxMinor = taxOnNet(netMinor, row.ratePpm);
      else {
        const net = (runningNet.get(groupKey) ?? 0n) + netMinor;
        const cumulative = taxOnNet(net, row.ratePpm);
        taxMinor = cumulative - (runningTax.get(groupKey) ?? 0n);
        runningNet.set(groupKey, net);
        runningTax.set(groupKey, cumulative);
      }
      lines.push({
        lineId: entry.line.lineId,
        jurisdiction: row.jurisdictionId,
        treatment: row.treatment,
        taxCode: entry.line.taxCode,
        ruleBookId: row.ruleBookId,
        ruleBookVersion: row.ruleBookVersion,
        ratePpm: row.ratePpm,
        rateKind: row.rateKind,
        taxableMinor: minor(netMinor),
        taxMinor: minor(taxMinor),
        legalBasis: row.legalBasis,
        notation: row.notation,
      });
    }
  }
  return lines;
}
