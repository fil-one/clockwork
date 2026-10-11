import type {
  ContractSigner,
  ContractType,
  TemplateDerived,
  TemplateField,
  TemplateSection,
  TemplateValue,
} from "@clockwork/contracts";

export {
  LocalizedTextSchema,
  TemplateContentSchema,
  TemplateFieldSchema,
  TemplateFileSchema,
  TemplateLineItemsSchema,
  standardTemplateTokens,
  type LocalizedText,
  type TemplateBlock,
  type TemplateContent,
  type TemplateField,
  type TemplateFile,
  type TemplateLineItems,
  type TemplateSection,
  type TemplateValue,
} from "@clockwork/contracts";

/**
 * Contract templates for the staff register.
 *
 * A template is data: agreement wording as blocks with `[[field]]` tokens,
 * the fields a seller fills in, the optional sections they may include, and
 * the SHA-256 of that content. Live templates are kept in the template store
 * and managed by commerce administrators; the few kept in code are the test
 * fixture and the guided demo's samples.
 * `docs/operations/contract-templates.md` explains both.
 */

/** What a renderer receives: validated values, the optional sections the
 * seller ticked, and both signers. A `line_items` field's value is a table;
 * every other value is text. */
export interface PreparedTemplateInput {
  contractId: string;
  counterpartyName: string;
  effectiveDate: string;
  values: Readonly<Record<string, TemplateValue>>;
  /** Ticked sections. Sections a choice field controls follow the value. */
  sections: readonly string[];
  /** A specimen: every optional section in, whatever the choices. */
  everySection?: boolean;
  /** Printed on every page and in the PDF title of a preview or specimen,
   * such as `SPECIMEN`. Never set for a prepared contract. */
  marking?: "SPECIMEN" | "PREVIEW, NOT FOR SIGNATURE";
  signer: ContractSigner;
  countersigner: ContractSigner;
}

export interface RenderedContract {
  bytes: Buffer;
  sha256: string;
  pages: number;
}

export interface AvailableContractTemplate {
  /** The template key, shared by every version. */
  id: string;
  contractType: ContractType;
  /** English name, used in the document and the signing email subject. */
  name: string;
  version: string;
  /** SHA-256 of the template content; snapshotted on every preparation. */
  templateHash: string;
  sourceNote: string;
  requiresApproval: boolean;
  fields: readonly TemplateField[];
  sections: readonly TemplateSection[];
  derived: readonly TemplateDerived[];
  render(input: PreparedTemplateInput): Promise<RenderedContract>;
}

export type ContractTemplate = AvailableContractTemplate;

/** A registry is a list with unique ids and at most one entry per id. */
export type ContractTemplateRegistry = readonly ContractTemplate[];

/**
 * Where preparation reads templates: the template store in production, a
 * code registry in tests and the guided demo.
 */
export interface ContractTemplateSource {
  /** The version of each template that is in use, by name. */
  listActive(): Promise<readonly ContractTemplate[]>;
  /** The version in use; `CONTRACT_TEMPLATE_NOT_FOUND` when there is none. */
  active(id: string): Promise<ContractTemplate>;
  /** That exact version, while it is the one in use; otherwise
   * `CONTRACT_TEMPLATE_VERSION_CHANGED`, so a form built for an older
   * version is never prepared against newer wording. */
  version(id: string, version: string): Promise<ContractTemplate>;
}
