import {
  TemplateLineItemsSchema,
  templateLineItemPricingLines,
  type PricingScenarioRecord,
  type TemplateLineItems,
} from "@clockwork/contracts";
import {
  compareQuantities,
  indicativeScenarioPrice,
} from "@clockwork/domain/core";

// Codes a nested issue keeps; anything else reads as "check every line".
const reported = new Set(["required", "too_big", "characters"]);
const issueCode = (message: string | undefined) =>
  message && reported.has(message) ? message : "line_items";

/** Rate minimums by item, region and unit; see `rateMinimums`. */
export type RateMinimums = ReadonlyMap<string, string>;

const rateKey = (row: { sku: string; region: string; unit: string }) =>
  JSON.stringify([row.sku, row.region, row.unit]);

/**
 * The minimum quantity of every rate in the given books, by item, region and
 * unit. Where two books price the same item, region and unit, the higher
 * minimum applies.
 */
export function rateMinimums(
  books: readonly {
    rateCards?:
      | readonly {
          sku: string;
          region: string;
          unit: string;
          minimumQuantity: string;
        }[]
      | undefined;
  }[],
): RateMinimums {
  const minimums = new Map<string, string>();
  for (const book of books)
    for (const rate of book.rateCards ?? []) {
      const key = rateKey(rate);
      const current = minimums.get(key);
      if (
        current === undefined ||
        compareQuantities(rate.minimumQuantity, current) > 0
      )
        minimums.set(key, rate.minimumQuantity);
    }
  return minimums;
}

/**
 * A line-item table checked by the pricing scenario rules: one currency, no
 * row below its rate's minimum, and every extended price equal to what
 * `indicativeScenarioPrice` computes. A refusal is one field-level code.
 *
 * With `minimums`, as the server checks it, each row's minimum is replaced
 * by its rate's minimum, or "0" for a row that matches no rate, whatever the
 * browser sent. Without, the row's own minimum is used, as the editor shows.
 */
export function checkLineItems(
  value: unknown,
  minimums?: RateMinimums,
):
  | {
      ok: true;
      value: TemplateLineItems;
      totals: ReturnType<typeof indicativeScenarioPrice>;
    }
  | { ok: false; code: string } {
  if (value === undefined || value === null || value === "")
    return { ok: false, code: "required" };
  const parsed = TemplateLineItemsSchema.safeParse(value);
  if (!parsed.success)
    return {
      ok: false,
      code: issueCode(
        parsed.error.issues.find((issue) => reported.has(issue.message))
          ?.message,
      ),
    };
  const items = minimums
    ? {
        ...parsed.data,
        rows: parsed.data.rows.map((row) => ({
          ...row,
          minimumQuantity: minimums.get(rateKey(row)) ?? "0",
        })),
      }
    : parsed.data;
  const totals = indicativeScenarioPrice(templateLineItemPricingLines(items));
  if (totals.lines.some((line) => line.belowMinimum))
    return { ok: false, code: "below_minimum" };
  if (
    totals.lines.some(
      (line, index) => line.total.minor !== items.rows[index]?.extendedMinor,
    )
  )
    return { ok: false, code: "line_total" };
  return { ok: true, value: items, totals };
}

/**
 * A saved scenario's lines as table rows: the same list prices, entries and
 * minimums, priced as the scenario prices them, each linked to its scenario
 * line, with the scenario's name, version and as-of day. Or the first line
 * the table cannot carry, with the reason.
 */
export function scenarioLineItems(
  scenario: Pick<
    PricingScenarioRecord,
    "id" | "name" | "version" | "asOf" | "currency" | "lines"
  >,
):
  | { ok: true; lineItems: TemplateLineItems }
  | { ok: false; line: number; code: string } {
  const priced = indicativeScenarioPrice(scenario.lines);
  const parsed = TemplateLineItemsSchema.safeParse({
    currency: scenario.currency,
    scenario: {
      id: scenario.id,
      name: scenario.name,
      version: scenario.version,
      asOf: scenario.asOf,
    },
    rows: scenario.lines.map((line, index) => ({
      sku: line.sku,
      description: "",
      region: line.region,
      unit: line.unit,
      quantity: line.quantity,
      termMonths: line.termMonths,
      unitPriceMinor: line.unitPrice.minor,
      minimumQuantity: line.minimumQuantity,
      discountBps: line.discountBps,
      extendedMinor: priced.lines[index]?.total.minor ?? "",
      scenarioLine: index,
    })),
  });
  if (parsed.success) return { ok: true, lineItems: parsed.data };
  const issue = parsed.error.issues[0];
  const index = issue?.path[0] === "rows" ? Number(issue.path[1]) : 0;
  return { ok: false, line: index + 1, code: issueCode(issue?.message) };
}

/**
 * The register's pricing note for a table imported from a pricing scenario,
 * checked against the scenario as it is now. It vouches for list prices only
 * when the scenario is still the version imported and every row is linked to
 * a scenario line whose item, region, unit, unit price, currency, minimum
 * and discount it still carries. Otherwise it says the lines were edited, and
 * which, or that the scenario has changed since.
 */
export function scenarioNote(
  items: TemplateLineItems,
  current: Pick<PricingScenarioRecord, "id" | "name" | "version" | "lines">,
) {
  const imported = items.scenario;
  if (!imported) return "";
  const named = `Line items imported from pricing scenario "${current.name}" (${current.id}) version ${imported.version}`;
  if (current.version !== imported.version)
    return `${named}; the scenario has changed since, so its prices were not checked against these lines.`;
  const edited = items.rows.flatMap((row, index) => {
    const line =
      row.scenarioLine === undefined
        ? undefined
        : current.lines[row.scenarioLine];
    const same =
      line !== undefined &&
      line.sku === row.sku &&
      line.region === row.region &&
      line.unit === row.unit &&
      line.unitPrice.currency === items.currency &&
      line.unitPrice.minor === row.unitPriceMinor &&
      compareQuantities(line.minimumQuantity, row.minimumQuantity) === 0 &&
      line.discountBps === row.discountBps;
    return same ? [] : [index + 1];
  });
  if (edited.length)
    return `${named}, then edited (${edited.length === 1 ? "line" : "lines"} ${edited.join(", ")}).`;
  return `${named}, list prices as of ${imported.asOf}.`;
}
