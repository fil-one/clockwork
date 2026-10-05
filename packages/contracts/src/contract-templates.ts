import { z } from "zod";
import { contractTypes } from "./contract-register";

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
    kind: z.enum(["text", "email", "date", "choice", "number"]),
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
  });
export type TemplateField = z.infer<typeof TemplateFieldSchema>;

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
    if (declared.size !== standardTemplateTokens.length + file.fields.length)
      ctx.addIssue({
        code: "custom",
        path: ["fields"],
        message: "duplicate or reserved field id",
      });
    for (const [index, b] of file.document.blocks.entries())
      if ("text" in b)
        for (const [, token] of b.text.matchAll(/\[\[([^\]]*)\]\]/g))
          if (!declared.has(token ?? ""))
            ctx.addIssue({
              code: "custom",
              path: ["document", "blocks", index],
              message: `undeclared token [[${token}]]`,
            });
  });
export type TemplateFile = z.infer<typeof TemplateFileSchema>;
