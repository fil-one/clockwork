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
  /** Advances with each removal or restore; a stale change is refused. */
  version: number;
}

/** A document taken off its record. It stays in the history, unopenable. */
export interface RemovedAccountDocumentRecord extends AccountDocumentRecord {
  removedAt: string;
  removedByName: string;
  removalReason: string;
}

/**
 * Removing a document attached by mistake or superseded by a corrected copy.
 * The reason is required and kept; the row and its bytes are retained.
 */
export const AccountDocumentRemovalSchema = z
  .object({
    id: z.uuid(),
    expectedVersion: z.int().min(1),
    reason: line(500),
  })
  .strict();
export type AccountDocumentRemoval = z.infer<
  typeof AccountDocumentRemovalSchema
>;

/** Putting a removed document back on its record. */
export const AccountDocumentRestoreSchema = z
  .object({ id: z.uuid(), expectedVersion: z.int().min(1) })
  .strict();
