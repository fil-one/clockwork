import type {
  TaxDeterminationRequest,
  TaxDeterminationResult,
  TaxDeterminationResultLine,
} from "@clockwork/contracts";
import type { DocumentLineItem, Money } from "@clockwork/documents/model";
import {
  RuleBookTaxDeterminationAdapter,
  seedTaxRuleBook,
} from "@clockwork/integrations/core";

import { ExperienceProblem } from "./model";

/**
 * The demo's tax determination.
 *
 * It is the SAME engine the authoritative repository determines against: the
 * rule-book adapter in `@clockwork/integrations` running
 * `@clockwork/domain/core`'s `determineTax` over a seeded rule book. Nothing
 * here computes a rate, a treatment, a notation or a legal basis — every one of
 * those is read off the determination the engine returns.
 *
 * That is the whole reason the engine was written pure. A demo that hand-mocked
 * `tax: "21%"` into a fixture would drift from the product the moment a rate
 * row changed, and the drift would be invisible: the demo would keep showing a
 * number that reconciles against nothing.
 */
const demoTaxAdapter = new RuleBookTaxDeterminationAdapter(seedTaxRuleBook());

/**
 * Determines, or refuses.
 *
 * A refusal is surfaced rather than swallowed. The production path fails closed
 * on a provider refusal instead of writing a zero, and a demo that quietly
 * dropped to "no tax" would show a behaviour the product does not have.
 */
export async function determineDemoTax(
  request: TaxDeterminationRequest,
): Promise<TaxDeterminationResult> {
  const result = await demoTaxAdapter.determine(request);
  if (!result.ok)
    throw new ExperienceProblem(
      502,
      result.code,
      `The demo tax determination was refused: ${result.message}`,
    );
  return result.value;
}

/** `65000` parts per million is `6.5%`. Trailing zeros are dropped. */
export function formatRatePpm(ratePpm: number): string {
  const percent = ratePpm / 10_000;
  return `${Number.parseFloat(percent.toFixed(4)).toString()}%`;
}

const treatmentWording: Readonly<Record<string, string>> = {
  standard: "Taxable",
  reverse_charge: "Reverse charge",
  zero_rated: "Zero-rated",
  exempt: "Exempt",
  out_of_scope: "Outside the scope",
  not_registered: "No registration held",
};

/**
 * The label a document line carries beside its amount.
 *
 * A line reaches one row per taxing authority, so a Seattle supply carries four
 * and a reverse-charged one carries a single row naming the customer's
 * territory. The label names each of them at its own rate, because a single
 * blended figure cannot say which authority is owed what — and the stacked case
 * is precisely what a US prospect asks about.
 */
export function taxLabelForLine(
  lines: readonly TaxDeterminationResultLine[],
): string {
  if (lines.length === 0) return "";
  return lines
    .map((line) =>
      line.treatment === "standard"
        ? `${line.jurisdiction} ${formatRatePpm(line.ratePpm)}`
        : `${line.jurisdiction} ${treatmentWording[line.treatment] ?? line.treatment}`,
    )
    .join(" · ");
}

/** The wording beside the tax total: the treatments the document actually has. */
export function taxTotalLabel(result: TaxDeterminationResult): string {
  const treatments = [
    ...new Set(result.totals.byTreatment.map((entry) => entry.treatment)),
  ];
  if (treatments.length === 1 && treatments[0] === "standard") return "Tax";
  return `Tax · ${treatments
    .map((treatment) => treatmentWording[treatment] ?? treatment)
    .join(", ")}`;
}

/**
 * The sentences the determination requires the document to carry.
 *
 * The reverse-charge statement is a legal requirement on the invoice, not
 * decoration, and the engine is the only thing that knows whether this supply
 * earned it. Every string here is copied from the determination: the notation
 * the rule book publishes, the statute each row cites, the place of supply, and
 * the book and version the answer is reproducible under.
 */
export function taxNotes(result: TaxDeterminationResult): readonly string[] {
  const notes: string[] = [];
  for (const notation of new Set(
    result.lines.map((line) => line.notation).filter(Boolean),
  ))
    notes.push(notation);
  for (const basis of new Set(
    result.lines.map(
      (line) =>
        `${line.jurisdiction} · ${treatmentWording[line.treatment] ?? line.treatment}${
          line.treatment === "standard"
            ? ` at ${formatRatePpm(line.ratePpm)}`
            : ""
        } · ${line.legalBasis}`,
    ),
  ))
    notes.push(basis);
  notes.push(`Place of supply: ${result.placeOfSupply.join(", ")}`);
  const book = result.lines[0];
  if (book)
    notes.push(
      `Determined under rule book ${book.ruleBookId} version ${book.ruleBookVersion}, rounding per ${result.rounding}, determination ${result.determinationId}.`,
    );
  return notes;
}

export interface DeterminedLineItem extends DocumentLineItem {
  readonly taxLabel: string;
}

/** Attaches each line's determined rows to the line the document prints. */
export function withTaxLabels(
  items: readonly DocumentLineItem[],
  result: TaxDeterminationResult,
): readonly DeterminedLineItem[] {
  return items.map((item) => ({
    ...item,
    taxLabel: taxLabelForLine(
      result.lines.filter((line) => line.lineId === item.id),
    ),
  }));
}

export function money(currency: Money["currency"], minorUnits: string): Money {
  return { currency, minorUnits };
}

/** The totals block, taken from the determination rather than restated. */
export function determinedTotals(result: TaxDeterminationResult) {
  // `Currency` in the contracts and `SupportedCurrency` in the documents model
  // are the same three-member union, so no assertion is needed or wanted here:
  // if either ever gains a member the other lacks, this must stop compiling.
  const currency: Money["currency"] = result.totals.currency;
  return {
    subtotal: money(currency, result.totals.netMinor),
    tax: money(currency, result.totals.taxMinor),
    taxLabel: taxTotalLabel(result),
    total: money(currency, result.totals.grossMinor),
  };
}
