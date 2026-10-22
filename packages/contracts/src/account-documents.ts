import { z } from "zod";

/** Staff attachments belong to exactly one saved partner record or account. */
export const AccountDocumentTargetSchema = z
  .object({
    type: z.enum(["partner", "account"]),
    id: z.guid(),
  })
  .strict();
export type AccountDocumentTarget = z.infer<typeof AccountDocumentTargetSchema>;
export const accountDocumentKinds = ["mnda", "agreement", "other"] as const;
export type AccountDocumentKind = (typeof accountDocumentKinds)[number];
const line = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine(
      (value) =>
        [...value].every((character) => {
          const code = character.charCodeAt(0);
          return code >= 32 && code !== 127;
        }),
      "control_character",
    );
export const AccountDocumentInputSchema = z
  .object({
    id: z.uuid(),
    title: line(200),
    kind: z.enum(accountDocumentKinds),
    signedOn: z
      .union([z.iso.date(), z.literal(""), z.null()])
      .transform((value) => value || null)
      .default(null),
  })
  .strict();
export type AccountDocumentInput = z.infer<typeof AccountDocumentInputSchema>;
export interface AccountDocumentRecord extends AccountDocumentInput {
  fileName: string;
  sizeBytes: number;
  uploadedByName: string;
  createdAt: string;
}
