import {
  mndaSigningFields,
  type MndaDetailFieldId,
  type MndaFieldError,
  type MndaInput,
  type MndaRecord,
  type MndaSigner,
} from "@clockwork/contracts";
import type { MessageId } from "@/src/i18n";

/** Modes a new draft may use. Drafts made in the retired partner-completes
 * mode ("recipient") reopen in the default mode. */
export type DetailsMode = "team" | "mixed";
export const detailsModes: readonly DetailsMode[] = ["mixed", "team"];

/** The form's own state. `shortName` null follows the legal name. */
export interface MndaFormValues {
  detailsMode: DetailsMode;
  signerName: string;
  signerEmail: string;
  company: string;
  shortName: string | null;
  entityDescription: string;
  streetAddress: string;
  locality: string;
  noticesContact: string;
  noticesEmail: string;
  signerTitle: string;
  effectiveDate: string;
  countersignerId: string;
}
export type MndaFormField = Exclude<keyof MndaFormValues, "detailsMode">;

/** Details the partner may leave for later; required when our team enters them. */
export const knownDetailFields = [
  "entityDescription",
  "streetAddress",
  "locality",
  "noticesContact",
  "noticesEmail",
  "signerTitle",
] as const satisfies readonly MndaFormField[];
/** Focus order for the first invalid field. */
export const formFieldOrder: readonly MndaFormField[] = [
  "signerName",
  "signerEmail",
  "company",
  "shortName",
  ...knownDetailFields,
  "effectiveDate",
  "countersignerId",
];

export const fieldLabels: Record<MndaFormField, MessageId> = {
  company: "operations.mnda.company",
  shortName: "operations.mnda.shortName",
  entityDescription: "operations.mnda.entityDescription",
  streetAddress: "operations.mnda.streetAddress",
  locality: "operations.mnda.locality",
  noticesContact: "operations.mnda.noticesContact",
  noticesEmail: "operations.mnda.noticesEmail",
  signerName: "operations.mnda.signerName",
  signerEmail: "operations.mnda.signerEmail",
  signerTitle: "operations.mnda.signerTitle",
  effectiveDate: "operations.mnda.effectiveDate",
  countersignerId: "operations.mnda.countersigner",
};
/** Partner-completed signing fields, by the form field a seller knows. */
const signingFieldOwners: Record<MndaDetailFieldId, MndaFormField> = {
  company_intro: "company",
  company_sign: "company",
  company_notice: "company",
  entity: "entityDescription",
  email_intro: "noticesEmail",
  email_notice: "noticesEmail",
  address_intro: "streetAddress",
  address_notice: "streetAddress",
  street_intro: "streetAddress",
  street_notice: "streetAddress",
  locality_intro: "locality",
  locality_notice: "locality",
  short_name: "shortName",
  signer_name: "signerName",
  signer_title: "signerTitle",
  notice_contact: "noticesContact",
};
/** The details the partner fills in while signing, once each. */
export function partnerCompletes(input: MndaInput): MndaFormField[] {
  return [
    ...new Set(
      mndaSigningFields(input).map(({ id }) => signingFieldOwners[id]),
    ),
  ];
}

export function today(now = new Date()) {
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10);
}
export function emptyValues(signers: readonly MndaSigner[]): MndaFormValues {
  return {
    detailsMode: "mixed",
    signerName: "",
    signerEmail: "",
    company: "",
    shortName: null,
    entityDescription: "",
    streetAddress: "",
    locality: "",
    noticesContact: "",
    noticesEmail: "",
    signerTitle: "",
    effectiveDate: today(),
    countersignerId:
      signers.find((s) => s.isDefault && s.active)?.id ??
      signers.find((s) => s.active)?.id ??
      "",
  };
}
/**
 * Prefills the form from an existing request. Editing keeps its date;
 * sending again starts today. `clearSigner` is for sending to someone else.
 * A partner-completes draft held an internal reference, not the legal name,
 * so its copy starts in the default mode with the legal name to enter.
 */
export function valuesFromRecord(
  record: MndaRecord,
  signers: readonly MndaSigner[],
  options: { keepDate: boolean; clearSigner?: boolean },
): MndaFormValues {
  const input = record.input;
  const mode = input.detailsMode ?? "team";
  const reference = mode === "recipient";
  const countersigner = signers.find(
    (s) => s.id === input.countersignerId && s.active,
  );
  return {
    ...emptyValues(signers),
    detailsMode: mode === "recipient" ? "mixed" : mode,
    signerName: options.clearSigner ? "" : input.signerName,
    signerEmail: options.clearSigner
      ? ""
      : (record.correctedSignerEmail ?? input.signerEmail),
    signerTitle: options.clearSigner ? "" : input.signerTitle,
    company: reference ? "" : input.company,
    shortName:
      !input.shortName || input.shortName === input.company
        ? null
        : input.shortName,
    entityDescription: input.entityDescription,
    streetAddress: input.streetAddress,
    locality: input.locality,
    noticesContact: input.noticesContact,
    noticesEmail: input.noticesEmail,
    ...(options.keepDate ? { effectiveDate: input.effectiveDate } : {}),
    ...(countersigner ? { countersignerId: countersigner.id } : {}),
  };
}
/** The server input. */
export function inputFromValues(id: string, values: MndaFormValues) {
  return {
    id,
    detailsMode: values.detailsMode,
    company: values.company,
    shortName: values.shortName ?? values.company,
    entityDescription: values.entityDescription,
    streetAddress: values.streetAddress,
    locality: values.locality,
    noticesContact: values.noticesContact,
    noticesEmail: values.noticesEmail,
    signerName: values.signerName,
    signerEmail: values.signerEmail,
    signerTitle: values.signerTitle,
    countersignerId: values.countersignerId,
    effectiveDate: values.effectiveDate,
  };
}

/** Browser checks run first so a seller sees every problem at once. */
export function localErrors(
  values: MndaFormValues,
  signers: readonly MndaSigner[],
): MndaFieldError[] {
  const errors: MndaFieldError[] = [];
  const required: MndaFormField[] = ["signerName", "signerEmail", "company"];
  if (values.detailsMode === "team") required.push(...knownDetailFields);
  for (const field of required)
    if (!String(values[field] ?? "").trim())
      errors.push({ field, code: "required" });
  for (const field of ["signerEmail", "noticesEmail"] as const) {
    const value = values[field].trim();
    if (value && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value))
      errors.push({ field, code: "invalid_email" });
  }
  const countersigner = signers.find((s) => s.id === values.countersignerId);
  if (!countersigner)
    errors.push({
      field: "countersignerId",
      code: "countersigner_unavailable",
    });
  else if (
    values.signerEmail.trim().toLowerCase() ===
    countersigner.email.toLowerCase()
  )
    errors.push({ field: "signerEmail", code: "same_as_countersigner" });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(values.effectiveDate))
    errors.push({ field: "effectiveDate", code: "invalid_date" });
  return errors.filter(
    (error, index) =>
      errors.findIndex((e) => e.field === error.field) === index,
  );
}
