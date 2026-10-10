import { z } from "zod";
import { MoneySchema, type Currency, type Money } from "./primitives";

/**
 * Saved indicative pricing scenarios: several list-price lines a seller
 * prices for one prospect. Every figure is indicative and list price only;
 * signed prices wait on EXT-COMMERCIAL-01.
 */
export const pricingScenarioLineLimit = 20;
export const pricingScenarioListLimit = 100;

const noControl = (value: string) =>
  [...value].every((c) => c.charCodeAt(0) >= 32);
const line = (max: number) =>
  z.string().trim().min(1).max(max).refine(noControl, "control_character");
// Notes keep newlines and tabs but no other control characters.
const notes = (max: number) =>
  z
    .string()
    .max(max)
    .refine(
      (value) =>
        [...value].every((c) => {
          const code = c.charCodeAt(0);
          return code >= 32 || code === 9 || code === 10 || code === 13;
        }),
      "control_character",
    );
/**
 * What the indicative summary PDF can draw: its embedded faces cover Latin
 * scripts and common punctuation only, so a company outside them is refused
 * when it is saved rather than when the summary is downloaded.
 */
export const pricingSummaryPrintable =
  /^[\u0020-\u007e\u00a0-\u024f\u02b0-\u036f\u1e00-\u1eff\u2000-\u206f\u20ac\u2122]*$/u;
/** A positive quantity with at most six decimal places, as rate cards hold. */
const quantity = z
  .string()
  .trim()
  .regex(/^(0|[1-9]\d{0,11})(\.\d{1,6})?$/, "number")
  .refine((value) => /[1-9]/.test(value), "too_small");
const termMonths = z.int().min(1).max(120);
const discountBps = z.int().min(0).max(10_000);
/** The entry rules, shared with contract template line items. */
export const pricingEntrySchemas = { quantity, termMonths, discountBps };

/** One line as the seller enters it. Prices are never taken from the browser. */
export const PricingScenarioLineInputSchema = z
  .object({
    bookId: z.guid(),
    rateId: z.guid(),
    quantity,
    termMonths,
    discountBps,
  })
  .strict();
export type PricingScenarioLineInput = z.infer<
  typeof PricingScenarioLineInputSchema
>;

/** A new scenario, or an overwrite of `id` when `expectedVersion` is given. */
export const PricingScenarioInputSchema = z
  .object({
    id: z.uuid(),
    name: line(120),
    company: line(200).refine(
      (value) => pricingSummaryPrintable.test(value),
      "unprintable",
    ),
    notes: notes(2000).default(""),
    lines: z
      .array(PricingScenarioLineInputSchema)
      .min(1)
      .max(pricingScenarioLineLimit),
    expectedVersion: z.int().min(1).optional(),
  })
  .strict();

/**
 * A saved line: the entry plus the list price and rate details read from the
 * price book in force when it was saved. Floors, transfer prices, claims and
 * accounting codes have no place here.
 */
export const PricingScenarioLineSchema = z
  .object({
    bookId: z.guid(),
    bookVersion: z.int().min(1),
    rateId: z.guid(),
    sku: line(120),
    region: line(120),
    unit: line(60),
    unitPrice: MoneySchema,
    minimumQuantity: z.string().regex(/^\d{1,18}(\.\d{1,18})?$/),
    quantity,
    termMonths,
    discountBps,
  })
  .strict();
export type PricingScenarioLine = z.infer<typeof PricingScenarioLineSchema>;

export const PricingScenarioLinesSchema = z
  .array(PricingScenarioLineSchema)
  .min(1)
  .max(pricingScenarioLineLimit)
  .refine(
    (lines) =>
      lines.every(
        (entry) => entry.unitPrice.currency === lines[0]?.unitPrice.currency,
      ),
    "currency_mismatch",
  );

export const PricingScenarioBooksSchema = z
  .array(z.object({ id: z.guid(), version: z.int().min(1) }).strict())
  .min(1)
  .max(pricingScenarioLineLimit);

export interface PricingScenarioRecord {
  id: string;
  ownerId: string;
  ownerName: string;
  name: string;
  company: string;
  notes: string;
  currency: Currency;
  /** The day the lines were priced: the books in force then are `priceBooks`. */
  asOf: string;
  priceBooks: readonly { id: string; version: number }[];
  lines: readonly PricingScenarioLine[];
  createdAt: string;
  updatedAt: string;
  version: number;
}

/** A row of the scenario list, its total recomputed from the saved lines. */
export interface PricingScenarioSummary {
  id: string;
  ownerId: string;
  ownerName: string;
  name: string;
  company: string;
  currency: Currency;
  asOf: string;
  updatedAt: string;
  version: number;
  lineCount: number;
  total: Money;
}
