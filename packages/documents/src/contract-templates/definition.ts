import type {
  ContractSigner,
  ContractType,
  TemplateField,
} from "@clockwork/contracts";

export {
  LocalizedTextSchema,
  TemplateFieldSchema,
  TemplateFileSchema,
  standardTemplateTokens,
  type LocalizedText,
  type TemplateBlock,
  type TemplateField,
  type TemplateFile,
} from "@clockwork/contracts";

/**
 * Contract templates for the staff register.
 *
 * A template is data: counsel's approved wording as blocks with `[[field]]`
 * tokens, the fields a seller fills in, and the SHA-256 of counsel's source
 * DOCX. `docs/operations/contract-templates.md` explains how one is added.
 * Until counsel supplies the wording, a contract type is registered as
 * `pending_legal`: listed, never preparable, with no text at all.
 */

/** What a renderer receives: validated values plus both signers. */
export interface PreparedTemplateInput {
  contractId: string;
  counterpartyName: string;
  effectiveDate: string;
  values: Readonly<Record<string, string>>;
  signer: ContractSigner;
  countersigner: ContractSigner;
}

export interface RenderedContract {
  bytes: Buffer;
  sha256: string;
  pages: number;
}

interface TemplateBase {
  id: string;
  contractType: ContractType;
  /** English name, used in the document and the signing email subject. */
  name: string;
}

export interface PendingContractTemplate extends TemplateBase {
  status: "pending_legal";
}

export interface AvailableContractTemplate extends TemplateBase {
  status: "available";
  version: string;
  /** SHA-256 of counsel's source DOCX; snapshotted on every preparation. */
  templateHash: string;
  sourcePath: string;
  requiresApproval: boolean;
  fields: readonly TemplateField[];
  render(input: PreparedTemplateInput): Promise<RenderedContract>;
}

export type ContractTemplate =
  PendingContractTemplate | AvailableContractTemplate;

/** A registry is a list with unique ids and at most one entry per id. */
export type ContractTemplateRegistry = readonly ContractTemplate[];

export function pendingTemplate(
  id: string,
  contractType: ContractType,
  name: string,
): PendingContractTemplate {
  return { id, contractType, name, status: "pending_legal" };
}
