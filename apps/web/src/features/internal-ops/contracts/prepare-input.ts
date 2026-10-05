import { z } from "zod";
import type { TemplateField } from "@clockwork/contracts";

const text = (max: number) =>
  z.string().trim().max(max, { message: "too_big" });
const requiredText = (max: number) => text(max).min(1, { message: "required" });

function fieldSchema(field: TemplateField) {
  const max = field.maxLength ?? 200;
  const base =
    field.kind === "email"
      ? z.union([z.literal(""), z.email({ message: "email" }).max(254)])
      : field.kind === "date"
        ? z.union([z.literal(""), z.iso.date({ message: "invalid_format" })])
        : field.kind === "number"
          ? z.union([
              z.literal(""),
              z.string().regex(/^\d{1,12}$/, { message: "number" }),
            ])
          : field.kind === "choice"
            ? z.union([
                z.literal(""),
                z.enum(
                  (field.options ?? []).map((o) => o.value) as [
                    string,
                    ...string[],
                  ],
                  { message: "required" },
                ),
              ])
            : text(max);
  // A field left out of the submission is the same as one left empty.
  const trimmed = z.preprocess(
    (value) => value ?? "",
    z.string().trim().pipe(base),
  );
  return field.required
    ? trimmed.refine((value) => value !== "", { message: "required" })
    : trimmed;
}

/** What a seller enters to prepare a contract from one template. */
export function prepareInputSchema(fields: readonly TemplateField[]) {
  return z
    .object({
      id: z.uuid(),
      templateId: z.string().min(1).max(64),
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
      values: z
        .object(
          Object.fromEntries(
            fields.map((field) => [field.id, fieldSchema(field)]),
          ),
        )
        .strict(),
    })
    .strict();
}
export type PrepareInput = z.infer<ReturnType<typeof prepareInputSchema>>;
