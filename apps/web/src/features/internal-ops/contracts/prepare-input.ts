import { z } from "zod";
import {
  includedTemplateSections,
  templateValueIssue,
  type TemplateField,
  type TemplateSection,
  type TemplateValue,
} from "@clockwork/contracts";
import { checkLineItems, type RateMinimums } from "./line-items";

const text = (max: number) =>
  z.string().trim().max(max, { message: "too_big" });
const requiredText = (max: number) => text(max).min(1, { message: "required" });

// A table is refused at the field's own path, with one code for the form.
// Each row's minimum comes from `minimums`, never from the browser.
const lineItems = (minimums: RateMinimums) =>
  z.unknown().transform((value, ctx) => {
    const checked = checkLineItems(value, minimums);
    if (checked.ok) return checked.value;
    ctx.addIssue({ code: "custom", message: checked.code });
    return z.NEVER;
  });

function fieldSchema(field: TemplateField, minimums: RateMinimums) {
  if (field.kind === "line_items") return lineItems(minimums);
  const max = field.maxLength ?? 200;
  // A field left out of the submission is the same as one left empty.
  const trimmed = z.preprocess(
    (value) => value ?? "",
    z
      .string()
      .trim()
      .max(field.kind === "text" ? max : 254, { message: "too_big" })
      .transform((value, ctx) => {
        const issue = templateValueIssue(field, value);
        if (issue) ctx.addIssue({ code: "custom", message: issue });
        return field.kind === "email" ? value.toLowerCase() : value;
      }),
  );
  return field.required
    ? trimmed.refine((value) => value !== "", { message: "required" })
    : trimmed;
}

/** What the prepare form needs to know about a template. */
export interface PrepareTemplate {
  fields: readonly TemplateField[];
  sections: readonly TemplateSection[];
}

/**
 * What a seller enters to prepare a contract from one template version.
 * `sections` lists the optional sections the seller ticked; a field of a
 * section the contract leaves out is neither asked for nor kept. `minimums`
 * holds the in-force rate minimums a line-item table is checked against.
 */
export function prepareInputSchema(
  template: PrepareTemplate,
  minimums: RateMinimums,
) {
  const toggles = new Set(
    template.sections.filter((s) => !s.when).map((s) => s.id),
  );
  const known = new Set(template.fields.map((field) => field.id));
  return z
    .object({
      id: z.uuid(),
      templateId: z.string().min(1).max(64),
      templateVersion: z.string().min(1).max(40),
      counterpartyName: requiredText(200),
      effectiveDate: z.iso.date({ message: "required" }),
      signerName: requiredText(120),
      signerEmail: z
        .email({ message: "email" })
        .max(254)
        .transform((v) => v.toLowerCase()),
      signerTitle: requiredText(120),
      countersignerId: z.uuid({ message: "required" }),
      ownerName: requiredText(120),
      sections: z
        .array(z.string().max(48))
        .max(30)
        .default([])
        .transform((ids) => [...new Set(ids)].filter((id) => toggles.has(id))),
      values: z.record(z.string(), z.unknown()),
    })
    .strict()
    .transform((input, ctx) => {
      for (const key of Object.keys(input.values))
        if (!known.has(key))
          ctx.addIssue({
            code: "custom",
            path: ["values", key],
            message: "unrecognized_keys",
          });
      // Sections follow the choice values as they are checked and printed:
      // trimmed, so a padded value cannot include wording the check skipped.
      const included = includedTemplateSections(
        template,
        input.sections,
        Object.fromEntries(
          Object.entries(input.values).map(([key, value]) => [
            key,
            typeof value === "string" ? value.trim() : value,
          ]),
        ),
      );
      const asked = template.fields.filter(
        (field) => !field.section || included.has(field.section),
      );
      const values = z
        .object(
          Object.fromEntries(
            asked.map((field) => [field.id, fieldSchema(field, minimums)]),
          ),
        )
        .safeParse(input.values);
      if (!values.success) {
        for (const issue of values.error.issues)
          ctx.addIssue({
            code: "custom",
            path: ["values", ...issue.path.map(String)],
            message: issue.message,
          });
        return z.NEVER;
      }
      return {
        ...input,
        values: values.data,
      };
    });
}
export type PrepareInput = z.infer<ReturnType<typeof prepareInputSchema>>;

/** The key a signing request keeps the ticked sections under. Field ids
 * start with a letter, so it can never be a field's. */
export const preparedSectionsKey = "_sections";

/** What a preparation starts from when it replaces an earlier contract from
 * the same template, for a different counterparty signer. */
export interface PrepareStart {
  counterpartyName: string;
  effectiveDate: string | null;
  ownerName: string;
  countersignerId: string;
  /** Text values, and a line-item table where the template has one. */
  values: Record<string, TemplateValue>;
  /** The optional sections the earlier contract included. */
  sections: string[];
}
