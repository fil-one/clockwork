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
/**
 * A quantity in the rate's own unit. An entry in another capacity unit
 * converts to it exactly: 1 PiB is 1,125.899906842624 TB, so up to 18
 * decimal places, as numeric(38,18) holds.
 */
const canonicalQuantity = z
  .string()
  .trim()
  .regex(/^(0|[1-9]\d{0,15})(\.\d{1,18})?$/, "number")
  .refine((value) => /[1-9]/.test(value), "too_small");
const termMonths = z.int().min(1).max(120);
const discountBps = z.int().min(0).max(10_000);
/** The entry rules, shared with contract template line items. */
export const pricingEntrySchemas = {
  quantity,
  canonicalQuantity,
  termMonths,
  discountBps,
};

/**
 * The capacity units a seller may enter: decimal TB and PB (1 TB is 1,000
 * GB) and binary TiB and PiB. Rates are priced per decimal TB-month.
 */
export const pricingCapacityUnits = ["TB", "PB", "TiB", "PiB"] as const;
export const PricingCapacityUnitSchema = z.enum(pricingCapacityUnits);

/** One line as the seller enters it. Prices are never taken from the browser. */
export const PricingScenarioLineInputSchema = z
  .object({
    bookId: z.guid(),
    rateId: z.guid(),
    quantity,
    /** The unit `quantity` is entered in; absent means the rate's own unit. */
    quantityUnit: PricingCapacityUnitSchema.optional(),
    termMonths,
    discountBps,
  })
  .strict();
export type PricingScenarioLineInput = z.infer<
  typeof PricingScenarioLineInputSchema
>;

const printableLine = (max: number) =>
  line(max).refine(
    (value) => pricingSummaryPrintable.test(value),
    "unprintable",
  );
const percentBps = z.int().min(0).max(10_000);
/** A price per capacity unit per month, in minor units of the scenario currency. */
const unitMinor = z.string().regex(/^(0|[1-9]\d{0,9})$/, "number");

/**
 * How a partner shares in a scenario, entered by the seller to size a
 * conversation. Indicative only: no policy cap or floor applies here, and
 * nothing is read from the price book's floors or transfer prices. A direct
 * scenario carries none.
 *
 * - referral: the customer buys from Fil One and the partner earns a
 *   commission on what the customer pays, at `commissionBps` from month 1 and
 *   at each step's rate from its month on.
 * - resale: the partner buys from Fil One and sets its own customer price.
 *   The seller gives Fil One's price to the partner or the partner's margin
 *   on its customer price; the other is derived.
 * - other: a share of what the customer pays, a fee per unit and a fixed
 *   monthly amount, in any combination.
 */
export const PricingPartnerEconomicsSchema = z
  .discriminatedUnion("model", [
    z
      .object({
        model: z.literal("referral"),
        partnerName: printableLine(120).optional(),
        commissionBps: percentBps,
        steps: z
          .array(
            z
              .object({
                fromMonth: z.int().min(2).max(120),
                commissionBps: percentBps,
              })
              .strict(),
          )
          .max(12)
          .default([])
          .refine(
            (steps) =>
              steps.every(
                (step, index) =>
                  index === 0 ||
                  step.fromMonth > (steps[index - 1]?.fromMonth ?? 0),
              ),
            "steps_order",
          ),
      })
      .strict(),
    z
      .object({
        model: z.literal("resale"),
        partnerName: printableLine(120).optional(),
        customerPriceMinor: unitMinor,
        buyPriceMinor: unitMinor.optional(),
        marginBps: percentBps.optional(),
      })
      .strict(),
    z
      .object({
        model: z.literal("other"),
        partnerName: printableLine(120).optional(),
        label: printableLine(80).optional(),
        partnerShareBps: percentBps.default(0),
        partnerPerUnitMinor: unitMinor.default("0"),
        partnerMonthlyMinor: z
          .string()
          .regex(/^(0|[1-9]\d{0,11})$/, "number")
          .default("0"),
      })
      .strict(),
  ])
  .superRefine((value, context) => {
    if (
      value.model === "resale" &&
      (value.buyPriceMinor === undefined) === (value.marginBps === undefined)
    )
      context.addIssue({
        code: "custom",
        message: "resale_basis",
        path: ["buyPriceMinor"],
      });
    // A partner cannot buy above its own price: that is a loss, not a margin.
    if (
      value.model === "resale" &&
      value.buyPriceMinor !== undefined &&
      /^\d+$/.test(value.buyPriceMinor) &&
      /^\d+$/.test(value.customerPriceMinor) &&
      BigInt(value.buyPriceMinor) > BigInt(value.customerPriceMinor)
    )
      context.addIssue({
        code: "custom",
        message: "buy_above_customer",
        path: ["buyPriceMinor"],
      });
  });
export type PricingPartnerEconomics = z.infer<
  typeof PricingPartnerEconomicsSchema
>;

/**
 * Whether a scenario has a partner summary: it has partner inputs and every
 * line is priced in one unit, since partner prices and fees apply per unit
 * across all lines.
 */
export function pricingPartnerSummaryAvailable(scenario: {
  lines: readonly { unit: string }[];
  partnerEconomics: PricingPartnerEconomics | null;
}) {
  return (
    scenario.partnerEconomics !== null &&
    scenario.lines.every((entry) => entry.unit === scenario.lines[0]?.unit)
  );
}

/**
 * Whether a scenario has a customer summary. A resale's customer summary is
 * the partner's quote at one price per unit, so it needs every line in one
 * unit; it never falls back to Fil One's list.
 */
export function pricingCustomerSummaryAvailable(scenario: {
  lines: readonly { unit: string }[];
  partnerEconomics: PricingPartnerEconomics | null;
}) {
  return (
    scenario.partnerEconomics?.model !== "resale" ||
    pricingPartnerSummaryAvailable(scenario)
  );
}

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
    partnerEconomics: PricingPartnerEconomicsSchema.nullable().default(null),
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
    /** In the rate's unit, so prices and minimums apply to it directly. */
    quantity: canonicalQuantity,
    /** What the seller typed when it was in another unit, for display. */
    entered: z
      .object({ quantity, unit: PricingCapacityUnitSchema })
      .strict()
      .optional(),
    /** The rate's egress terms, so a summary states free egress only when the book does. */
    egressTreatment: line(60).optional(),
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
  partnerEconomics: PricingPartnerEconomics | null;
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
