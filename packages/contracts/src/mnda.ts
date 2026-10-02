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
const optionalLabel = z
  .string()
  .trim()
  .pipe(z.union([label, z.literal("")]))
  .default("");
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
    detailsMode: z.enum(["team", "recipient", "mixed"]).optional(),
    company: label,
    shortName: optionalLabel,
    entityDescription: optionalLabel,
    streetAddress: optionalLabel,
    locality: optionalLabel,
    noticesContact: optionalLabel,
    noticesEmail: z
      .union([z.email().max(254), z.literal("")])
      .default("")
      .transform((v) => v.toLowerCase()),
    signerName: label,
    signerEmail: z
      .email()
      .max(254)
      .transform((v) => v.toLowerCase()),
    signerTitle: optionalLabel,
    countersignerId: z.uuid(),
    effectiveDate: z.iso.date(),
  })
  .strict()
  .transform((input) => ({
    ...input,
    shortName:
      input.detailsMode === "recipient"
        ? input.shortName
        : input.shortName || input.company,
  }))
  .superRefine((input, ctx) => {
    if (!input.detailsMode || input.detailsMode === "team") {
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

const mixedAddressFields = [
  { id: "street_intro", label: "Street address" },
  { id: "locality_intro", label: "City, region, postal code, country" },
  { id: "street_notice", label: "Street address" },
  { id: "locality_notice", label: "City, region, postal code, country" },
] as const;
export const mndaDetailFields = [...mndaRecipientFields, ...mixedAddressFields];
export type MndaDetailFieldId = (typeof mndaDetailFields)[number]["id"];

/** A supplied value is printed in the agreement; only a missing value becomes
 * a required recipient field. Legacy recipient-only drafts keep their tags. */
export function mndaDetailValue(
  input: MndaInput,
  id: MndaDetailFieldId,
): string {
  const values: Record<MndaDetailFieldId, string> = {
    company_intro: input.company,
    company_sign: input.company,
    company_notice: input.company,
    entity: input.entityDescription,
    email_intro: input.noticesEmail,
    email_notice: input.noticesEmail,
    address_intro: [input.streetAddress, input.locality]
      .filter(Boolean)
      .join(", "),
    address_notice: [input.streetAddress, input.locality]
      .filter(Boolean)
      .join(", "),
    street_intro: input.streetAddress,
    street_notice: input.streetAddress,
    locality_intro: input.locality,
    locality_notice: input.locality,
    short_name: input.shortName || input.company,
    signer_name: input.signerName,
    signer_title: input.signerTitle,
    notice_contact: input.noticesContact,
  };
  return values[id];
}

export function mndaSigningFields(input: MndaInput) {
  if (input.detailsMode === "recipient") return [...mndaRecipientFields];
  if (input.detailsMode !== "mixed") return [];
  return mndaDetailFields.filter(
    ({ id }) =>
      id !== "address_intro" &&
      id !== "address_notice" &&
      !mndaDetailValue(input, id),
  );
}
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
