import { z } from "zod";

import {
  DomesticTreatmentSchema,
  TaxJurisdictionRuleSchema,
  TaxNotationRuleSchema,
  TaxRegistrationSchemeRuleSchema,
  TaxRegistrationThresholdRuleSchema,
  TaxRuleBookSchema,
  TaxSupplyTypeSchema,
  TaxTerritoryRuleSchema,
  TaxUnionRuleSchema,
  type TaxRuleBook,
} from "./rule-book";

/**
 * THE PERSISTED RULE BOOKS, ASSEMBLED INTO THE ONE THE ENGINE READS.
 *
 * `core_tax_rule_books` (001411) is one row PER JURISDICTION: GB's rates, then
 * Spain's, then Washington's. `determineTax` takes ONE book that has to
 * describe BOTH sides of the supply, because place of supply is a comparison
 * and a book that knows only the customer's country cannot make it. So the
 * persisted rows are composed, which is not a workaround — `TaxRateRule`
 * carries `ruleBookId`/`ruleBookVersion` per ROW precisely "for a book composed
 * from several per-jurisdiction books" (rule-book.ts:159).
 *
 * WHERE THE NON-RATE PARAMETERS COME FROM. 001411 states it: `rule_parameters`
 * is "where the algorithm's non-rate parameters live … everything an accountant
 * might amend that is not a rate". This module reads them from
 * `rule_parameters -> 'engine'`, in the engine's own vocabulary, and REFUSES a
 * book that carries none. It does not default them. A missing territory is not
 * an empty territory: defaulting one would answer a place-of-supply question
 * nobody has stated an answer to, which is the class of invention this whole
 * effort exists to stop.
 *
 * WHAT IS DELIBERATELY NOT HERE: no country list, no rate, no union membership,
 * no postal range and no scheme. Every one of those is a row in the database.
 * The only thing this file knows about the world is how to merge two JSON
 * documents.
 */

/** Raised when the persisted books cannot produce a book the engine can read. */
export class PersistedTaxRuleBookError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PersistedTaxRuleBookError";
  }
}

/**
 * The engine fragment one persisted book contributes.
 *
 * `territory` is stated by a COUNTRY-level book and by nothing else: a US state
 * book contributes a taxing jurisdiction inside the United States, not a
 * territory of its own, and two books each declaring "US" differently would be
 * two answers to one question.
 */
export const PersistedEngineFragmentSchema = z
  .object({
    territory: TaxTerritoryRuleSchema.optional(),
    jurisdictions: z.array(TaxJurisdictionRuleSchema).default([]),
    unions: z.array(TaxUnionRuleSchema).default([]),
    schemes: z.array(TaxRegistrationSchemeRuleSchema).default([]),
    notations: z.array(TaxNotationRuleSchema).default([]),
    thresholds: z.array(TaxRegistrationThresholdRuleSchema).default([]),
    rateKindTreatments: z
      .record(z.string(), DomesticTreatmentSchema)
      .default({}),
    /**
     * Which taxing jurisdiction this book's `core_tax_rates` rows belong to.
     * Defaults to the book's own jurisdiction, which is the case for every book
     * whose rates are its own; a book that publishes rates for a jurisdiction
     * it is not named after says so here rather than by convention.
     */
    rateJurisdictionId: z.string().trim().min(1).max(120).optional(),
    /** Restricts this book's rates to certain supply types, when it does. */
    rateSupplyTypes: z.array(TaxSupplyTypeSchema).default([]),
  })
  .strict();
export type PersistedEngineFragment = z.infer<
  typeof PersistedEngineFragmentSchema
>;

export interface PersistedTaxRate {
  taxCode: string;
  rateKind: string;
  /** Parts per million, as `core_tax_rates.rate_ppm` holds it. */
  ratePpm: number;
  legalBasis: string;
  notation: string;
}

export interface PersistedTaxRuleBookRow {
  id: string;
  jurisdiction: string;
  version: number;
  effectiveFrom: string;
  effectiveTo?: string | undefined;
  determinationSource: string;
  inputProvenance: string;
  ruleParameters: unknown;
  rates: readonly PersistedTaxRate[];
}

/** Which persisted book published an answer, by the place the answer names. */
export interface RuleBookAttribution {
  ruleBookId: string;
  ruleBookVersion: number;
}

export interface ComposedTaxRuleBook {
  ruleBook: TaxRuleBook;
  /**
   * Place id — a taxing jurisdiction or a territory — to the persisted book
   * that published it.
   *
   * The engine attributes a rate row to the book the ROW came from, but a
   * reverse charge, an export and a non-registration are conclusions rather
   * than rates and carry the containing book's pin. A composed book has no
   * single persisted identity to give them, so every place is mapped back to
   * the book that declared it and the caller re-attributes. Without this the
   * pin on those rows would be an assembly's synthetic id, and
   * `core_invoice_tax_lines.rule_book_id` would have nothing real to reference.
   */
  attribution: ReadonlyMap<string, RuleBookAttribution>;
  /** The persisted books this composition read, in the order they were given. */
  sources: readonly PersistedTaxRuleBookRow[];
}

function fragmentOf(row: PersistedTaxRuleBookRow): PersistedEngineFragment {
  const parameters = row.ruleParameters;
  const engine =
    parameters && typeof parameters === "object" && !Array.isArray(parameters)
      ? (parameters as Record<string, unknown>).engine
      : undefined;
  if (engine === undefined)
    throw new PersistedTaxRuleBookError(
      "TAX_RULE_BOOK_ENGINE_PARAMETERS_MISSING",
      `Rule book ${row.jurisdiction} v${row.version} (${row.id}) states no engine parameters; a determination is refused rather than defaulted`,
    );
  const parsed = PersistedEngineFragmentSchema.safeParse(engine);
  if (!parsed.success)
    throw new PersistedTaxRuleBookError(
      "TAX_RULE_BOOK_ENGINE_PARAMETERS_INVALID",
      `Rule book ${row.jurisdiction} v${row.version} (${row.id}) states engine parameters the engine cannot read: ${parsed.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`).join("; ")}`,
    );
  return parsed.data;
}

/**
 * Composes the persisted books into one rule book.
 *
 * Every book is required to be readable. A composition that silently dropped
 * the book it could not parse would answer with the rest — the customer's
 * jurisdiction missing, the supplier's export rule missing — and produce a
 * confident wrong number instead of a refusal.
 */
export function composeTaxRuleBook(
  rows: readonly PersistedTaxRuleBookRow[],
): ComposedTaxRuleBook {
  if (rows.length === 0)
    throw new PersistedTaxRuleBookError(
      "TAX_RULE_BOOK_UNRESOLVED",
      "No rule book answers for this supply on this tax point",
    );
  const provider = rows.find((row) => row.determinationSource !== "local");
  if (provider)
    throw new PersistedTaxRuleBookError(
      "TAX_RULE_BOOK_DELEGATED",
      `Rule book ${provider.jurisdiction} v${provider.version} is determined by an external provider (${provider.determinationSource}), and no provider is wired to this path`,
    );

  const attribution = new Map<string, RuleBookAttribution>();
  const territories: TaxRuleBook["territories"] = [];
  const jurisdictions: TaxRuleBook["jurisdictions"] = [];
  const unions: TaxRuleBook["unions"] = [];
  const schemes: TaxRuleBook["schemes"] = [];
  const notations: TaxRuleBook["notations"] = [];
  const thresholds: TaxRuleBook["thresholds"] = [];
  const rates: TaxRuleBook["rates"] = [];
  const rateKindTreatments: Record<string, string> = {};

  const claim = (place: string, row: PersistedTaxRuleBookRow) => {
    const held = attribution.get(place);
    if (held && held.ruleBookId !== row.id)
      throw new PersistedTaxRuleBookError(
        "TAX_RULE_BOOK_PLACE_CONFLICT",
        `Two persisted rule books both declare ${place}: ${held.ruleBookId} and ${row.id}`,
      );
    attribution.set(place, {
      ruleBookId: row.id,
      ruleBookVersion: row.version,
    });
  };

  for (const row of rows) {
    const fragment = fragmentOf(row);
    if (fragment.territory) {
      territories.push(fragment.territory);
      claim(fragment.territory.id, row);
    }
    for (const jurisdiction of fragment.jurisdictions) {
      jurisdictions.push(jurisdiction);
      claim(jurisdiction.id, row);
    }
    unions.push(...fragment.unions);
    schemes.push(...fragment.schemes);
    notations.push(...fragment.notations);
    thresholds.push(...fragment.thresholds);
    for (const [kind, treatment] of Object.entries(
      fragment.rateKindTreatments,
    )) {
      const held = rateKindTreatments[kind];
      if (held !== undefined && held !== treatment)
        throw new PersistedTaxRuleBookError(
          "TAX_RULE_BOOK_RATE_KIND_CONFLICT",
          `Two persisted rule books disagree about what rate kind ${kind} means: ${held} and ${treatment}`,
        );
      rateKindTreatments[kind] = treatment;
    }
    const rateJurisdiction = fragment.rateJurisdictionId ?? row.jurisdiction;
    for (const rate of row.rates)
      rates.push({
        jurisdictionId: rateJurisdiction,
        taxCode: rate.taxCode,
        supplyTypes: fragment.rateSupplyTypes,
        rateKind: rate.rateKind,
        ratePpm: rate.ratePpm,
        legalBasis: rate.legalBasis,
        ...(rate.notation ? { notation: rate.notation } : {}),
        // The rate's own book and version, so a composed answer still says
        // which published matrix charged it.
        ruleBookId: row.id,
        ruleBookVersion: row.version,
        effectiveFrom: row.effectiveFrom,
        ...(row.effectiveTo ? { effectiveTo: row.effectiveTo } : {}),
      });
  }

  // Deduplicated by id: a union, scheme or notation stated identically by two
  // member states' books is one rule, and the engine reads the first match.
  const unique = <T extends { id: string }>(values: readonly T[]): T[] => {
    const seen = new Set<string>();
    return values.filter((value) =>
      seen.has(value.id) ? false : (seen.add(value.id), true),
    );
  };

  const ruleBook = TaxRuleBookSchema.parse({
    // The assembly is not a published book and does not pretend to be one.
    // Every row it emits is attributed to a real one before it is persisted.
    id: "composed",
    version: 0,
    effectiveFrom: rows
      .map((row) => row.effectiveFrom)
      .reduce((earliest, value) => (value < earliest ? value : earliest)),
    unions: unique(unions),
    rateKindTreatments,
    territories,
    jurisdictions,
    rates,
    schemes: unique(schemes),
    notations,
    thresholds,
  });

  return { ruleBook, attribution, sources: rows };
}
