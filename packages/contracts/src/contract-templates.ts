import { z } from "zod";
import { contractTypes } from "./contract-register";
import {
  pricingEntrySchemas,
  pricingScenarioLineLimit,
  pricingSummaryPrintable,
} from "./pricing-scenarios";
import { CurrencySchema, type Money } from "./primitives";

/**
 * The file format of a contract template (see
 * `docs/operations/contract-templates.md`). Rendering lives in
 * `@clockwork/documents`; the format is here so every layer can validate it.
 */
const locales = ["en", "es", "fr", "de", "ja", "pt", "zh", "ar"] as const;
/** Labels shown to staff. English is required; a missing language shows
 * the English label. */
export const LocalizedTextSchema = z
  .object({ en: z.string().min(1).max(200) })
  .extend(
    Object.fromEntries(
      locales.slice(1).map((l) => [l, z.string().min(1).max(200).optional()]),
    ) as Record<
      Exclude<(typeof locales)[number], "en">,
      z.ZodOptional<z.ZodString>
    >,
  )
  .strict();
export type LocalizedText = z.infer<typeof LocalizedTextSchema>;

const fieldId = z.string().regex(/^[a-z][a-z0-9_]{0,47}$/);
export const TemplateFieldSchema = z
  .object({
    id: fieldId,
    kind: z.enum(["text", "email", "date", "choice", "number", "line_items"]),
    required: z.boolean(),
    label: LocalizedTextSchema,
    help: LocalizedTextSchema.optional(),
    maxLength: z.number().int().min(1).max(500).optional(),
    options: z
      .array(
        z
          .object({
            value: z.string().min(1).max(80),
            label: LocalizedTextSchema,
          })
          .strict(),
      )
      .min(2)
      .max(20)
      .optional(),
  })
  .strict()
  .refine((f) => (f.kind === "choice") === Boolean(f.options), {
    message: "choice fields, and only choice fields, list options",
  })
  .refine(
    (f) => f.kind !== "line_items" || (f.required && f.maxLength === undefined),
    { message: "line_items fields are required and take no maxLength" },
  );
export type TemplateField = z.infer<typeof TemplateFieldSchema>;

/** The most rows one line-item table carries: as many as a pricing scenario. */
export const templateLineItemLimit = pricingScenarioLineLimit;

// What a table cell may hold: the pricing summary's printable set, which its
// embedded fonts draw, less the brackets and braces that could form a
// template token or a SignWell text tag, and less invisible format
// characters (zero-width marks, bidirectional overrides, line and paragraph
// separators) that could make the printed text read differently from the
// stored value.
const printableCell = (value: string) =>
  pricingSummaryPrintable.test(value) &&
  !/[<>[\]{}\p{Cf}\u2028\u2029]/u.test(value);
const cell = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { message: "too_big" })
    .refine(printableCell, "characters");
const requiredCell = (max: number) =>
  cell(max).refine((value) => value !== "", "required");
/** Non-negative integer minor units, as text so JSON never loses precision. */
const minor = z.string().regex(/^(0|[1-9]\d{0,17})$/, "number");

/**
 * One row of a line-item table. Quantity, term and discount follow the
 * pricing scenario rules. The server replaces `minimumQuantity` when a
 * contract is prepared: the minimum of the in-force rate with the same item,
 * region and unit, or "0" when no rate matches. `extendedMinor` is the row's
 * price over its term after the discount, as `indicativeLinePrice` computes
 * it; a row whose figure differs is refused wherever the table is checked.
 * `scenarioLine` is the index of the pricing scenario line the row was
 * imported from, if any.
 */
export const TemplateLineItemSchema = z
  .object({
    sku: requiredCell(120),
    description: cell(200).default(""),
    region: cell(120).default(""),
    unit: requiredCell(60),
    quantity: pricingEntrySchemas.quantity,
    termMonths: pricingEntrySchemas.termMonths,
    unitPriceMinor: minor,
    minimumQuantity: z
      .string()
      .regex(/^\d{1,18}(\.\d{1,18})?$/, "number")
      .default("0"),
    discountBps: pricingEntrySchemas.discountBps,
    extendedMinor: minor,
    scenarioLine: z
      .int()
      .min(0)
      .max(templateLineItemLimit - 1)
      .optional(),
  })
  .strict();
export type TemplateLineItem = z.infer<typeof TemplateLineItemSchema>;

/**
 * The value of a `line_items` field: rows in one currency and, when they were
 * imported, the pricing scenario they came from as it stood at import: its
 * name, version and the day its list prices were read.
 */
export const TemplateLineItemsSchema = z
  .object({
    currency: CurrencySchema,
    scenario: z
      .object({
        id: z.uuid(),
        name: z
          .string()
          .trim()
          .min(1)
          .max(120)
          .refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value), "characters"),
        version: z.int().min(1),
        asOf: z.iso.date(),
      })
      .strict()
      .optional(),
    rows: z
      .array(TemplateLineItemSchema)
      .min(1, { message: "required" })
      .max(templateLineItemLimit, { message: "too_big" }),
  })
  .strict();
export type TemplateLineItems = z.infer<typeof TemplateLineItemsSchema>;

/** A field's value: text for the scalar kinds, a table for `line_items`. */
export type TemplateValue = string | TemplateLineItems;

/** The rows as `indicativeScenarioPrice` takes them. */
export function templateLineItemPricingLines(items: TemplateLineItems) {
  return items.rows.map((row) => ({
    unitPrice: { currency: items.currency, minor: row.unitPriceMinor } as Money,
    minimumQuantity: row.minimumQuantity,
    quantity: row.quantity,
    termMonths: row.termMonths,
    discountBps: row.discountBps,
  }));
}

/** Values every template receives without declaring them. */
export const standardTemplateTokens = [
  "counterparty_name",
  "effective_date",
  "signer_name",
  "signer_email",
  "signer_title",
  "countersigner_name",
  "countersigner_title",
] as const;

const block = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("heading"), text: z.string().min(1).max(500) })
    .strict(),
  z
    .object({
      type: z.literal("paragraph"),
      text: z.string().min(1).max(20_000),
    })
    .strict(),
  z.object({ type: z.literal("pageBreak") }).strict(),
]);
export type TemplateBlock = z.infer<typeof block>;

export const TemplateFileSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
    contractType: z.enum(contractTypes),
    name: z.string().min(1).max(120),
    version: z.string().min(1).max(40),
    requiresApproval: z.boolean(),
    source: z
      .object({
        path: z.string().min(1),
        sha256: z.string().regex(/^[0-9a-f]{64}$/),
        counselApprovedBy: z.string().min(1).max(120),
        counselApprovedOn: z.iso.date(),
      })
      .strict(),
    fields: z.array(TemplateFieldSchema).max(60),
    document: z
      .object({
        title: z.string().min(1).max(200),
        blocks: z.array(block).min(1),
      })
      .strict(),
  })
  .strict()
  .superRefine((file, ctx) => {
    const declared = new Set<string>([
      ...standardTemplateTokens,
      ...file.fields.map((f) => f.id),
    ]);
    const tables = new Set(
      file.fields.filter((f) => f.kind === "line_items").map((f) => f.id),
    );
    if (declared.size !== standardTemplateTokens.length + file.fields.length)
      ctx.addIssue({
        code: "custom",
        path: ["fields"],
        message: "duplicate or reserved field id",
      });
    for (const [index, b] of file.document.blocks.entries())
      if ("text" in b)
        for (const [, token] of b.text.matchAll(/\[\[([^\]]*)\]\]/g)) {
          if (!declared.has(token ?? ""))
            ctx.addIssue({
              code: "custom",
              path: ["document", "blocks", index],
              message: `undeclared token [[${token}]]`,
            });
          // A table is a block of its own: a paragraph holding only its token.
          if (
            tables.has(token ?? "") &&
            (b.type !== "paragraph" || b.text !== `[[${token}]]`)
          )
            ctx.addIssue({
              code: "custom",
              path: ["document", "blocks", index],
              message: `[[${token}]] must be a paragraph of its own`,
            });
        }
    for (const [, token] of file.document.title.matchAll(/\[\[([^\]]*)\]\]/g))
      if (tables.has(token ?? ""))
        ctx.addIssue({
          code: "custom",
          path: ["document", "title"],
          message: `[[${token}]] cannot be part of the title`,
        });
  });
export type TemplateFile = z.infer<typeof TemplateFileSchema>;
