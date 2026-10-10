import type { ContractSigningRecord } from "./contract-register";
import {
  mndaDetailFields,
  mndaSearchableDetailFields,
  mndaSigningFields,
  type MndaRecord,
  type MndaState,
} from "./mnda";

/** Every signing request moves through these states, whatever its type. */
export type SigningState = MndaState;

/** One required field SignWell must hold for a signer, exactly once. A text
 * field names the `api_id` its text tag carries. */
export interface SigningField {
  type: string;
  apiId?: string;
}

/** A person who signs, by SignWell recipient id. */
export interface SigningSlot<R> {
  id: string;
  /** Signing order; 1 signs first. */
  order: number;
  fields(record: R): readonly SigningField[];
  /** Staff may replace this signer's email after sending, while they have
   * not started signing. */
  correctable: boolean;
}

/** A text field the first signer completes whose value is kept on the
 * request with completion. */
export interface SigningCapture {
  apiId: string;
  /** The register search matches the kept value. */
  searchable: boolean;
}

/**
 * What differs between one kind of signed document and another. The signing
 * rules themselves (bind before send, re-read on every wakeup, archive the
 * executed PDF with completion) are the same for every type.
 */
export interface SigningDocumentType<R> {
  /** SignWell metadata key holding the request id. */
  bindingKey: string;
  slots: readonly SigningSlot<R>[];
  /** Shown to signers as the SignWell document name. */
  documentName(record: R): string;
  /** The uploaded PDF's name. */
  fileName(record: R): string;
  subject(record: R): string;
  message(record: R): string;
  /** `two_person`: someone other than the preparer approves before sending. */
  approval: "none" | "two_person";
  /** Copies the sender on the completed document. */
  copySender: boolean;
  /** Error codes read `<prefix>_NOT_PENDING`. */
  errorPrefix: string;
  /** History events read `<prefix>.voided`. */
  auditPrefix: string;
  /** Fields whose values the first signer's completed copy keeps. Only the
   * ones a request asked that signer for are read; the store must be able
   * to keep them. */
  capture?: readonly SigningCapture[];
}

/** A signature and its date, required of every signer. */
export const signatureFields: readonly SigningField[] = [
  { type: "signature" },
  { type: "autofill_date_signed" },
];

/** The partner signs first and fills in any company details left blank,
 * then the Fil One countersigner signs. */
export const mndaSigning: SigningDocumentType<MndaRecord> = {
  bindingKey: "commerce_mnda_id",
  slots: [
    {
      id: "counterparty",
      order: 1,
      fields: (r) => [
        ...signatureFields,
        ...mndaSigningFields(r.input).map(({ id }) => ({
          type: "text",
          apiId: id,
        })),
      ],
      correctable: true,
    },
    {
      id: "fil-one",
      order: 2,
      fields: () => signatureFields,
      correctable: false,
    },
  ],
  // Partner-facing. In the partner-completes mode the company field is only
  // an internal reference, so it is never shown to the partner.
  documentName: (r) =>
    r.input.detailsMode === "recipient"
      ? "Mutual NDA: Fil One"
      : `Mutual NDA: Fil One and ${r.input.company}`,
  fileName: () => "Fil-One-MNDA.pdf",
  subject: () => "Fil One: Mutual Non-Disclosure Agreement",
  message: () =>
    "Please review and sign the mutual non-disclosure agreement. Fil One will countersign and you will receive the completed agreement.",
  approval: "none",
  copySender: true,
  errorPrefix: "MNDA",
  auditPrefix: "mnda",
  // Kept so the register finds the MNDA by what the partner entered, not
  // only by what staff typed before sending.
  capture: mndaDetailFields.map(({ id }) => ({
    apiId: id,
    searchable: mndaSearchableDetailFields.includes(id),
  })),
};

/** A contract prepared from a template: the counterparty signs first, then
 * the Fil One countersigner. Whether a template needs approval is recorded
 * on each request; the type declares that approval exists. Staff may fix the
 * counterparty's email until they start signing. */
export const contractSigning: SigningDocumentType<ContractSigningRecord> = {
  bindingKey: "commerce_contract_id",
  slots: [
    {
      id: "counterparty",
      order: 1,
      fields: () => signatureFields,
      correctable: true,
    },
    {
      id: "fil-one",
      order: 2,
      fields: () => signatureFields,
      correctable: false,
    },
  ],
  documentName: (r) => r.documentName,
  fileName: () => "Fil-One-Agreement.pdf",
  subject: (r) => r.documentName,
  message: () =>
    "Please review and sign the attached agreement. Fil One will countersign and you will receive the completed agreement.",
  approval: "two_person",
  copySender: false,
  errorPrefix: "CONTRACT",
  auditPrefix: "contract",
};

/** Interim message pending counsel's wording (EXT-LEGAL-01). */
const counterpartyPaperMessage = (r: ContractSigningRecord) =>
  r.counterpartySigns
    ? "Please review and sign the attached agreement. Fil One will countersign and you will receive the completed agreement."
    : "Please review and sign the attached agreement for Fil One.";

/**
 * A contract on the counterparty's paper: their uploaded PDF, pinned by its
 * SHA-256, with a Fil One signature page appended. Either the counterparty
 * signs first and then the Fil One countersigner, or (`counterpartySigns`
 * false: they signed their paper already) the Fil One countersigner alone;
 * the store's view leaves out a signer who does not sign. Same table, store
 * and approval rule as template contracts.
 */
export const counterpartyPaperSigning: SigningDocumentType<ContractSigningRecord> =
  {
    bindingKey: "commerce_contract_id",
    slots: [
      {
        id: "counterparty",
        order: 1,
        fields: () => signatureFields,
        correctable: true,
      },
      {
        id: "fil-one",
        order: 2,
        fields: () => signatureFields,
        correctable: false,
      },
    ],
    documentName: (r) => r.documentName,
    fileName: () => "Fil-One-Countersignature.pdf",
    subject: (r) => r.documentName,
    message: counterpartyPaperMessage,
    approval: "two_person",
    copySender: false,
    errorPrefix: "CONTRACT",
    auditPrefix: "contract",
  };
