import { CurrencySchema, MoneySchema } from "@clockwork/contracts";
import { z } from "zod";

import { PriceBookCloneCommandSchema, clonedDiscountMatrix } from "./clone";
import {
  validatePriceBook,
  type PriceBook,
  type RateCard,
  type DiscountMatrix,
} from "./index";

export const PRICE_BOOK_IMPORT_MAX_BYTES = 1_048_576;
const text = z
  .string()
  .min(1)
  .max(500)
  .refine((value) => value.trim().length > 0, "Text must not be blank");
const quantity = z
  .string()
  .regex(
    /^(0|[1-9]\d{0,19})(\.\d{1,18})?$/,
    "Use a non-negative decimal with at most 20 integer and 18 fractional digits",
  );
const money = MoneySchema.refine(
  (value) =>
    !/^-?(0|[1-9]\d*)$/.test(value.minor) ||
    (BigInt(value.minor) >= 0n &&
      BigInt(value.minor) <= 9_223_372_036_854_775_807n),
  "Minor units must fit a non-negative signed 64-bit integer",
);
const rateSchema = z
  .object({
    id: z.uuid(),
    sku: text,
    region: text,
    unit: text,
    approvedClaim: text,
    unitPrice: money,
    floorPrice: money.optional(),
    overageRate: money,
    minimumQuantity: quantity,
    trialLimit: quantity.optional(),
    egressTreatment: text,
    commitType: z.enum(["period_allowance", "term_drawdown"]),
    stripeTaxCode: text,
    qboIncomeAccount: text,
    partnerTransferPrices: z.preprocess(
      (value, context) => {
        // Zod intentionally drops this object key; reject it before parsing so
        // an exchange can never silently lose a configured transfer price.
        const reserved =
          value && typeof value === "object"
            ? ["__proto__", "constructor", "prototype"].find((key) =>
                Object.hasOwn(value, key),
              )
            : undefined;
        if (reserved) {
          context.addIssue({
            code: "custom",
            message: `Rename the reserved transfer tier ${reserved} before exchanging this price book`,
          });
          return z.NEVER;
        }
        return value;
      },
      z
        .record(
          z
            .string()
            .min(1)
            .max(100)
            .refine((value) => value.trim().length > 0),
          money,
        )
        .refine(
          (values) => Object.keys(values).length <= 100,
          "At most 100 transfer tiers are supported",
        ),
    ),
  })
  .strict()
  .transform(({ floorPrice, trialLimit, ...rate }): RateCard => ({
    ...rate,
    ...(floorPrice === undefined ? {} : { floorPrice }),
    ...(trialLimit === undefined ? {} : { trialLimit }),
  }));
const matrixSchema = z
  .object({
    id: text,
    version: z.int().min(0).max(2_147_483_647),
    defaultMaxDiscountBps: z.int().min(0).max(10000),
    rules: z
      .array(
        z
          .object({
            id: text,
            sku: text.optional(),
            region: text.optional(),
            route: z
              .enum([
                "direct",
                "referral",
                "resale",
                "distributor",
                "marketplace",
              ])
              .optional(),
            partnerTier: text.optional(),
            minTermMonths: z.int().positive().max(2_147_483_647).optional(),
            minQuantity: quantity.optional(),
            maxDiscountBps: z.int().min(0).max(10000),
          })
          .strict()
          .transform(
            ({
              sku,
              region,
              route,
              partnerTier,
              minTermMonths,
              minQuantity,
              ...rule
            }) => ({
              ...rule,
              ...(sku === undefined ? {} : { sku }),
              ...(region === undefined ? {} : { region }),
              ...(route === undefined ? {} : { route }),
              ...(partnerTier === undefined ? {} : { partnerTier }),
              ...(minTermMonths === undefined ? {} : { minTermMonths }),
              ...(minQuantity === undefined ? {} : { minQuantity }),
            }),
          ),
      )
      .max(100),
  })
  .strict();

/** Economics exchange deliberately has no approval, status, or provider-binding fields. */
export const PriceBookExchangeSchema = z
  .object({
    format: z.literal("clockwork.price-book.v2"),
    schemaVersion: z.literal(2),
    exportedAt: z.iso.datetime(),
    source: z
      .object({
        id: z.uuid(),
        name: text,
        version: z.int().positive().max(2_147_483_647),
        rowVersion: z.int().positive().max(2_147_483_647),
      })
      .strict(),
    currency: CurrencySchema,
    rateCards: z.array(rateSchema).min(1).max(250),
    discountMatrix: matrixSchema.optional(),
  })
  .strict()
  .superRefine((document, context) => {
    if (
      new Set(document.rateCards.map((rate) => rate.id)).size !==
      document.rateCards.length
    )
      context.addIssue({
        code: "custom",
        message: "Rate identities must be unique",
      });
    try {
      validatePriceBook({
        id: document.source.id,
        name: document.source.name,
        version: 1,
        currency: document.currency,
        effectiveFrom: "2000-01-01",
        status: "draft",
        rateCards: document.rateCards,
        ...(document.discountMatrix
          ? { discountMatrix: document.discountMatrix }
          : {}),
      });
    } catch (error) {
      context.addIssue({
        code: "custom",
        message:
          error instanceof Error
            ? error.message
            : "Price-book economics are invalid",
      });
    }
  });
export type PriceBookExchange = z.infer<typeof PriceBookExchangeSchema>;
export const PriceBookImportCommandSchema = PriceBookCloneCommandSchema.omit({
  sourceId: true,
  sourceRowVersion: true,
})
  .extend({ document: PriceBookExchangeSchema })
  .strict();

export function parsePriceBookExchange(value: unknown): PriceBookExchange {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  if (
    typeof serialized !== "string" ||
    new TextEncoder().encode(serialized).length > PRICE_BOOK_IMPORT_MAX_BYTES
  )
    throw new Error("Price-book JSON must be no larger than 1 MiB");
  return PriceBookExchangeSchema.parse(
    typeof value === "string" ? JSON.parse(value) : value,
  );
}

export function exportPriceBookExchange(
  book: {
    id: string;
    name: string;
    version: number;
    rowVersion: number;
    currency: string;
    rateCards?: readonly RateCard[];
    discountMatrix?: DiscountMatrix;
  },
  exportedAt: string,
): PriceBookExchange {
  return parsePriceBookExchange({
    format: "clockwork.price-book.v2",
    schemaVersion: 2,
    exportedAt,
    source: {
      id: book.id,
      name: book.name,
      version: book.version,
      rowVersion: book.rowVersion,
    },
    currency: book.currency,
    rateCards: book.rateCards ?? [],
    ...(book.discountMatrix ? { discountMatrix: book.discountMatrix } : {}),
  });
}

export function importedPriceBook(
  document: PriceBookExchange,
  target: { id: string; name: string; version: number; effectiveFrom: string },
  newRateId: () => string,
): PriceBook {
  if (target.id === document.source.id)
    throw new Error("An import requires a new price-book identity");
  return validatePriceBook({
    ...target,
    currency: document.currency,
    status: "draft",
    rateCards: document.rateCards.map((rate) => ({ ...rate, id: newRateId() })),
    ...(document.discountMatrix
      ? {
          discountMatrix: clonedDiscountMatrix(
            document.discountMatrix,
            target.id,
          ),
        }
      : {}),
  });
}
