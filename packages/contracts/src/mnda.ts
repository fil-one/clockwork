import { z } from "zod";

const label = z
  .string()
  .trim()
  .min(1)
  .max(180)
  .refine((value) =>
    [...value].every((c) => c.charCodeAt(0) >= 32 && !"<>[]{}".includes(c)),
  )
  // The approved English template uses a PDF WinAnsi font. Fail rather than
  // silently dropping glyphs in a legal entity name or address.
  .regex(
    /^[\u0020-\u007e\u00a0-\u00ff\u0152\u0153\u0160\u0161\u0178\u0192\u02c6\u02dc\u2013\u2014\u2018-\u201a\u201c-\u201e\u2020-\u2022\u2026\u2030\u2039\u203a\u20ac]+$/u,
  );
export const MndaSignerSchema = z
  .object({
    id: z.uuid(),
    name: label,
    email: z
      .email()
      .max(254)
      .transform((v) => v.toLowerCase()),
    title: label,
    active: z.boolean(),
    isDefault: z.boolean(),
  })
  .strict();
export type MndaSigner = z.infer<typeof MndaSignerSchema>;
export const MndaInputSchema = z
  .object({
    id: z.uuid(),
    detailsMode: z.enum(["team", "recipient"]).optional(),
    company: label,
    shortName: z.union([label, z.literal("")]).default(""),
    entityDescription: z.union([label, z.literal("")]).default(""),
    streetAddress: z.union([label, z.literal("")]).default(""),
    locality: z.union([label, z.literal("")]).default(""),
    noticesContact: z.union([label, z.literal("")]).default(""),
    noticesEmail: z
      .union([z.email().max(254), z.literal("")])
      .default("")
      .transform((v) => v.toLowerCase()),
    signerName: label,
    signerEmail: z
      .email()
      .max(254)
      .transform((v) => v.toLowerCase()),
    signerTitle: z.union([label, z.literal("")]).default(""),
    countersignerId: z.uuid(),
    effectiveDate: z.iso.date(),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.detailsMode !== "recipient") {
      for (const key of [
        "shortName",
        "entityDescription",
        "streetAddress",
        "locality",
        "noticesContact",
        "noticesEmail",
        "signerTitle",
      ] as const)
        if (!input[key])
          ctx.addIssue({
            code: "custom",
            path: [key],
            message: "Required when our team supplies partner details",
          });
    }
  });
export const mndaRecipientFields = [
  { id: "company_intro", label: "Legal company name" },
  { id: "entity", label: "Jurisdiction and entity type" },
  { id: "email_intro", label: "Notice email", email: true },
  { id: "address_intro", label: "Full notice address" },
  { id: "short_name", label: "Company short name" },
  { id: "company_sign", label: "Legal company name" },
  { id: "signer_name", label: "Authorized signer full name" },
  { id: "signer_title", label: "Authorized signer title" },
  { id: "company_notice", label: "Legal company name" },
  { id: "notice_contact", label: "Notice contact name" },
  { id: "address_notice", label: "Full notice address" },
  { id: "email_notice", label: "Notice email", email: true },
] as const;
export type MndaInput = z.infer<typeof MndaInputSchema>;
export const mndaStates = [
  "draft",
  "preparing",
  "ready",
  "sending",
  "sent",
  "viewed",
  "awaiting_countersignature",
  "completed",
  "declined",
  "expired",
  "canceled",
  "attention",
] as const;
export type MndaState = (typeof mndaStates)[number];
export interface MndaRecord {
  id: string;
  input: MndaInput;
  countersigner: MndaSigner;
  ownerId: string;
  ownerName: string;
  state: MndaState;
  providerId: string | null;
  testMode: boolean;
  templateHash: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  error: string | null;
  version: number;
}
