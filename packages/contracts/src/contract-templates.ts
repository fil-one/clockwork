import { z } from "zod";
import { contractTypes } from "./contract-register";
import {
  PricingCapacityUnitSchema,
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
/** Help text: a longer note, such as counsel's comment on an open term. */
const HelpTextSchema = z
  .object({ en: z.string().min(1).max(600) })
  .extend(
    Object.fromEntries(
      locales.slice(1).map((l) => [l, z.string().min(1).max(600).optional()]),
    ) as Record<
      Exclude<(typeof locales)[number], "en">,
      z.ZodOptional<z.ZodString>
    >,
  )
  .strict();

export const templateFieldKinds = [
  "text",
  "email",
  "date",
  "choice",
  "number",
  "decimal",
  "percent",
  "line_items",
] as const;
export type TemplateFieldKind = (typeof templateFieldKinds)[number];

/**
 * What a typed value of each numeric kind looks like. `number` is a whole
 * number, `decimal` a non-negative amount with up to six decimal places and
 * `percent` a figure from 0 to 100 with up to four. There are no business
 * limits here: those belong to whoever approves the contract.
 */
export const templateNumberPatterns = {
  number: /^\d{1,12}$/,
  decimal: /^\d{1,15}(\.\d{1,6})?$/,
  percent: /^(100(\.0{1,4})?|\d{1,2}(\.\d{1,4})?)$/,
} as const;

/** Why a scalar value does not suit its field, or null when it does. */
export function templateValueIssue(
  field: {
    kind: TemplateFieldKind;
    options?: readonly { value: string }[] | undefined;
    maxLength?: number | undefined;
  },
  value: string,
):
  | "number"
  | "percent"
  | "email"
  | "invalid_format"
  | "required"
  | "too_big"
  | null {
  if (value === "") return null;
  switch (field.kind) {
    case "number":
    case "decimal":
      return templateNumberPatterns[field.kind].test(value) ? null : "number";
    case "percent":
      return templateNumberPatterns.percent.test(value) ? null : "percent";
    case "email":
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254
        ? null
        : "email";
    case "date":
      return /^\d{4}-\d{2}-\d{2}$/.test(value) &&
        !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
        ? null
        : "invalid_format";
    case "choice":
      return field.options?.some((option) => option.value === value)
        ? null
        : "required";
    case "line_items":
      return "invalid_format";
    default:
      return value.length > (field.maxLength ?? 200) ? "too_big" : null;
  }
}

/**
 * Whether text may be a printed value: drawable by the PDF fonts, with no
 * control characters and none of `< > [ ] { }`, which could form a token or a
 * signing tag. Seller values, choice options and defaults all follow it.
 */
export function printableTemplateValue(value: string) {
  return (
    !/[<>[\]{}\p{Cc}\p{Cf}\u2028\u2029]/u.test(value) &&
    undrawableTemplateCharacter(value) === null
  );
}

const sectionId = fieldId;
export const TemplateFieldSchema = z
  .object({
    id: fieldId,
    kind: z.enum(templateFieldKinds),
    required: z.boolean(),
    label: LocalizedTextSchema,
    help: HelpTextSchema.optional(),
    maxLength: z.number().int().min(1).max(2000).optional(),
    options: z
      .array(
        z
          .object({
            value: z.string().min(1).max(200),
            label: LocalizedTextSchema,
          })
          .strict(),
      )
      .min(2)
      .max(20)
      .optional(),
    /** The value the form starts with; the seller may change it. */
    default: z.string().max(2000).optional(),
    /** The optional section the field belongs to: asked for, and checked,
     * only when that section is in the contract. */
    section: sectionId.optional(),
  })
  .strict()
  .refine((f) => (f.kind === "choice") === Boolean(f.options), {
    message: "choice fields, and only choice fields, list options",
  })
  .refine(
    (f) =>
      f.kind !== "line_items" ||
      (f.required && f.maxLength === undefined && f.default === undefined),
    {
      message:
        "line_items fields are required and take no maxLength or default",
    },
  )
  .refine(
    (f) =>
      f.default === undefined ||
      f.kind === "line_items" ||
      templateValueIssue(f, f.default) === null,
    { message: "the default does not suit the field" },
  )
  .refine(
    (f) =>
      (f.default === undefined || printableTemplateValue(f.default)) &&
      (f.options ?? []).every((option) => printableTemplateValue(option.value)),
    {
      message:
        "option values and defaults print: use characters the PDF can draw, without < > [ ] { }",
    },
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
    // In the rate's unit, so a scenario entered in PiB imports exactly.
    quantity: pricingEntrySchemas.canonicalQuantity,
    /** The capacity as entered in another unit, printed beside the quantity. */
    entered: z
      .object({
        quantity: pricingEntrySchemas.quantity,
        unit: PricingCapacityUnitSchema,
      })
      .strict()
      .optional(),
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

// The PDF base fonts encode WinAnsi only. Template text and values outside
// it would be dropped silently, so they are refused instead.
const winAnsi: readonly (readonly [number, number])[] = [
  [0x20, 0x7e],
  [0xa0, 0xff],
  [0x152, 0x153],
  [0x160, 0x161],
  [0x178, 0x178],
  [0x192, 0x192],
  [0x2c6, 0x2c6],
  [0x2dc, 0x2dc],
  [0x2013, 0x2014],
  [0x2018, 0x201a],
  [0x201c, 0x201e],
  [0x2020, 0x2022],
  [0x2026, 0x2026],
  [0x2030, 0x2030],
  [0x2039, 0x203a],
  [0x20ac, 0x20ac],
];
/** The first character a contract PDF cannot draw, or null. Tabs and line
 * breaks inside a paragraph are allowed; they print as spaces and breaks. */
export function undrawableTemplateCharacter(value: string): string | null {
  for (const character of value) {
    if (character === "\n" || character === "\t") continue;
    const point = character.codePointAt(0) ?? 0;
    if (!winAnsi.some(([from, to]) => point >= from && point <= to))
      return character;
  }
  return null;
}

const templateKey = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/);
/** Text with `[[token]]` placeholders and `**bold**` runs. */
const blockText = (max: number) => z.string().min(1).max(max);
const inSection = { section: sectionId.optional() };
const tableRow = z.array(z.string().max(4000)).min(1).max(6);
const block = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("heading"), text: blockText(500), ...inSection })
    .strict(),
  z
    .object({
      type: z.literal("paragraph"),
      text: blockText(20_000),
      ...inSection,
    })
    .strict(),
  z.object({ type: z.literal("pageBreak"), ...inSection }).strict(),
  /** A ruled table; with `header`, the first row is its heading.
   * `widths` are relative column widths, such as [1, 3]; equal without. */
  z
    .object({
      type: z.literal("table"),
      header: z.boolean().default(true),
      widths: z.array(z.number().min(1).max(100)).min(1).max(6).optional(),
      rows: z.array(tableRow).min(1).max(80),
      ...inSection,
    })
    .strict()
    .refine(
      (t) =>
        !t.widths ||
        t.widths.length === Math.max(...t.rows.map((row) => row.length)),
      { message: "widths needs one entry per column" },
    ),
]);
export type TemplateBlock = z.infer<typeof block>;

/**
 * A part of the agreement that is in or out per contract: an option, a
 * schedule or an annex. The seller ticks it on the form, starting from
 * `default`, unless `when` ties it to a choice field: it is then in exactly
 * when that field holds one of the listed values.
 */
export const TemplateSectionSchema = z
  .object({
    id: sectionId,
    label: LocalizedTextSchema,
    help: HelpTextSchema.optional(),
    default: z.boolean().default(false),
    when: z
      .object({
        field: fieldId,
        in: z.array(z.string().min(1).max(200)).min(1).max(20),
      })
      .strict()
      .optional(),
  })
  .strict();
export type TemplateSection = z.infer<typeof TemplateSectionSchema>;

/**
 * A figure worked out from numeric fields, such as an illustrative
 * commission. `percent_of` takes a percent and an amount; `product` and
 * `sum` take two or more operands. An operand is a numeric field, an earlier
 * derived figure or a plain number. The result prints with thousands
 * separators and `decimals` places, rounded half up.
 */
export const TemplateDerivedSchema = z
  .object({
    id: fieldId,
    op: z.enum(["percent_of", "product", "sum"]),
    of: z
      .array(z.string().regex(/^([a-z][a-z0-9_]{0,47}|\d{1,15}(\.\d{1,6})?)$/))
      .min(2)
      .max(10),
    decimals: z.int().min(0).max(6).default(0),
    section: sectionId.optional(),
  })
  .strict()
  .refine((d) => d.op !== "percent_of" || d.of.length === 2, {
    message: "percent_of takes a percent and an amount",
  });
export type TemplateDerived = z.infer<typeof TemplateDerivedSchema>;

const contentShape = {
  id: templateKey,
  contractType: z.enum(contractTypes),
  name: z.string().trim().min(1).max(120),
  requiresApproval: z.boolean(),
  /** Where the wording came from, such as "Counsel draft 8 Sept 2026,
   * clean". Kept with the template; never printed. */
  sourceNote: z.string().trim().max(200).optional(),
  fields: z.array(TemplateFieldSchema).max(80),
  sections: z.array(TemplateSectionSchema).max(30).default([]),
  derived: z.array(TemplateDerivedSchema).max(20).default([]),
  document: z
    .object({
      title: z.string().min(1).max(200),
      blocks: z.array(block).min(1).max(3000),
    })
    .strict(),
};

const tokenPattern = /\[\[([^\]]*)\]\]/g;
/** The `[[token]]` names in a piece of template text. */
export function templateTokens(text: string): string[] {
  return [...text.matchAll(tokenPattern)].map(([, token]) => token ?? "");
}

type TemplateShape = z.infer<z.ZodObject<typeof contentShape>>;

/** Cross-checks a template: unique ids, declared tokens, sections and
 * derived figures that resolve, and text the PDF can draw. */
function checkTemplate(file: TemplateShape, ctx: z.RefinementCtx) {
  const issue = (path: (string | number)[], message: string) =>
    ctx.addIssue({ code: "custom", path, message });
  const fields = new Map(file.fields.map((f) => [f.id, f]));
  const derived = new Map(file.derived.map((d) => [d.id, d]));
  const sections = new Map(file.sections.map((s) => [s.id, s]));
  const reserved = new Set<string>(standardTemplateTokens);
  const seen = new Set<string>();
  for (const [index, id] of [
    ...file.fields.map((f) => ["fields", f.id] as const),
    ...file.derived.map((d) => ["derived", d.id] as const),
  ].entries()) {
    if (reserved.has(id[1]) || seen.has(id[1]))
      issue([id[0]], `duplicate or reserved id ${id[1]} (${index})`);
    seen.add(id[1]);
  }
  if (sections.size !== file.sections.length)
    issue(["sections"], "duplicate section id");
  for (const [index, f] of file.fields.entries())
    if (f.section && !sections.has(f.section))
      issue(["fields", index, "section"], `unknown section ${f.section}`);
  for (const [index, s] of file.sections.entries()) {
    if (!s.when) continue;
    const driver = fields.get(s.when.field);
    if (!driver || driver.kind !== "choice" || driver.section)
      issue(
        ["sections", index, "when"],
        `${s.when.field} must be a choice field outside any section`,
      );
    else
      for (const value of s.when.in)
        if (!driver.options?.some((option) => option.value === value))
          issue(
            ["sections", index, "when"],
            `${value} is not an option of ${s.when.field}`,
          );
  }
  const numeric = new Set(["number", "decimal", "percent"]);
  const earlier = new Set<string>();
  for (const [index, d] of file.derived.entries()) {
    if (d.section && !sections.has(d.section))
      issue(["derived", index, "section"], `unknown section ${d.section}`);
    for (const operand of d.of) {
      if (/^\d/.test(operand)) continue;
      const field = fields.get(operand);
      const owner = field ? field.section : derived.get(operand)?.section;
      if (
        field
          ? !numeric.has(field.kind) || !field.required
          : !earlier.has(operand)
      )
        issue(
          ["derived", index, "of"],
          `${operand} must be a required numeric field or an earlier derived figure`,
        );
      else if (owner && owner !== d.section)
        issue(
          ["derived", index, "of"],
          `${operand} belongs to section ${owner}`,
        );
    }
    earlier.add(d.id);
  }
  const tables = new Set(
    file.fields.filter((f) => f.kind === "line_items").map((f) => f.id),
  );
  const checkText = (
    text: string,
    path: (string | number)[],
    section: string | undefined,
    tableAllowed: boolean,
  ) => {
    const bad = undrawableTemplateCharacter(text);
    if (bad)
      issue(
        path,
        `U+${(bad.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")} (${bad}) cannot be printed`,
      );
    if ((text.match(/\*\*/g)?.length ?? 0) % 2)
      issue(path, "unbalanced ** bold marker");
    // Braces never appear in template text, so no arrangement of bold
    // markers or empty values can print a signing tag.
    if (/[{}]/.test(text)) issue(path, "{ and } are reserved for signing tags");
    for (const token of templateTokens(text)) {
      const owner = fields.has(token)
        ? fields.get(token)?.section
        : derived.get(token)?.section;
      if (!reserved.has(token) && !fields.has(token) && !derived.has(token))
        issue(path, `undeclared token [[${token}]]`);
      else if (owner && owner !== section)
        issue(path, `[[${token}]] belongs to section ${owner}`);
      // A table is a block of its own: a paragraph holding only its token.
      if (tables.has(token) && (!tableAllowed || text !== `[[${token}]]`))
        issue(path, `[[${token}]] must be a paragraph of its own`);
    }
  };
  for (const [index, b] of file.document.blocks.entries()) {
    const path = ["document", "blocks", index];
    if (b.section && !sections.has(b.section))
      issue([...path, "section"], `unknown section ${b.section}`);
    if (b.type === "heading" || b.type === "paragraph")
      checkText(b.text, path, b.section, b.type === "paragraph");
    if (b.type === "table")
      for (const [r, row] of b.rows.entries())
        for (const [c, cell] of row.entries())
          checkText(cell, [...path, "rows", r, c], b.section, false);
  }
  checkText(file.document.title, ["document", "title"], undefined, false);
  checkText(file.name, ["name"], undefined, false);
  if (templateTokens(file.name).length)
    issue(["name"], "the name cannot hold tokens");
}

/**
 * A contract template's content: agreement wording as blocks with
 * `[[field]]` tokens, the fields a seller fills in, optional sections and
 * derived figures. This is the JSON an administrator imports, and what the
 * template store versions. See `docs/operations/contract-templates.md`.
 */
export const TemplateContentSchema = z
  .object(contentShape)
  .strict()
  .superRefine(checkTemplate);
export type TemplateContent = z.infer<typeof TemplateContentSchema>;

/** A template kept in code, for tests and the guided demo: its content with
 * a fixed version label. Live templates are kept in the template store. */
export const TemplateFileSchema = z
  .object({ ...contentShape, version: z.string().min(1).max(40) })
  .strict()
  .superRefine(checkTemplate);
export type TemplateFile = z.infer<typeof TemplateFileSchema>;

/** Keys sorted at every depth, so equal content serializes identically. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [
          key,
          canonical((value as Record<string, unknown>)[key]),
        ]),
    );
  return value;
}

/**
 * The text a template's content hash is taken over: the parsed content,
 * defaults filled in, keys sorted, without the source note. Two templates
 * with the same wording, fields and sections hash the same.
 */
export function templateContentJson(content: TemplateContent): string {
  const hashed: Partial<TemplateContent> = { ...content };
  delete hashed.sourceNote;
  return JSON.stringify(canonical(hashed));
}

/** The sections a contract includes: ticked ones, and those a choice field
 * turns on. `ticked` holds the seller's own choices. */
export function includedTemplateSections(
  template: { sections: readonly TemplateSection[] },
  ticked: readonly string[],
  values: Readonly<Record<string, unknown>>,
): Set<string> {
  return new Set(
    template.sections
      .filter((section) =>
        section.when
          ? section.when.in.some(
              (value) => value === values[section.when?.field ?? ""],
            )
          : ticked.includes(section.id),
      )
      .map((section) => section.id),
  );
}

export const contractTemplateStatuses = ["draft", "active", "retired"] as const;
export type ContractTemplateStatus = (typeof contractTemplateStatuses)[number];

/** One version of a template in the template store, without its content. */
export interface ContractTemplateVersionSummary {
  id: string;
  key: string;
  version: number;
  /** The label prepared contracts print and pin, `v<version>`. */
  versionLabel: string;
  name: string;
  contractType: (typeof contractTypes)[number];
  status: ContractTemplateStatus;
  sourceNote: string;
  contentHash: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  activatedByName: string | null;
  activatedAt: string | null;
  retiredByName: string | null;
  retiredAt: string | null;
  revision: number;
}

/** A version with its content and how many contracts were prepared from it. */
export interface ContractTemplateVersionRecord extends ContractTemplateVersionSummary {
  content: TemplateContent;
  /** Why the stored content cannot be used, such as a hash mismatch; the
   * content shown is then a placeholder and only retiring is offered. */
  problem: "CONTRACT_TEMPLATE_INTEGRITY" | "CONTRACT_TEMPLATE_INVALID" | null;
  usedBy: number;
}

/** The label a stored version prints and pins. */
export const templateVersionLabel = (version: number) => `v${version}`;
