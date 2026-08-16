import type {
  TaxRoundingConvention,
  TaxSupplyType,
} from "@clockwork/contracts";
import { z } from "zod";

/**
 * The rule book: every parameter the determination engine consults.
 *
 * The split this file exists to hold is the whole design. The ALGORITHM is
 * stable and lives in `engine.ts` — where a supply takes place, when a business
 * customer is really a consumer, when a charge becomes a reverse charge. Every
 * PARAMETER that algorithm reads lives here, as rows: rates, which code is
 * standard or reduced or zero, whether a jurisdiction taxes a thing at all,
 * which territories belong to which union and from when, whether reverse charge
 * is available for a supply type, the wording a document must carry, the
 * rounding convention, and the registration thresholds. None of it is a literal
 * in TypeScript, because the owner authorised building this on the basis that
 * the rules stay amendable without a deploy.
 *
 * The rows are the same whether they arrive from a database table or from a
 * seeded document, which is what lets the demo and production run one engine.
 */

const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Rule-book dates are plain ISO calendar dates");

const NameSchema = z.string().trim().min(1).max(120);

/**
 * The token a rate row uses to say "any tax code". It is a rule-book
 * convention, spelled once, and a code that literally equals it is not
 * expressible — which is correct, since tax codes are provider vocabulary.
 */
export const anyTaxCode = "*";

export const TaxSupplyTypeSchema = z.enum([
  "service",
  "digital_service",
  "goods",
]);

/**
 * A union of territories that share a cross-border regime — the EU VAT area is
 * one. Membership is not stated here but on the territory, because membership
 * changes with a date and the territory row is where that date lives.
 */
export const TaxUnionRuleSchema = z
  .object({
    id: NameSchema,
    /**
     * Whether a cross-border business supply of this type inside the union may
     * be reverse charged. A regime with no rows admits no reverse charge at
     * all, which is how the US falls out without the string "US" appearing in
     * the engine.
     */
    reverseCharge: z.array(
      z
        .object({
          supplyType: TaxSupplyTypeSchema,
          available: z.boolean(),
          legalBasis: z.string().trim().min(1).max(400),
        })
        .strict(),
    ),
  })
  .strict();
export type TaxUnionRule = z.infer<typeof TaxUnionRuleSchema>;

/**
 * A tax territory: the unit that place-of-supply rules compare. Usually a
 * country, but not always — the Canary Islands, Åland and Réunion are carve-outs
 * inside a member state and are territories of their own with no union
 * membership, which is exactly how they behave.
 *
 * `effectiveFrom`/`effectiveTo` make membership a dated fact rather than a
 * standing one: Brexit is two rows for GB, not an edit to one.
 */
export const TaxTerritoryRuleSchema = z
  .object({
    id: NameSchema,
    country: z.string().trim().length(2).toUpperCase(),
    /** Absent for a territory outside every union. */
    unionId: NameSchema.optional(),
    /** Address regions that select this territory over the country default. */
    regions: z.array(NameSchema).default([]),
    /** Postal-code prefixes that select it. Matched longest-first. */
    postalPrefixes: z.array(z.string().trim().min(1).max(10)).default([]),
    /**
     * Which address selects the taxing jurisdictions within the territory.
     * Destination for US sales tax; irrelevant where the territory has a single
     * country-level jurisdiction, which is the VAT case.
     */
    sourcing: z.enum(["destination", "origin"]).default("destination"),
    rounding: z.enum(["line", "invoice"]).default("line"),
    /**
     * What a supply of services leaving this territory's regime becomes.
     * Out of scope in some regimes, zero-rated in others, and the difference
     * decides whether it appears on a return at all.
     */
    exportOfServices: z
      .object({
        treatment: z.enum(["out_of_scope", "zero_rated"]),
        rateKind: NameSchema,
        legalBasis: z.string().trim().min(1).max(400),
      })
      .strict(),
    effectiveFrom: IsoDateSchema,
    effectiveTo: IsoDateSchema.optional(),
  })
  .strict();
export type TaxTerritoryRule = z.infer<typeof TaxTerritoryRuleSchema>;

/**
 * A taxing authority inside a territory. VAT territories have one, at country
 * level. US states stack state, county, city and district, and each one is a
 * row here so each can appear as its own answer.
 */
export const TaxJurisdictionRuleSchema = z
  .object({
    id: NameSchema,
    territoryId: NameSchema,
    /** Rule-book vocabulary: `country`, `state`, `county`, `city`, `district`. */
    level: NameSchema,
    /** Stacking order on the document. */
    sequence: z.number().int().nonnegative(),
    regions: z.array(NameSchema).default([]),
    postalPrefixes: z.array(z.string().trim().min(1).max(10)).default([]),
    effectiveFrom: IsoDateSchema,
    effectiveTo: IsoDateSchema.optional(),
  })
  .strict();
export type TaxJurisdictionRule = z.infer<typeof TaxJurisdictionRuleSchema>;

export const DomesticTreatmentSchema = z.enum([
  "standard",
  "zero_rated",
  "exempt",
  "out_of_scope",
]);
export type DomesticTaxTreatment = z.infer<typeof DomesticTreatmentSchema>;

/**
 * What a jurisdiction charges for a tax code. The treatment is limited to the
 * outcomes a domestic charge can have: reverse charge and non-registration are
 * conclusions the engine reaches, not rates a jurisdiction publishes.
 *
 * A jurisdiction that does not tax a supply at all is a row with treatment
 * `out_of_scope`, not a missing row — a missing row means nobody has stated an
 * answer, and the engine refuses rather than inventing a zero.
 *
 * `treatment` may be omitted when the book maps the row's `rateKind` in
 * `rateKindTreatments`. A rate table keyed by kind rather than by treatment is
 * the natural shape for a persisted rule book, and neither form is a rule in
 * code: both are rows.
 *
 * `ruleBookId`/`ruleBookVersion` pin an individual row to the book it was
 * published in, for a book composed from several per-jurisdiction books. Absent,
 * the containing book's own pin is used.
 */
export const TaxRateRuleSchema = z
  .object({
    jurisdictionId: NameSchema,
    taxCode: z.string().trim().min(1).max(120),
    supplyTypes: z.array(TaxSupplyTypeSchema).default([]),
    rateKind: NameSchema,
    ratePpm: z.number().int().min(0).max(1_000_000),
    treatment: DomesticTreatmentSchema.optional(),
    legalBasis: z.string().trim().min(1).max(400),
    /** Overrides the book's notation for this row, as a rate table may carry one. */
    notation: z.string().trim().max(400).optional(),
    ruleBookId: NameSchema.optional(),
    ruleBookVersion: z.number().int().nonnegative().optional(),
    effectiveFrom: IsoDateSchema,
    effectiveTo: IsoDateSchema.optional(),
  })
  .strict();
export type TaxRateRule = z.infer<typeof TaxRateRuleSchema>;

/**
 * A register a number can sit on. `scope` is what makes a single registration
 * cover many territories: a union-scoped scheme is how a one-stop-shop
 * registration covers every member state without a row per state.
 */
export const TaxRegistrationSchemeRuleSchema = z
  .object({
    id: NameSchema,
    scope: z.enum(["territory", "union"]),
    /** Required when scope is `union`. */
    unionId: NameSchema.optional(),
    /** Territories whose numbers sit on this register. */
    territories: z.array(NameSchema).default([]),
    /**
     * Anchored pattern a well-formed number matches. Number formats are
     * jurisdiction facts that change, so they are rows and not a regex
     * literal in an adapter.
     */
    numberPattern: z.string().trim().min(1).max(200).optional(),
    /**
     * Whether a CUSTOMER number on this register can carry a reverse charge.
     * A sales-tax permit cannot; a VAT number can.
     */
    admitsReverseCharge: z.boolean().default(false),
    /**
     * How stale a validation may be before the registration counts as
     * unvalidated. Absent means a validation never goes stale by age alone.
     */
    maxValidationAgeDays: z.number().int().positive().optional(),
  })
  .strict();
export type TaxRegistrationSchemeRule = z.infer<
  typeof TaxRegistrationSchemeRuleSchema
>;

/** Wording a document must carry for a treatment. Legal text is never a literal. */
export const TaxNotationRuleSchema = z
  .object({
    treatment: z.enum([
      "standard",
      "reverse_charge",
      "zero_rated",
      "exempt",
      "out_of_scope",
      "not_registered",
    ]),
    territoryId: NameSchema.optional(),
    unionId: NameSchema.optional(),
    text: z.string().trim().min(1).max(400),
  })
  .strict();
export type TaxNotationRule = z.infer<typeof TaxNotationRuleSchema>;

/**
 * The turnover at which a jurisdiction requires registration. The engine cannot
 * know what has already been supplied — it is pure and sees one document — so
 * it reports the threshold alongside every `not_registered` row it emits, and
 * the breach is detected by counting those rows against it after the fact.
 */
export const TaxRegistrationThresholdRuleSchema = z
  .object({
    jurisdictionId: NameSchema,
    currency: z.string().trim().length(3),
    amountMinor: z.string().regex(/^(0|[1-9]\d*)$/),
    periodMonths: z.number().int().positive(),
    basis: z.string().trim().min(1).max(200).optional(),
  })
  .strict();
export type TaxRegistrationThresholdRule = z.infer<
  typeof TaxRegistrationThresholdRuleSchema
>;

export const TaxRuleBookSchema = z
  .object({
    id: NameSchema,
    version: z.number().int().nonnegative(),
    effectiveFrom: IsoDateSchema,
    effectiveTo: IsoDateSchema.optional(),
    unions: z.array(TaxUnionRuleSchema).default([]),
    /**
     * What a rate kind means for a rate row that does not state a treatment.
     * The distinction between zero-rated and exempt is a book-level policy
     * statement, not something to infer from a rate of zero.
     */
    rateKindTreatments: z
      .record(NameSchema, DomesticTreatmentSchema)
      .default({}),
    territories: z.array(TaxTerritoryRuleSchema),
    jurisdictions: z.array(TaxJurisdictionRuleSchema),
    rates: z.array(TaxRateRuleSchema),
    schemes: z.array(TaxRegistrationSchemeRuleSchema).default([]),
    notations: z.array(TaxNotationRuleSchema).default([]),
    thresholds: z.array(TaxRegistrationThresholdRuleSchema).default([]),
  })
  .strict();
export type TaxRuleBook = z.infer<typeof TaxRuleBookSchema>;

export function parseTaxRuleBook(value: unknown): TaxRuleBook {
  return TaxRuleBookSchema.parse(value);
}

/** The calendar day a rule-book window is compared against. */
export function taxDay(value: string): string {
  const day = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day)))
    throw new Error(`Invalid tax date: ${value}`);
  return day;
}

export function withinWindow(
  window: { effectiveFrom: string; effectiveTo?: string | undefined },
  day: string,
): boolean {
  if (day < window.effectiveFrom) return false;
  return window.effectiveTo === undefined || day <= window.effectiveTo;
}

export function daysBetween(from: string, to: string): number {
  return Math.floor(
    (Date.parse(`${taxDay(to)}T00:00:00.000Z`) -
      Date.parse(`${taxDay(from)}T00:00:00.000Z`)) /
      86_400_000,
  );
}

function matchesPostal(
  prefixes: readonly string[],
  postalCode: string | undefined,
): boolean {
  if (prefixes.length === 0 || postalCode === undefined) return false;
  const normalized = postalCode.replace(/\s/g, "").toUpperCase();
  return prefixes.some((prefix) => normalized.startsWith(prefix.toUpperCase()));
}

function matchesRegion(
  regions: readonly string[],
  region: string | undefined,
): boolean {
  if (regions.length === 0 || region === undefined) return false;
  const normalized = region.trim().toUpperCase();
  return regions.some((value) => value.trim().toUpperCase() === normalized);
}

export interface TaxPlace {
  country: string;
  region?: string;
  postalCode?: string;
}

/**
 * The territory an address sits in on a given day. A carve-out row wins over
 * the country default because it names the region or the postal range; the
 * default is the row that names neither.
 */
export function territoryFor(
  ruleBook: TaxRuleBook,
  place: TaxPlace,
  day: string,
): TaxTerritoryRule | undefined {
  const country = place.country.trim().toUpperCase();
  const candidates = ruleBook.territories.filter(
    (territory) =>
      territory.country === country && withinWindow(territory, day),
  );
  const carveOut = candidates.find(
    (territory) =>
      matchesPostal(territory.postalPrefixes, place.postalCode) ||
      matchesRegion(territory.regions, place.region),
  );
  if (carveOut) return carveOut;
  return candidates.find(
    (territory) =>
      territory.regions.length === 0 && territory.postalPrefixes.length === 0,
  );
}

/**
 * The taxing authorities inside a territory that reach this address, in
 * stacking order. A territory whose rows carry no address filter answers with
 * all of them, which is the single country-level row a VAT territory has.
 */
export function taxingJurisdictions(
  ruleBook: TaxRuleBook,
  territory: TaxTerritoryRule,
  place: TaxPlace,
  day: string,
): readonly TaxJurisdictionRule[] {
  const inTerritory = ruleBook.jurisdictions.filter(
    (jurisdiction) =>
      jurisdiction.territoryId === territory.id &&
      withinWindow(jurisdiction, day),
  );
  const matched = inTerritory.filter(
    (jurisdiction) =>
      (jurisdiction.regions.length === 0 &&
        jurisdiction.postalPrefixes.length === 0) ||
      matchesRegion(jurisdiction.regions, place.region) ||
      matchesPostal(jurisdiction.postalPrefixes, place.postalCode),
  );
  return [...matched].sort(
    (left, right) =>
      left.sequence - right.sequence || left.id.localeCompare(right.id),
  );
}

/**
 * The rate a jurisdiction charges for a code. An exact code match wins over the
 * rule book's any-code row, and a row restricted to supply types only answers
 * for those.
 */
export function rateFor(
  ruleBook: TaxRuleBook,
  jurisdictionId: string,
  taxCode: string,
  supplyType: TaxSupplyType,
  day: string,
): TaxRateRule | undefined {
  const candidates = ruleBook.rates.filter(
    (rate) =>
      rate.jurisdictionId === jurisdictionId &&
      withinWindow(rate, day) &&
      (rate.supplyTypes.length === 0 || rate.supplyTypes.includes(supplyType)),
  );
  return (
    candidates.find((rate) => rate.taxCode === taxCode) ??
    candidates.find((rate) => rate.taxCode === anyTaxCode)
  );
}

export function schemeFor(
  ruleBook: TaxRuleBook,
  schemeId: string,
): TaxRegistrationSchemeRule | undefined {
  return ruleBook.schemes.find((scheme) => scheme.id === schemeId);
}

/**
 * Whether a registration on a scheme covers a territory. A union-scoped scheme
 * covers every territory in its union; a territory-scoped one covers the
 * territory it names.
 */
export function registrationCovers(
  scheme: TaxRegistrationSchemeRule,
  registrationJurisdiction: string,
  territory: TaxTerritoryRule,
): boolean {
  if (scheme.scope === "union")
    return (
      territory.unionId !== undefined && scheme.unionId === territory.unionId
    );
  return registrationJurisdiction === territory.id;
}

export function unionFor(
  ruleBook: TaxRuleBook,
  territory: TaxTerritoryRule,
): TaxUnionRule | undefined {
  if (territory.unionId === undefined) return undefined;
  return ruleBook.unions.find((union) => union.id === territory.unionId);
}

export function reverseChargeRule(
  union: TaxUnionRule | undefined,
  supplyType: TaxSupplyType,
): { available: boolean; legalBasis: string } | undefined {
  return union?.reverseCharge.find((rule) => rule.supplyType === supplyType);
}

export function notationFor(
  ruleBook: TaxRuleBook,
  treatment: TaxNotationRule["treatment"],
  territory: TaxTerritoryRule | undefined,
): string | undefined {
  const candidates = ruleBook.notations.filter(
    (notation) => notation.treatment === treatment,
  );
  return (
    candidates.find(
      (notation) =>
        territory !== undefined && notation.territoryId === territory.id,
    )?.text ??
    candidates.find(
      (notation) =>
        territory?.unionId !== undefined &&
        notation.unionId === territory.unionId,
    )?.text ??
    candidates.find(
      (notation) =>
        notation.territoryId === undefined && notation.unionId === undefined,
    )?.text
  );
}

/** Registers a number in this territory could sit on. */
export function schemesForTerritory(
  ruleBook: TaxRuleBook,
  territory: TaxTerritoryRule,
): readonly TaxRegistrationSchemeRule[] {
  return ruleBook.schemes.filter(
    (scheme) =>
      scheme.territories.includes(territory.id) ||
      (scheme.scope === "union" &&
        territory.unionId !== undefined &&
        scheme.unionId === territory.unionId),
  );
}

export function thresholdFor(
  ruleBook: TaxRuleBook,
  jurisdictionId: string,
): TaxRegistrationThresholdRule | undefined {
  return ruleBook.thresholds.find(
    (threshold) => threshold.jurisdictionId === jurisdictionId,
  );
}

export function roundingFor(
  territory: TaxTerritoryRule,
): TaxRoundingConvention {
  return territory.rounding;
}
